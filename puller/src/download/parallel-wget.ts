import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DOWNLOAD_CONCURRENCY, WGET_USER_AGENT } from '../config.js';

const execFileAsync = promisify(execFile);

export interface DownloadTask {
	url: string;
	destPath: string;
}

export interface ParallelDownloadResult {
	url: string;
	destPath: string;
	ok: boolean;
	skipped?: boolean;
}

async function downloadOne(url: string, destPath: string): Promise<ParallelDownloadResult> {
	if (existsSync(destPath)) {
		try {
			const stat = await fs.stat(destPath);
			if (stat.isFile() && stat.size > 0) {
				return { url, destPath, ok: true, skipped: true };
			}
		} catch {
			// re-download
		}
	}

	await fs.mkdir(path.dirname(destPath), { recursive: true });
	try {
		await execFileAsync('wget', [
			'-q',
			'--tries=2',
			'--timeout=90',
			'-U',
			WGET_USER_AGENT,
			'-O',
			destPath,
			url
		]);
		const stat = await fs.stat(destPath);
		if (stat.size === 0) {
			await fs.rm(destPath, { force: true });
			return { url, destPath, ok: false };
		}
		const head = (await fs.readFile(destPath)).subarray(0, 32).toString('utf8');
		if (head.startsWith('<!DOCTYPE') || head.startsWith('<html')) {
			await fs.rm(destPath, { force: true });
			return { url, destPath, ok: false };
		}
		return { url, destPath, ok: true };
	} catch {
		try {
			await fs.rm(destPath, { force: true });
		} catch {
			// ignore
		}
		return { url, destPath, ok: false };
	}
}

/** Download many files in parallel with a bounded worker pool. */
export async function downloadFilesParallel(
	tasks: DownloadTask[],
	options: {
		concurrency?: number;
		signal?: AbortSignal;
		onProgress?: (done: number, total: number, task: DownloadTask) => void;
	} = {}
): Promise<ParallelDownloadResult[]> {
	const concurrency = Math.max(1, options.concurrency ?? DOWNLOAD_CONCURRENCY);
	const results: ParallelDownloadResult[] = [];
	const queue = [...tasks];
	let done = 0;
	const total = tasks.length;

	async function worker(): Promise<void> {
		while (queue.length > 0) {
			if (options.signal?.aborted) return;
			const task = queue.shift();
			if (!task) break;
			const result = await downloadOne(task.url, task.destPath);
			results.push(result);
			done++;
			options.onProgress?.(done, total, task);
		}
	}

	const workers = Array.from({ length: Math.min(concurrency, tasks.length || 1) }, () => worker());
	await Promise.all(workers);

	if (options.signal?.aborted) {
		const { DownloadCancelledError } = await import('../cancel-registry.js');
		throw new DownloadCancelledError();
	}

	return results;
}

/** Fetch remote text for discovery (no disk write). */
export async function fetchTextForDiscovery(url: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync('wget', [
			'-qO-',
			'--tries=2',
			'--timeout=45',
			'-U',
			WGET_USER_AGENT,
			url
		]);
		return stdout;
	} catch {
		return null;
	}
}

/** Parallel HEAD probes to detect split part count. */
export async function detectPartCountParallel(
	probe: (url: string) => Promise<boolean>,
	baseUrl: string,
	hint: number,
	maxProbe = 32
): Promise<number> {
	const limit = Math.max(hint + 2, maxProbe);
	const checks = Array.from({ length: limit }, (_, i) => `${baseUrl}.part${i}`);

	const results = await Promise.all(
		checks.map(async (url, i) => ({ i, ok: await probe(url) }))
	);

	let count = 0;
	for (const { i, ok } of results.sort((a, b) => a.i - b.i)) {
		if (!ok) break;
		count = i + 1;
	}
	return count || hint;
}
