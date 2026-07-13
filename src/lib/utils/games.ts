import { base } from '$app/paths';
import { getGamePlayMode } from '$lib/utils/game-play-mode';
import {
	fetchGameOfflineStatus,
	getOfflineBackend,
	getOfflinePlayUrl,
	isBrowserGameDownloaded
} from '$lib/utils/offline-downloader';
import { isPublicSiteDeployment } from '$lib/utils/offline-deployment';
import { isBundledOfflineGame } from '$lib/utils/game-availability';
import {
	resolveStaticOfflinePlayUrl,
	staticOfflineFileExists
} from '$lib/utils/offline-play-url';
import { appendPlayLog } from '$lib/utils/play-diagnostics-log';

export type GameEngine = 'unity' | 'html5' | string;

export interface GameMetadata {
	id: string;
	name: string;
	author: string;
	description: string;
	/** Local `/games/...` path, remote https URL, or empty; use `resolveGameThumbnailSrc` for `<img src>`. */
	thumbnail: string;
	/** Original portal cover URL when `thumbnail` may be local or remote. */
	thumbnailRemote?: string;
	/** How the cover is stored in the catalog tree. */
	thumbnailStored?: 'local' | 'remote' | 'none';
	category: string;
	/** Game engine — Unity titles may use an external embed for online play. */
	engine?: GameEngine;
	/** Direct URL for online play (Unity CDN, etc.). */
	onlineEmbedUrl?: string;
	/** Shipped with a pre-built offline copy under static/games/{id}/offline/. */
	bundledOffline?: boolean;
}

/** Lean catalog row from games-index shards (no description / embed URLs). */
export type GameIndexEntry = Pick<
	GameMetadata,
	'id' | 'name' | 'author' | 'category' | 'thumbnail' | 'engine'
>;

export interface CatalogManifest {
	version: number;
	total: number;
	shardSize: number;
	shardCount: number;
	categories: string[];
}

export type CatalogLoadProgress = {
	loadedShards: number;
	shardCount: number;
	loadedGames: number;
	total: number;
	complete: boolean;
};

/** Neutral inline SVG — avoids a network request when `thumbnail` is missing or blank. */
const MISSING_THUMB_DATA_URI =
	'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="256" height="256"%3E%3Crect fill="%23e5e5e5" width="256" height="256"/%3E%3C/svg%3E';

export type ThumbnailResolveOptions = {
	/**
	 * Prefer a locally cached offline cover when the device is offline or the user is in
	 * offline play mode with a downloaded copy.
	 */
	preferOffline?: boolean;
	/** Relative path under offline/ from puller status (e.g. assets/thumbnail.jpg). */
	offlineThumbnailRel?: string | null;
	/** Absolute/blob URL for browser-offline covers. */
	offlineThumbnailUrl?: string | null;
};

