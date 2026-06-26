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
import { staticOfflineFileExists, staticOfflinePlayUrl } from '$lib/utils/offline-play-url';

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

/** Safe `src` for game cards: blank `thumbnail` does not hit `/games/.../404`. */
export function resolveGameThumbnailSrc(thumbnail: string | undefined | null): string {
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

function unityEmbedShellUrl(externalUrl: string): string {
	const params = new URLSearchParams({ src: externalUrl });
	return `${base}/unity/embed.html?${params.toString()}`;
}

function resolveOnlinePlayUrl(metadata: GameMetadata | null, gameId: string): string {
	const embed = metadata?.onlineEmbedUrl?.trim();
	if (embed) {
		if (metadata?.engine === 'unity') {
			return unityEmbedShellUrl(embed);
		}
		return embed;
	}
	return `${base}/games/${gameId}/online/index.html`;
}

async function offlineAvailable(gameId: string): Promise<boolean> {
	if (isBundledOfflineGame(gameId)) return true;
	const status = await fetchGameOfflineStatus(gameId);
	if (status?.offline) return true;
	if ((await getOfflineBackend()) === 'browser' && (await isBrowserGameDownloaded(gameId))) {
		return true;
	}
	if (!isPublicSiteDeployment()) {
		return staticOfflineFileExists(gameId, base);
	}
	return false;
}

/** Resolve the iframe src for playing a game. */
export async function getGamePlayerUrl(gameId: string): Promise<string> {
	const metadata = await loadGameMetadata(gameId);
	const onlineUrl = resolveOnlinePlayUrl(metadata, gameId);
	const staticOfflineUrl = staticOfflinePlayUrl(gameId, base);

	const hasOffline = await offlineAvailable(gameId);
	const networkOnline = typeof navigator === 'undefined' || navigator.onLine;

	if (!networkOnline) {
		if (hasOffline) {
			const offlineUrl = await getOfflinePlayUrl(gameId);
			if (offlineUrl) return offlineUrl;
			if (!isPublicSiteDeployment()) {
				return staticOfflineUrl;
			}
		}
		return onlineUrl;
	}

	const mode = getGamePlayMode(gameId);

	if (mode === 'offline' && hasOffline) {
		const offlineUrl = await getOfflinePlayUrl(gameId);
		if (offlineUrl) return offlineUrl;
		// Avoid loading the SPA 404 shell into the iframe on GitHub Pages.
		if (!isPublicSiteDeployment()) {
			return staticOfflineUrl;
		}
		return onlineUrl;
	}

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
