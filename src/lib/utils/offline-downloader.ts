/**
 * Unified offline download API — routes to the desktop app's own file backend or to
 * browser IndexedDB + service worker (GitHub Pages / static hosting, Android).
 */

export type { GameOfflineStatus, DownloadProgress } from './offline-types';

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
	cancelNativeDownload,
	deleteNativeOfflineCopy,
	nativeDownloadProgress,
	startNativeDownload,
	fetchNativeOfflineStatus,
	fetchNativeOfflineStatuses,
	nativeOfflineEntry,
	nativeOfflineUrl
} from './offline-native';
import type { DownloadProgress, GameOfflineStatus } from './offline-types';
import {
	cancelBrowserGameDownload,
	deleteBrowserOfflineCopy,
	fetchBrowserGameOfflineStatus,
	fetchBrowserOfflineStatuses,
	getBrowserDownloadProgress,
	pollBrowserDownloadUntilDone,
	startBrowserGameDownload
} from './browser-offline-download';
import {
	getOfflineBackend,
	invalidateOfflineBackendCache,
	isPublicSiteDeployment
} from './offline-runtime';

/** Games shipped with a pre-built offline copy in static/ (no downloader required). */
export const BUNDLED_OFFLINE_GAME_IDS = ['shrek-escape'] as const;

export function bundledOfflineStatus(): Record<string, GameOfflineStatus> {
	const out: Record<string, GameOfflineStatus> = {};
	for (const id of BUNDLED_OFFLINE_GAME_IDS) {
		out[id] = { online: true, offline: true, downloading: false };
	}
	return out;
}

/** Downloaded / in-progress / bundled only — not every catalog id. */
export async function fetchDownloadedStatuses(
	force = false
): Promise<Record<string, GameOfflineStatus>> {
	const bundled = bundledOfflineStatus();
	const backend = await getOfflineBackend(force);

	if (backend === 'native') {
		const onDisk = await fetchNativeOfflineStatuses();
		return { ...bundled, ...onDisk };
	}
	if (backend === 'browser') {
		const stored = await fetchBrowserOfflineStatuses();
		return { ...bundled, ...stored };
	}
	return bundled;
}

/** Statuses for visible / requested game ids. */
export async function fetchOfflineStatusesForIds(
	gameIds: string[],
	force = false
): Promise<Record<string, GameOfflineStatus>> {
	const unique = [...new Set(gameIds.filter(Boolean))];
	if (unique.length === 0) return {};
	const bundled = bundledOfflineStatus();
	const backend = await getOfflineBackend(force);

	if (backend === 'native') {
		const onDisk = await fetchNativeOfflineStatuses(unique);
		const out: Record<string, GameOfflineStatus> = {};
		for (const id of unique) {
			const status = onDisk[id];
			if (bundled[id]) out[id] = { ...status, ...bundled[id], offline: true };
			else if (status) out[id] = status;
		}
		return out;
	}
	if (backend === 'browser') {
		const stored = await fetchBrowserOfflineStatuses();
		const out: Record<string, GameOfflineStatus> = {};
		for (const id of unique) {
			if (bundled[id]) out[id] = bundled[id];
			else if (stored[id]) out[id] = stored[id];
		}
		return out;
	}
	const out: Record<string, GameOfflineStatus> = {};
	for (const id of unique) {
		if (bundled[id]) out[id] = bundled[id];
	}
	return out;
}

/**
 * @deprecated Prefer `fetchDownloadedStatuses` + `fetchOfflineStatusesForIds`.
 * Now returns downloaded/in-progress only (same as fetchDownloadedStatuses).
 */
export async function fetchAllOfflineStatuses(
	force = false
): Promise<Record<string, GameOfflineStatus>> {
	return fetchDownloadedStatuses(force);
}

