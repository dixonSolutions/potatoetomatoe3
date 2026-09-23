/**
 * Unified per-game browser profile storage: disk in the desktop app (read and written by the
 * app itself, in the layout the puller used), disk via a dev puller, or IndexedDB.
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
	await saveGameBrowserProfile(gameId, migrated);
	clearLegacyShellSnapshot(gameId);
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
	if (stranded && (await saveNativeGameProfile(gameId, stranded))) {
		await deleteBrowserGameProfile(gameId);
	}
	return stranded;
}

export async function loadGameBrowserProfile(
	gameId: string,
	playOrigin = typeof window !== 'undefined' ? window.location.origin : ''
): Promise<GameBrowserProfile | null> {
	const backend = await getBrowserDataBackend();
	let profile: GameBrowserProfile | null = null;

	if (backend === 'native') {
		profile = await loadNativeWithFallback(gameId);
	} else if (backend === 'puller') {
		profile = await loadPullerBrowserProfile(gameId);
	} else if (backend === 'browser') {
		profile = await loadBrowserGameProfile(gameId);
	}

	return await migrateLegacyIfNeeded(gameId, profile, playOrigin);
}

export async function saveGameBrowserProfile(
	gameId: string,
	profile: GameBrowserProfile
): Promise<void> {
	if (!isGameBrowserProfile(profile)) return;
	const backend = await getBrowserDataBackend();

	if (backend === 'native') {
		if (await saveNativeGameProfile(gameId, profile)) return;
	} else if (backend === 'puller') {
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
