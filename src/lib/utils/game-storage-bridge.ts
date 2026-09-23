/**
 * Persists in-game browser storage in per-game profiles (disk or IndexedDB)
 * so offline and online play share the same save data.
 *
 * The in-frame half is `static/game-storage-bridge.child.js`, which gives every game a
 * virtual localStorage / sessionStorage / cookie jar of its own. It boots from the
 * profile this module preloads onto `window.__ptGameProfiles` when it can read it
 * synchronously (same-origin frames), and pulls it over postMessage otherwise.
 *
 * Nothing is answered or written on the strength of a failed read. The frame holds its
 * pushes until it has an answer and asks again with backoff; the app holds pushes it could
 * not merge until the stored profile can be read.
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

/** True when `source` is a frame nested somewhere inside this window. */
function isDescendantFrame(source: MessageEventSource | null): boolean {
	if (!source || typeof window === 'undefined') return false;
	const visit = (win: Window, depth: number): boolean => {
		if (depth > 6) return false;
		let count = 0;
		try {
			count = win.frames.length;
		} catch {
			return false;
		}
		for (let i = 0; i < count; i++) {
			let child: Window | null = null;
			try {
				child = win.frames[i];
			} catch {
				continue;
			}
			if (!child) continue;
			if (child === source) return true;
			if (visit(child, depth + 1)) return true;
		}
		return false;
	};
	return visit(window, 0);
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
		if (msg.action !== 'pull' && msg.action !== 'push') return;
		/*
		 * Only the game frames this page hosts may read or write a game's saves. A frame
		 * being torn down flushes from its pagehide, by which point it is no longer in the
		 * frame tree — its WindowProxy reports closed, which no live foreign window does.
		 */
		const closingFrame = msg.action === 'push' && Boolean((event.source as Window | null)?.closed);
		if (!isDescendantFrame(event.source) && !closingFrame) return;
		const gameId = msg.gameId;

		if (msg.action === 'pull') {
			void preloadGameBrowserProfile(gameId).then((stored) => {
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