function offlineAssetUrl(gameId: string, relPath: string): string {
	const safe = relPath.replace(/^(\.\.\/)+/, '').replace(/^\//, '');
	const b = base.replace(/\/$/, '');
	/* Dev / Tauri webview: puller offline files are proxied under /puller-games */
	if (typeof window !== 'undefined' && (import.meta.env.DEV || shouldUsePullerProxyHeuristic())) {
		return `${b}/puller-games/${encodeURIComponent(gameId)}/offline/${safe}`.replace(/\/{2,}/g, '/');
	}
	return `${b}/games/${encodeURIComponent(gameId)}/offline/${safe}`.replace(/\/{2,}/g, '/');
}

function shouldUsePullerProxyHeuristic(): boolean {
	try {
		return window.location.protocol === 'http:' || window.location.protocol === 'https:';
	} catch {
		return false;
	}
}

/** Safe `src` for game cards: blank `thumbnail` does not hit `/games/.../404`. */
export function resolveGameThumbnailSrc(
	thumbnail: string | undefined | null,
	options?: ThumbnailResolveOptions & { gameId?: string }
): string {
	if (options?.preferOffline) {
		if (options.offlineThumbnailUrl?.trim()) return options.offlineThumbnailUrl.trim();
		const rel = options.offlineThumbnailRel?.trim();
		if (rel) {
			/* Browser backend may stash a blob:/https: URL in offlineThumbnail */
			if (/^(blob:|https?:)/i.test(rel)) return rel;
			if (options.gameId) return offlineAssetUrl(options.gameId, rel);
		}
	}
	const t = thumbnail?.trim();
	if (!t || t.endsWith('/.gitkeep') || t.endsWith('.gitkeep')) return MISSING_THUMB_DATA_URI;
	/* Absolute remote covers (budget fallback) load as-is. */
	if (/^https?:\/\//i.test(t) || t.startsWith('data:')) return t;
	if (t.startsWith('/')) return `${base}${t}`;
	return t;
}

let cachedManifest: CatalogManifest | null = null;
const shardCache = new Map<number, GameIndexEntry[]>();
let cachedIndex: GameIndexEntry[] | null = null;
let indexLoadPromise: Promise<GameIndexEntry[]> | null = null;
const indexProgressListeners = new Set<
	(games: GameIndexEntry[], progress: CatalogLoadProgress) => void
>();

function indexBaseUrl(): string {
	return `${base}/games/games-index`.replace(/\/{2,}/g, '/');
}

export async function loadCatalogManifest(): Promise<CatalogManifest> {
	if (cachedManifest) return cachedManifest;
	const response = await fetch(`${indexBaseUrl()}/manifest.json`);
	if (!response.ok) {
		throw new Error(`Catalog manifest failed (${response.status})`);
	}
	const data = (await response.json()) as CatalogManifest;
	cachedManifest = data;
	return data;
}

export async function loadCatalogShard(index: number): Promise<GameIndexEntry[]> {
	const cached = shardCache.get(index);
	if (cached) return cached;
	const name = `shard-${String(index).padStart(3, '0')}.json`;
	const response = await fetch(`${indexBaseUrl()}/${name}`);
	if (!response.ok) {
		throw new Error(`Catalog shard ${index} failed (${response.status})`);
	}
	const data: unknown = await response.json();
	const shard = Array.isArray(data) ? (data as GameIndexEntry[]) : [];
	shardCache.set(index, shard);
	return shard;
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
	let cursor = 0;
	const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (cursor < items.length) {
			const i = cursor++;
			await worker(items[i]);
		}
	});
	await Promise.all(runners);
}

function emitIndexProgress(games: GameIndexEntry[], progress: CatalogLoadProgress) {
	for (const listener of indexProgressListeners) {
		try {
			listener(games, progress);
		} catch (err) {
			console.error('Catalog progress listener failed:', err);
		}
	}
}

async function loadCatalogIndexInternal(): Promise<GameIndexEntry[]> {
	const manifest = await loadCatalogManifest();
	const byShard = new Map<number, GameIndexEntry[]>();

	const rebuild = (): GameIndexEntry[] => {
		const out: GameIndexEntry[] = [];
		for (let i = 0; i < manifest.shardCount; i++) {
			const shard = byShard.get(i);
			if (shard) out.push(...shard);
		}
		return out;
	};

	const report = (loadedShards: number, complete: boolean) => {
		const games = rebuild();
		const progress: CatalogLoadProgress = {
			loadedShards,
			shardCount: manifest.shardCount,
			loadedGames: games.length,
			total: manifest.total,
			complete
		};
		emitIndexProgress(games, progress);
		if (complete) cachedIndex = games;
	};

	byShard.set(0, await loadCatalogShard(0));
	report(1, manifest.shardCount <= 1);

	if (manifest.shardCount > 1) {
		const rest = Array.from({ length: manifest.shardCount - 1 }, (_, i) => i + 1);
		let loadedShards = 1;
		await runPool(rest, 4, async (shardIndex) => {
			byShard.set(shardIndex, await loadCatalogShard(shardIndex));
			loadedShards += 1;
			report(loadedShards, loadedShards >= manifest.shardCount);
		});
	}

	const final = rebuild();
	cachedIndex = final;
	return final;
}

