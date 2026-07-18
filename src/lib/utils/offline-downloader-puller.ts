/** HTTP client for the local puller backend (Tauri / `pnpm dev`). */

import { shouldProbePullerBackend } from './offline-deployment';

export interface GameOfflineStatus {
	online: boolean;
	offline: boolean;
	downloading: boolean;
	partialCache?: boolean;
	cacheFileCount?: number;
	/** Relative path under offline/ for a cached cover (puller). */
	offlineThumbnail?: string;
}

export interface DownloadProgress {
	state: 'idle' | 'pending' | 'running' | 'done' | 'error' | 'cancelled';
	progress: number;
	message: string;
	error?: string;
}

const DEFAULT_PULLER_URL = 'http://127.0.0.1:18787';

/** Set by Tauri on startup when the sidecar uses a non-default port. */
let pullerBaseUrlOverride: string | null = null;

export function setPullerBaseUrlOverride(url: string | null): void {
	pullerBaseUrlOverride = url ? url.replace(/\/$/, '') : null;
	pullerAvailableCache = null;
	pullerAvailableCheckedAt = 0;
}

export function getPullerBaseUrl(): string {
	if (pullerBaseUrlOverride) return pullerBaseUrlOverride;
	const env = import.meta.env.PUBLIC_DOWNLOADER_URL;
	if (typeof env === 'string' && env.trim()) return env.replace(/\/$/, '');
	return DEFAULT_PULLER_URL;
}

/**
 * Base URL for puller HTTP APIs (`/api/offline`, etc.).
 * In Vite dev, prefer same-origin (empty string) so WebKit/Tauri uses the Vite proxy
 * instead of flaky cross-origin fetches to :18787.
 */
export function getPullerApiBaseUrl(): string {
	if (shouldUsePullerGameProxy()) return '';
	return getPullerBaseUrl();
}

/** Clear cached health probes so a later puller start is observed quickly. */
export function invalidatePullerAvailabilityCache(): void {
	pullerAvailableCache = null;
	pullerAvailableCheckedAt = 0;
}

async function canInvokeTauriPuller(): Promise<boolean> {
	try {
		const { isTauriApp, isLocalAppDeployment } = await import('./offline-deployment');
		// Packaged Tauri / Flatpak classify as local-app; invoke when either signal is present.
		return isTauriApp() || isLocalAppDeployment();
	} catch {
		return false;
	}
}

/** Resolve puller URL from Tauri (handles port conflicts with host pullers). */
export async function syncPullerBaseUrlFromTauri(): Promise<string | null> {
	if (!shouldProbePullerBackend()) return null;
	try {
		if (!(await canInvokeTauriPuller())) return null;
		const { invoke } = await import('@tauri-apps/api/core');
		const url = await invoke<string>('get_puller_base_url');
		if (typeof url === 'string' && url.trim()) {
			setPullerBaseUrlOverride(url.trim());
			invalidatePullerAvailabilityCache();
			return getPullerBaseUrl();
		}
	} catch {
		/* not Tauri or command unavailable */
	}
	invalidatePullerAvailabilityCache();
	return null;
}

/**
 * Ask the native shell to health-check (and respawn) the puller.
 * Prefer this in packaged Flatpak/Tauri — WebKit fetch to 127.0.0.1 is flaky
 * from `tauri://` while Rust loopback checks are reliable.
 */
export async function ensurePullerFromTauri(): Promise<string | null> {
	if (!shouldProbePullerBackend()) return null;
	try {
		if (!(await canInvokeTauriPuller())) return null;
		const { invoke } = await import('@tauri-apps/api/core');
		const url = await invoke<string>('ensure_puller');
		if (typeof url === 'string' && url.trim()) {
			setPullerBaseUrlOverride(url.trim());
			pullerAvailableCache = true;
			pullerAvailableCheckedAt = Date.now();
			return getPullerBaseUrl();
		}
	} catch {
		/* not Tauri, or puller failed to become healthy */
	}
	return null;
}

let pullerAvailableCache: boolean | null = null;
let pullerAvailableCheckedAt = 0;
const AVAILABILITY_TTL_MS = 5000;

/**
 * Probe the local puller health endpoint.
 * @param force bypass TTL cache
 * @param options.ignoreDeploymentGate when true, probe even on public-site
 *   (used to route external-iframe full scrapes to a running local puller)
 */
export async function isPullerAvailable(
	force = false,
	options?: { ignoreDeploymentGate?: boolean }
): Promise<boolean> {
	if (!options?.ignoreDeploymentGate && !shouldProbePullerBackend()) {
		pullerAvailableCache = false;
		pullerAvailableCheckedAt = Date.now();
		return false;
	}

	const now = Date.now();
	if (
		!force &&
		!options?.ignoreDeploymentGate &&
		pullerAvailableCache !== null &&
		now - pullerAvailableCheckedAt < AVAILABILITY_TTL_MS
	) {
		return pullerAvailableCache;
	}

	const cacheResult = (ok: boolean) => {
		if (!options?.ignoreDeploymentGate) {
			pullerAvailableCache = ok;
			pullerAvailableCheckedAt = Date.now();
		}
		return ok;
	};

	if (await probePullerHealthHttp()) return cacheResult(true);

	/*
	 * Packaged WebViews often fail cross-origin loopback fetch even when the
	 * sidecar is healthy — confirm via Rust ensure_puller before giving up.
	 */
	if (await ensurePullerFromTauri()) return cacheResult(true);
	return cacheResult(false);
}

