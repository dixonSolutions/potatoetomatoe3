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
	release: [] as Array<() => void>
}));

vi.mock('./game-browser-storage', () => ({
	loadGameBrowserProfile: async (gameId: string) => {
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
	preloadGameBrowserProfile
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
		stop();
	});

	it('answers a real "no saves" with null', async () => {
		const app = fakeAppWindow();
		vi.stubGlobal('window', app);
		const stop = attachGameStorageBridge();
		const frame = fakeWindow(app);

		app.send(frame, 'pull', 'no-saves');
		await settle();
		expect(hydrates(frame)).toEqual([expect.objectContaining({ data: null })]);
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