/**
 * Progressive catalog index: shard 0 first (callback), then remaining shards (concurrency 4).
 * Concurrent callers share one load; progress listeners all receive updates.
 */
export async function loadCatalogIndex(
	onProgress?: (games: GameIndexEntry[], progress: CatalogLoadProgress) => void
): Promise<GameIndexEntry[]> {
	if (cachedIndex) {
		onProgress?.(cachedIndex, {
			loadedShards: cachedManifest?.shardCount ?? 1,
			shardCount: cachedManifest?.shardCount ?? 1,
			loadedGames: cachedIndex.length,
			total: cachedIndex.length,
			complete: true
		});
		return cachedIndex;
	}

	if (onProgress) indexProgressListeners.add(onProgress);
	try {
		if (!indexLoadPromise) {
			indexLoadPromise = loadCatalogIndexInternal().finally(() => {
				indexLoadPromise = null;
			});
		}
		return await indexLoadPromise;
	} finally {
		if (onProgress) indexProgressListeners.delete(onProgress);
	}
}

/**
 * @deprecated Prefer `loadCatalogIndex` for progressive UI. Awaits the full lean index
 * (not the legacy ~11 MB games-metadata.json).
 */
export async function loadAllGames(): Promise<GameIndexEntry[]> {
	try {
		return await loadCatalogIndex();
	} catch (error) {
		console.error('Failed to load games catalog index:', error);
		return [];
	}
}

export async function loadGameMetadata(id: string): Promise<GameMetadata | null> {
	try {
		const response = await fetch(`${base}/games/${id}/online/metadata.json`);
		if (response.ok) {
			return await response.json();
		}
	} catch (error) {
		console.error(`Failed to load metadata for ${id}:`, error);
	}
	return null;
}

/**
 * Legacy bug / stale bundles produced `/games/<id>/online/offline/...` by joining `offline/...`
 * under `online/`. Normalize to the real static path.
 */
export function fixMalformedGamePlayerUrl(url: string, gameId: string): string {
	let out = url;
	const withBase = `${base}/games/${gameId}/online/offline`;
	const noBase = `/games/${gameId}/online/offline`;
	if (out.includes(withBase)) {
		out = out.split(withBase).join(`${base}/games/${gameId}/offline`);
	}
	if (out.includes(noBase)) {
		out = out.split(noBase).join(`/games/${gameId}/offline`);
	}
	return out;
}

/** Unity WebGL player shell — inject.js strips splash / portal loading bloat. */
function unityPlayerShellUrl(externalUrl: string, gameId: string, assetsBase?: string): string {
	const params = new URLSearchParams({ src: externalUrl, game: gameId });
	if (assetsBase) params.set('assets', assetsBase);
	return `${base}/unity/player.html?${params.toString()}`;
}

function unityOfflineAssetsBase(gameId: string): string {
	return `${base}/games/${encodeURIComponent(gameId)}/offline/`.replace(/\/{2,}/g, '/');
}

/**
 * Offline Unity hosts are already post-processed (inject + asset-map) or are
 * browser blob / SW shells. Wrapping them in `/unity/player.html` rejects `blob:`
 * and double-wraps puller offline entry HTML — load them directly instead.
 */
export function isLocalOfflinePlayUrl(url: string): boolean {
	const trimmed = url.trim();
	if (!trimmed) return false;
	if (trimmed.startsWith('blob:')) return true;
	if (trimmed.includes('/browser-offline/')) return true;
	if (trimmed.includes('/puller-games/')) return true;
	if (trimmed.includes('/games/') && trimmed.includes('/offline/')) return true;
	try {
		const absolute = new URL(trimmed, 'http://local.invalid');
		if (absolute.protocol === 'blob:') return true;
	} catch {
		/* ignore */
	}
	return false;
}

function resolveOfflineUnityPlayUrl(offlineUrl: string, gameId: string): string {
	if (isLocalOfflinePlayUrl(offlineUrl)) {
		return offlineUrl;
	}
	return unityPlayerShellUrl(offlineUrl, gameId, unityOfflineAssetsBase(gameId));
}

