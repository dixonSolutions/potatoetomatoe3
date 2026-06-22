import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { catalogOnlineDir, offlineDir } from '../catalog.js';
import type { ProgressReporter } from './types.js';

const execFileAsync = promisify(execFile);

const WGET_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function extractIframeSrc(html: string): string | null {
	const patterns = [/<iframe[^>]+src=["']([^"']+)["']/i, /<iframe[^>]+src=([^\s>]+)/i];
	for (const re of patterns) {
		const m = html.match(re);
		if (m?.[1]) {
			const src = m[1].replace(/&amp;/g, '&').trim();
			if (src.startsWith('http')) return src;
		}
	}
	return null;
}

async function runWget(args: string[]): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn('wget', args, { stdio: 'inherit' });
		child.on('error', reject);
		child.on('close', (code) => resolve(code ?? 1));
	});
}

async function deepFetchAssets(
	targetDir: string,
	baseUrl: string,
	onProgress: ProgressReporter
): Promise<void> {
	onProgress(70, 'Deep asset scan…');
	const assetPattern =
		/(?:href|src)=["']([^"']+\.(?:js|css|png|jpg|jpeg|gif|webp|wasm|json|br|mp3|ogg|wav))["']/gi;
	const queue = new Set<string>();
	const seen = new Set<string>();

	async function scanFile(filePath: string): Promise<void> {
		try {
			const content = await fs.readFile(filePath, 'utf-8');
			let m: RegExpExecArray | null;
			assetPattern.lastIndex = 0;
			while ((m = assetPattern.exec(content)) !== null) {
				const ref = m[1];
				if (!ref || ref.startsWith('data:') || ref.startsWith('blob:')) continue;
				try {
					const abs = new URL(ref, baseUrl).href;
					if (!seen.has(abs)) queue.add(abs);
				} catch {
					// skip bad URLs
				}
			}
		} catch {
			// binary or unreadable
		}
	}

	async function walk(dir: string): Promise<void> {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const e of entries) {
			const full = path.join(dir, e.name);
			if (e.isDirectory()) await walk(full);
			else if (/\.(html?|js|css|json)$/i.test(e.name)) await scanFile(full);
		}
	}

	await walk(targetDir);

	let fetched = 0;
	for (const url of queue) {
		if (seen.has(url)) continue;
		seen.add(url);
		try {
			const parsed = new URL(url);
			const rel = path.join(parsed.hostname, ...parsed.pathname.split('/').filter(Boolean));
			const dest = path.join(targetDir, rel);
			await fs.mkdir(path.dirname(dest), { recursive: true });
			if (!existsSync(dest)) {
				await execFileAsync('wget', [
					'-q',
					'--tries=3',
					'--timeout=90',
					'-U',
					WGET_UA,
					'-O',
					dest,
					url
				]);
				fetched++;
			}
		} catch {
			// skip failed assets
		}
	}
	if (fetched > 0) onProgress(80, `Fetched ${fetched} additional asset(s)`);
}

export async function pullGenericGame(gameId: string, onProgress: ProgressReporter): Promise<void> {
	const onlineIndex = path.join(catalogOnlineDir(gameId), 'index.html');
	const out = offlineDir(gameId);

	onProgress(5, 'Reading online shell…');
	const html = await fs.readFile(onlineIndex, 'utf-8');
	const iframeSrc = extractIframeSrc(html);

	if (!iframeSrc) {
		onProgress(20, 'No iframe — copying online shell to offline…');
		await fs.rm(out, { recursive: true, force: true });
		await fs.cp(catalogOnlineDir(gameId), out, { recursive: true });
		onProgress(100, 'Copied online shell');
		return;
	}

	onProgress(15, `Mirroring ${iframeSrc}…`);
	await fs.rm(out, { recursive: true, force: true });
	await fs.mkdir(out, { recursive: true });

	const parsed = new URL(iframeSrc);
	const wgetArgs = [
		'--mirror',
		'--convert-links',
		'--adjust-extension',
		'--no-parent',
		'--page-requisites',
		'--directory-prefix',
		out,
		'-e',
		'robots=off',
		'-U',
		WGET_UA,
		'--tries=3',
		'--timeout=90',
		iframeSrc
	];

	const code = await runWget(wgetArgs);
	if (code !== 0) {
		throw new Error(`wget mirror failed with exit code ${code}`);
	}

	onProgress(55, 'Locating mirrored index…');
	const hostDir = path.join(out, parsed.hostname);
	let indexPath: string | null = null;

	async function findIndex(dir: string): Promise<string | null> {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const e of entries) {
			const full = path.join(dir, e.name);
			if (e.isFile() && /^index\.html?$/i.test(e.name)) return full;
			if (e.isDirectory()) {
				const found = await findIndex(full);
				if (found) return found;
			}
		}
		return null;
	}

	if (existsSync(hostDir)) {
		indexPath = await findIndex(hostDir);
	}
	if (!indexPath) {
		indexPath = await findIndex(out);
	}

	if (indexPath && indexPath !== path.join(out, 'index.html')) {
		await fs.copyFile(indexPath, path.join(out, 'index.html'));
	}

	const finalIndex = path.join(out, 'index.html');
	if (!existsSync(finalIndex)) {
		throw new Error('Mirror completed but no index.html found');
	}

	onProgress(65, 'Fetching runtime assets…');
	await deepFetchAssets(out, iframeSrc, onProgress);

	onProgress(100, 'Download complete');
}
