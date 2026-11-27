/** Detect how offline downloads are handled in the current environment. */

import {
	getAppDeployment,
	isLocalAppDeployment,
	isPublicSiteDeployment,
	isTauriApp,
	type AppDeployment
} from './offline-deployment';
import { hasNativeOfflineBackend } from './offline-native';

/**
 * - `native`: the desktop app reads and writes game files on disk itself.
 * - `browser`: IndexedDB + service worker (public site, Android, `pnpm dev`).
 */
export type OfflineBackend = 'native' | 'browser' | 'none';

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
 * - **desktop app**: game files on disk, read natively; 
 * - **local-app in a browser** (pnpm dev): browser storage
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

	backendCache = isBrowserStorageSupported() ? 'browser' : 'none';
	backendCheckedAt = now;
	return backendCache;
}

export function describeOfflineBackend(backend: OfflineBackend): string {
	switch (backend) {
		case 'native':
			return 'Game files on disk';
		case 'browser':
			return isPublicSiteDeployment()
				? 'Browser storage (IndexedDB)'
				: 'Browser storage';
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
