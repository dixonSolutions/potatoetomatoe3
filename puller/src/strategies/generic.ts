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

const ASSET_EXT =
	/(?:\.(?:unityweb|wasm|data|js|json|css|png|jpe?g|gif|webp|svg|ico|br|mp3|ogg|wav|woff2?|ttf|eot))(?:[?#]|$)/i;

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

function normalizeGameBaseUrl(iframeSrc: string): string {
	const parsed = new URL(iframeSrc);
	if (!parsed.pathname.endsWith('/')) {
		parsed.pathname = `${parsed.pathname}/`;
	}
	return parsed.href;
}

function mirroredIndexCandidates(out: string, iframeUrl: string): string[] {
	const parsed = new URL(iframeUrl);
	const parts = parsed.pathname.split('/').filter(Boolean);
	const hostDir = path.join(out, parsed.hostname);
	const candidates = [path.join(out, 'index.html'), path.join(hostDir, 'index.html')];

	if (parts.length === 0) return candidates;

	const last = parts[parts.length - 1];
	candidates.push(path.join(hostDir, ...parts, 'index.html'));
	candidates.push(path.join(hostDir, ...parts.slice(0, -1), `${last}.html`));
	candidates.push(path.join(hostDir, ...parts, `${last}.html`));

	return candidates;
}

async function findIndexHtml(dir: string): Promise<string | null> {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isFile() && /^index\.html?$/i.test(e.name)) return full;
		if (e.isDirectory()) {
			const found = await findIndexHtml(full);
			if (found) return found;
		}
	}
	return null;
}

async function resolveMirroredIndex(out: string, iframeSrc: string): Promise<string> {
	for (const candidate of mirroredIndexCandidates(out, iframeSrc)) {
		if (!existsSync(candidate)) continue;
		try {
			const stat = await fs.stat(candidate);
			if (stat.isFile() && stat.size >= 64) return candidate;
		} catch {
			// try next candidate
		}
	}

	const hostDir = path.join(out, new URL(iframeSrc).hostname);
	if (existsSync(hostDir)) {
		const found = await findIndexHtml(hostDir);
		if (found) return found;
	}

	const fallback = await findIndexHtml(out);
	if (fallback) return fallback;

	throw new Error('Mirror completed but no playable HTML entry point found');
}

async function findGameContentRoot(mirrorDir: string): Promise<string | null> {
	async function walk(dir: string): Promise<string | null> {
		if (existsSync(path.join(dir, 'Build')) || existsSync(path.join(dir, 'TemplateData'))) {
			return dir;
		}
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const e of entries) {
			if (!e.isDirectory()) continue;
			const found = await walk(path.join(dir, e.name));
			if (found) return found;
		}
		return null;
	}

	return walk(mirrorDir);
}

/** Hoist mirrored game files so index.html, Build/, TemplateData/ sit directly under offline/. */
async function promoteGameRootToOfflineDir(mirrorDir: string, iframeSrc: string): Promise<string> {
	const indexPath = await resolveMirroredIndex(mirrorDir, iframeSrc);
	const contentRoot = (await findGameContentRoot(mirrorDir)) ?? path.dirname(indexPath);
	const staging = path.join(path.dirname(mirrorDir), `${path.basename(mirrorDir)}.__staging__`);

	await fs.rm(staging, { recursive: true, force: true });
	await fs.mkdir(staging, { recursive: true });
	await fs.cp(contentRoot, staging, { recursive: true });

	const entryName = path.basename(indexPath);
	const stagedEntry = path.join(staging, entryName);
	const stagedIndex = path.join(staging, 'index.html');

	if (entryName !== 'index.html' && existsSync(stagedEntry)) {
		await fs.copyFile(stagedEntry, stagedIndex);
	} else if (!existsSync(stagedIndex) && existsSync(path.join(contentRoot, 'index.html'))) {
		await fs.copyFile(path.join(contentRoot, 'index.html'), stagedIndex);
	}

	if (!existsSync(stagedIndex)) {
		await fs.rm(staging, { recursive: true, force: true });
		throw new Error('Could not prepare offline index.html');
	}

	await fs.rm(mirrorDir, { recursive: true, force: true });
	await fs.rename(staging, mirrorDir);

	return normalizeGameBaseUrl(iframeSrc);
}

async function runWget(args: string[]): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn('wget', args, { stdio: 'inherit' });
		child.on('error', reject);
		child.on('close', (code) => resolve(code ?? 1));
	});
}

async function downloadFile(url: string, destPath: string): Promise<boolean> {
	if (existsSync(destPath)) {
		try {
			const stat = await fs.stat(destPath);
			if (stat.isFile() && stat.size > 0) return true;
		} catch {
			// re-download
		}
	}

	await fs.mkdir(path.dirname(destPath), { recursive: true });
	try {
		await execFileAsync('wget', [
			'-q',
			'--tries=3',
			'--timeout=120',
			'-U',
			WGET_UA,
			'-O',
			destPath,
			url
		]);
		const stat = await fs.stat(destPath);
		if (stat.size === 0) {
			await fs.rm(destPath, { force: true });
			return false;
		}
		const head = (await fs.readFile(destPath)).subarray(0, 32).toString('utf8');
		if (head.startsWith('<!DOCTYPE') || head.startsWith('<html')) {
			await fs.rm(destPath, { force: true });
			return false;
		}
		return true;
	} catch {
		try {
			await fs.rm(destPath, { force: true });
		} catch {
			// ignore
		}
		return false;
	}
}

