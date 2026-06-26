import fs from 'node:fs/promises';
import path from 'node:path';
import { CATALOG_DIR, GAMES_DATA_DIR, MIN_OFFLINE_INDEX_BYTES } from './config.js';
import { resolveOfflineEntryRel, resolveOfflineEntryRelForDir } from './offline-manifest.js';

const GAME_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;

export interface GameStatus {
  online: boolean;
  offline: boolean;
  downloading: boolean;
  partialCache?: boolean;
  cacheFileCount?: number;
}

let cachedGameIds: string[] | null = null;

export function isValidGameId(gameId: string): boolean {
  if (!GAME_ID_PATTERN.test(gameId)) return false;
  if (gameId.startsWith('_')) return false;
  return !gameId.includes('..') && !gameId.includes('/');
}

export async function loadGameIds(): Promise<string[]> {
  if (cachedGameIds) return cachedGameIds;
  const listPath = path.join(CATALOG_DIR, 'games-list.json');
  try {
    const raw = await fs.readFile(listPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    cachedGameIds = Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string' && isValidGameId(id))
      : [];
  } catch {
    cachedGameIds = await listGameIdsFromDisk(CATALOG_DIR);
  }
  return cachedGameIds;
}

export function invalidateCatalogCache(): void {
  cachedGameIds = null;
}

async function listGameIdsFromDisk(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('_') && isValidGameId(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Writable root for offline downloads (never the bundled catalog). */
export function gameDataRoot(gameId: string): string {
  return path.join(GAMES_DATA_DIR, gameId);
}

export function catalogGameRoot(gameId: string): string {
  return path.join(CATALOG_DIR, gameId);
}

export function catalogOnlineDir(gameId: string): string {
  return path.join(catalogGameRoot(gameId), 'online');
}

export function offlineDir(gameId: string): string {
  return path.join(gameDataRoot(gameId), 'offline');
}

export function offlineIndexPath(gameId: string): string {
  return path.join(offlineDir(gameId), 'index.html');
}

export function catalogOfflineIndexPath(gameId: string): string {
  return path.join(catalogGameRoot(gameId), 'offline', 'index.html');
}

export async function hasOnlineShell(gameId: string): Promise<boolean> {
  for (const indexPath of [
    path.join(catalogOnlineDir(gameId), 'index.html'),
    path.join(gameDataRoot(gameId), 'online', 'index.html')
  ]) {
    try {
      const stat = await fs.stat(indexPath);
      if (stat.size >= MIN_OFFLINE_INDEX_BYTES) return true;
    } catch {
      // try next
    }
  }
  return false;
}

export async function hasOfflineMirror(gameId: string): Promise<boolean> {
	const entryRel = await resolveOfflineEntryRel(gameId);
	if (!entryRel) return false;

	for (const root of [offlineDir(gameId), path.join(catalogGameRoot(gameId), 'offline')]) {
		try {
			const stat = await fs.stat(path.join(root, entryRel));
			if (stat.isFile() && stat.size >= MIN_OFFLINE_INDEX_BYTES) return true;
		} catch {
			// try next root
		}
	}
	return false;
}

export { resolveOfflineEntryRel, resolveOfflineEntryRelForDir };

/** Resolve offline file for static serving (user data first, then bundled catalog). */
export function resolveOfflineFilePath(gameId: string, fileRel: string): string | null {
  const normalized = path.normalize(fileRel).replace(/^(\.\.(\/|\\|$))+/, '');
  const candidates = [
    path.join(offlineDir(gameId), normalized),
    path.join(catalogGameRoot(gameId), 'offline', normalized)
  ];
  for (const candidate of candidates) {
    const dataRoot = path.resolve(path.dirname(candidate));
    const allowedRoots = [
      path.resolve(GAMES_DATA_DIR),
      path.resolve(CATALOG_DIR)
    ];
    const ok = allowedRoots.some(
      (root) => dataRoot.startsWith(root + path.sep) || dataRoot === root
    );
    if (ok) return candidate;
  }
  return null;
}

/** Resolve a safe absolute path under writable games data dir; throws on traversal. */
export function resolveSafeGamesPath(relativePath: string): string {
  const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const resolved = path.resolve(GAMES_DATA_DIR, normalized);
  const dataRoot = path.resolve(GAMES_DATA_DIR);
  if (!resolved.startsWith(dataRoot + path.sep) && resolved !== dataRoot) {
    throw new Error('Path traversal rejected');
  }
  return resolved;
}

export async function readGameMetadata(gameId: string): Promise<Record<string, unknown> | null> {
  const candidates = [
    path.join(catalogOnlineDir(gameId), 'metadata.json'),
    path.join(catalogGameRoot(gameId), 'shared', 'metadata.json'),
    path.join(catalogGameRoot(gameId), 'metadata.json'),
    path.join(gameDataRoot(gameId), 'online', 'metadata.json')
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(await fs.readFile(p, 'utf-8')) as Record<string, unknown>;
    } catch {
      // try next
    }
  }
  return null;
}

export async function getPullStrategy(gameId: string): Promise<'embed' | 'generic'> {
  const { EMBED_STRATEGY_GAME_IDS } = await import('./config.js');
  if (EMBED_STRATEGY_GAME_IDS.has(gameId)) return 'embed';
  const meta = await readGameMetadata(gameId);
  const strategy = meta?.pullStrategy;
  if (strategy === 'embed' || strategy === 'generic') return strategy;
  return 'generic';
}

/** Copy pre-bundled offline games from catalog into writable data dir (packaged app). */
export async function seedBundledOfflineFromCatalog(): Promise<void> {
  if (path.resolve(CATALOG_DIR) === path.resolve(GAMES_DATA_DIR)) return;

  const ids = await loadGameIds();
  for (const gameId of ids) {
    const catalogOffline = path.join(catalogGameRoot(gameId), 'offline');
    const entry = await resolveOfflineEntryRelForDir(catalogOffline);
    if (!entry) continue;
    try {
      await fs.access(offlineIndexPath(gameId));
      continue;
    } catch {
      await fs.mkdir(offlineDir(gameId), { recursive: true });
      await fs.cp(catalogOffline, offlineDir(gameId), {
        recursive: true
      });
      console.log(`[puller] Seeded bundled offline copy: ${gameId}`);
    }
  }
}
