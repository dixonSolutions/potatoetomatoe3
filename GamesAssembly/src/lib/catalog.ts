import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GAMES_ROOT } from '../paths.js';

const MIN_OFFLINE_INDEX_BYTES = 64;

export function offlineIndexLooksValid(offlineIndexPath: string): boolean {
	if (!existsSync(offlineIndexPath)) return false;
	try {
		return statSync(offlineIndexPath).size >= MIN_OFFLINE_INDEX_BYTES;
	} catch {
		return false;
	}
}

export function offlineBundleIndexPath(gameId: string): string {
	return join(GAMES_ROOT, gameId, 'offline', 'index.html');
}

/** Games that have catalog metadata (`online/metadata.json`). */
export function listGameIdsWithMetadata(): string[] {
	if (!existsSync(GAMES_ROOT)) return [];
	return readdirSync(GAMES_ROOT, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith('_'))
		.map((d) => d.name)
		.filter((id) => existsSync(join(GAMES_ROOT, id, 'online', 'metadata.json')));
}

export type LocalTransformSplit = {
	needFresh: string[];
	needForce: string[];
};

/** Split IDs missing a valid offline mirror into new vs broken partial dirs (matches `ensure-all-local.mjs`). */
export function splitIdsForLocalTransform(gameIds: string[]): LocalTransformSplit {
	const needFresh: string[] = [];
	const needForce: string[] = [];

	for (const id of gameIds) {
		const offlineDir = join(GAMES_ROOT, id, 'offline');
		const offlineIndex = join(offlineDir, 'index.html');
		if (!existsSync(offlineDir)) {
			needFresh.push(id);
			continue;
		}
		if (!offlineIndexLooksValid(offlineIndex)) {
			needForce.push(id);
			continue;
		}
	}
	return { needFresh, needForce };
}

/** IDs whose offline bundle is missing or invalid (same criteria as ensure-all-local). */
export function listGameIdsMissingValidOfflineMirror(): string[] {
	const ids = listGameIdsWithMetadata();
	return ids.filter((id) => !offlineIndexLooksValid(offlineBundleIndexPath(id)));
}

/**
 * Games that have an online shell and a usable `offline/index.html` — eligible for
 * `download-games-offline.js --deep-only` (runtime asset scan + Unity manifest fetch + Poki helpers).
 */
export function listGameIdsWithOfflineMirror(): string[] {
	if (!existsSync(GAMES_ROOT)) return [];
	return readdirSync(GAMES_ROOT, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith('_'))
		.map((d) => d.name)
		.filter(
			(id) =>
				existsSync(join(GAMES_ROOT, id, 'online', 'index.html')) &&
				offlineIndexLooksValid(offlineBundleIndexPath(id))
		);
}

export function summarizeGameEntriesLocalVsLegacy(): {
	localCount: number;
	legacyCount: number;
	stillLegacy: string[];
} {
	const entriesPath = join(GAMES_ROOT, 'game-entries.json');
	let localCount = 0;
	let legacyCount = 0;
	const stillLegacy: string[] = [];
	if (!existsSync(entriesPath)) {
		return { localCount: 0, legacyCount: 0, stillLegacy: [] };
	}
	try {
		const entries = JSON.parse(readFileSync(entriesPath, 'utf-8')) as Record<string, string>;
		for (const [gid, rel] of Object.entries(entries)) {
			if (rel && String(rel).startsWith('offline/')) {
				localCount++;
			} else {
				legacyCount++;
				stillLegacy.push(gid);
			}
		}
	} catch {
		/* */
	}
	return { localCount, legacyCount, stillLegacy };
}
