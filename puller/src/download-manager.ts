import fs from 'node:fs/promises';
import path from 'node:path';
import {
	getPullStrategy,
	hasOfflineMirror,
	hasOnlineShell,
	invalidateCatalogCache,
	isValidGameId,
	isGameInCatalog,
	offlineDir,
	type GameStatus
} from './catalog.js';
import { CATALOG_DIR, GAMES_DATA_DIR } from './config.js';
import {
	beginDownloadAbort,
	cancelDownloadAbort,
	clearDownloadAbort,
	DownloadCancelledError
} from './cancel-registry.js';
import {
	clearDownloadCache,
	countOfflineFiles,
	hasPartialDownloadCache,
	writeDownloadCache
} from './download-cache.js';
import { createJob, getActiveJobForGame, isGameDownloading, listDownloadingGameIds, updateJob } from './jobs.js';
import { pullEmbedGame } from './strategies/embed.js';
import { pullGenericGame } from './strategies/generic.js';
import type { ProgressReporter } from './strategies/types.js';
import { ensureOfflineThumbnail, readOfflineThumbnailRel } from './offline-thumbnail.js';

const cancelDiscardCache = new Map<string, boolean>();

/** In-memory cache so home/browse do not re-stat the whole catalog on every request. */
let activityIdsCache: string[] | null = null;
let activityIdsCacheAt = 0;
const ACTIVITY_IDS_TTL_MS = 30_000;

export function invalidateOfflineActivityIdsCache(): void {
	activityIdsCache = null;
	activityIdsCacheAt = 0;
}

async function pathIsOfflineDir(abs: string): Promise<boolean> {
	try {
		const st = await fs.stat(abs);
		return st.isDirectory();
	} catch {
		return false;
	}
}

/** Bounded concurrency — unbounded Promise.all over 10k+ dirs saturates libuv and freezes Vite. */
async function mapPool<T, R>(
	items: T[],
	concurrency: number,
	worker: (item: T) => Promise<R | null | undefined>
): Promise<R[]> {
	const out: R[] = [];
	let cursor = 0;
	const runners = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, async () => {
		while (cursor < items.length) {
			const i = cursor++;
			const value = await worker(items[i]);
			if (value != null) out.push(value);
		}
	});
	await Promise.all(runners);
	return out;
}

async function scanRootForOfflineDirs(root: string): Promise<string[]> {
	let entries: import('node:fs').Dirent[];
	try {
		entries = await fs.readdir(root, { withFileTypes: true });
	} catch {
		return [];
	}
	const dirs = entries.filter(
		(entry) => entry.isDirectory() && !entry.name.startsWith('_') && isValidGameId(entry.name)
	);
	return mapPool(dirs, 32, async (entry) => {
		if (await pathIsOfflineDir(path.join(root, entry.name, 'offline'))) return entry.name;
		return null;
	});
}

/**
 * IDs that may have offline activity: downloading, or an `offline/` directory exists.
 * Avoids full-catalog FS probes for every catalog id on every request.
 */
async function listOfflineActivityIds(force = false): Promise<string[]> {
	const now = Date.now();
	if (!force && activityIdsCache && now - activityIdsCacheAt < ACTIVITY_IDS_TTL_MS) {
		return [...new Set([...activityIdsCache, ...listDownloadingGameIds()])];
	}

	const ids = new Set<string>(listDownloadingGameIds());
	const roots = [...new Set([path.resolve(GAMES_DATA_DIR), path.resolve(CATALOG_DIR)])];
	for (const root of roots) {
		for (const id of await scanRootForOfflineDirs(root)) ids.add(id);
	}
	activityIdsCache = [...ids];
	activityIdsCacheAt = now;
	return activityIdsCache;
}

export async function getGameStatus(
	gameId: string,
	options?: { repairThumbnail?: boolean }
): Promise<GameStatus> {
	const partialCache = await hasPartialDownloadCache(gameId);
	const cache = partialCache ? await countOfflineFiles(gameId) : 0;
	const offline = await hasOfflineMirror(gameId);
	let offlineThumbnail = offline ? ((await readOfflineThumbnailRel(gameId)) ?? undefined) : undefined;
	/* Bulk status lists must not hit the network — repair only when explicitly requested. */
	if (offline && !offlineThumbnail && options?.repairThumbnail === true) {
		offlineThumbnail = (await ensureOfflineThumbnail(gameId)) ?? undefined;
	}
	return {
		online: await hasOnlineShell(gameId),
		offline,
		downloading: isGameDownloading(gameId),
		partialCache: partialCache && !offline,
		cacheFileCount: cache > 0 ? cache : undefined,
		offlineThumbnail
	};
}

/** Downloaded / in-progress / partial only — not every catalog id. */
export async function getDownloadedGameStatuses(): Promise<Record<string, GameStatus>> {
	const ids = await listOfflineActivityIds();
	const result: Record<string, GameStatus> = {};
	await mapPool(ids, 24, async (id) => {
		result[id] = await getGameStatus(id, { repairThumbnail: false });
		return id;
	});
	return result;
}