function resolveOnlinePlayUrl(metadata: GameMetadata | null, gameId: string): string {
	const embed = metadata?.onlineEmbedUrl?.trim();
	if (embed) {
		if (metadata?.engine === 'unity') {
			return unityPlayerShellUrl(embed, gameId);
		}
		return embed;
	}

	const onlineShell = `${base}/games/${gameId}/online/index.html`;
	if (metadata?.engine === 'unity') {
		return unityPlayerShellUrl(onlineShell, gameId);
	}
	return onlineShell;
}

async function offlineAvailable(gameId: string): Promise<boolean> {
	if (isBundledOfflineGame(gameId)) return true;
	const status = await fetchGameOfflineStatus(gameId);
	if (status?.offline) return true;
	// Puller answered — trust it; do not probe static /offline/ (noisy 404s while playing online).
	if (status) return false;
	if ((await getOfflineBackend()) === 'browser' && (await isBrowserGameDownloaded(gameId))) {
		return true;
	}
	if (!isPublicSiteDeployment()) {
		return staticOfflineFileExists(gameId, base);
	}
	return false;
}

async function staticOfflinePlayUrlIfNeeded(gameId: string): Promise<string> {
	return resolveStaticOfflinePlayUrl(gameId, base);
}

/** Resolve the iframe src for playing a game. */
export async function getGamePlayerUrl(gameId: string): Promise<string> {
	const metadata = await loadGameMetadata(gameId);

	const hasOffline = await offlineAvailable(gameId);
	const networkOnline = typeof navigator === 'undefined' || navigator.onLine;
	const mode = networkOnline ? getGamePlayMode(gameId) : 'offline';

	if (!networkOnline) {
		if (hasOffline) {
			const offlineUrl = await getOfflinePlayUrl(gameId);
			if (offlineUrl) {
				const url =
					metadata?.engine === 'unity'
						? resolveOfflineUnityPlayUrl(offlineUrl, gameId)
						: offlineUrl;
				appendPlayLog(
					'info',
					'play-url',
					`Resolved offline play URL (device offline)`,
					`game=${gameId} engine=${metadata?.engine ?? 'unknown'} mode=${mode} url=${url}`
				);
				return url;
			}
			if (!isPublicSiteDeployment()) {
				const staticOfflineUrl = await staticOfflinePlayUrlIfNeeded(gameId);
				const url =
					metadata?.engine === 'unity'
						? resolveOfflineUnityPlayUrl(staticOfflineUrl, gameId)
						: staticOfflineUrl;
				appendPlayLog(
					'info',
					'play-url',
					`Resolved static offline play URL (device offline)`,
					`game=${gameId} url=${url}`
				);
				return url;
			}
		}
		const fallback = resolveOnlinePlayUrl(metadata, gameId);
		appendPlayLog(
			'warn',
			'play-url',
			`No offline copy — falling back while device offline`,
			`game=${gameId} url=${fallback}`
		);
		return fallback;
	}

	if (mode === 'offline' && hasOffline) {
		const offlineUrl = await getOfflinePlayUrl(gameId);
		if (offlineUrl) {
			const url =
				metadata?.engine === 'unity'
					? resolveOfflineUnityPlayUrl(offlineUrl, gameId)
					: offlineUrl;
			appendPlayLog(
				'info',
				'play-url',
				`Resolved offline play URL (offline mode)`,
				`game=${gameId} engine=${metadata?.engine ?? 'unknown'} url=${url}`
			);
			return url;
		}
		if (!isPublicSiteDeployment()) {
			const staticOfflineUrl = await staticOfflinePlayUrlIfNeeded(gameId);
			const url =
				metadata?.engine === 'unity'
					? resolveOfflineUnityPlayUrl(staticOfflineUrl, gameId)
					: staticOfflineUrl;
			appendPlayLog(
				'info',
				'play-url',
				`Resolved static offline play URL (offline mode)`,
				`game=${gameId} url=${url}`
			);
			return url;
		}
		const fallback = resolveOnlinePlayUrl(metadata, gameId);
		appendPlayLog(
			'warn',
			'play-url',
			`Offline mode selected but no offline URL — using online`,
			`game=${gameId} url=${fallback}`
		);
		return fallback;
	}

	/*
	 * Unity online with inject:
	 * 1) Local-app puller URL when available
	 * 2) Optional hosted PUBLIC_PLAY_PROXY_URL (Cloudflare Worker)
	 * 3) Public site: same-origin /api/unity-play/:id via offline-sw → local puller :18787
	 * 4) Else player.html shell (touch unavailable)
	 */
	if (metadata?.engine === 'unity') {
		const { isPullerAvailable, pullerUnityPlayUrl } = await import('./offline-downloader-puller');
		if (await isPullerAvailable()) {
			const url = pullerUnityPlayUrl(gameId, base);
			appendPlayLog('info', 'play-url', `Resolved Unity play via puller proxy`, `game=${gameId} url=${url}`);
			return url;
		}
		const playProxy = (import.meta.env.PUBLIC_PLAY_PROXY_URL as string | undefined)?.replace(/\/$/, '');
		if (playProxy) {
			const url = `${playProxy}/api/unity-play/${encodeURIComponent(gameId)}`;
			appendPlayLog('info', 'play-url', `Resolved Unity play via PUBLIC_PLAY_PROXY_URL`, `game=${gameId} url=${url}`);
			return url;
		}
		if (isPublicSiteDeployment()) {
			const { ensureOfflineServiceWorker } = await import('./browser-offline-download');
			await ensureOfflineServiceWorker();
			const url = `${base}/api/unity-play/${encodeURIComponent(gameId)}`.replace(/\/{2,}/g, '/');
			appendPlayLog(
				'info',
				'play-url',
				`Resolved Unity play via service-worker → local puller relay`,
				`game=${gameId} url=${url}`
			);
			return url;
		}
	}

	const onlineUrl = resolveOnlinePlayUrl(metadata, gameId);
	appendPlayLog(
		'info',
		'play-url',
		`Resolved online play URL`,
		`game=${gameId} engine=${metadata?.engine ?? 'unknown'} url=${onlineUrl}`
	);
	return onlineUrl;
}