export async function fetchGameOfflineStatus(
	gameId: string,
	force = false
): Promise<GameOfflineStatus | null> {
	const bundled = bundledOfflineStatus()[gameId];
	const backend = await getOfflineBackend(force);

	if (backend === 'native') {
		const status = await fetchNativeOfflineStatus(gameId);
		if (bundled) return { ...bundled, ...status, offline: true };
		return status ?? { online: true, offline: false, downloading: false };
	}
	if (backend === 'browser') {
		const status = await fetchBrowserGameOfflineStatus(gameId);
		return bundled ? { ...status, online: true, offline: true, downloading: false } : status;
	}
	return bundled ?? null;
}

export async function refreshGameOfflineState(gameId: string): Promise<GameOfflineStatus | null> {
	invalidateOfflineBackendCache();
	return fetchGameOfflineStatus(gameId, true);
}

export async function startGameDownload(
	gameId: string
): Promise<{ started: boolean; message: string }> {
	const backend = await getOfflineBackend(true);
	if (backend === 'native') return startNativeDownload(gameId);

	if (backend === 'browser') {
		const { onlineShellHasExternalIframe, EXTERNAL_IFRAME_UNSUPPORTED } = await import(
			'./browser-offline-download'
		);
		if (await onlineShellHasExternalIframe(gameId)) {
			return { started: false, message: EXTERNAL_IFRAME_UNSUPPORTED };
		}
		return startBrowserGameDownload(gameId);
	}

	throw new Error('Offline downloads are not available in this environment');
}

export async function fetchDownloadProgress(gameId: string): Promise<DownloadProgress> {
	const backend = await getOfflineBackend();
	if (backend === 'native') return nativeDownloadProgress(gameId);
	if (backend === 'browser') return getBrowserDownloadProgress(gameId);
	return { state: 'idle', progress: 0, message: 'Unavailable' };
}

export async function deleteOfflineCopy(gameId: string): Promise<void> {
	const backend = await getOfflineBackend(true);
	if (backend === 'native') {
		await deleteNativeOfflineCopy(gameId);
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
	if (backend === 'native') {
		for (;;) {
			const p = await nativeDownloadProgress(gameId);
			onProgress(p);
			if (p.state !== 'running' && p.state !== 'pending') return p;
			await new Promise((r) => setTimeout(r, intervalMs));
		}
	}
	if (backend === 'browser') {
		return pollBrowserDownloadUntilDone(gameId, onProgress, Math.min(intervalMs, 400));
	}
	return { state: 'error', progress: 0, message: 'Unavailable', error: 'No offline backend' };
}

/** Cancel an in-progress download. When discardCache is false, partial files are kept for resume. */
export async function cancelGameDownload(gameId: string, discardCache: boolean): Promise<void> {
	const backend = await getOfflineBackend(true);
	if (backend === 'native') {
		await cancelNativeDownload(gameId, discardCache);
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
	const { resolveStaticOfflinePlayUrl, staticOfflineFileExists } = await import(
		'./offline-play-url'
	);

	if (isBundledOfflineGame(gameId)) {
		return resolveStaticOfflinePlayUrl(gameId, base);
	}

	const backend = await getOfflineBackend();

	if (backend === 'native') {
		const entry = await nativeOfflineEntry(gameId);
		return entry ? nativeOfflineUrl(gameId, entry) : null;
	}

	if (backend === 'browser') {
		const { isBrowserGameDownloaded, resolveBrowserOfflinePlayUrl } = await import(
			'./browser-offline-download'
		);
		if (await isBrowserGameDownloaded(gameId)) {
			return resolveBrowserOfflinePlayUrl(gameId);
		}
		/* A copy from an earlier build may still sit under static/games (dev). */
		if (!isPublicSiteDeployment() && (await staticOfflineFileExists(gameId, base))) {
			return resolveStaticOfflinePlayUrl(gameId, base);
		}
		return null;
	}

	/* Backend none — still try a same-origin static mirror in local-app. */
	if (!isPublicSiteDeployment() && (await staticOfflineFileExists(gameId, base))) {
		return resolveStaticOfflinePlayUrl(gameId, base);
	}

	return null;
}
