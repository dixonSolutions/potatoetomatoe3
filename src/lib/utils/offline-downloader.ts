/**
 * Unified offline download API — routes to the puller backend (desktop / local dev)
 * or browser IndexedDB + service worker (GitHub Pages / static hosting).
 */

export type { GameOfflineStatus, DownloadProgress } from './offline-downloader-puller';

export {
	getPullerBaseUrl,
	isPullerAvailable,
	invalidatePullerAvailabilityCache,
	pullerOfflinePlayUrl,
	pullerUnityPlayUrl,
	describePullerDownloadError
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
	fetchPullerOfflineStatusesForIds,
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
import { importPullerOfflineCopy } from './browser-offline-download';
import { getOfflineBackend, invalidateOfflineBackendCache } from './offline-runtime';

/** Public-site downloads delegated to the puller, then imported into browser storage. */
const BROWSER_PULLER_DOWNLOADS_KEY = 'pt-browser-puller-downloads';
const browserPullerDownloads = new Set<string>();

function hydrateBrowserPullerDownloads(): void {
	if (typeof sessionStorage === 'undefined') return;
	try {
		const raw = sessionStorage.getItem(BROWSER_PULLER_DOWNLOADS_KEY);
		if (!raw) return;
		for (const id of JSON.parse(raw) as string[]) {
			if (typeof id === 'string' && id) browserPullerDownloads.add(id);
		}
	} catch {
		/* ignore corrupt session data */
	}
}

function syncBrowserPullerDownloads(): void {
	if (typeof sessionStorage === 'undefined') return;
	sessionStorage.setItem(BROWSER_PULLER_DOWNLOADS_KEY, JSON.stringify([...browserPullerDownloads]));
}

function trackBrowserPullerDownload(gameId: string): void {
	browserPullerDownloads.add(gameId);
	syncBrowserPullerDownloads();
}

function untrackBrowserPullerDownload(gameId: string): void {
	browserPullerDownloads.delete(gameId);
	syncBrowserPullerDownloads();
}

hydrateBrowserPullerDownloads();

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

/** Statuses for visible / requested game ids. */
export async function fetchOfflineStatusesForIds(
	gameIds: string[],
	force = false
): Promise<Record<string, GameOfflineStatus>> {
	const unique = [...new Set(gameIds.filter(Boolean))];
	if (unique.length === 0) return {};
	const bundled = bundledOfflineStatus();
	const backend = await getOfflineBackend(force);

	if (backend === 'puller') {
		const remote = await fetchPullerOfflineStatusesForIds(unique, force);
		const out: Record<string, GameOfflineStatus> = { ...remote };
		for (const id of unique) {
			if (bundled[id]) out[id] = { ...out[id], ...bundled[id], offline: true };
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

export async function refreshGameOfflineState(gameId: string): Promise<GameOfflineStatus | null> {
	invalidatePullerOfflineStatusCache();
	invalidateOfflineBackendCache();
	return fetchGameOfflineStatus(gameId, true);
}

export async function startGameDownload(
	gameId: string
): Promise<{ started: boolean; message: string }> {
	const backend = await getOfflineBackend(true);
	if (backend === 'puller') return startPullerGameDownload(gameId);

	if (backend === 'browser') {
		const { onlineShellHasExternalIframe, EXTERNAL_IFRAME_NEEDS_PULLER } = await import(
			'./browser-offline-download'
		);
		const external = await onlineShellHasExternalIframe(gameId);
		if (external) {
			/* Prefer a running local puller for full iframe scrape (even on public-site). */
			const { isPullerAvailable, startPullerGameDownload } = await import(
				'./offline-downloader-puller'
			);
			if (await isPullerAvailable(true, { ignoreDeploymentGate: true })) {
				trackBrowserPullerDownload(gameId);
				const result = await startPullerGameDownload(gameId);
				if (!result.started) {
					untrackBrowserPullerDownload(gameId);
				}
				return result;
			}
			return { started: false, message: EXTERNAL_IFRAME_NEEDS_PULLER };
		}
		return startBrowserGameDownload(gameId);
	}

	throw new Error('Offline downloads are not available in this environment');
}

export async function fetchDownloadProgress(gameId: string): Promise<DownloadProgress> {
	if (browserPullerDownloads.has(gameId)) {
		return fetchPullerDownloadProgress(gameId);
	}
	const backend = await getOfflineBackend();
	if (backend === 'puller') return fetchPullerDownloadProgress(gameId);
	if (backend === 'browser') return getBrowserDownloadProgress(gameId);
	return { state: 'idle', progress: 0, message: 'Unavailable' };
}

export async function deleteOfflineCopy(gameId: string): Promise<void> {
	const backend = await getOfflineBackend(true);
	if (browserPullerDownloads.has(gameId)) {
		untrackBrowserPullerDownload(gameId);
	}
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
	if (browserPullerDownloads.has(gameId)) {
		const final = await pollPullerDownloadUntilDone(gameId, onProgress, intervalMs);
		if (final.state !== 'done') {
			untrackBrowserPullerDownload(gameId);
			return final;
		}
		try {
			await importPullerOfflineCopy(gameId, onProgress);
			untrackBrowserPullerDownload(gameId);
			onProgress({ state: 'done', progress: 100, message: 'Saved for browser offline play' });
			return { state: 'done', progress: 100, message: 'Saved for browser offline play' };
		} catch (error) {
			untrackBrowserPullerDownload(gameId);
			const message = error instanceof Error ? error.message : 'Browser import failed';
			return { state: 'error', progress: 0, message, error: message };
		}
	}
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
export async function cancelGameDownload(gameId: string, discardCache: boolean): Promise<void> {
	const backend = await getOfflineBackend(true);
	if (browserPullerDownloads.has(gameId)) {
		await cancelPullerGameDownload(gameId, discardCache);
		untrackBrowserPullerDownload(gameId);
		if (discardCache) await deleteBrowserOfflineCopy(gameId);
		return;
	}
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
	const { resolveStaticOfflineEntry, resolveStaticOfflinePlayUrl, staticOfflineFileExists } =
		await import('./offline-play-url');

	if (isBundledOfflineGame(gameId)) {
		return resolveStaticOfflinePlayUrl(gameId, base);
	}

	const backend = await getOfflineBackend();

	if (backend === 'browser') {
		const { isBrowserGameDownloaded, resolveBrowserOfflinePlayUrl } = await import(
			'./browser-offline-download'
		);
		if (await isBrowserGameDownloaded(gameId)) {
			return resolveBrowserOfflinePlayUrl(gameId);
		}
		return null;
	}

	if (backend === 'puller') {
		if (await staticOfflineFileExists(gameId, base)) {
			return resolveStaticOfflinePlayUrl(gameId, base);
		}
		const status = await fetchPullerGameOfflineStatus(gameId);
		if (status?.offline) {
			const { pullerOfflinePlayUrl } = await import('./offline-downloader-puller');
			const entry = await resolveStaticOfflineEntry(gameId, base);
			return pullerOfflinePlayUrl(gameId, base, entry);
		}
		return null;
	}

	return null;
}
