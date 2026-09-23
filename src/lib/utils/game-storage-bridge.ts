/**
 * Persists in-game browser storage in per-game profiles (disk or IndexedDB)
 * so offline and online play share the same save data.
 *
 * The in-frame half is `static/game-storage-bridge.child.js`, which gives every game a
 * virtual localStorage / sessionStorage / cookie jar of its own. It boots from the
 * profile this module preloads onto `window.__ptGameProfiles` when it can read it
 * synchronously (same-origin frames), and pulls it over postMessage otherwise.
 *
 * Two rules hold everything else up:
 *   - A game's saves are read and written only by the frame the page hosts that game in
 *     (`registerGameFrameHost`), or a frame nested inside it.
 *   - Nothing is answered or written on the strength of a failed read. The frame holds its
 *     pushes until it has an answer and asks again with backoff; the app holds pushes it
 *     could not merge until the stored profile can be read.
 */

import {
	isGameBrowserProfile,
	mergeGameBrowserProfiles,
	type GameBrowserProfile
} from './game-browser-profile';
import { loadGameBrowserProfile, saveGameBrowserProfile } from './game-browser-storage';
import { appendPlayLog } from './play-diagnostics-log';

export const GAME_STORAGE_MESSAGE_TYPE = 'potato-tomato-game-storage';

/** @deprecated Use GameBrowserProfile via game-browser-storage */
export interface GameBrowserData {
	localStorage: Record<string, string>;
	updatedAt: number;
}

type ProfileBag = Record<string, GameBrowserProfile | null>;

/**
 * Profiles the child bridge can read synchronously at boot. A key that is present with
 * `null` means "known to have no saves" — the bridge then skips the postMessage pull. A
 * game whose read failed has no key at all, so its frame pulls and waits.
 */
function profileBag(): ProfileBag | null {
	if (typeof window === 'undefined') return null;
	const w = window as unknown as { __ptGameProfiles?: ProfileBag };
	if (!w.__ptGameProfiles) w.__ptGameProfiles = Object.create(null) as ProfileBag;
	return w.__ptGameProfiles ?? null;
}

function rememberProfile(gameId: string, profile: GameBrowserProfile | null): void {
	const bag = profileBag();
	if (bag) bag[gameId] = profile;
}

/** What this page already knows of the game's saves; `undefined` when it knows nothing. */
function knownProfile(gameId: string): GameBrowserProfile | null | undefined {
	const bag = profileBag();
	return bag ? bag[gameId] : undefined;
}

function reportReadFailure(gameId: string, error: unknown, what: string): void {
	appendPlayLog(
		'warn',
		'saves',
		`Could not read this game's saves — ${what}`,
		`game=${gameId} ${error instanceof Error ? error.message : String(error)}`
	);
}

const inflight = new Map<string, Promise<GameBrowserProfile | null | undefined>>();

/**
 * Load a game's saved profile ahead of launch so the frame can boot from it without a
 * round trip. Safe to call repeatedly; concurrent calls share one read.
 *
 * Resolves to the profile, `null` when the game has no saves, or `undefined` when the read
 * failed and nothing earlier in this session says what the saves are. Never rejects.
 */
export function preloadGameBrowserProfile(
	gameId: string
): Promise<GameBrowserProfile | null | undefined> {
	if (!gameId) return Promise.resolve(null);
	const pending = inflight.get(gameId);
	if (pending) return pending;
	const task = loadGameBrowserProfile(gameId)
		.then(
			(profile) => {
				/* Never downgrade a profile a push already refreshed while this read ran. */
				const current = knownProfile(gameId);
				if (current && (!profile || current.updatedAt >= profile.updatedAt)) return current;
				rememberProfile(gameId, profile);
				return profile;
			},
			(error: unknown) => {
				/*
				 * Not "no saves". Leave the bag alone, so a same-origin frame pulls instead of
				 * booting empty, and fall back only on what an earlier read (plus the pushes
				 * since) established.
				 */
				reportReadFailure(gameId, error, 'the game waits for them');
				return knownProfile(gameId);
			}
		)
		.finally(() => inflight.delete(gameId));
	inflight.set(gameId, task);
	return task;
}