function localPathForUrl(baseUrl: string, assetUrl: string, outDir: string): string {
	const base = new URL(baseUrl);
	const abs = new URL(assetUrl, base);
	if (abs.origin !== base.origin) {
		return path.join(
			outDir,
			'_external',
			abs.hostname,
			...abs.pathname.split('/').filter(Boolean)
		);
	}

	const baseParts = base.pathname.split('/').filter(Boolean);
	const absParts = abs.pathname.split('/').filter(Boolean);
	const relParts = absParts.slice(baseParts.length);
	if (relParts.length === 0) return path.join(outDir, 'index.html');
	return path.join(outDir, ...relParts);
}

function collectAssetRefs(text: string, fileUrl: string, queue: Set<string>, seen: Set<string>): void {
	const patterns = [
		/(?:href|src)=["']([^"']+)["']/gi,
		/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi,
		/UnityLoader\.instantiate\s*\(\s*[^,]+,\s*["']([^"']+)["']/gi,
		/"(?:dataUrl|wasmCodeUrl|wasmFrameworkUrl|codeUrl|frameworkUrl|symbolsUrl|streamingAssetsUrl)"\s*:\s*"([^"]+)"/gi,
		/["']([^"']+\.(?:unityweb|wasm|data|js|json|css|png|jpe?g|gif|webp|svg|ico|br|mp3|ogg|wav|woff2?|ttf|eot)(?:\?[^"']*)?)["']/gi
	];

	for (const pattern of patterns) {
		pattern.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = pattern.exec(text)) !== null) {
			const ref = m[1]?.trim();
			if (!ref || ref.startsWith('data:') || ref.startsWith('blob:') || ref.startsWith('#')) continue;
			try {
				const abs = new URL(ref, fileUrl).href;
				if (!ASSET_EXT.test(abs)) continue;
				if (seen.has(abs)) continue;
				queue.add(abs);
			} catch {
				// skip invalid URL
			}
		}
	}
}

async function validateRequiredAssets(
	outDir: string,
	baseUrl: string,
	indexHtml: string
): Promise<void> {
	const missing: string[] = [];

	if (/UnityLoader/i.test(indexHtml)) {
		const match = indexHtml.match(/UnityLoader\.instantiate\s*\(\s*[^,]+,\s*["']([^"']+)["']/i);
		if (match?.[1]) {
			const buildJsonUrl = new URL(match[1], baseUrl).href;
			const buildJsonPath = localPathForUrl(baseUrl, buildJsonUrl, outDir);
			if (!existsSync(buildJsonPath)) {
				missing.push(buildJsonPath);
			} else {
				try {
					const buildMeta = JSON.parse(await fs.readFile(buildJsonPath, 'utf-8')) as Record<
						string,
						string
					>;
					for (const key of [
						'dataUrl',
						'wasmCodeUrl',
						'wasmFrameworkUrl',
						'codeUrl',
						'frameworkUrl'
					]) {
						const rel = buildMeta[key];
						if (!rel) continue;
						const assetPath = localPathForUrl(buildJsonUrl, rel, outDir);
						if (!existsSync(assetPath)) missing.push(assetPath);
					}
				} catch {
					missing.push(buildJsonPath);
				}
			}
		}

		if (!existsSync(path.join(outDir, 'Build', 'UnityLoader.js'))) {
			missing.push(path.join(outDir, 'Build', 'UnityLoader.js'));
		}
	}

	if (missing.length > 0) {
		throw new Error(`Missing required offline assets: ${missing.slice(0, 5).join(', ')}`);
	}
}

async function fetchAllReferencedAssets(
	outDir: string,
	baseUrl: string,
	onProgress: ProgressReporter
): Promise<void> {
	onProgress(65, 'Fetching all referenced assets…');

	const indexPath = path.join(outDir, 'index.html');
	const indexHtml = await fs.readFile(indexPath, 'utf-8');
	const queue = new Set<string>();
	const seen = new Set<string>();

	collectAssetRefs(indexHtml, baseUrl, queue, seen);

	let fetched = 0;
	for (let pass = 0; pass < 24 && queue.size > 0; pass++) {
		const batch = [...queue];
		queue.clear();

		for (const url of batch) {
			if (seen.has(url)) continue;
			seen.add(url);

			const dest = localPathForUrl(baseUrl, url, outDir);
			const ok = await downloadFile(url, dest);
			if (!ok) continue;

			fetched++;
			if (fetched % 5 === 0) {
				onProgress(70 + Math.min(20, Math.floor(fetched / 3)), `Downloaded ${fetched} asset(s)…`);
			}

			if (/\.(html?|js|css|json)$/i.test(dest)) {
				try {
					const text = await fs.readFile(dest, 'utf-8');
					collectAssetRefs(text, url, queue, seen);
				} catch {
					// binary mislabeled
				}
			}
		}
	}

	onProgress(92, `Verifying required assets (${fetched} downloaded)…`);
	await validateRequiredAssets(outDir, baseUrl, indexHtml);
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

	const mirrorUrl = normalizeGameBaseUrl(iframeSrc);

	onProgress(15, `Mirroring ${mirrorUrl}…`);
	await fs.rm(out, { recursive: true, force: true });
	await fs.mkdir(out, { recursive: true });

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
		'--timeout=120',
		mirrorUrl
	];

	const code = await runWget(wgetArgs);

	onProgress(50, 'Preparing offline layout…');
	let baseUrl: string;
	try {
		baseUrl = await promoteGameRootToOfflineDir(out, iframeSrc);
	} catch (error) {
		if (code !== 0 && code !== 8) {
			throw new Error(`wget mirror failed with exit code ${code}`);
		}
		throw error;
	}

	if (code !== 0 && code !== 8) {
		throw new Error(`wget mirror failed with exit code ${code}`);
	}

	if (!existsSync(path.join(out, 'index.html'))) {
		throw new Error('Mirror completed but no index.html found');
	}

	await fetchAllReferencedAssets(out, baseUrl, onProgress);

	onProgress(100, 'Download complete');
}
