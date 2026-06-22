/** Detect how offline downloads are handled in the current environment. */

import { isPullerAvailable } from './offline-downloader-puller';

export type OfflineBackend = 'puller' | 'browser' | 'none';

export function isTauriApp(): boolean {
	if (typeof window === 'undefined') return false;
	return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

export function isBrowserStorageSupported(): boolean {
	if (typeof window === 'undefined') return false;
	return typeof indexedDB !== 'undefined' && 'serviceWorker' in navigator;
}

let backendCache: OfflineBackend | null = null;
let backendCheckedAt = 0;
const BACKEND_TTL_MS = 5000;

/** Prefer puller when running locally or in Tauri; otherwise use browser storage on the web. */
export async function getOfflineBackend(force = false): Promise<OfflineBackend> {
	const now = Date.now();
	if (!force && backendCache !== null && now - backendCheckedAt < BACKEND_TTL_MS) {
		return backendCache;
	}

	if (await isPullerAvailable(force)) {
		backendCache = 'puller';
	} else if (isBrowserStorageSupported()) {
		backendCache = 'browser';
	} else {
		backendCache = 'none';
	}
	backendCheckedAt = now;
	return backendCache;
}

export function invalidateOfflineBackendCache(): void {
	backendCache = null;
}

export async function isOfflineDownloadAvailable(force = false): Promise<boolean> {
	return (await getOfflineBackend(force)) !== 'none';
}