/** Statuses for an explicit id list (visible cards). */
export async function getGameStatusesForIds(gameIds: string[]): Promise<Record<string, GameStatus>> {
	const result: Record<string, GameStatus> = {};
	const unique = [...new Set(gameIds.filter((id) => isValidGameId(id)))];
	await mapPool(unique, 24, async (id) => {
		result[id] = await getGameStatus(id, { repairThumbnail: false });
		return id;
	});
	return result;
}

/** @deprecated Use getDownloadedGameStatuses — full catalog scan is too slow at 10k+. */
export async function getAllGameStatuses(): Promise<Record<string, GameStatus>> {
	return getDownloadedGameStatuses();
}

export async function deleteOfflineGame(gameId: string): Promise<void> {
	if (!isValidGameId(gameId)) throw new Error('Invalid game id');
	if (!(await isGameInCatalog(gameId))) throw new Error('Game not in catalog');

	if (isGameDownloading(gameId)) {
		throw new Error('Cannot delete while download is in progress');
	}

	await fs.rm(offlineDir(gameId), { recursive: true, force: true });
	invalidateCatalogCache();
	invalidateOfflineActivityIdsCache();
}

export async function startDownload(gameId: string): Promise<{ started: boolean; message: string }> {
	if (!isValidGameId(gameId)) throw new Error('Invalid game id');
	if (!(await isGameInCatalog(gameId))) throw new Error('Game not in catalog');

	if (!(await hasOnlineShell(gameId))) {
		throw new Error('Game has no online shell to pull from');
	}

	const existing = getActiveJobForGame(gameId);
	if (existing && (existing.state === 'pending' || existing.state === 'running')) {
		return { started: false, message: 'Download already in progress' };
	}

	cancelDiscardCache.delete(gameId);
	const job = createJob(gameId);
	const signal = beginDownloadAbort(gameId);
	const strategy = await getPullStrategy(gameId);
	console.log(`[puller] download start game=${gameId} strategy=${strategy}`);
	void runDownloadJob(gameId, job, signal);

	return { started: true, message: 'Download started' };
}

export async function cancelDownload(
	gameId: string,
	discardCache: boolean
): Promise<{ cancelled: boolean; message: string }> {
	if (!isValidGameId(gameId)) throw new Error('Invalid game id');

	const job = getActiveJobForGame(gameId);
	if (!job || (job.state !== 'pending' && job.state !== 'running')) {
		return { cancelled: false, message: 'No active download' };
	}

	cancelDiscardCache.set(gameId, discardCache);
	cancelDownloadAbort(gameId);

	return { cancelled: true, message: discardCache ? 'Cancelling and discarding…' : 'Cancelling…' };
}

async function runDownloadJob(
	gameId: string,
	job: ReturnType<typeof createJob>,
	signal: AbortSignal
): Promise<void> {
	const reporter: ProgressReporter = (progress, message) => {
		if (signal.aborted) return;
		updateJob(gameId, { state: 'running', progress, message });
	};

	updateJob(gameId, { state: 'running', progress: 0, message: 'Starting…' });

	try {
		const strategy = await getPullStrategy(gameId);
		if (strategy === 'embed') {
			await pullEmbedGame(gameId, reporter, signal);
		} else {
			await pullGenericGame(gameId, reporter, signal);
		}

		if (signal.aborted) throw new DownloadCancelledError();
		reporter(96, 'Caching cover thumbnail…');
		await ensureOfflineThumbnail(gameId);

		await clearDownloadCache(gameId);
		updateJob(gameId, {
			state: 'done',
			progress: 100,
			message: 'Complete',
			finishedAt: Date.now()
		});
		console.log(`[puller] download done game=${gameId}`);
		invalidateCatalogCache();
		invalidateOfflineActivityIdsCache();
	} catch (error) {
		const discardCache = cancelDiscardCache.get(gameId) ?? true;
		cancelDiscardCache.delete(gameId);

		if (error instanceof DownloadCancelledError || signal.aborted) {
			const fileCount = await countOfflineFiles(gameId);
			if (discardCache) {
				try {
					await fs.rm(offlineDir(gameId), { recursive: true, force: true });
				} catch {
					// ignore
				}
			} else if (fileCount > 0) {
				await writeDownloadCache(gameId, {
					cachedAt: Date.now(),
					fileCount,
					message: 'Partial download saved for resume'
				});
			}

			updateJob(gameId, {
				state: 'cancelled',
				progress: 0,
				message: discardCache ? 'Cancelled — cache discarded' : 'Cancelled — partial cache kept',
				finishedAt: Date.now()
			});
			invalidateCatalogCache();
			return;
		}

		const message = error instanceof Error ? error.message : String(error);
		console.warn(`[puller] download error game=${gameId}: ${message}`);
		updateJob(gameId, {
			state: 'error',
			progress: 0,
			message: 'Failed',
			error: message,
			finishedAt: Date.now()
		});
		try {
			await fs.rm(offlineDir(gameId), { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	} finally {
		clearDownloadAbort(gameId);
	}
}
