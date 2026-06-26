import fs from 'node:fs/promises';
import {
	getPullStrategy,
	hasOfflineMirror,
	hasOnlineShell,
	invalidateCatalogCache,
	isValidGameId,
	loadGameIds,
	offlineDir,
	type GameStatus
} from './catalog.js';
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

const cancelDiscardCache = new Map<string, boolean>();

export async function getGameStatus(gameId: string): Promise<GameStatus> {
	const partialCache = await hasPartialDownloadCache(gameId);
	const cache = partialCache ? await countOfflineFiles(gameId) : 0;
	return {
		online: await hasOnlineShell(gameId),
		offline: await hasOfflineMirror(gameId),
		downloading: isGameDownloading(gameId),
		partialCache: partialCache && !(await hasOfflineMirror(gameId)),
		cacheFileCount: cache > 0 ? cache : undefined
	};
}

export async function getAllGameStatuses(): Promise<Record<string, GameStatus>> {
	const ids = await loadGameIds();
	const downloading = listDownloadingGameIds();
	const result: Record<string, GameStatus> = {};

	await Promise.all(
		ids.map(async (id) => {
			const partialCache = await hasPartialDownloadCache(id);
			const offline = await hasOfflineMirror(id);
			const cacheFileCount = partialCache ? await countOfflineFiles(id) : 0;
			result[id] = {
				online: await hasOnlineShell(id),
				offline,
				downloading: downloading.has(id),
				partialCache: partialCache && !offline,
				cacheFileCount: cacheFileCount > 0 ? cacheFileCount : undefined
			};
		})
	);

	return result;
}

export async function deleteOfflineGame(gameId: string): Promise<void> {
	if (!isValidGameId(gameId)) throw new Error('Invalid game id');
	const ids = await loadGameIds();
	if (!ids.includes(gameId)) throw new Error('Game not in catalog');

	if (isGameDownloading(gameId)) {
		throw new Error('Cannot delete while download is in progress');
	}

	await fs.rm(offlineDir(gameId), { recursive: true, force: true });
	invalidateCatalogCache();
}

export async function startDownload(gameId: string): Promise<{ started: boolean; message: string }> {
	if (!isValidGameId(gameId)) throw new Error('Invalid game id');
	const ids = await loadGameIds();
	if (!ids.includes(gameId)) throw new Error('Game not in catalog');

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

		await clearDownloadCache(gameId);
		updateJob(gameId, {
			state: 'done',
			progress: 100,
			message: 'Complete',
			finishedAt: Date.now()
		});
		invalidateCatalogCache();
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
