import { base } from '$app/paths';
import { dev } from '$app/environment';
import { getGameHostMode } from '$lib/utils/game-host-mode';

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
let cachedGameEntries: Record<string, string> | null = null;

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
 * Same-origin URL for the game document (the player loads this in an isolated browsing context).
 * - **Offline** (default): `game-entries.json` points at `offline/index.html` when a mirror exists under
 *   `static/games/<id>/offline/`, else `index.html` (the online shell only).
 * - **Online**: always `online/index.html` (original portal shell; may still pull remote iframes/CDNs).
 */
function normalizeGameEntryRel(raw: string): string {
  let s = raw.trim().replace(/\\/g, '/');
  while (s.startsWith('/')) s = s.slice(1);
  if (s.startsWith('./')) s = s.slice(2);
  if (s.startsWith('_offline_bundle/')) {
    return `offline/${s.slice('_offline_bundle/'.length)}`;
  }
  return s;
}

/** Call after changing static game-entries.json at runtime (tests / rare hot reload). */
export function invalidateGameEntriesCache(): void {
  cachedGameEntries = null;
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

function entryRelPointsAtOfflineMirror(rel: string): boolean {
  const n = normalizeGameEntryRel(rel);
  if (n === 'offline' || n === 'offline/index.html') return true;
  return n.split('/')[0] === 'offline';
}

export async function getGamePlayerUrl(gameId: string): Promise<string> {
  if (dev) {
    cachedGameEntries = null;
  }
  if (!cachedGameEntries) {
    try {
      const response = await fetch(`${base}/games/game-entries.json`, { cache: 'no-cache' });
      cachedGameEntries = response.ok ? ((await response.json()) as Record<string, string>) : {};
    } catch {
      cachedGameEntries = {};
    }
  }
  const rawEntry = cachedGameEntries[gameId] ?? 'index.html';
  const entryRel = normalizeGameEntryRel(rawEntry);
  const mode = getGameHostMode();
  const root = `${base}/games/${gameId}`;

  let out: string;
  if (mode === 'online') {
    out = `${root}/online/index.html`;
  } else if (entryRelPointsAtOfflineMirror(rawEntry)) {
    out = `${root}/${entryRel}`;
  } else {
    out = `${root}/online/${entryRel}`;
  }

  return fixMalformedGamePlayerUrl(out, gameId);
}