/** One write at a time per game, so two quick pushes cannot interleave load → merge → save. */
const saveChains = new Map<string, Promise<void>>();
/**
 * Pushes that arrived while a write was running, folded into one. A game that writes every
 * frame pushes every 800 ms; against a store slower than that (a busy puller), chaining one
 * whole-profile write per push queued copies without bound. Folding is exact: merging is
 * per origin bucket and per database, newest wins, so merge(merge(a, b), c) is what writing
 * a, b and c in turn would have stored.
 */
const pendingSaves = new Map<
	string,
	{ incoming: GameBrowserProfile | null; done: Promise<void> }
>();
/**
 * Pushes that could not be merged because the stored profile could not be read. Kept in
 * memory, under anything pushed later, until a read succeeds: writing them on their own
 * would replace the saves, and dropping them would lose the session.
 */
const heldSaves = new Map<string, GameBrowserProfile>();
const heldRetry = new Map<string, { timer: ReturnType<typeof setTimeout> | null; delay: number }>();
const HELD_RETRY_FIRST_MS = 2_000;
const HELD_RETRY_MAX_MS = 60_000;

function retryHeldSave(gameId: string): void {
	const state = heldRetry.get(gameId) ?? { timer: null, delay: HELD_RETRY_FIRST_MS };
	if (state.timer) return;
	const delay = state.delay;
	state.delay = Math.min(delay * 2, HELD_RETRY_MAX_MS);
	state.timer = setTimeout(() => {
		state.timer = null;
		/* A write already queued folds the held pushes in when it runs. */
		if (heldSaves.has(gameId) && !pendingSaves.has(gameId)) void queueSave(gameId, null);
	}, delay);
	heldRetry.set(gameId, state);
}

function clearHeldRetry(gameId: string): void {
	const state = heldRetry.get(gameId);
	if (state?.timer) clearTimeout(state.timer);
	heldRetry.delete(gameId);
}

function queueSave(gameId: string, incoming: GameBrowserProfile | null): Promise<void> {
	const waiting = pendingSaves.get(gameId);
	if (waiting) {
		if (incoming) {
			waiting.incoming = waiting.incoming
				? mergeGameBrowserProfiles(waiting.incoming, incoming)
				: incoming;
		}
		return waiting.done;
	}
	const prev = saveChains.get(gameId) ?? Promise.resolve();
	const entry = { incoming, done: Promise.resolve() };
	pendingSaves.set(gameId, entry);
	const next = prev
		.catch(() => undefined)
		.then(async () => {
			/* From here on a new push starts the next write instead of joining this one. */
			pendingSaves.delete(gameId);
			/* Pushes held back by an earlier failed read are older: they go underneath. */
			const held = heldSaves.get(gameId);
			heldSaves.delete(gameId);
			const unsaved =
				held && entry.incoming
					? mergeGameBrowserProfiles(held, entry.incoming)
					: (entry.incoming ?? held);
			if (!unsaved) return;
			let existing = knownProfile(gameId);
			if (existing === undefined) {
				try {
					existing = await loadGameBrowserProfile(gameId);
				} catch (error) {
					heldSaves.set(gameId, unsaved);
					retryHeldSave(gameId);
					reportReadFailure(gameId, error, 'holding its progress until they can be read');
					return;
				}
			}
			clearHeldRetry(gameId);
			const merged = mergeGameBrowserProfiles(existing, unsaved);
			rememberProfile(gameId, merged);
			await saveGameBrowserProfile(gameId, merged);
		});
	entry.done = next;
	saveChains.set(gameId, next);
	return next;
}

/* ------------------------------------------------------------------------------------
 * Which frame may touch which game's saves
 * ---------------------------------------------------------------------------------- */

/** Frames the page is hosting a game in, with that game's id. */
const hostedFrames = new Map<HTMLIFrameElement, string>();
/**
 * Windows seen inside a frame hosting a game, with that game's id. A window keeps its
 * identity across navigations of its frame, and after the frame is removed: that is what
 * lets a frame's last push, sent from `pagehide` once it is no longer in the frame tree,
 * through — for the game it was hosting, and no other. Weak, so a removed game's documents
 * are not kept alive by it.
 */
const knownFrames = new WeakMap<object, string>();
/* Portal shells nest the game a few frames deep; nothing legitimate goes this far. */
const MAX_FRAME_DEPTH = 12;

