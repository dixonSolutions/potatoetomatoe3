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
import {
	decodeHtmlEntitiesInUrl,
	isDeadThumbnailUrl,
	sizedThumbnailUrl,
	thumbnailSrcset
} from '$lib/utils/thumbnail-size';
import {
	failedPlayRoutes,
	markPlayRouteFailed,
	nextPlayRoute,
	planOnlineRoutes,
	type PlayRouteKind
} from '$lib/utils/online-play-routing';
import {
	nativeGameFramesSupported,
	prepareNativeGameFrames,
	watchGameFrameLife
} from '$lib/utils/native-game-frames';
import { OFFLINE_SCHEME } from '$lib/utils/offline-native';

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

/** A locally stored offline cover, when one should win over the catalog cover. */
function offlineThumbnailSrc(
	options?: ThumbnailResolveOptions & { gameId?: string }
): string | null {
	if (!options?.preferOffline) return null;
	if (options.offlineThumbnailUrl?.trim()) return options.offlineThumbnailUrl.trim();
	const rel = options.offlineThumbnailRel?.trim();
	if (rel) {
		/* Browser backend may stash a blob:/https: URL in offlineThumbnail */
		if (/^(blob:|https?:)/i.test(rel)) return rel;
		if (options.gameId) return offlineAssetUrl(options.gameId, rel);
	}
	return null;
}

/** A catalog value that names no loadable cover: a `.gitkeep` stand-in or a dead link. */
function isMissingThumbnail(t: string): boolean {
	return t.endsWith('.gitkeep') || isDeadThumbnailUrl(t);
}