async function probePullerHealthHttp(): Promise<boolean> {
	try {
		const res = await fetch(`${getPullerApiBaseUrl()}/api/offline/health`, {
			signal: AbortSignal.timeout(2500)
		});
		return res.ok;
	} catch {
		return false;
	}
}

/**
 * Wait until the puller answers health (native app startup). Returns false on timeout.
 */
export async function waitForPuller(timeoutMs = 15_000): Promise<boolean> {
	const deadline = Date.now() + Math.max(0, timeoutMs);
	await syncPullerBaseUrlFromTauri();
	/* Native ensure respawns a dead sidecar — do this once before the poll loop. */
	if (await ensurePullerFromTauri()) return true;
	while (Date.now() <= deadline) {
		invalidatePullerAvailabilityCache();
		if (await probePullerHealthHttp()) {
			pullerAvailableCache = true;
			pullerAvailableCheckedAt = Date.now();
			return true;
		}
		await new Promise((r) => setTimeout(r, 400));
	}
	/* Last chance: WebKit fetch stayed dark but Rust can still reach loopback. */
	return Boolean(await ensurePullerFromTauri());
}

export interface PullerHealth {
	ok: boolean;
	dataDir?: string;
	catalogDir?: string;
	catalogGameCount?: number;
	port?: number;
	activeDownloads?: number;
	liveSessions?: number;
}

export interface PullerJobsSnapshot {
	ok: boolean;
	active: string[];
	jobs: unknown[];
	liveSessions?: number;
}

export async function fetchPullerJobs(): Promise<PullerJobsSnapshot | null> {
	if (!shouldProbePullerBackend()) return null;
	try {
		const res = await fetch(`${getPullerApiBaseUrl()}/api/offline/jobs`, {
			signal: AbortSignal.timeout(4000)
		});
		if (!res.ok) return null;
		return (await res.json()) as PullerJobsSnapshot;
	} catch {
		return null;
	}
}

export async function fetchPullerHealth(): Promise<PullerHealth | null> {
	if (!shouldProbePullerBackend()) return null;
	try {
		const res = await fetch(`${getPullerApiBaseUrl()}/api/offline/health`, {
			signal: AbortSignal.timeout(2500)
		});
		if (!res.ok) return null;
		return (await res.json()) as PullerHealth;
	} catch {
		return null;
	}
}

/** Enrich "Game not in catalog" errors with puller catalog size when available. */
export async function describePullerDownloadError(error: string | undefined): Promise<string> {
	const base = error?.trim() || 'Download failed';
	if (!/not in catalog/i.test(base)) return base;
	const health = await fetchPullerHealth();
	if (!health || typeof health.catalogGameCount !== 'number') return base;
	if (health.catalogGameCount === 0) {
		return `${base} — puller catalog is empty (packaging issue)`;
	}
	return `${base} (puller catalog has ${health.catalogGameCount} games)`;
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
		const res = await fetch(`${getPullerApiBaseUrl()}/api/offline/status`, {
			signal: AbortSignal.timeout(8_000)
		});
		if (!res.ok) return {};
		const data = (await res.json()) as { games?: Record<string, GameOfflineStatus> };
		statusCache = data.games ?? {};
		statusCacheAt = now;
		return statusCache;
	} catch {
		return {};
	}
}

/** Statuses for a specific set of game ids (visible cards). Merges into status cache. */
export async function fetchPullerOfflineStatusesForIds(
	gameIds: string[],
	force = false
): Promise<Record<string, GameOfflineStatus>> {
	const unique = [...new Set(gameIds.filter(Boolean))];
	if (unique.length === 0) return {};
	if (!(await isPullerAvailable(force))) return {};
	try {
		const params = new URLSearchParams({ ids: unique.join(',') });
		const res = await fetch(`${getPullerApiBaseUrl()}/api/offline/status?${params}`, {
			signal: AbortSignal.timeout(8_000)
		});
		if (!res.ok) return {};
		const data = (await res.json()) as { games?: Record<string, GameOfflineStatus> };
		const games = data.games ?? {};
		const nextCache: Record<string, GameOfflineStatus> = { ...(statusCache ?? {}) };
		for (const [id, status] of Object.entries(games)) {
			if (status.offline || status.downloading || status.partialCache) {
				nextCache[id] = status;
			} else {
				/* Drop stale downloaded entries after delete. */
				delete nextCache[id];
			}
		}
		statusCache = nextCache;
		statusCacheAt = Date.now();
		return games;
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
			`${getPullerApiBaseUrl()}/api/offline/status/${encodeURIComponent(gameId)}`
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
		`${getPullerApiBaseUrl()}/api/offline/${encodeURIComponent(gameId)}/download`,
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
		`${getPullerApiBaseUrl()}/api/offline/${encodeURIComponent(gameId)}/progress`
	);
	if (!res.ok) {
		return { state: 'idle', progress: 0, message: 'Unavailable' };
	}
	return (await res.json()) as DownloadProgress;
}

