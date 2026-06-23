import { base } from '$app/paths';
import {
	fetchGameOfflineStatus,
	isBundledOfflineGame
} from '$lib/utils/offline-downloader';
import type { GameMetadata } from '$lib/utils/games';

export interface GameAvailability {
	online: boolean;
	offline: boolean;
}

export { isBundledOfflineGame };

async function onlineShellExists(gameId: string): Promise<boolean> {
	try {
		const res = await fetch(`${base}/games/${gameId}/online/index.html`, { method: 'HEAD' });
		return res.ok;
	} catch {
		return false;
	}
}

async function staticOfflineExists(gameId: string): Promise<boolean> {
	if (isBundledOfflineGame(gameId)) return true;
	try {
		const res = await fetch(`${base}/games/${gameId}/offline/index.html`, { method: 'HEAD' });
		return res.ok;
	} catch {
		return false;
	}
}

/** Whether online and/or offline copies exist for a game. */
export async function getGameAvailability(
	gameId: string,
	metadata?: GameMetadata | null,
	force = false
): Promise<GameAvailability> {
	const online = Boolean(metadata?.onlineEmbedUrl?.trim()) || (await onlineShellExists(gameId));

	let offline = isBundledOfflineGame(gameId) || Boolean(metadata?.bundledOffline);
	if (!offline) {
		offline = await staticOfflineExists(gameId);
	}
	if (!offline) {
		const status = await fetchGameOfflineStatus(gameId, force);
		if (status?.offline) offline = true;
	}

	return { online, offline };
}

/** Keep only games with a local offline copy (downloaded, bundled, or browser-stored). */
export function filterDownloadedGames<T extends { id: string }>(
	games: T[],
	statusMap: Record<string, { offline?: boolean } | undefined>
): T[] {
	return games.filter((game) => statusMap[game.id]?.offline === true);
}
