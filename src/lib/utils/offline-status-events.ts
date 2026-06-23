import { invalidatePullerOfflineStatusCache } from './offline-downloader-puller';
import { invalidateOfflineBackendCache } from './offline-runtime';

export const OFFLINE_STATUS_CHANGED = 'potato-tomato-offline-status-changed';

export type OfflineStatusChangeReason = 'download-start' | 'download-done' | 'download-error' | 'delete';

export interface OfflineStatusChangedDetail {
	gameId?: string;
	reason?: OfflineStatusChangeReason;
}

/** Invalidate caches and notify all game UI (browse list, play selector, download controls). */
export function dispatchOfflineStatusChanged(
	gameId?: string,
	reason?: OfflineStatusChangeReason
): void {
	invalidatePullerOfflineStatusCache();
	invalidateOfflineBackendCache();
	if (typeof window === 'undefined') return;
	window.dispatchEvent(
		new CustomEvent(OFFLINE_STATUS_CHANGED, { detail: { gameId, reason } satisfies OfflineStatusChangedDetail })
	);
}

export function invalidateOfflineStatusCache(): void {
	invalidatePullerOfflineStatusCache();
}
