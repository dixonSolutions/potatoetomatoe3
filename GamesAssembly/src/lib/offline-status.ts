import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GAMES_ROOT } from '../paths.js';

const MIN_INDEX_BYTES = 64;

export function listGameIdsWithOnlineShell(): string[] {
	if (!existsSync(GAMES_ROOT)) return [];
	return readdirSync(GAMES_ROOT, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith('_'))
		.map((d) => d.name)
		.filter((id) => existsSync(join(GAMES_ROOT, id, 'online', 'index.html')));
}

export function needsOfflineMirror(gameId: string): boolean {
	const offlineDir = join(GAMES_ROOT, gameId, 'offline');
	if (!existsSync(offlineDir)) return true;
	try {
		const entries = readdirSync(offlineDir);
		if (entries.length === 0) return true;
	} catch {
		return true;
	}
	const idx = join(offlineDir, 'index.html');
	if (!existsSync(idx)) return true;
	try {
		return statSync(idx).size < MIN_INDEX_BYTES;
	} catch {
		return true;
	}
}

/** True when offline/ exists but is unusable — mirror with { force: true } to replace. */
export function needsForceRemirror(gameId: string): boolean {
	const offlineDir = join(GAMES_ROOT, gameId, 'offline');
	if (!existsSync(offlineDir)) return false;
	try {
		if (readdirSync(offlineDir).length === 0) return true;
	} catch {
		return true;
	}
	const idx = join(offlineDir, 'index.html');
	if (!existsSync(idx)) return true;
	try {
		return statSync(idx).size < MIN_INDEX_BYTES;
	} catch {
		return true;
	}
}
