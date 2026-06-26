import path from 'node:path';

/** Fallback CDN base when parsing the wrapper fails. */
export const DEFAULT_CDN_BASE = 'https://cdn.jsdelivr.net/gh/777kze777/shreh@main';

/** Timeout for page navigation (ms). */
export const PAGE_TIMEOUT_MS = 60_000;

/** Concurrent download limit. */
export const DOWNLOAD_CONCURRENCY = 4;

/** Resolve output directory for a given game id. */
export function outDirForGame(gamesDataDir: string, gameId: string): string {
	return path.join(gamesDataDir, gameId, 'offline');
}
