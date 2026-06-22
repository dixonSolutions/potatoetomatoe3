import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Google Sites page that embeds the game. */
export const GAME_PAGE_URL =
	'https://sites.google.com/classroom.center/view-1/shrek-escape-from-the-swamp';

/** Fallback CDN base derived from embed FILE_URL when parsing fails. */
export const CDN_BASE = 'https://cdn.jsdelivr.net/gh/777kze777/shreh@main';

/** Timeout for page navigation (ms). */
export const PAGE_TIMEOUT_MS = 60_000;

/** Concurrent download limit. */
export const DOWNLOAD_CONCURRENCY = 4;

/** Resolve output directory for a given game id. */
export function outDirForGame(gamesDataDir: string, gameId: string): string {
	return path.join(gamesDataDir, gameId, 'offline');
}
