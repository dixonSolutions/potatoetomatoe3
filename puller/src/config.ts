import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root (parent of puller/). */
export const REPO_ROOT = path.resolve(__dirname, '../..');

/**
 * Writable directory for user-downloaded offline mirrors.
 * Packaged app: app data dir (set by Tauri). Dev: static/games.
 */
export const GAMES_DATA_DIR =
  process.env.GAMES_DATA_DIR ?? path.join(REPO_ROOT, 'static', 'games');

/**
 * Read-only catalog (online shells, metadata, games-list).
 * Packaged app: bundled resource catalog/games. Dev: same as GAMES_DATA_DIR.
 */
export const CATALOG_DIR = process.env.CATALOG_DIR ?? GAMES_DATA_DIR;

/** HTTP listen port for the puller service. */
/** Default avoids Cursor Voice MCP on 8787. Override with PULLER_PORT. */
export const PORT = Number.parseInt(process.env.PULLER_PORT ?? '18787', 10);

/** Allowed CORS origin for the SvelteKit dev server. */
export const CORS_ORIGIN = process.env.PULLER_CORS_ORIGIN ?? '*';

/** Minimum bytes for a valid offline index.html. */
export const MIN_OFFLINE_INDEX_BYTES = 64;

/** wget user agent for mirrors and asset fetches. */
export const WGET_USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Legacy game hosts often ship expired or self-signed TLS certs.
 * wget exit code 5 = SSL verification failure without this flag.
 */
export const WGET_INSECURE_SSL =
	process.env.PULLER_WGET_STRICT_SSL === '1' || process.env.PULLER_WGET_STRICT_SSL === 'true'
		? false
		: true;

/** Shared wget flags for mirror + asset fetches. */
export function wgetCommonArgs(): string[] {
	const args = ['-U', WGET_USER_AGENT];
	if (WGET_INSECURE_SSL) args.push('--no-check-certificate');
	return args;
}

/** Parallel download worker count (override with PULLER_DOWNLOAD_CONCURRENCY). */
export const DOWNLOAD_CONCURRENCY = Number.parseInt(
	process.env.PULLER_DOWNLOAD_CONCURRENCY ?? '12',
	10
);

/** Games that use the Unity/Google Sites embed pull strategy (see pullStrategy in metadata). */
export const EMBED_STRATEGY_GAME_IDS = new Set(
  (process.env.EMBED_STRATEGY_GAMES ?? 'shrek-escape').split(',').filter(Boolean)
);
