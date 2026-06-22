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
import { createJob, getActiveJobForGame, isGameDownloading, listDownloadingGameIds, updateJob } from './jobs.js';
import { pullEmbedGame } from './strategies/embed.js';
import { pullGenericGame } from './strategies/generic.js';
import type { ProgressReporter } from './strategies/types.js';

export async function getGameStatus(gameId: string): Promise<GameStatus> {
  return {
    online: await hasOnlineShell(gameId),
    offline: await hasOfflineMirror(gameId),
    downloading: isGameDownloading(gameId)
  };
}

export async function getAllGameStatuses(): Promise<Record<string, GameStatus>> {
  const ids = await loadGameIds();
  const downloading = listDownloadingGameIds();
  const result: Record<string, GameStatus> = {};

  await Promise.all(
    ids.map(async (id) => {
      result[id] = {
        online: await hasOnlineShell(id),
        offline: await hasOfflineMirror(id),
        downloading: downloading.has(id)
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

  const job = createJob(gameId);
  void runDownloadJob(gameId, job);

  return { started: true, message: 'Download started' };
}

async function runDownloadJob(gameId: string, job: ReturnType<typeof createJob>): Promise<void> {
  const reporter: ProgressReporter = (progress, message) => {
    updateJob(gameId, { state: 'running', progress, message });
  };

  updateJob(gameId, { state: 'running', progress: 0, message: 'Starting…' });

  try {
    const strategy = await getPullStrategy(gameId);
    if (strategy === 'embed') {
      await pullEmbedGame(gameId, reporter);
    } else {
      await pullGenericGame(gameId, reporter);
    }
    updateJob(gameId, {
      state: 'done',
      progress: 100,
      message: 'Complete',
      finishedAt: Date.now()
    });
    invalidateCatalogCache();
  } catch (error) {
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
  }
}