/**
 * A window is attributed to the first game it was seen hosting, and never moved to
 * another: the game page gives every game a frame of its own, so a window that shows up
 * under a second game is the first game's frame being reused, and its last push — sent
 * as it unloads — still belongs to the first.
 */
function rememberWindow(win: object, gameId: string): void {
	if (!knownFrames.has(win)) knownFrames.set(win, gameId);
}

function rememberFrameTree(win: Window | null, gameId: string, depth = 0): void {
	if (!win || depth > MAX_FRAME_DEPTH) return;
	rememberWindow(win, gameId);
	let count = 0;
	try {
		count = win.frames.length;
	} catch {
		return;
	}
	for (let i = 0; i < count; i++) {
		let child: Window | null = null;
		try {
			child = win.frames[i];
		} catch {
			continue;
		}
		rememberFrameTree(child, gameId, depth + 1);
	}
}

/**
 * The page hosts `gameId` in `iframe`: from now on only that frame, and frames nested in
 * it, may read or write the game's saves. Returns the unregister function.
 */
export function registerGameFrameHost(iframe: HTMLIFrameElement, gameId: string): () => void {
	const hosting = hostedFrames.get(iframe);
	/* A frame already hosting another game keeps it (see `rememberWindow`). */
	if (hosting !== undefined && hosting !== gameId) return () => {};
	hostedFrames.set(iframe, gameId);
	rememberFrameTree(iframe.contentWindow, gameId);
	return () => {
		if (hostedFrames.get(iframe) !== gameId) return;
		/* Documents still in it flush on pagehide, after it has left the tree. */
		rememberFrameTree(iframe.contentWindow, gameId);
		hostedFrames.delete(iframe);
	};
}

/**
 * Note every frame currently inside the hosting frame — the frame's `load` is a good time:
 * a portal shell has built its game frame by then. A frame nested in the game that never
 * spoke while attached can then still flush on its way out.
 */
export function noteGameFrameTree(iframe: HTMLIFrameElement, gameId: string): void {
	if (hostedFrames.get(iframe) === gameId) rememberFrameTree(iframe.contentWindow, gameId);
}

function isWindow(source: MessageEventSource | null): source is Window {
	if (!source || typeof source !== 'object') return false;
	try {
		return 'parent' in source && typeof (source as Window).postMessage === 'function';
	} catch {
		return false;
	}
}

/**
 * True when `source` is the window of a frame this page hosts `gameId` in, or a window
 * nested under it. Walks up through `parent`, which every window may read, cross-origin
 * included — so a native-injected game frame on its own host qualifies, and a frame the
 * page did not create for this game (another game's, an ad in the app page) does not.
 */
function isInsideHostOf(source: Window, gameId: string): boolean {
	const hosts = new Set<Window>();
	for (const [iframe, id] of hostedFrames) {
		if (id !== gameId) continue;
		const win = iframe.contentWindow;
		if (win) hosts.add(win);
	}
	if (!hosts.size) return false;
	let win: Window = source;
	for (let depth = 0; depth <= MAX_FRAME_DEPTH; depth++) {
		if (hosts.has(win)) return true;
		let parent: Window | null = null;
		try {
			parent = win.parent;
		} catch {
			return false;
		}
		if (!parent || parent === win) return false;
		win = parent;
	}
	return false;
}

function isClosed(win: Window): boolean {
	try {
		return win.closed;
	} catch {
		return false;
	}
}

/** Whether a storage message about `gameId` from `source` may be acted on. */
export function mayTouchGameSaves(
	source: MessageEventSource | null,
	gameId: string,
	action: string
): boolean {
	if (!isWindow(source)) return false;
	if (isInsideHostOf(source, gameId)) {
		rememberWindow(source, gameId);
		return true;
	}
	/*
	 * A frame being torn down flushes from its pagehide, by which point it is no longer in
	 * the frame tree — its window reports closed, and has no parent to walk. Its push counts
	 * only if that window was seen hosting this game while it was attached.
	 */
	return action === 'push' && isClosed(source) && knownFrames.get(source) === gameId;
}

/** Frames asked to flush, and what to call when they say they have. */
const flushWaiters = new Map<MessageEventSource, () => void>();

