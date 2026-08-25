import { base } from '$app/paths';
import { getGamePlayMode } from '$lib/utils/game-play-mode';
import {
	fetchGameOfflineStatus,
	getOfflineBackend,
	getOfflinePlayUrl,
	isBrowserGameDownloaded
} from '$lib/utils/offline-downloader';
import {
	pullerOfflineAssetUrl,
	shouldUsePullerGameProxy
} from '$lib/utils/offline-downloader-puller';
import { isPublicSiteDeployment, shouldProbePullerBackend } from '$lib/utils/offline-deployment';
import { isBundledOfflineGame } from '$lib/utils/game-availability';
import { resolveStaticOfflinePlayUrl, staticOfflineFileExists } from '$lib/utils/offline-play-url';
import { appendPlayLog } from '$lib/utils/play-diagnostics-log';
import { sizedThumbnailUrl } from '$lib/utils/thumbnail-size';
import { readConsoleVisiblePref } from '$lib/utils/touch-console';
import {
	decideOnlineRelay,
	hasDirectLaunchFailed,
	isFrameBlockedHost
} from '$lib/utils/online-play-routing';

/**
 * How long a launch may wait for a cold puller when the relay is mandatory (touch
 * console / direct-launch retry). Kept short: the touch console runs its own longer
 * wait when the user turns it on, so the launch path never needs to block for that.
 */
const RELAY_LAUNCH_WAIT_MS = 4000;

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
	/** Prefer this CDN HTML over Sites fallback URLs when present. */
	remotePlayUrl?: string;
	/** Catalog importer wrote online/embed.html for puller live/unity proxies. */
	localEmbed?: boolean;
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
	/** Widest this cover will be displayed, in CSS pixels. Drives CDN resizing. */
	targetPx?: number;
};

/**
 * Cover URL for a file under offline/ (e.g. assets/thumbnail.jpg).
 * Dev → Vite `/puller-games` proxy; packaged desktop → puller loopback;
 * Android / static mirrors → same-origin `/games/.../offline/...`.
 */
function offlineAssetUrl(gameId: string, relPath: string): string {
	const safe = relPath.replace(/^(\.\.\/)+/, '').replace(/^\//, '');
	if (shouldUsePullerGameProxy() || shouldProbePullerBackend()) {
		return pullerOfflineAssetUrl(gameId, safe, base);
	}
	const b = base.replace(/\/$/, '');
	return `${b}/games/${encodeURIComponent(gameId)}/offline/${safe}`.replace(/\/{2,}/g, '/');
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
	if (t.startsWith('data:')) return t;
	/*
	 * Remote portal covers are full-resolution originals — up to 2730x1535 for a 138px
	 * tile. Ask the CDN for a tile-sized image instead; see `sizedThumbnailUrl`.
	 */
	if (/^https?:\/\//i.test(t)) return sizedThumbnailUrl(t, options?.targetPx);
	if (t.startsWith('/')) return `${base}${t}`;
	return t;
}

let cachedManifest: CatalogManifest | null = null;
const shardCache = new Map<number, GameIndexEntry[]>();
let cachedIndex: GameIndexEntry[] | null = null;
/** Contiguous loaded prefix length (shards 0..n-1 all present). */
let contiguousLoadedShards = 0;
let shardLoadTail: Promise<void> = Promise.resolve();
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

function assembleContiguousGames(manifest: CatalogManifest): GameIndexEntry[] {
	const out: GameIndexEntry[] = [];
	let n = 0;
	for (let i = 0; i < manifest.shardCount; i++) {
		const shard = shardCache.get(i);
		if (!shard) break;
		out.push(...shard);
		n = i + 1;
	}
	contiguousLoadedShards = n;
	return out;
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

function reportCatalogProgress(manifest: CatalogManifest): GameIndexEntry[] {
	const games = assembleContiguousGames(manifest);
	const complete = contiguousLoadedShards >= manifest.shardCount;
	const progress: CatalogLoadProgress = {
		loadedShards: contiguousLoadedShards,
		shardCount: manifest.shardCount,
		loadedGames: games.length,
		total: manifest.total,
		complete
	};
	emitIndexProgress(games, progress);
	if (complete) cachedIndex = games;
	return games;
}

/**
 * Ensure shards `[0, throughExclusive)` are loaded (sequential, scroll-friendly).
 * Shared across callers; progress listeners receive contiguous-prefix updates.
 */
export async function ensureCatalogShards(
	throughExclusive: number,
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
		const manifest = await loadCatalogManifest();
		const target = Math.max(0, Math.min(Math.floor(throughExclusive), manifest.shardCount));

		shardLoadTail = shardLoadTail.then(async () => {
			for (let i = contiguousLoadedShards; i < target; i++) {
				if (!shardCache.has(i)) {
					await loadCatalogShard(i);
				}
				/* Recompute contiguous in case shards arrived out of order from eager loads. */
				reportCatalogProgress(manifest);
			}
		});
		await shardLoadTail;
		return reportCatalogProgress(manifest);
	} finally {
		if (onProgress) indexProgressListeners.delete(onProgress);
	}
}

/** Load the next `count` shards after the current contiguous prefix. */
export async function loadMoreCatalogShards(
	count = 2,
	onProgress?: (games: GameIndexEntry[], progress: CatalogLoadProgress) => void
): Promise<GameIndexEntry[]> {
	const manifest = cachedManifest ?? (await loadCatalogManifest());
	const next = Math.min(manifest.shardCount, contiguousLoadedShards + Math.max(1, count));
	return ensureCatalogShards(next, onProgress);
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
	let cursor = 0;
	const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
		while (cursor < items.length) {
			const i = cursor++;
			await worker(items[i]!);
		}
	});
	await Promise.all(runners);
}

