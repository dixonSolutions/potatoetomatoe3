/**
 * Persists in-game browser storage in per-game profiles (disk or IndexedDB)
 * so offline and online play share the same save data.
 *
 * The in-frame half is `static/game-storage-bridge.child.js`, which gives every game a
 * virtual localStorage / sessionStorage / cookie jar of its own. It boots from the
 * profile this module preloads onto `window.__ptGameProfiles` when it can read it
 * synchronously (same-origin frames), and pulls it over postMessage otherwise.
 */

import {
	isGameBrowserProfile,
	mergeGameBrowserProfiles,
	type GameBrowserProfile
} from './game-browser-profile';
import { loadGameBrowserProfile, saveGameBrowserProfile } from './game-browser-storage';

export const GAME_STORAGE_MESSAGE_TYPE = 'potato-tomato-game-storage';

/** @deprecated Use GameBrowserProfile via game-browser-storage */
export interface GameBrowserData {
	localStorage: Record<string, string>;
	updatedAt: number;
}

type ProfileBag = Record<string, GameBrowserProfile | null>;

/**
 * Profiles the child bridge can read synchronously at boot. A key that is present with
 * `null` means "known to have no saves" — the bridge then skips the postMessage pull.
 */
function profileBag(): ProfileBag | null {
	if (typeof window === 'undefined') return null;
	const w = window as unknown as { __ptGameProfiles?: ProfileBag };
	if (!w.__ptGameProfiles) w.__ptGameProfiles = Object.create(null) as ProfileBag;
	return w.__ptGameProfiles;
}

function rememberProfile(gameId: string, profile: GameBrowserProfile | null): void {
	const bag = profileBag();
	if (bag) bag[gameId] = profile;
}

const inflight = new Map<string, Promise<GameBrowserProfile | null>>();

/**
 * Load a game's saved profile ahead of launch so the frame can boot from it without a
 * round trip. Safe to call repeatedly; concurrent calls share one read.
 */
export function preloadGameBrowserProfile(gameId: string): Promise<GameBrowserProfile | null> {
	if (!gameId) return Promise.resolve(null);
	const pending = inflight.get(gameId);
	if (pending) return pending;
	const task = loadGameBrowserProfile(gameId)
		.catch(() => null)
		.then((profile) => {
			/* Never downgrade a profile a push already refreshed while this read ran. */
			const bag = profileBag();
			const current = bag ? bag[gameId] : undefined;
			if (current && (!profile || current.updatedAt >= profile.updatedAt)) return current;
			rememberProfile(gameId, profile);
			return profile;
		})
		.finally(() => inflight.delete(gameId));
	inflight.set(gameId, task);
	return task;
}

/** One write at a time per game, so two quick pushes cannot interleave load → merge → save. */
const saveChains = new Map<string, Promise<void>>();

function queueSave(gameId: string, incoming: GameBrowserProfile): Promise<void> {
	const prev = saveChains.get(gameId) ?? Promise.resolve();
	const next = prev
		.catch(() => undefined)
		.then(async () => {
			const bag = profileBag();
			const existing =
				bag && bag[gameId] !== undefined ? bag[gameId] : await loadGameBrowserProfile(gameId);
			const merged = mergeGameBrowserProfiles(existing, incoming);
			rememberProfile(gameId, merged);
			await saveGameBrowserProfile(gameId, merged);
		});
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
				const source = event.source as Window | null;
				if (!source || typeof source.postMessage !== 'function') return;
				/* Always answer — `null` tells the bridge there is nothing to wait for. */
				source.postMessage(
					{ type: GAME_STORAGE_MESSAGE_TYPE, action: 'hydrate', gameId, data: stored ?? null },
					'*'
				);
			});
			return;
		}

		if (msg.action === 'push' && msg.data && isGameBrowserProfile(msg.data)) {
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
