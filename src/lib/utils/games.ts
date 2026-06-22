import { base } from '$app/paths';
import { dev } from '$app/environment';
import { getGamePlayMode } from '$lib/utils/game-play-mode';
import {
	fetchGameOfflineStatus,
	getOfflineBackend,
	getOfflinePlayUrl,
	isBrowserGameDownloaded
} from '$lib/utils/offline-downloader';

export interface GameMetadata {
	id: string;
	name: string;
	author: string;
	description: string;
	/** Empty when no on-disk asset; use `resolveGameThumbnailSrc` for `<img src>`. */
	thumbnail: string;
	category: string;
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

async function staticOfflineExists(gameId: string): Promise<boolean> {
	try {
		const res = await fetch(`${base}/games/${gameId}/offline/index.html`, { method: 'HEAD' });
		return res.ok;
	} catch {
		return false;
	}
}

async function offlineAvailable(gameId: string): Promise<boolean> {
	const status = await fetchGameOfflineStatus(gameId);
	if (status?.offline) return true;
	if ((await getOfflineBackend()) === 'browser' && (await isBrowserGameDownloaded(gameId))) {
		return true;
	}
	return staticOfflineExists(gameId);
}

/**
 * Resolve the iframe src for playing a game.
 * Uses per-game online/offline preference and checks puller or static offline copies.
 */
export async function getGamePlayerUrl(gameId: string): Promise<string> {
	const onlineUrl = `${base}/games/${gameId}/online/index.html`;
	const staticOfflineUrl = `${base}/games/${gameId}/offline/index.html`;

	const mode = getGamePlayMode(gameId);
	const hasOffline = await offlineAvailable(gameId);

	if (mode === 'offline' && hasOffline) {
		const offlineUrl = await getOfflinePlayUrl(gameId);
		if (offlineUrl) return offlineUrl;
		return staticOfflineUrl;
	}

	return onlineUrl;
}

/** Whether both online and offline copies exist for a game. */
export async function gameHasDualVersions(gameId: string): Promise<{
	online: boolean;
	offline: boolean;
}> {
	const status = await fetchGameOfflineStatus(gameId);
	if (status) {
		return { online: status.online, offline: status.offline };
	}
	return {
		online: true,
		offline: await staticOfflineExists(gameId)
	};
}
