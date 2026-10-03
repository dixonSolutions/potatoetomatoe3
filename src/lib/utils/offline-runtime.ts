/** Detect how offline downloads are handled in the current environment. */

import {
	getAppDeployment,
	isLocalAppDeployment,
	isPublicSiteDeployment,
	isTauriApp,
	shouldProbePullerBackend,
	type AppDeployment
} from './offline-deployment';
import { isPullerAvailable } from './offline-downloader-puller';
import { hasNativeOfflineBackend } from './offline-native';

/**
 * - `native`: the desktop app reads and writes game files on disk itself; the puller is
 *   started only to capture a download.
 * - `puller`: a puller answers on this machine (`pnpm dev` in a plain browser).
 * - `browser`: IndexedDB + service worker (public site, Android, or no puller in dev).
 */
export type OfflineBackend = 'native' | 'puller' | 'browser' | 'none';

export {
	getAppDeployment,
	isLocalAppDeployment,
	isPublicSiteDeployment,
	isTauriApp,
	type AppDeployment
};

export function isBrowserStorageSupported(): boolean {
	if (typeof window === 'undefined') return false;
	return typeof indexedDB !== 'undefined' && 'serviceWorker' in navigator;
}

let backendCache: OfflineBackend | null = null;
let backendCheckedAt = 0;
const BACKEND_TTL_MS = 5000;

/**
 * Pick offline storage backend:
 * - **public-site** (GitHub Pages): browser IndexedDB + service worker only
 * - **desktop app**: game files on disk, read natively; no puller until a download
 * - **local-app in a browser** (pnpm dev): puller file downloads; browser fallback if it is down
 */
export async function getOfflineBackend(force = false): Promise<OfflineBackend> {
	const now = Date.now();
	if (!force && backendCache !== null && now - backendCheckedAt < BACKEND_TTL_MS) {
		return backendCache;
	}

	if (isPublicSiteDeployment()) {
		backendCache = isBrowserStorageSupported() ? 'browser' : 'none';
		backendCheckedAt = now;
		return backendCache;
	}

	if (hasNativeOfflineBackend()) {
		backendCache = 'native';
		backendCheckedAt = now;
		return backendCache;
	}

	// local-app in a browser: full game mirrors via a dev puller on disk
	if (shouldProbePullerBackend() && (await isPullerAvailable(force))) {
		backendCache = 'puller';
	} else if (isBrowserStorageSupported()) {
		backendCache = 'browser';
	} else {
		backendCache = 'none';
	}
	backendCheckedAt = now;
	return backendCache;
}

export function describeOfflineBackend(backend: OfflineBackend): string {
	switch (backend) {
		case 'native':
			return 'Game files on disk';
		case 'puller':
			return 'Local file download (puller)';
		case 'browser':
			return isPublicSiteDeployment()
				? 'Browser storage (IndexedDB)'
				: 'Browser storage (puller unavailable)';
		default:
			return 'Offline downloads unavailable';
	}
}

export function invalidateOfflineBackendCache(): void {
	backendCache = null;
	backendCheckedAt = 0;
}

export async function isOfflineDownloadAvailable(force = false): Promise<boolean> {
	return (await getOfflineBackend(force)) !== 'none';
}
