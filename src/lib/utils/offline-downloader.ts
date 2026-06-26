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
	isPublicSiteDeployment,
	isLocalAppDeployment,
	getAppDeployment,
	describeOfflineBackend,
	invalidateOfflineBackendCache,
	type OfflineBackend,
	type AppDeployment
} from './offline-runtime';

export {
	OFFLINE_STATUS_CHANGED,
	dispatchOfflineStatusChanged,
	invalidateOfflineStatusCache,
	type OfflineStatusChangeReason,
	type OfflineStatusChangedDetail
} from './offline-status-events';

export { browserOfflinePlayUrl, isBrowserGameDownloaded } from './browser-offline-download';

export function isBundledOfflineGame(gameId: string): boolean {
	return (BUNDLED_OFFLINE_GAME_IDS as readonly string[]).includes(gameId);
}

import {
	deletePullerOfflineCopy,
	cancelPullerGameDownload,
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
	checkOnlineShellExists,
	cancelBrowserGameDownload,
	deleteBrowserOfflineCopy,
	fetchBrowserGameOfflineStatus,
	fetchBrowserOfflineStatuses,
	getBrowserDownloadProgress,
	pollBrowserDownloadUntilDone,
	startBrowserGameDownload
} from './browser-offline-download';
import { getOfflineBackend, invalidateOfflineBackendCache } from './offline-runtime';

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

export async function fetchGameOfflineStatus(
	gameId: string,
	force = false
): Promise<GameOfflineStatus | null> {
	const bundled = bundledOfflineStatus()[gameId];
	const backend = await getOfflineBackend(force);

	if (backend === 'puller') {
		const status = await fetchPullerGameOfflineStatus(gameId, force);
		if (bundled) return { ...bundled, ...status, offline: true };
		if (status) return status;
		return {
			online: await checkOnlineShellExists(gameId),
			offline: false,
			downloading: false
		};
	}
	if (backend === 'browser') {
		const status = await fetchBrowserGameOfflineStatus(gameId);
		return bundled ? { ...status, online: true, offline: true, downloading: false } : status;
	}
	return bundled ?? null;
}

export async function refreshGameOfflineState(
	gameId: string
): Promise<GameOfflineStatus | null> {
	invalidatePullerOfflineStatusCache();
	invalidateOfflineBackendCache();
	return fetchGameOfflineStatus(gameId, true);
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

/** Cancel an in-progress download. When discardCache is false, partial files are kept for resume. */
export async function cancelGameDownload(
	gameId: string,
	discardCache: boolean
): Promise<void> {
	const backend = await getOfflineBackend(true);
	if (backend === 'puller') {
		await cancelPullerGameDownload(gameId, discardCache);
		return;
	}
	if (backend === 'browser') {
		await cancelBrowserGameDownload(gameId, discardCache);
		return;
	}
	throw new Error('Offline downloads are not available in this environment');
}

/** Resolve play URL for an offline copy based on the active backend. */
export async function getOfflinePlayUrl(gameId: string): Promise<string | null> {
	const { base } = await import('$app/paths');
	const { staticOfflineFileExists, staticOfflinePlayUrl } = await import('./offline-play-url');

	if (isBundledOfflineGame(gameId)) {
		return staticOfflinePlayUrl(gameId, base);
	}

	const backend = await getOfflineBackend();

	if (backend === 'browser') {
		const { browserOfflinePlayUrl, isBrowserGameDownloaded, ensureBrowserOfflineReady } =
			await import('./browser-offline-download');
		if (await isBrowserGameDownloaded(gameId)) {
			await ensureBrowserOfflineReady();
			return browserOfflinePlayUrl(gameId);
		}
		return null;
	}

	if (backend === 'puller') {
		if (await staticOfflineFileExists(gameId, base)) {
			return staticOfflinePlayUrl(gameId, base);
		}
		const { pullerOfflinePlayUrl } = await import('./offline-downloader-puller');
		return pullerOfflinePlayUrl(gameId, base);
	}

	return null;
}
