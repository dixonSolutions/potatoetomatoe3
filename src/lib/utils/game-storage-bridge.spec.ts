import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyGameBrowserProfile, type GameBrowserProfile } from './game-browser-profile';

const store = vi.hoisted(() => ({
	/** What each game has saved; a missing key is a game with no saves. */
	saved: new Map<string, GameBrowserProfile>(),
	/** Games whose saves cannot be read right now. */
	readFails: new Set<string>(),
	writes: [] as Array<{ gameId: string; profile: GameBrowserProfile }>,
	/** When set, each write waits until the test lets it finish. */
	slow: false,
	release: [] as Array<() => void>,
	/** Reads made of the store. */
	reads: 0
}));

vi.mock('./game-browser-storage', () => ({
	loadGameBrowserProfile: async (gameId: string) => {
		store.reads++;
		if (store.readFails.has(gameId)) throw new Error('store unavailable');
		return store.saved.get(gameId) ?? null;
	},
	saveGameBrowserProfile: (gameId: string, profile: GameBrowserProfile) =>
		new Promise<void>((resolve) => {
			const copy = JSON.parse(JSON.stringify(profile)) as GameBrowserProfile;
			store.writes.push({ gameId, profile: copy });
			const finish = () => {
				store.saved.set(gameId, copy);
				resolve();
			};
			if (store.slow) store.release.push(finish);
			else finish();
		})
}));
vi.mock('./play-diagnostics-log', () => ({ appendPlayLog: () => {} }));

const {
	GAME_STORAGE_MESSAGE_TYPE,
	attachGameStorageBridge,
	captureGameStorageFromIframe,
	flushGameFrame,
	mayTouchGameSaves,
	noteGameFrameTree,
	preloadGameBrowserProfile,
	registerGameFrameHost
} = await import('./game-storage-bridge');

function profileWith(buckets: Record<string, Record<string, string>>): GameBrowserProfile {
	const profile = emptyGameBrowserProfile();
	profile.updatedAt = Date.now();
	profile.profile.Default.localStorage = buckets;
	return profile;
}

function pushFrom(origin: string, key: string, value: string): HTMLIFrameElement {
	const profile = profileWith({ [origin]: { [key]: value } });
	return {
		contentWindow: { __ptStorageBridge: { takeDirtySnapshot: () => profile } }
	} as unknown as HTMLIFrameElement;
}

/** A window in a frame tree: `parent` is itself for the top, as in a browser. */
interface FakeWindow {
	parent: FakeWindow | null;
	frames: FakeWindow[];
	closed: boolean;
	postMessage: ReturnType<typeof vi.fn>;
}

function fakeWindow(parent?: FakeWindow): FakeWindow {
	const win: FakeWindow = { parent: null, frames: [], closed: false, postMessage: vi.fn() };
	win.parent = parent ?? win;
	parent?.frames.push(win);
	return win;
}

/** The frame going away: detached windows report closed and have no parent. */
function detach(win: FakeWindow): void {
	win.closed = true;
	win.parent = null;
}

function hostFrame(win: FakeWindow): HTMLIFrameElement {
	return { contentWindow: win } as unknown as HTMLIFrameElement;
}

/** The app window: the message target, and where the preloaded profiles live. */
function fakeAppWindow() {
	const listeners: Array<(event: MessageEvent) => void> = [];
	const win = Object.assign(fakeWindow(), {
		__ptGameProfiles: undefined as Record<string, GameBrowserProfile | null> | undefined,
		addEventListener: (_type: string, fn: (event: MessageEvent) => void) => listeners.push(fn),
		removeEventListener: (_type: string, fn: (event: MessageEvent) => void) =>
			listeners.splice(listeners.indexOf(fn), 1),
		send(source: FakeWindow, action: string, gameId: string, data?: GameBrowserProfile) {
			const event = {
				source,
				data: { type: GAME_STORAGE_MESSAGE_TYPE, action, gameId, data }
			} as unknown as MessageEvent;
			for (const fn of [...listeners]) fn(event);
		}
	});
	return win;
}

const settle = async () => {
	for (let i = 0; i < 10; i++) await Promise.resolve();
	await new Promise((r) => setTimeout(r, 0));
};

function hydrates(win: FakeWindow) {
	return win.postMessage.mock.calls
		.map(([msg]) => msg as { action: string; data: unknown })
		.filter((msg) => msg.action === 'hydrate');
}

