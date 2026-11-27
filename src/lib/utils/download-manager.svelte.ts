/**
 * Offline downloads that outlive the page that started them. A download keeps running when
 * you leave the game page; coming back shows its progress, and a toast says when it is done.
 * One tap cancels and frees what was stored so far.
 *
 * State is a module-level rune, so every component reading `downloadState(id)` stays in sync.
 */
import { toast } from 'svelte-sonner';
import {
	cancelGameDownload,
	dispatchOfflineStatusChanged,
	pollDownloadUntilDone,
	startGameDownload,
	type DownloadProgress
} from './offline-downloader';
import { appendPlayLog } from './play-diagnostics-log';

export type ManagedDownload = DownloadProgress & { gameId: string; name: string };

const active = $state<Record<string, ManagedDownload>>({});
/* Bumped on cancel so a poll that is still running stops reporting. */
const generations: Record<string, number> = {};

export function downloadState(gameId: string): ManagedDownload | undefined {
	return active[gameId];
}

export function activeDownloads(): ManagedDownload[] {
	return Object.values(active);
}

export function isDownloading(gameId: string): boolean {
	const d = active[gameId];
	return Boolean(d && (d.state === 'pending' || d.state === 'running'));
}

function finish(gameId: string) {
	delete active[gameId];
	delete generations[gameId];
}

/** Start (or join) a background download. Resolves when it ends. */
export async function startDownload(gameId: string, name: string): Promise<DownloadProgress> {
	if (isDownloading(gameId)) return active[gameId];
	const generation = (generations[gameId] ?? 0) + 1;
	generations[gameId] = generation;
	active[gameId] = { gameId, name, state: 'pending', progress: 0, message: 'Starting…' };
	appendPlayLog('info', 'download', 'Starting offline download', `game=${gameId}`);
	dispatchOfflineStatusChanged(gameId, 'download-start');
	const current = () => generations[gameId] === generation;
	try {
		const start = await startGameDownload(gameId);
		if (!start.started) {
			finish(gameId);
			toast.error(start.message, { closeButton: true });
			dispatchOfflineStatusChanged(gameId, 'download-error');
			return { state: 'error', progress: 0, message: start.message, error: start.message };
		}
		const final = await pollDownloadUntilDone(gameId, (p) => {
			if (current()) active[gameId] = { ...p, gameId, name };
		});
		if (!current()) return final;
		finish(gameId);
		if (final.state === 'done') {
			appendPlayLog('info', 'download', 'Download finished', `game=${gameId}`);
			toast.success(`${name} is ready offline`, { closeButton: true });
			dispatchOfflineStatusChanged(gameId, 'download-done');
		} else if (final.state === 'error') {
			const msg = final.error || final.message || 'Download failed';
			appendPlayLog('error', 'download', 'Download failed', `game=${gameId} ${msg}`);
			toast.error(`${name}: ${msg}`, { closeButton: true });
			dispatchOfflineStatusChanged(gameId, 'download-error');
		} else {
			dispatchOfflineStatusChanged(gameId, 'download-cancel');
		}
		return final;
	} catch (e) {
		const msg = e instanceof Error ? e.message : 'Download failed';
		if (current()) {
			finish(gameId);
			appendPlayLog('error', 'download', 'Download threw', `game=${gameId} ${msg}`);
			toast.error(`${name}: ${msg}`, { closeButton: true });
			dispatchOfflineStatusChanged(gameId, 'download-error');
		}
		return { state: 'error', progress: 0, message: msg, error: msg };
	}
}

/** Stop a download and remove what it stored. No toast: the user just did it. */
export async function cancelDownload(gameId: string): Promise<void> {
	generations[gameId] = (generations[gameId] ?? 0) + 1;
	finish(gameId);
	try {
		await cancelGameDownload(gameId, true);
	} finally {
		dispatchOfflineStatusChanged(gameId, 'download-cancel');
	}
}
