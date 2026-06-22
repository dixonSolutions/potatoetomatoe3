/**
 * Unified offline download API — routes to the puller backend (desktop / local dev)
 * or browser IndexedDB + service worker (GitHub Pages / static hosting).
 */

export type {
	GameOfflineStatus,
	DownloadProgress
} from './offline-downloader-puller';

export {
	getPullerBaseUrl,
	isPullerAvailable,
	invalidatePullerAvailabilityCache,
	pullerOfflinePlayUrl
} from './offline-downloader-puller';

export {
	getOfflineBackend,
	isOfflineDownloadAvailable,
	isBrowserStorageSupported,
	isTauriApp,
	invalidateOfflineBackendCache,
	type OfflineBackend
} from './offline-runtime';

export { browserOfflinePlayUrl, isBrowserGameDownloaded } from './browser-offline-download';

import {
	deletePullerOfflineCopy,
	fetchPullerDownloadProgress,
	fetchPullerGameOfflineStatus,
	fetchPullerOfflineStatuses,
	invalidatePullerOfflineStatusCache,
	pollPullerDownloadUntilDone,
	startPullerGameDownload,
	type DownloadProgress,
	type GameOfflineStatus
} from './offline-downloader-puller';
import {
	deleteBrowserOfflineCopy,
	fetchBrowserGameOfflineStatus,
	fetchBrowserOfflineStatuses,
	getBrowserDownloadProgress,
	pollBrowserDownloadUntilDone,
	startBrowserGameDownload
} from './browser-offline-download';
import { getOfflineBackend } from './offline-runtime';

/** Games shipped with a pre-built offline copy in static/ (no downloader required). */
export const BUNDLED_OFFLINE_GAME_IDS = ['shrek-escape'] as const;

export function bundledOfflineStatus(): Record<string, GameOfflineStatus> {
	const out: Record<string, GameOfflineStatus> = {};
	for (const id of BUNDLED_OFFLINE_GAME_IDS) {
		out[id] = { online: true, offline: true, downloading: false };
	}
	return out;
}

export async function fetchAllOfflineStatuses(
	force = false
): Promise<Record<string, GameOfflineStatus>> {
	const bundled = bundledOfflineStatus();
	const backend = await getOfflineBackend(force);

	if (backend === 'puller') {
		const remote = await fetchPullerOfflineStatuses(force);
		return { ...bundled, ...remote };
	}
	if (backend === 'browser') {
		const stored = await fetchBrowserOfflineStatuses();
		return { ...bundled, ...stored };
	}
	return bundled;
}

export async function fetchGameOfflineStatus(gameId: string): Promise<GameOfflineStatus | null> {
	const backend = await getOfflineBackend();
	if (backend === 'puller') {
		return fetchPullerGameOfflineStatus(gameId);
	}
	if (backend === 'browser') {
		return fetchBrowserGameOfflineStatus(gameId);
	}
	return null;
}

export function invalidateOfflineStatusCache(): void {
	invalidatePullerOfflineStatusCache();
}

export async function startGameDownload(
	gameId: string
): Promise<{ started: boolean; message: string }> {
	const backend = await getOfflineBackend(true);
	if (backend === 'puller') return startPullerGameDownload(gameId);
	if (backend === 'browser') return startBrowserGameDownload(gameId);
	throw new Error('Offline downloads are not available in this environment');
}

export async function fetchDownloadProgress(gameId: string): Promise<DownloadProgress> {
	const backend = await getOfflineBackend();
	if (backend === 'puller') return fetchPullerDownloadProgress(gameId);
	if (backend === 'browser') return getBrowserDownloadProgress(gameId);
	return { state: 'idle', progress: 0, message: 'Unavailable' };
}

export async function deleteOfflineCopy(gameId: string): Promise<void> {
	const backend = await getOfflineBackend(true);
	if (backend === 'puller') {
		await deletePullerOfflineCopy(gameId);
		return;
	}
	if (backend === 'browser') {
		await deleteBrowserOfflineCopy(gameId);
		return;
	}
	throw new Error('Offline downloads are not available in this environment');
}

export async function pollDownloadUntilDone(
	gameId: string,
	onProgress: (p: DownloadProgress) => void,
	intervalMs = 800
): Promise<DownloadProgress> {
	const backend = await getOfflineBackend(true);
	if (backend === 'puller') {
		return pollPullerDownloadUntilDone(gameId, onProgress, intervalMs);
	}
	if (backend === 'browser') {
		return pollBrowserDownloadUntilDone(gameId, onProgress, Math.min(intervalMs, 400));
	}
	return { state: 'error', progress: 0, message: 'Unavailable', error: 'No offline backend' };
}

/** Resolve play URL for an offline copy based on the active backend. */
export async function getOfflinePlayUrl(gameId: string): Promise<string | null> {
	const backend = await getOfflineBackend();
	if (backend === 'puller') {
		const { pullerOfflinePlayUrl } = await import('./offline-downloader-puller');
		return pullerOfflinePlayUrl(gameId);
	}
	if (backend === 'browser') {
		const { browserOfflinePlayUrl, isBrowserGameDownloaded } = await import(
			'./browser-offline-download'
		);
		if (await isBrowserGameDownloaded(gameId)) return browserOfflinePlayUrl(gameId);
	}
	return null;
}