/** Whether the game can be played while the device has no network connection. */
export async function canPlayGameOffline(
	gameId: string,
	metadata?: GameMetadata | null
): Promise<boolean> {
	const { getGameAvailability } = await import('$lib/utils/game-availability');
	const availability = await getGameAvailability(gameId, metadata ?? (await loadGameMetadata(gameId)), true);
	return availability.offline;
}

/** Whether both online and offline copies exist for a game. */
export async function gameHasDualVersions(gameId: string): Promise<{
	online: boolean;
	offline: boolean;
}> {
	const metadata = await loadGameMetadata(gameId);
	const online = Boolean(metadata?.onlineEmbedUrl?.trim()) || true;
	const offline = await offlineAvailable(gameId);
	return { online, offline };
}

/** Iframe `allow` attribute for the resolved play URL. */
export function iframeAllowForUrl(url: string): string | undefined {
	if (
		url.includes('/api/unity-play/') ||
		url.includes('/unity/player.html') ||
		url.includes('/unity/embed.html') ||
		url.includes('jsdelivr.net') ||
		url.includes('/browser-offline/') ||
		url.includes('/puller-games/') ||
		url.includes('127.0.0.1') ||
		url.includes('localhost') ||
		url.startsWith('blob:') ||
		(url.includes('/games/') && (url.includes('/online/') || url.includes('/offline/'))) ||
		(() => {
			try {
				const proxy = (import.meta.env.PUBLIC_PLAY_PROXY_URL as string | undefined)?.replace(
					/\/$/,
					''
				);
				return Boolean(proxy && url.startsWith(proxy));
			} catch {
				return false;
			}
		})()
	) {
		return 'fullscreen; autoplay; gamepad; microphone; camera';
	}
	return undefined;
}
