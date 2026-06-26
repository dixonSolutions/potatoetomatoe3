import { base } from '$app/paths';
import {
	fetchGameOfflineStatus,
	isBundledOfflineGame
} from '$lib/utils/offline-downloader';
import { isPublicSiteDeployment } from '$lib/utils/offline-deployment';
import { staticOfflineFileExists } from '$lib/utils/offline-play-url';
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

/** Whether online and/or offline copies exist for a game. */
export async function getGameAvailability(
	gameId: string,
	metadata?: GameMetadata | null,
	force = false
): Promise<GameAvailability> {
	const online = Boolean(metadata?.onlineEmbedUrl?.trim()) || (await onlineShellExists(gameId));

	let offline = isBundledOfflineGame(gameId) || Boolean(metadata?.bundledOffline);
	if (!offline && !isPublicSiteDeployment()) {
		offline = await staticOfflineFileExists(gameId, base);
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
