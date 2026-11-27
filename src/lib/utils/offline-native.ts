/**
 * Offline copies and saves in the desktop app, read by the app itself.
 *
 * The Node puller used to own the games data folder: badges, offline launches and every
 * save went through its HTTP API, so it had to run whenever the app did. The native side
 * now reads and writes that folder directly (`src-tauri/src/offline_games.rs`) and serves
 * a mirror as `ptoffline://localhost/<id>/<entry>`, and downloads games itself
 * (`src-tauri/src/offline_download.rs`).
 */

import type { DownloadProgress, GameOfflineStatus } from './offline-types';
import type { GameBrowserProfile } from './game-browser-profile';
import { isTauriApp, isTauriMobileBuild } from './offline-deployment';

export const OFFLINE_SCHEME = 'ptoffline';

/** The desktop app (not Android, not a browser): the native file backend exists. */
export function hasNativeOfflineBackend(): boolean {
	return typeof window !== 'undefined' && isTauriApp() && !isTauriMobileBuild();
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
	const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
	return tauriInvoke<T>(command, args);
}

/** Play URL of a file inside a game's offline copy (its entry HTML, a cover image…). */
export function nativeOfflineUrl(gameId: string, relPath = ''): string {
	const rel = relPath
		.replace(/^(\.\.\/)+/, '')
		.replace(/^\//, '')
		.split('/')
		.map(encodeURIComponent)
		.join('/');
	return `${OFFLINE_SCHEME}://localhost/${encodeURIComponent(gameId)}/${rel}`;
}

/** Offline status for the given games, or for every game with a copy on disk. */
export async function fetchNativeOfflineStatuses(
	gameIds?: string[]
): Promise<Record<string, GameOfflineStatus>> {
	try {
		return await invoke<Record<string, GameOfflineStatus>>('offline_statuses', {
			ids: gameIds ?? null
		});
	} catch {
		return {};
	}
}

export async function fetchNativeOfflineStatus(gameId: string): Promise<GameOfflineStatus | null> {
	const map = await fetchNativeOfflineStatuses([gameId]);
	return map[gameId] ?? null;
}

/** Entry HTML of the game's complete offline copy, relative to `offline/`. */
export async function nativeOfflineEntry(gameId: string): Promise<string | null> {
	try {
		return await invoke<string | null>('offline_entry', { id: gameId });
	} catch {
		return null;
	}
}

/** Start downloading in the app. `started: false` when one is already running. */
export async function startNativeDownload(
	gameId: string
): Promise<{ started: boolean; message: string }> {
	try {
		const started = await invoke<boolean>('offline_download_start', { id: gameId });
		return { started, message: started ? 'Download started' : 'Already downloading' };
	} catch (error) {
		return { started: false, message: error instanceof Error ? error.message : String(error) };
	}
}

export async function cancelNativeDownload(gameId: string, discard: boolean): Promise<void> {
	await invoke('offline_download_cancel', { id: gameId, discard });
}

export async function nativeDownloadProgress(gameId: string): Promise<DownloadProgress> {
	try {
		const p = await invoke<DownloadProgress | null>('offline_download_progress', { id: gameId });
		return p ?? { state: 'idle', progress: 0, message: '' };
	} catch {
		return { state: 'idle', progress: 0, message: '' };
	}
}

export async function deleteNativeOfflineCopy(gameId: string): Promise<void> {
	await invoke('offline_delete', { id: gameId });
}

/**
 * The game's saves on disk, or `null` when it has none.
 *
 * @throws when the command fails (an unreadable or corrupt profile file, no IPC): that is
 *   not "no saves", and must not be answered as such.
 */
export async function loadNativeGameProfile(gameId: string): Promise<GameBrowserProfile | null> {
	return await invoke<GameBrowserProfile | null>('game_profile_read', { id: gameId });
}

/**
 * Write the game's saves to disk.
 *
 * @throws when the write failed. The caller keeps the saves and tries again: the disk is
 *   the only place the desktop app reads them back from.
 */
export async function saveNativeGameProfile(
	gameId: string,
	profile: GameBrowserProfile
): Promise<void> {
	await invoke('game_profile_write', { id: gameId, profile });
}

export async function deleteNativeGameProfile(gameId: string): Promise<boolean> {
	try {
		await invoke('game_profile_delete', { id: gameId });
		return true;
	} catch {
		return false;
	}
}
