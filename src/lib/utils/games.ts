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
	/** Empty when no on-disk asset; use `resolveGameThumbnailSrc` for `<img src>`. */
	thumbnail: string;
	category: string;
	/** Game engine — Unity titles may use an external embed for online play. */
	engine?: GameEngine;
	/** Direct URL for online play (Unity CDN, etc.). */
	onlineEmbedUrl?: string;
	/** Shipped with a pre-built offline copy under static/games/{id}/offline/. */
	bundledOffline?: boolean;
}

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
	if (!t) return MISSING_THUMB_DATA_URI;
	if (t.startsWith('/')) return `${base}${t}`;
	return t;
}

let cachedGames: GameMetadata[] | null = null;

export async function loadAllGames(): Promise<GameMetadata[]> {
	if (cachedGames) {
		return cachedGames;
	}

	try {
		const response = await fetch(`${base}/games/games-metadata.json`);
		if (response.ok) {
			const data: unknown = await response.json();
			cachedGames = Array.isArray(data) ? (data as GameMetadata[]) : [];
			return cachedGames;
		}
	} catch (error) {
		console.error('Failed to load games metadata:', error);
	}

	return [];
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
	 * Unity online: `/api/unity-play/:id` is only proxied in Vite dev (vite.config.ts).
	 * Packaged Tauri/Flatpak has no reverse proxy — using that path serves the SPA shell
	 * and looks like a blank game. Fall through to /unity/player.html?src=<HTTPS embed>.
	 */
	if (metadata?.engine === 'unity' && import.meta.env.DEV) {
		const { isPullerAvailable, pullerUnityPlayUrl } = await import('./offline-downloader-puller');
		if (await isPullerAvailable()) {
			const url = pullerUnityPlayUrl(gameId, base);
			appendPlayLog('info', 'play-url', `Resolved Unity play via puller proxy`, `game=${gameId} url=${url}`);
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
		url.startsWith('blob:') ||
		(url.includes('/games/') && (url.includes('/online/') || url.includes('/offline/')))
	) {
		return 'fullscreen; autoplay; gamepad; microphone; camera';
	}
	return undefined;
}
