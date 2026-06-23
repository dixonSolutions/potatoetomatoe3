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

export type OfflineBackend = 'puller' | 'browser' | 'none';

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
 * - **local-app** (pnpm dev / Tauri): puller file downloads; browser fallback if puller is down
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

	// local-app: full game mirrors via puller on disk
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
}

export async function isOfflineDownloadAvailable(force = false): Promise<boolean> {
	return (await getOfflineBackend(force)) !== 'none';
}
