/**
 * Unified per-game browser profile storage: disk in the desktop app (read and written by the
 * app itself, in the layout the puller used), disk via a dev puller, or IndexedDB.
 *
 * A read has three answers, and the difference between the last two matters: the profile,
 * `null` when the game has no saves, or a thrown `GameProfileReadError` when the store could
 * not be read. The in-frame bridge never pushes before the saved profile is known, and a
 * failed read reported as "no saves" let the next write replace the real saves with what
 * one session wrote.
 */

import { canUseLocalStorage } from '$lib/utils/browser-storage';
import {
	emptyGameBrowserProfile,
	isGameBrowserProfile,
	mergeLegacyLocalStorage,
	type GameBrowserProfile
} from './game-browser-profile';
import {
	deleteBrowserGameProfile,
	isBrowserGameDataSupported,
	loadBrowserGameProfile,
	saveBrowserGameProfile
} from './browser-game-data-storage';
import {
	deletePullerBrowserProfile,
	isPullerBrowserDataAvailable,
	loadPullerBrowserProfile,
	savePullerBrowserProfile
} from './puller-browser-data';
import { isPublicSiteDeployment } from './offline-deployment';
import {
	deleteNativeGameProfile,
	hasNativeOfflineBackend,
	loadNativeGameProfile,
	saveNativeGameProfile
} from './offline-native';

export type BrowserDataBackend = 'native' | 'puller' | 'browser' | 'none';

/**
 * The store holding a game's saves could not be read: a puller error, an IndexedDB error,
 * the native saves command failing. Not "no saves" — nothing may be written over the stored
 * profile on the strength of it.
 */
export class GameProfileReadError extends Error {
	readonly gameId: string;

	constructor(gameId: string, cause: unknown) {
		const why = cause instanceof Error ? cause.message : String(cause);
		super(`Could not read the saves of ${gameId}: ${why}`, { cause });
		this.name = 'GameProfileReadError';
		this.gameId = gameId;
	}
}

const STORAGE_PREFIX = 'potato-tomato-game-browser-data-';

function legacyBrowserDataKey(gameId: string): string {
	return STORAGE_PREFIX + gameId;
}

interface LegacyGameBrowserData {
	localStorage: Record<string, string>;
	updatedAt: number;
}

function loadLegacyShellSnapshot(gameId: string): LegacyGameBrowserData | null {
	if (!canUseLocalStorage()) return null;
	try {
		const raw = localStorage.getItem(legacyBrowserDataKey(gameId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as LegacyGameBrowserData;
		if (!parsed?.localStorage || typeof parsed.localStorage !== 'object') return null;
		return parsed;
	} catch {
		return null;
	}
}

function clearLegacyShellSnapshot(gameId: string): void {
	if (!canUseLocalStorage()) return;
	try {
		localStorage.removeItem(legacyBrowserDataKey(gameId));
	} catch {
		/* ignore */
	}
}

export async function getBrowserDataBackend(force = false): Promise<BrowserDataBackend> {
	if (isPublicSiteDeployment()) {
		return isBrowserGameDataSupported() ? 'browser' : 'none';
	}
	if (hasNativeOfflineBackend()) return 'native';
	if (await isPullerBrowserDataAvailable(force)) {
		return 'puller';
	}
	return isBrowserGameDataSupported() ? 'browser' : 'none';
}

async function migrateLegacyIfNeeded(
	gameId: string,
	profile: GameBrowserProfile | null,
	origin: string
): Promise<GameBrowserProfile | null> {
	if (profile) return profile;
	const legacy = loadLegacyShellSnapshot(gameId);
	if (!legacy) return null;
	const migrated = mergeLegacyLocalStorage(emptyGameBrowserProfile(), origin, legacy.localStorage);
	try {
		await saveGameBrowserProfile(gameId, migrated);
		clearLegacyShellSnapshot(gameId);
	} catch {
		/* Keep the old snapshot: the next load migrates it again. */
	}
	return migrated;
}

/**
 * Desktop saves live on disk. While the puller was down they fell back to IndexedDB, so a
 * game with nothing on disk may still have its saves there — move them across once.
 */
async function loadNativeWithFallback(gameId: string): Promise<GameBrowserProfile | null> {
	const onDisk = await loadNativeGameProfile(gameId);
	if (onDisk || !isBrowserGameDataSupported()) return onDisk;
	const stranded = await loadBrowserGameProfile(gameId);
	if (stranded) {
		try {
			await saveNativeGameProfile(gameId, stranded);
			await deleteBrowserGameProfile(gameId);
		} catch {
			/* Left where it is: the next load moves it. */
		}
	}
	return stranded;
}

/**
 * The game's saved profile, or `null` when it has none.
 *
 * @throws GameProfileReadError when the store could not be read. Never answer that with
 *   "no saves": a write made on the strength of it replaces the real ones.
 */
export async function loadGameBrowserProfile(
	gameId: string,
	playOrigin = typeof window !== 'undefined' ? window.location.origin : ''
): Promise<GameBrowserProfile | null> {
	let profile: GameBrowserProfile | null = null;
	try {
		const backend = await getBrowserDataBackend();
		if (backend === 'native') {
			profile = await loadNativeWithFallback(gameId);
		} else if (backend === 'puller') {
			profile = await loadPullerBrowserProfile(gameId);
		} else if (backend === 'browser') {
			profile = await loadBrowserGameProfile(gameId);
		}
	} catch (error) {
		throw error instanceof GameProfileReadError ? error : new GameProfileReadError(gameId, error);
	}

	return await migrateLegacyIfNeeded(gameId, profile, playOrigin);
}

/**
 * Write the game's saves where the loader reads them from.
 *
 * @throws when the desktop app could not write them to disk. They used to go to IndexedDB
 *   instead, which the loader never reads while the disk has a profile of the game — the
 *   write was as good as lost. The caller holds the saves and tries again.
 */
export async function saveGameBrowserProfile(
	gameId: string,
	profile: GameBrowserProfile
): Promise<void> {
	if (!isGameBrowserProfile(profile)) return;
	const backend = await getBrowserDataBackend();

	if (backend === 'native') {
		await saveNativeGameProfile(gameId, profile);
		return;
	}
	if (backend === 'puller') {
		const ok = await savePullerBrowserProfile(gameId, profile);
		if (ok) return;
	}

	if (isBrowserGameDataSupported()) {
		await saveBrowserGameProfile(gameId, profile);
	}
}

export async function deleteGameBrowserProfile(gameId: string): Promise<void> {
	const backend = await getBrowserDataBackend();
	if (backend === 'native') {
		await deleteNativeGameProfile(gameId);
	} else if (backend === 'puller') {
		await deletePullerBrowserProfile(gameId);
	}
	if (isBrowserGameDataSupported()) {
		await deleteBrowserGameProfile(gameId);
	}
	clearLegacyShellSnapshot(gameId);
}

export function describeBrowserDataBackend(backend: BrowserDataBackend): string {
	switch (backend) {
		case 'native':
			return 'Disk (app data folder)';
		case 'puller':
			return 'Disk (puller data folder)';
		case 'browser':
			return isPublicSiteDeployment()
				? 'Browser storage (IndexedDB)'
				: 'Browser storage (IndexedDB fallback)';
		default:
			return 'Browser data storage unavailable';
	}
}