/** Safe `src` for game cards: blank `thumbnail` does not hit `/games/.../404`. */
export function resolveGameThumbnailSrc(
	thumbnail: string | undefined | null,
	options?: ThumbnailResolveOptions & { gameId?: string }
): string {
	const offline = offlineThumbnailSrc(options);
	if (offline) return offline;
	const t = thumbnail?.trim();
	if (!t || isMissingThumbnail(t)) return MISSING_THUMB_DATA_URI;
	if (t.startsWith('data:')) return t;
	/*
	 * Remote portal covers are full-resolution originals — up to 2730x1535 for a 138px
	 * tile. Ask the CDN for a tile-sized image instead; see `sizedThumbnailUrl`.
	 */
	if (/^https?:\/\//i.test(t)) return sizedThumbnailUrl(t, options?.targetPx);
	if (t.startsWith('/')) return `${base}${t}`;
	return t;
}

export type GameThumbnailSources = {
	/** First URL to try, or null when there is no cover worth requesting. */
	src: string | null;
	/** Resized candidates for `src`'s host, to pair with the card's `sizes`. */
	srcset?: string;
	/** The untouched original, for when the resized request fails. */
	fallbackSrc?: string;
};

/**
 * Everything a card `<img>` needs: a right-sized `srcset` where the portal can resize, and
 * the original to fall back to when that fails. `boxAspect` is the card box's
 * width/height (see `thumbnailSrcset`).
 */
export function resolveGameThumbnailSources(
	thumbnail: string | undefined | null,
	options?: Omit<ThumbnailResolveOptions, 'targetPx'> & { gameId?: string; boxAspect?: number }
): GameThumbnailSources {
	const offline = offlineThumbnailSrc(options);
	if (offline) return { src: offline };
	const t = thumbnail?.trim();
	if (!t || isMissingThumbnail(t)) return { src: null };
	if (/^https?:\/\//i.test(t)) {
		const original = decodeHtmlEntitiesInUrl(t);
		const sized = thumbnailSrcset(original, options?.boxAspect);
		return sized
			? { src: sized.src, srcset: sized.srcset, fallbackSrc: original }
			: { src: original };
	}
	if (t.startsWith('/')) return { src: `${base}${t}` };
	return { src: t };
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
	if (trimmed.startsWith(`${OFFLINE_SCHEME}:`)) return true;
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

/** The catalog's online URL: its own embed, else the remote page it was imported from. */
function catalogEmbedUrl(metadata: GameMetadata | null): string | null {
	return metadata?.onlineEmbedUrl?.trim() || metadata?.remotePlayUrl?.trim() || null;
}

function onlineShellUrl(gameId: string): string {
	return `${base}/games/${gameId}/online/index.html`;
}

/** The plain online URL, with no route decided — what the frame shows when nothing else can. */
function resolveOnlinePlayUrl(metadata: GameMetadata | null, gameId: string): string {
	const embed = metadata?.onlineEmbedUrl?.trim();
	if (embed) {
		if (metadata?.engine === 'unity') {
			return unityPlayerShellUrl(embed, gameId);
		}
		return embed;
	}

	const onlineShell = onlineShellUrl(gameId);
	if (metadata?.engine === 'unity') {
		return unityPlayerShellUrl(onlineShell, gameId);
	}
	return onlineShell;
}

/** The desktop app's in-process relay (`src-tauri/src/relay.rs`). */
export const RELAY_SCHEME = 'ptrelay';

/** Which route produced each play URL handed out, so the watchdog knows what failed. */
const routeByUrl = new Map<string, PlayRouteKind>();

function remember(url: string, kind: PlayRouteKind): string {
	routeByUrl.set(url, kind);
	return url;
}

/**
 * The route a play URL came from; `null` for offline copies and anything this module did
 * not resolve (those have nothing to fall back to online).
 */
export function playRouteOfUrl(url: string | null | undefined): PlayRouteKind | null {
	const u = url?.trim();
	if (!u) return null;
	const known = routeByUrl.get(u);
	if (known) return known;
	if (u.startsWith(`${RELAY_SCHEME}:`)) return 'relay';
	if (u.includes('/api/game-live/') || u.includes('/api/unity-play/')) return 'puller';
	if (isLocalOfflinePlayUrl(u)) return null;
	return 'direct';
}

/**
 * A catalog shell that only frames a third-party page. Where the desktop app bridges
 * cross-origin frames itself, the wrapper is one document too many — and a wall between
 * the console and the game — so the game's own URL is framed instead.
 */
async function unwrapOnlineShell(gameId: string): Promise<string | null> {
	try {
		const { readOnlineShellIframeSrc } = await import('./browser-offline-download');
		return await readOnlineShellIframeSrc(gameId);
	} catch {
		return null;
	}
}

/** A puller that already answers — it is never started for play. */
async function pullerAlreadyRunning(): Promise<boolean> {
	if (isPublicSiteDeployment() || !shouldProbePullerBackend()) return false;
	try {
		const { isPullerRunning } = await import('./offline-downloader-puller');
		return await isPullerRunning();
	} catch {
		return false;
	}
}

async function urlForRoute(
	kind: PlayRouteKind,
	gameId: string,
	metadata: GameMetadata | null,
	nativeFrames: boolean
): Promise<string | null> {
	const embed = catalogEmbedUrl(metadata);
	const unity = metadata?.engine === 'unity';
	switch (kind) {
		case 'direct': {
			if (metadata?.onlineEmbedUrl?.trim()) {
				const url = metadata.onlineEmbedUrl.trim();
				return unity && !nativeFrames ? unityPlayerShellUrl(url, gameId) : url;
			}
			if (nativeFrames) {
				const inner = await unwrapOnlineShell(gameId);
				if (inner) return inner;
			}
			return resolveOnlinePlayUrl(metadata, gameId);
		}
		case 'local': {
			const { createLocalEmbedShell } = await import('./online-play-routing-shell');
			return createLocalEmbedShell(gameId);
		}
		case 'shell': {
			if (!embed) return null;
			const { createRemoteShell } = await import('./online-play-routing-shell');
			return createRemoteShell(gameId, embed);
		}
		case 'relay': {
			if (!embed) return null;
			/*
			 * The relay fetches the catalog URL itself; the query and fragment ride along only
			 * so the page sees them in `location` (Playhop's SDK reads `#origin=` from there).
			 */
			let tail = '';
			try {
				const parsed = new URL(embed);
				tail = parsed.search + parsed.hash;
			} catch {
				/* unparseable embed: the relay has its own copy anyway */
			}
			return `${RELAY_SCHEME}://localhost/game/${encodeURIComponent(gameId)}${tail}`;
		}
		case 'puller': {
			const { pullerUnityPlayUrl, pullerLiveGameUrl } = await import('./offline-downloader-puller');
			return unity ? pullerUnityPlayUrl(gameId, base) : pullerLiveGameUrl(gameId, base);
		}
	}
}

export interface OnlinePlayRoute {
	url: string;
	/** `null` when every route failed and `url` is only the plain online URL. */
	kind: PlayRouteKind | null;
}

/**
 * The online play URL: the first route of the game's chain that has not already failed
 * this session (see `planOnlineRoutes`). A route that cannot even be built — a shell whose
 * HTML will not download — counts as failed on the spot.
 */
export async function resolveOnlinePlayRoute(
	gameId: string,
	metadata: GameMetadata | null
): Promise<OnlinePlayRoute> {
	const nativeFrames = await nativeGameFramesSupported();
	const input = {
		desktopApp: nativeFrames,
		pullerRunning: false,
		embedUrl: catalogEmbedUrl(metadata),
		localEmbed: Boolean(metadata?.localEmbed)
	};
	let plan = planOnlineRoutes(input);
	for (let attempt = 0; attempt < 8; attempt++) {
		let kind = nextPlayRoute(plan, failedPlayRoutes(gameId));
		if (!kind && !plan.includes('puller') && (await pullerAlreadyRunning())) {
			plan = planOnlineRoutes({ ...input, pullerRunning: true });
			kind = nextPlayRoute(plan, failedPlayRoutes(gameId));
		}
		if (!kind) break;
		const url = await urlForRoute(kind, gameId, metadata, nativeFrames);
		if (url) {
			exhausted.delete(gameId);
			return { url: remember(url, kind), kind };
		}
		markPlayRouteFailed(gameId, kind);
		appendPlayLog('warn', 'play-url', `Play route ${kind} unavailable`, `game=${gameId}`);
	}
	exhausted.add(gameId);
	return { url: resolveOnlinePlayUrl(metadata, gameId), kind: null };
}

/** Games whose last online resolution found no route left to try. */
const exhausted = new Set<string>();

/**
 * True when the last online resolution for this game had no untried route and fell back
 * to the plain online URL — the watchdog's cue to stop relaunching and tell the user.
 */
export function playRoutesExhausted(gameId: string): boolean {
	return exhausted.has(gameId);
}

/**
 * On desktop, hand the native side this launch before the frame exists: the bridge goes
 * into the game's own frames when the top document is the game's (direct), and only
 * into frames nested inside it when the top document brings the bridge itself.
 */
async function prepareFramesFor(gameId: string, url: string): Promise<void> {
	if (!(await nativeGameFramesSupported())) return;
	const kind = playRouteOfUrl(url);
	const topHasBridge = kind !== 'direct' || url.startsWith(`${base}/`) || url.startsWith('/');
	let ownOrigins: string[] = [];
	try {
		const { getPullerBaseUrl } = await import('./offline-downloader-puller');
		ownOrigins = [new URL(getPullerBaseUrl()).origin];
	} catch {
		/* no puller origin to exclude */
	}
	watchGameFrameLife();
	await prepareNativeGameFrames({ gameId, topHasBridge, ownOrigins });
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
	 * A file backend's offline:false is authoritative. Otherwise still accept a same-origin
	 * disk mirror so an offline launch survives the backend being unreachable.
	 */
	if (status && (backend === 'puller' || backend === 'native')) return false;
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
	const url = await resolveGamePlayerUrl(gameId, metadataOverride);
	await prepareFramesFor(gameId, url);
	return url;
}

async function resolveGamePlayerUrl(
	gameId: string,
	metadataOverride?: GameMetadata | null
): Promise<string> {
	const metadata =
		metadataOverride === undefined ? await loadGameMetadata(gameId) : metadataOverride;

	const networkOnline = typeof navigator === 'undefined' || navigator.onLine;
	const mode = networkOnline ? getGamePlayMode(gameId) : 'offline';
	/*
	 * Only an offline launch needs to know about offline copies. Asking costs a backend
	 * lookup (and, in `pnpm dev`, a puller probe), and an online launch now starts the
	 * game the moment this resolves, so the common case must not wait on it.
	 */
	const hasOffline = mode === 'offline' ? await offlineAvailable(gameId) : false;

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
	 * Unity online with a hosted play proxy (`PUBLIC_PLAY_PROXY_URL`, a Cloudflare Worker
	 * whose fetches originate outside a filtered network). Opt-in by build configuration.
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
	}

	const route = await resolveOnlinePlayRoute(gameId, metadata);
	appendPlayLog(
		route.kind ? 'info' : 'warn',
		'play-url',
		route.kind ? `Resolved online play (${route.kind})` : `Every play route failed`,
		`game=${gameId} engine=${metadata?.engine ?? 'unknown'} url=${route.url}`
	);
	return route.url;
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
		url.startsWith(`${RELAY_SCHEME}:`) ||
		url.startsWith(`${OFFLINE_SCHEME}:`) ||
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
