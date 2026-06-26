import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { offlineDir } from './catalog.js';

export interface PullerDownloadCacheMeta {
	cachedAt: number;
	fileCount: number;
	message?: string;
}

const CACHE_FILENAME = '.download-cache.json';

export function downloadCachePath(gameId: string): string {
	return path.join(offlineDir(gameId), CACHE_FILENAME);
}

export async function writeDownloadCache(
	gameId: string,
	meta: PullerDownloadCacheMeta
): Promise<void> {
	const dir = offlineDir(gameId);
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(downloadCachePath(gameId), JSON.stringify(meta, null, 2), 'utf-8');
}

export async function readDownloadCache(gameId: string): Promise<PullerDownloadCacheMeta | null> {
	const p = downloadCachePath(gameId);
	if (!existsSync(p)) return null;
	try {
		return JSON.parse(await fs.readFile(p, 'utf-8')) as PullerDownloadCacheMeta;
	} catch {
		return null;
	}
}

export async function clearDownloadCache(gameId: string): Promise<void> {
	try {
		await fs.rm(downloadCachePath(gameId), { force: true });
	} catch {
		// ignore
	}
}

/** Count non-cache files under offline/ (rough partial progress indicator). */
export async function countOfflineFiles(gameId: string): Promise<number> {
	const dir = offlineDir(gameId);
	if (!existsSync(dir)) return 0;
	let count = 0;

	async function walk(current: string): Promise<void> {
		const entries = await fs.readdir(current, { withFileTypes: true });
		for (const entry of entries) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
			} else if (entry.name !== CACHE_FILENAME && entry.isFile()) {
				count++;
			}
		}
	}

	try {
		await walk(dir);
	} catch {
		return 0;
	}
	return count;
}

export async function hasPartialDownloadCache(gameId: string): Promise<boolean> {
	const cache = await readDownloadCache(gameId);
	if (cache && cache.fileCount > 0) return true;
	return (await countOfflineFiles(gameId)) > 0;
}