export async function deletePullerOfflineCopy(gameId: string): Promise<void> {
	const res = await fetch(`${getPullerApiBaseUrl()}/api/offline/${encodeURIComponent(gameId)}`, {
		method: 'DELETE'
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `Delete failed (${res.status})`);
	}
	invalidatePullerOfflineStatusCache();
}

export async function cancelPullerGameDownload(
	gameId: string,
	discardCache: boolean
): Promise<{ cancelled: boolean; message: string }> {
	const res = await fetch(
		`${getPullerApiBaseUrl()}/api/offline/${encodeURIComponent(gameId)}/cancel`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ discardCache })
		}
	);
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `Cancel failed (${res.status})`);
	}
	invalidatePullerOfflineStatusCache();
	return (await res.json()) as { cancelled: boolean; message: string };
}

export async function pollPullerDownloadUntilDone(
	gameId: string,
	onProgress: (p: DownloadProgress) => void,
	intervalMs = 800
): Promise<DownloadProgress> {
	let sawActive = false;
	for (;;) {
		const p = await fetchPullerDownloadProgress(gameId);
		onProgress(p);
		if (p.state === 'pending' || p.state === 'running') {
			sawActive = true;
		}
		if (p.state === 'done' || p.state === 'error' || p.state === 'cancelled') {
			invalidatePullerOfflineStatusCache();
			return p;
		}
		if (p.state === 'idle' && !sawActive) {
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

/** True when puller offline games should load through the app origin (storage continuity).
 * Only Vite proxies `/puller-games` to PUBLIC_DOWNLOADER_URL (default :18787).
 * When Tauri reserved another port (Flatpak already on 18787), use absolute puller URLs
 * so we do not hit the wrong sidecar and 404 Unity Build JSON as HTML.
 */
export function shouldUsePullerGameProxy(): boolean {
	if (!shouldProbePullerBackend()) return false;
	if (!import.meta.env.DEV) return false;
	const active = getPullerBaseUrl().replace(/\/$/, '');
	const env = import.meta.env.PUBLIC_DOWNLOADER_URL;
	const viteProxyTarget = (
		typeof env === 'string' && env.trim() ? env.trim() : DEFAULT_PULLER_URL
	).replace(/\/$/, '');
	return active === viteProxyTarget;
}

export function pullerOfflinePlayUrl(gameId: string, basePath = '', entry = 'index.html'): string {
	const safeEntry = entry.replace(/^(\.\.\/)+/, '').replace(/^\//, '');
	if (shouldUsePullerGameProxy()) {
		return `${getPullerGameProxyPrefix(basePath)}/${encodeURIComponent(gameId)}/offline/${safeEntry}`;
	}
	return `${getPullerBaseUrl()}/games/${encodeURIComponent(gameId)}/offline/${safeEntry}`;
}

/** URL for a file under the puller's offline mirror (e.g. cached cover thumbnail). */
export function pullerOfflineAssetUrl(gameId: string, relPath: string, basePath = ''): string {
	return pullerOfflinePlayUrl(gameId, basePath, relPath);
}

/** Same-origin proxied Unity build (splash stripped) when puller is running. */
export function pullerUnityPlayUrl(gameId: string, basePath = ''): string {
	if (shouldUsePullerGameProxy()) {
		return `${getPullerGameProxyPrefix(basePath).replace(/\/puller-games$/, '')}/api/unity-play/${encodeURIComponent(gameId)}`;
	}
	return `${getPullerBaseUrl()}/api/unity-play/${encodeURIComponent(gameId)}`;
}

/**
 * Live play relay URL (additional puller capability — does not create an offline mirror).
 * Dev: same-origin Vite proxy. Packaged Tauri: direct loopback.
 */
export function pullerLiveGameUrl(gameId: string, basePath = ''): string {
	if (shouldUsePullerGameProxy()) {
		return `${getPullerGameProxyPrefix(basePath).replace(/\/puller-games$/, '')}/api/game-live/${encodeURIComponent(gameId)}`;
	}
	return `${getPullerBaseUrl()}/api/game-live/${encodeURIComponent(gameId)}`;
}

/** Same-origin live route for GitHub Pages (service worker relays to local puller). */
export function sameOriginLiveGameUrl(gameId: string, basePath = ''): string {
	const base = basePath.replace(/\/$/, '');
	return `${base}/api/game-live/${encodeURIComponent(gameId)}`.replace(/\/{2,}/g, '/');
}