beforeEach(() => {
	store.saved.clear();
	store.readFails.clear();
	store.writes = [];
	store.slow = false;
	store.release = [];
	store.reads = 0;
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('game-storage-bridge saves', () => {
	it('folds pushes that arrive during a slow write into one next write', async () => {
		store.slow = true;
		const first = captureGameStorageFromIframe(pushFrom('https://a', 'n', '1'), 'g');
		await settle();
		expect(store.writes).toHaveLength(1);

		/* Three more pushes while the first write is still running. */
		const rest = [
			captureGameStorageFromIframe(pushFrom('https://a', 'n', '2'), 'g'),
			captureGameStorageFromIframe(pushFrom('https://b', 'm', '1'), 'g'),
			captureGameStorageFromIframe(pushFrom('https://a', 'n', '3'), 'g')
		];
		store.release.shift()?.();
		await first;
		await settle();
		expect(store.writes).toHaveLength(2);
		store.release.shift()?.();
		await Promise.all(rest);

		expect(store.writes).toHaveLength(2);
		expect(store.saved.get('g')?.profile.Default.localStorage).toEqual({
			'https://a': { n: '3' },
			'https://b': { m: '1' }
		});
	});
});

describe('a failed save read is not "no saves"', () => {
	it('does not answer a pull while the saves cannot be read, and answers once they can', async () => {
		const app = fakeAppWindow();
		vi.stubGlobal('window', app);
		const stop = attachGameStorageBridge();
		const frame = fakeWindow(app);
		const unregister = registerGameFrameHost(hostFrame(frame), 'pull-fail');
		const saves = profileWith({ 'https://a': { level: '9' } });
		store.saved.set('pull-fail', saves);
		store.readFails.add('pull-fail');

		app.send(frame, 'pull', 'pull-fail');
		await settle();
		expect(hydrates(frame)).toEqual([]);
		/* Nor may a same-origin frame boot from "no saves". */
		expect(app.__ptGameProfiles && 'pull-fail' in app.__ptGameProfiles).toBe(false);

		store.readFails.delete('pull-fail');
		app.send(frame, 'pull', 'pull-fail');
		await settle();
		expect(hydrates(frame)).toEqual([expect.objectContaining({ data: saves })]);
		unregister();
		stop();
	});

	it('answers a real "no saves" with null', async () => {
		const app = fakeAppWindow();
		vi.stubGlobal('window', app);
		const stop = attachGameStorageBridge();
		const frame = fakeWindow(app);
		const unregister = registerGameFrameHost(hostFrame(frame), 'no-saves');

		app.send(frame, 'pull', 'no-saves');
		await settle();
		expect(hydrates(frame)).toEqual([expect.objectContaining({ data: null })]);
		unregister();
		stop();
	});

	it('answers from what the session already knows when a later read fails', async () => {
		const app = fakeAppWindow();
		vi.stubGlobal('window', app);
		const saves = profileWith({ 'https://a': { level: '4' } });
		store.saved.set('known', saves);
		expect(await preloadGameBrowserProfile('known')).toEqual(saves);
		store.readFails.add('known');
		expect(await preloadGameBrowserProfile('known')).toEqual(saves);

		store.readFails.add('never-read');
		expect(await preloadGameBrowserProfile('never-read')).toBeUndefined();
	});

	it('answers a pull from what the page already knows, with no read', async () => {
		/* An app-made shell's loader waits on this answer before the game starts. */
		const app = fakeAppWindow();
		vi.stubGlobal('window', app);
		const stop = attachGameStorageBridge();
		const frame = fakeWindow(app);
		const unregister = registerGameFrameHost(hostFrame(frame), 'known-pull');
		const saves = profileWith({ 'https://a': { level: '7' } });
		store.saved.set('known-pull', saves);
		await preloadGameBrowserProfile('known-pull');
		const readsBefore = store.reads;

		app.send(frame, 'pull', 'known-pull');
		await settle();
		expect(hydrates(frame)).toEqual([expect.objectContaining({ data: saves })]);
		expect(store.reads).toBe(readsBefore);
		unregister();
		stop();
	});

	it('answers a pull that follows a push with that push in it (a frame reloading)', async () => {
		const app = fakeAppWindow();
		vi.stubGlobal('window', app);
		const stop = attachGameStorageBridge();
		const frame = fakeWindow(app);
		const unregister = registerGameFrameHost(hostFrame(frame), 'reloading');
		store.saved.set('reloading', profileWith({ 'https://a': { level: '1' } }));
		await preloadGameBrowserProfile('reloading');
		/* A slow store: the push's write is still running when the pull comes in. */
		store.slow = true;
		app.send(frame, 'push', 'reloading', profileWith({ 'https://a': { level: '2' } }));
		app.send(frame, 'pull', 'reloading');
		await settle();
		store.release.shift()?.();
		await settle();
		const answers = hydrates(frame);
		expect(answers).toHaveLength(1);
		expect(
			(answers[0].data as GameBrowserProfile).profile.Default.localStorage['https://a']
		).toEqual({ level: '2' });
		unregister();
		stop();
	});

	it('holds pushes while the stored profile cannot be read, then merges them over it', async () => {
		vi.useFakeTimers();
		store.saved.set(
			'held',
			profileWith({ 'https://a': { save: '10' }, 'https://offline': { save: '12' } })
		);
		store.readFails.add('held');

		await captureGameStorageFromIframe(pushFrom('https://a', 'save', '1'), 'held');
		await captureGameStorageFromIframe(pushFrom('https://a', 'late', 'x'), 'held');
		expect(store.writes).toEqual([]);

		/* Still failing at the first retry: still nothing written. */
		await vi.advanceTimersByTimeAsync(2_000);
		expect(store.writes).toEqual([]);

		store.readFails.delete('held');
		await vi.advanceTimersByTimeAsync(4_000);
		expect(store.writes).toHaveLength(1);
		/* The other origin's saves survive; the held pushes land on top, newest last. */
		expect(store.saved.get('held')?.profile.Default.localStorage).toEqual({
			'https://a': { late: 'x' },
			'https://offline': { save: '12' }
		});
	});
});

describe("a game's saves belong to the frame hosting it", () => {
	it('accepts the hosting frame and frames nested in it, for that game only', () => {
		const app = fakeWindow();
		const game = fakeWindow(app);
		const shell = fakeWindow(game);
		const inner = fakeWindow(shell);
		const unregister = registerGameFrameHost(hostFrame(game), 'a');

		expect(mayTouchGameSaves(game as unknown as Window, 'a', 'pull')).toBe(true);
		expect(mayTouchGameSaves(inner as unknown as Window, 'a', 'push')).toBe(true);
		/* A frame inside game a cannot read or write game b's saves. */
		expect(mayTouchGameSaves(inner as unknown as Window, 'b', 'pull')).toBe(false);
		expect(mayTouchGameSaves(inner as unknown as Window, 'b', 'push')).toBe(false);
		unregister();
	});

	it('refuses frames outside the hosting frame, the app itself included', () => {
		const app = fakeWindow();
		const game = fakeWindow(app);
		const ad = fakeWindow(app);
		const otherGame = fakeWindow(app);
		const unregisterA = registerGameFrameHost(hostFrame(game), 'a');
		const unregisterB = registerGameFrameHost(hostFrame(otherGame), 'b');

		expect(mayTouchGameSaves(ad as unknown as Window, 'a', 'push')).toBe(false);
		expect(mayTouchGameSaves(app as unknown as Window, 'a', 'pull')).toBe(false);
		expect(mayTouchGameSaves(otherGame as unknown as Window, 'a', 'push')).toBe(false);
		expect(mayTouchGameSaves(null, 'a', 'push')).toBe(false);
		unregisterA();
		unregisterB();
	});

	it('lets a closing frame flush only the game it was seen hosting', () => {
		const app = fakeWindow();
		const game = fakeWindow(app);
		const nested = fakeWindow(game);
		const stranger = fakeWindow(app);
		const iframe = hostFrame(game);
		const unregister = registerGameFrameHost(iframe, 'a');
		noteGameFrameTree(iframe, 'a');
		unregister();
		detach(game);
		detach(nested);
		detach(stranger);

		expect(mayTouchGameSaves(game as unknown as Window, 'a', 'push')).toBe(true);
		expect(mayTouchGameSaves(nested as unknown as Window, 'a', 'push')).toBe(true);
		expect(mayTouchGameSaves(game as unknown as Window, 'b', 'push')).toBe(false);
		/* Closed is not enough: it has to have been one of this game's frames. */
		expect(mayTouchGameSaves(stranger as unknown as Window, 'a', 'push')).toBe(false);
		/* And a closing frame only flushes; it cannot read. */
		expect(mayTouchGameSaves(game as unknown as Window, 'a', 'pull')).toBe(false);
	});

	it('keeps a frame with its first game when the page moves on: A → B keeps A’s last push', () => {
		const app = fakeWindow();
		const frameA = fakeWindow(app);
		const iframeA = hostFrame(frameA);
		const unregisterA = registerGameFrameHost(iframeA, 'a');
		/* The page switches to game b while a's frame is still up, and asks to host b in it. */
		const stray = registerGameFrameHost(iframeA, 'b');
		expect(mayTouchGameSaves(frameA as unknown as Window, 'a', 'push')).toBe(true);
		expect(mayTouchGameSaves(frameA as unknown as Window, 'b', 'pull')).toBe(false);
		stray();
		unregisterA();
		/* Reused once a is unregistered: its windows still belong to a. */
		const reused = registerGameFrameHost(iframeA, 'b');
		reused();
		const frameB = fakeWindow(app);
		const unregisterB = registerGameFrameHost(hostFrame(frameB), 'b');
		/* a's frame goes; its last push, sent as it unloads, is still a's. */
		detach(frameA);
		expect(mayTouchGameSaves(frameA as unknown as Window, 'a', 'push')).toBe(true);
		expect(mayTouchGameSaves(frameA as unknown as Window, 'b', 'push')).toBe(false);
		expect(mayTouchGameSaves(frameB as unknown as Window, 'b', 'pull')).toBe(true);
		unregisterB();
	});

	it('remembers frames that spoke while attached, even if they appeared after load', () => {
		const app = fakeWindow();
		const game = fakeWindow(app);
		const unregister = registerGameFrameHost(hostFrame(game), 'a');
		const late = fakeWindow(game);
		expect(mayTouchGameSaves(late as unknown as Window, 'a', 'pull')).toBe(true);
		unregister();
		detach(late);
		expect(mayTouchGameSaves(late as unknown as Window, 'a', 'push')).toBe(true);
	});

	it('asks a frame for its last push before it goes, and waits for the answer', async () => {
		const app = fakeAppWindow();
		vi.stubGlobal('window', app);
		const stop = attachGameStorageBridge();
		const game = fakeWindow(app);
		const iframe = hostFrame(game);
		const unregister = registerGameFrameHost(iframe, 'leaving');
		/* The bridge in the frame: push what it holds, then say so. */
		game.postMessage.mockImplementation((msg: { action?: string }) => {
			if (msg.action !== 'flush') return;
			app.send(game, 'push', 'leaving', profileWith({ 'https://x': { last: 'yes' } }));
			app.send(game, 'flushed', 'leaving');
		});
		let settled = false;
		const flushed = flushGameFrame(iframe, 'leaving').then(() => (settled = true));
		await settle();
		expect(settled).toBe(true);
		await flushed;
		await settle();
		expect(store.saved.get('leaving')?.profile.Default.localStorage['https://x']).toEqual({
			last: 'yes'
		});
		unregister();
		stop();
	});

	it('gives up on a frame that cannot answer', async () => {
		vi.useFakeTimers();
		const app = fakeAppWindow();
		vi.stubGlobal('window', app);
		const stop = attachGameStorageBridge();
		const game = fakeWindow(app);
		let settled = false;
		void flushGameFrame(hostFrame(game), 'silent', 300).then(() => (settled = true));
		await vi.advanceTimersByTimeAsync(299);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(2);
		expect(settled).toBe(true);
		stop();
	});

	it('writes nothing for a push from a foreign frame', async () => {
		const app = fakeAppWindow();
		vi.stubGlobal('window', app);
		const stop = attachGameStorageBridge();
		const game = fakeWindow(app);
		const nested = fakeWindow(game);
		const foreign = fakeWindow(app);
		const unregister = registerGameFrameHost(hostFrame(game), 'mine');

		app.send(foreign, 'push', 'mine', profileWith({ 'https://x': { save: '999' } }));
		app.send(nested, 'push', 'theirs', profileWith({ 'https://x': { save: '999' } }));
		app.send(foreign, 'pull', 'mine');
		await settle();
		expect(store.writes).toEqual([]);
		expect(foreign.postMessage).not.toHaveBeenCalled();

		app.send(nested, 'push', 'mine', profileWith({ 'https://x': { save: '1' } }));
		await settle();
		expect(store.writes.map((w) => w.gameId)).toEqual(['mine']);
		unregister();
		stop();
	});
});