/**
 * Progressive catalog index: shard 0 first (callback), then remaining shards.
 * Pass `{ eager: false }` for All Games (first page only; use {@link loadMoreCatalogShards} on scroll).
 * Default `eager: true` loads the full index (Home / recommendations).
 */
export async function loadCatalogIndex(
	onProgress?: (games: GameIndexEntry[], progress: CatalogLoadProgress) => void,
	options?: { eager?: boolean }
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

	const eager = options?.eager !== false;
	if (!eager) {
		return ensureCatalogShards(1, onProgress);
	}

	if (onProgress) indexProgressListeners.add(onProgress);
	try {
		const manifest = await loadCatalogManifest();
		await ensureCatalogShards(1);
		if (manifest.shardCount > 1) {
			const rest = Array.from({ length: manifest.shardCount - 1 }, (_, i) => i + 1);
			shardLoadTail = shardLoadTail.then(async () => {
				await runPool(rest, 4, async (shardIndex) => {
					if (!shardCache.has(shardIndex)) {
						await loadCatalogShard(shardIndex);
					}
					reportCatalogProgress(manifest);
				});
			});
			await shardLoadTail;
		}
		return reportCatalogProgress(manifest);
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

/** External http(s) catalog embed that cannot be same-origin without the local puller. */
function hasExternalOnlineEmbed(metadata: GameMetadata | null): boolean {
	const embed = metadata?.onlineEmbedUrl?.trim() || metadata?.remotePlayUrl?.trim();
	if (!embed) return false;
	try {
		const url = new URL(embed);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

/**
 * Whether online play for this game ends up in a third-party document — either a direct
 * cross-origin embed or a locally written `embed.html` that only points at one. Those are
 * the games the touch console cannot reach without a proxy; everything else is same-origin
 * and injectable as-is.
 */
function onlinePlayIsCrossOrigin(metadata: GameMetadata | null): boolean {
	if (metadata?.localEmbed) return true;
	return hasExternalOnlineEmbed(metadata);
}

async function offlineAvailable(gameId: string): Promise<boolean> {
	if (isBundledOfflineGame(gameId)) return true;
	const status = await fetchGameOfflineStatus(gameId);
	if (status?.offline) return true;
	const backend = await getOfflineBackend();
	if (backend === 'browser' && (await isBrowserGameDownloaded(gameId))) {
		return true;
	}
	/*
	 * Puller status offline:false is authoritative while the puller is up.
	 * When puller is down (browser/none), still accept a same-origin disk mirror
	 * so offline launch survives temporary puller outages.
	 */
	if (status && backend === 'puller') return false;
	if (!isPublicSiteDeployment()) {
		return staticOfflineFileExists(gameId, base);
	}
	return false;
}

async function staticOfflinePlayUrlIfNeeded(gameId: string): Promise<string> {
	return resolveStaticOfflinePlayUrl(gameId, base);
}

/** Resolve the iframe src for playing a game. */
export async function getGamePlayerUrl(
	gameId: string,
	metadataOverride?: GameMetadata | null
): Promise<string> {
	const metadata =
		metadataOverride === undefined ? await loadGameMetadata(gameId) : metadataOverride;

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
				metadata?.engine === 'unity' ? resolveOfflineUnityPlayUrl(offlineUrl, gameId) : offlineUrl;
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
	 * Online launch routing. The public site plays external embeds directly and that
	 * path is the reliable one, so the app defaults to the same URL. The puller relay
	 * re-fetches and rewrites every asset through Node, which is what made desktop
	 * launches stall or never start — reserve it for launches that genuinely need code
	 * running inside a cross-origin game document (touch console), or for retrying a
	 * game whose direct launch already failed. See `decideOnlineRelay`.
	 */
	const localApp = !isPublicSiteDeployment();
	const pullerSupported = shouldProbePullerBackend();
	const relayPossible = localApp && pullerSupported;
	const consoleWanted = relayPossible && readConsoleVisiblePref(gameId);
	const directFailed = relayPossible && hasDirectLaunchFailed(gameId);

	let externalEmbed = onlinePlayIsCrossOrigin(metadata);
	let externalUnityShell = false;
	/*
	 * A host that answers with X-Frame-Options still fires the iframe `load` event, so
	 * the launch watchdog cannot see the refusal — the user just gets a blank frame.
	 * These hosts have to be routed to the relay up front.
	 */
	let frameBlockedHost = isFrameBlockedHost(
		metadata?.onlineEmbedUrl?.trim() || metadata?.remotePlayUrl?.trim()
	);
	/*
	 * Probing the shell costs a fetch plus a cross-origin Unity sniff. Only pay for it
	 * when a relay is actually on the table — otherwise it is pure launch latency.
	 */
	if (relayPossible && !externalEmbed && (consoleWanted || directFailed)) {
		try {
			const { probeOnlineShellExternal } = await import('./browser-offline-download');
			const shell = await probeOnlineShellExternal(gameId);
			externalEmbed = shell.external;
			externalUnityShell = shell.unityLike;
			frameBlockedHost = frameBlockedHost || isFrameBlockedHost(shell.iframeSrc);
		} catch {
			/* ignore probe failures */
		}
	}

	const relayDecision = decideOnlineRelay({
		localApp,
		pullerSupported,
		consoleWanted,
		externalEmbed,
		directLaunchFailed: directFailed,
		engine: metadata?.engine,
		frameBlockedHost
	});

	if (relayDecision.relay) {
		const {
			syncPullerBaseUrlFromTauri,
			isPullerAvailable,
			waitForPuller,
			pullerUnityPlayUrl,
			pullerLiveGameUrl
		} = await import('./offline-downloader-puller');
		/* Packaged Flatpak: sync port; isPullerAvailable falls back to Rust ensure_puller. */
		await syncPullerBaseUrlFromTauri();
		/*
		 * An optional relay must never block: waiting on a cold sidecar used to add a
		 * multi-second stall to every launch. Direct play is a good outcome here.
		 */
		const waitMs = relayDecision.relayOptional ? 0 : RELAY_LAUNCH_WAIT_MS;
		const pullerUp =
			(await isPullerAvailable(true)) || (waitMs > 0 ? await waitForPuller(waitMs) : false);
		if (pullerUp) {
			const preferUnityHost = metadata?.engine === 'unity' || externalUnityShell;
			const url = preferUnityHost
				? pullerUnityPlayUrl(gameId, base)
				: pullerLiveGameUrl(gameId, base);
			appendPlayLog(
				'info',
				'play-url',
				`Resolved online play via puller relay (${relayDecision.reason})`,
				`game=${gameId} engine=${metadata?.engine ?? 'unknown'} unityHost=${preferUnityHost} url=${url}`
			);
			return url;
		}
		appendPlayLog(
			relayDecision.relayOptional ? 'info' : 'warn',
			'play-url',
			relayDecision.relayOptional
				? `Puller not ready — launching direct instead of waiting`
				: `Puller unavailable — falling back to the direct online URL`,
			`game=${gameId} reason=${relayDecision.reason}`
		);
	} else {
		appendPlayLog(
			'info',
			'play-url',
			`Online play stays direct (${relayDecision.reason})`,
			`game=${gameId} engine=${metadata?.engine ?? 'unknown'}`
		);
	}

	/*
	 * Unity online without a local puller:
	 * 1) Optional hosted PUBLIC_PLAY_PROXY_URL (Cloudflare Worker)
	 * 2) Public site: same-origin /api/unity-play/:id via offline-sw → local puller :18787
	 * 3) Else player.html shell (touch unavailable)
	 */
	if (metadata?.engine === 'unity') {
		const playProxy = (import.meta.env.PUBLIC_PLAY_PROXY_URL as string | undefined)?.replace(
			/\/$/,
			''
		);
		if (playProxy) {
			const url = `${playProxy}/api/unity-play/${encodeURIComponent(gameId)}`;
			appendPlayLog(
				'info',
				'play-url',
				`Resolved Unity play via PUBLIC_PLAY_PROXY_URL`,
				`game=${gameId} url=${url}`
			);
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

	/*
	 * Public site: live relay for external embeds when a local puller is reachable via SW.
	 */
	if (hasExternalOnlineEmbed(metadata) && isPublicSiteDeployment()) {
		const { isPullerAvailable, sameOriginLiveGameUrl } = await import(
			'./offline-downloader-puller'
		);
		if (await isPullerAvailable(true, { ignoreDeploymentGate: true })) {
			const { ensureOfflineServiceWorker } = await import('./browser-offline-download');
			await ensureOfflineServiceWorker();
			const url = sameOriginLiveGameUrl(gameId, base);
			appendPlayLog(
				'info',
				'play-url',
				`Resolved live relay via service-worker → local puller`,
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
	const availability = await getGameAvailability(
		gameId,
		metadata ?? (await loadGameMetadata(gameId)),
		true
	);
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
		url.includes('/api/game-live/') ||
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