/**
 * Ask the game in `iframe` to push what it has not pushed yet, before the page takes the
 * frame away (another game, another page, a restart).
 *
 * A frame counts on its `pagehide` push for the last of its saves, but a frame on an origin
 * of its own — an app-made shell in its sandbox, a relayed game — runs in a process of its
 * own in Chromium, and what it posts as its frame is removed never arrives. So the last
 * push is asked for while the frame is still there. Resolves when the frame has answered
 * (its push is queued by then), or after `timeoutMs` for a frame that cannot answer.
 */
export function flushGameFrame(
	iframe: HTMLIFrameElement | null | undefined,
	gameId: string,
	timeoutMs = 500
): Promise<void> {
	let win: Window | null = null;
	try {
		win = iframe?.contentWindow ?? null;
	} catch {
		win = null;
	}
	if (!win || !gameId) return Promise.resolve();
	const target = win;
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			if (flushWaiters.get(target) === done) flushWaiters.delete(target);
			resolve();
		};
		const timer = setTimeout(done, timeoutMs);
		flushWaiters.set(target, done);
		try {
			target.postMessage({ type: GAME_STORAGE_MESSAGE_TYPE, action: 'flush', gameId }, '*');
		} catch {
			done();
		}
	});
}

export function attachGameStorageBridge(): () => void {
	if (typeof window === 'undefined') return () => {};

	const onMessage = (event: MessageEvent) => {
		const msg = event.data as {
			type?: string;
			action?: string;
			gameId?: string;
			data?: GameBrowserProfile;
		};
		if (!msg || msg.type !== GAME_STORAGE_MESSAGE_TYPE || typeof msg.gameId !== 'string') return;
		if (msg.action === 'flushed') {
			if (event.source) flushWaiters.get(event.source)?.();
			return;
		}
		if (msg.action !== 'pull' && msg.action !== 'push') return;
		if (!mayTouchGameSaves(event.source, msg.gameId, msg.action)) return;
		const gameId = msg.gameId;

		if (msg.action === 'pull') {
			/*
			 * What this page already knows is the answer, as a same-origin frame reads it from
			 * the bag: the stored profile plus every push since — once the pushes already queued
			 * are in. A frame that reloads flushes its last push on the way out and asks for its
			 * saves on the way back in; it must get that push back. A game in an app-made shell
			 * waits on this answer before it starts.
			 */
			const queued = saveChains.get(gameId) ?? Promise.resolve();
			const answer = queued
				.catch(() => undefined)
				.then(() => {
					const known = knownProfile(gameId);
					return known !== undefined ? known : preloadGameBrowserProfile(gameId);
				});
			void answer.then((stored) => {
				/*
				 * The read failed: say nothing. The frame keeps its pushes held and asks again
				 * with backoff; answering "no saves" would let its first push replace them.
				 */
				if (stored === undefined) return;
				const source = event.source as Window | null;
				if (!source || typeof source.postMessage !== 'function') return;
				/* `null` tells the bridge there is nothing to wait for. */
				source.postMessage(
					{ type: GAME_STORAGE_MESSAGE_TYPE, action: 'hydrate', gameId, data: stored },
					'*'
				);
			});
			return;
		}

		if (msg.data && isGameBrowserProfile(msg.data)) {
			void queueSave(gameId, msg.data);
		}
	};

	window.addEventListener('message', onMessage);
	return () => window.removeEventListener('message', onMessage);
}

/**
 * Ask the frame's bridge to write out everything it holds before the frame goes away.
 *
 * This used to read `iframe.contentWindow.localStorage` directly and save that as the
 * profile — which, for a same-origin game, was the app's entire localStorage (every
 * other game's keys and the app's own settings) and replaced the profile wholesale,
 * dropping its cookies and IndexedDB. The bridge knows exactly what the game wrote.
 */
export async function captureGameStorageFromIframe(
	iframe: HTMLIFrameElement,
	gameId: string
): Promise<void> {
	let snapshot: unknown = null;
	try {
		const win = iframe.contentWindow as
			| (Window & { __ptStorageBridge?: { takeDirtySnapshot?: () => unknown } })
			| null;
		snapshot = win?.__ptStorageBridge?.takeDirtySnapshot?.() ?? null;
	} catch {
		/* cross-origin frame — its bridge flushes itself on pagehide */
		return;
	}
	if (snapshot && isGameBrowserProfile(snapshot)) {
		/* Copy out of the frame's realm before it is torn down. */
		await queueSave(gameId, JSON.parse(JSON.stringify(snapshot)) as GameBrowserProfile);
	}
}
