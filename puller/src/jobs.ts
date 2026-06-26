export type JobState = 'pending' | 'running' | 'done' | 'error' | 'cancelled';

export interface DownloadJob {
  gameId: string;
  state: JobState;
  progress: number;
  message: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

const jobs = new Map<string, DownloadJob>();
const activeByGame = new Map<string, string>();
/** Terminal job kept briefly so progress polling can read done/error after activeByGame clears. */
const lastFinishedByGame = new Map<string, DownloadJob>();
const FINISHED_JOB_TTL_MS = 120_000;

export function getJob(jobId: string): DownloadJob | undefined {
  return jobs.get(jobId);
}

export function getActiveJobForGame(gameId: string): DownloadJob | undefined {
  const jobId = activeByGame.get(gameId);
  return jobId ? jobs.get(jobId) : undefined;
}

/** Active job, or the most recent terminal job (for progress polling after completion). */
export function getProgressJobForGame(gameId: string): DownloadJob | undefined {
  const active = getActiveJobForGame(gameId);
  if (active) return active;

  const finished = lastFinishedByGame.get(gameId);
  if (!finished) return undefined;

  const age = Date.now() - (finished.finishedAt ?? finished.startedAt);
  if (age > FINISHED_JOB_TTL_MS) {
    lastFinishedByGame.delete(gameId);
    return undefined;
  }

  return finished;
}

export function clearFinishedJobForGame(gameId: string): void {
  lastFinishedByGame.delete(gameId);
}

export function createJob(gameId: string): DownloadJob {
  const existing = getActiveJobForGame(gameId);
  if (existing && (existing.state === 'pending' || existing.state === 'running')) {
    return existing;
  }
  const jobId = `${gameId}-${Date.now()}`;
  const job: DownloadJob = {
    gameId,
    state: 'pending',
    progress: 0,
    message: 'Queued',
    startedAt: Date.now()
  };
  jobs.set(jobId, job);
  activeByGame.set(gameId, jobId);
  return job;
}

export function clearActiveJob(gameId: string): void {
	activeByGame.delete(gameId);
}

export function updateJob(
	gameId: string,
	patch: Partial<Pick<DownloadJob, 'state' | 'progress' | 'message' | 'error' | 'finishedAt'>>
): void {
	const jobId = activeByGame.get(gameId);
	if (!jobId) return;
	const job = jobs.get(jobId);
	if (!job) return;
	Object.assign(job, patch);
	if (patch.state === 'done' || patch.state === 'error' || patch.state === 'cancelled') {
		lastFinishedByGame.set(gameId, { ...job });
		activeByGame.delete(gameId);
	}
}

export function isGameDownloading(gameId: string): boolean {
  const job = getActiveJobForGame(gameId);
  return job?.state === 'pending' || job?.state === 'running';
}

export function listDownloadingGameIds(): Set<string> {
  const set = new Set<string>();
  for (const [gameId, jobId] of activeByGame) {
    const job = jobs.get(jobId);
    if (job && (job.state === 'pending' || job.state === 'running')) {
      set.add(gameId);
    }
  }
  return set;
}
