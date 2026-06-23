/** HTTP client for the local puller backend (Tauri / `pnpm dev`). */

import { shouldProbePullerBackend } from './offline-deployment';

export interface GameOfflineStatus {
	online: boolean;
	offline: boolean;
	downloading: boolean;
}

export interface DownloadProgress {
	state: 'idle' | 'pending' | 'running' | 'done' | 'error';
	progress: number;
	message: string;
	error?: string;
}

const DEFAULT_PULLER_URL = 'http://127.0.0.1:18787';

export function getPullerBaseUrl(): string {
	const env = import.meta.env.PUBLIC_DOWNLOADER_URL;
	if (typeof env === 'string' && env.trim()) return env.replace(/\/$/, '');
	return DEFAULT_PULLER_URL;
}

let pullerAvailableCache: boolean | null = null;
let pullerAvailableCheckedAt = 0;
const AVAILABILITY_TTL_MS = 5000;

export async function isPullerAvailable(force = false): Promise<boolean> {
	if (!shouldProbePullerBackend()) {
		pullerAvailableCache = false;
		pullerAvailableCheckedAt = Date.now();
		return false;
	}

	const now = Date.now();
	if (
		!force &&
		pullerAvailableCache !== null &&
		now - pullerAvailableCheckedAt < AVAILABILITY_TTL_MS
	) {
		return pullerAvailableCache;
	}
	try {
		const res = await fetch(`${getPullerBaseUrl()}/api/offline/health`, {
			signal: AbortSignal.timeout(2500)
		});
		pullerAvailableCache = res.ok;
	} catch {
		pullerAvailableCache = false;
	}
	pullerAvailableCheckedAt = now;
	return pullerAvailableCache;
}

export function invalidatePullerAvailabilityCache(): void {
	pullerAvailableCache = null;
}

let statusCache: Record<string, GameOfflineStatus> | null = null;
let statusCacheAt = 0;
const STATUS_TTL_MS = 3000;

export async function fetchPullerOfflineStatuses(
	force = false
): Promise<Record<string, GameOfflineStatus>> {
	const now = Date.now();
	if (!force && statusCache && now - statusCacheAt < STATUS_TTL_MS) {
		return statusCache;
	}
	if (!(await isPullerAvailable(force))) {
		return {};
	}
	try {
		const res = await fetch(`${getPullerBaseUrl()}/api/offline/status`);
		if (!res.ok) return {};
		const data = (await res.json()) as { games?: Record<string, GameOfflineStatus> };
		statusCache = data.games ?? {};
		statusCacheAt = now;
		return statusCache;
	} catch {
		return {};
	}
}

export async function fetchPullerGameOfflineStatus(
	gameId: string,
	force = false
): Promise<GameOfflineStatus | null> {
	if (!(await isPullerAvailable(force))) return null;
	try {
		const res = await fetch(
			`${getPullerBaseUrl()}/api/offline/status/${encodeURIComponent(gameId)}`
		);
		if (!res.ok) return null;
		return (await res.json()) as GameOfflineStatus;
	} catch {
		return null;
	}
}

export function invalidatePullerOfflineStatusCache(): void {
	statusCache = null;
}

export async function startPullerGameDownload(
	gameId: string
): Promise<{ started: boolean; message: string }> {
	const res = await fetch(
		`${getPullerBaseUrl()}/api/offline/${encodeURIComponent(gameId)}/download`,
		{ method: 'POST' }
	);
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `Download failed (${res.status})`);
	}
	invalidatePullerOfflineStatusCache();
	return (await res.json()) as { started: boolean; message: string };
}

export async function fetchPullerDownloadProgress(gameId: string): Promise<DownloadProgress> {
	const res = await fetch(
		`${getPullerBaseUrl()}/api/offline/${encodeURIComponent(gameId)}/progress`
	);
	if (!res.ok) {
		return { state: 'idle', progress: 0, message: 'Unavailable' };
	}
	return (await res.json()) as DownloadProgress;
}

export async function deletePullerOfflineCopy(gameId: string): Promise<void> {
	const res = await fetch(`${getPullerBaseUrl()}/api/offline/${encodeURIComponent(gameId)}`, {
		method: 'DELETE'
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `Delete failed (${res.status})`);
	}
	invalidatePullerOfflineStatusCache();
}

export async function pollPullerDownloadUntilDone(
	gameId: string,
	onProgress: (p: DownloadProgress) => void,
	intervalMs = 800
): Promise<DownloadProgress> {
	for (;;) {
		const p = await fetchPullerDownloadProgress(gameId);
		onProgress(p);
		if (p.state === 'done' || p.state === 'error' || p.state === 'idle') {
			invalidatePullerOfflineStatusCache();
			return p;
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
}

/** Same-origin path segment proxied to the puller in dev (shared localStorage with /games/). */
export const PULLER_GAME_PROXY_SEGMENT = 'puller-games';

export function getPullerGameProxyPrefix(basePath = ''): string {
	const base = basePath.replace(/\/$/, '');
	return `${base}/${PULLER_GAME_PROXY_SEGMENT}`.replace(/\/{2,}/g, '/');
}

/** True when puller offline games should load through the app origin (storage continuity). */
export function shouldUsePullerGameProxy(): boolean {
	if (!shouldProbePullerBackend()) return false;
	if (import.meta.env.DEV) return true;
	if (typeof window === 'undefined') return true;
	return window.location.protocol === 'http:' || window.location.protocol === 'https:';
}

export function pullerOfflinePlayUrl(gameId: string, basePath = ''): string {
	if (shouldUsePullerGameProxy()) {
		return `${getPullerGameProxyPrefix(basePath)}/${encodeURIComponent(gameId)}/offline/index.html`;
	}
	return `${getPullerBaseUrl()}/games/${encodeURIComponent(gameId)}/offline/index.html`;
}
