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

/** Games that use the embed (Unity/Google Sites) pull strategy. */
export const EMBED_STRATEGY_GAME_IDS = new Set(
  (process.env.EMBED_STRATEGY_GAMES ?? 'shrek-escape').split(',').filter(Boolean)
);
