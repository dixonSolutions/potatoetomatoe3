import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readDownloadCache } from '../download-cache.js';
import { throwIfCancelled } from '../cancel-registry.js';
import { catalogOnlineDir, offlineDir } from '../catalog.js';
import { WGET_USER_AGENT } from '../config.js';
import { discoverAllAssetUrls } from '../download/discover-all.js';
import { downloadFilesParallel } from '../download/parallel-wget.js';
import {
	expandBuildManifest,
	findUnityLoaderBuildJson,
	isUnityShell
} from '../unity/discover-assets.js';
import type { ProgressReporter } from './types.js';

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

async function validateRequiredAssets(
	outDir: string,
	baseUrl: string,
	indexHtml: string
): Promise<void> {
	const missing: string[] = [];

	if (isUnityShell(indexHtml)) {
		const buildJsonRel = findUnityLoaderBuildJson(indexHtml);
		if (buildJsonRel) {
			const buildJsonUrl = new URL(buildJsonRel, baseUrl).href;
			const buildJsonPath = localPathForUrl(baseUrl, buildJsonUrl, outDir);
			if (!existsSync(buildJsonPath)) {
				missing.push(buildJsonPath);
			} else {
				try {
					const buildMeta = JSON.parse(await fs.readFile(buildJsonPath, 'utf-8')) as Record<
						string,
						string
					>;
					for (const assetUrl of expandBuildManifest(buildMeta, buildJsonUrl)) {
						const assetPath = localPathForUrl(baseUrl, assetUrl, outDir);
						if (!existsSync(assetPath)) missing.push(assetPath);
					}
				} catch {
					missing.push(buildJsonPath);
				}
			}
		}

		if (
			/UnityLoader/i.test(indexHtml) &&
			!existsSync(path.join(outDir, 'Build', 'UnityLoader.js')) &&
			!existsSync(path.join(outDir, 'UnityLoader.js'))
		) {
			missing.push(path.join(outDir, 'Build/UnityLoader.js'));
		}
	}

	if (missing.length > 0) {
		throw new Error(`Missing required offline assets: ${missing.slice(0, 5).join(', ')}`);
	}
}

async function discoverAndDownloadAssets(
	outDir: string,
	baseUrl: string,
	onProgress: ProgressReporter,
	signal?: AbortSignal
): Promise<void> {
	throwIfCancelled(signal);
	onProgress(55, 'Discovering all asset URLs…');

	const urls = await discoverAllAssetUrls(
		{ outDir, baseUrl, unityOptimized: true },
		localPathForUrl
	);
	throwIfCancelled(signal);

	const tasks = [...urls].map((url) => ({
		url,
		destPath: localPathForUrl(baseUrl, url, outDir)
	}));

	onProgress(65, `Downloading ${tasks.length} asset(s) in parallel…`);

	let lastPct = 65;
	await downloadFilesParallel(tasks, {
		signal,
		onProgress: (done, total) => {
			const pct = 65 + Math.min(25, Math.floor((done / Math.max(total, 1)) * 25));
			if (pct > lastPct) {
				lastPct = pct;
				onProgress(pct, `Downloaded ${done}/${total} asset(s)…`);
			}
		}
	});

	throwIfCancelled(signal);
	onProgress(92, 'Verifying Unity / required assets…');
	const indexHtml = await fs.readFile(path.join(outDir, 'index.html'), 'utf-8');
	await validateRequiredAssets(outDir, baseUrl, indexHtml);
}

export async function pullGenericGame(
	gameId: string,
	onProgress: ProgressReporter,
	signal?: AbortSignal
): Promise<void> {
	const onlineIndex = path.join(catalogOnlineDir(gameId), 'online/index.html');
	const out = offlineDir(gameId);

	throwIfCancelled(signal);
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
	const existingCache = await readDownloadCache(gameId);
	if (!existingCache) {
		await fs.rm(out, { recursive: true, force: true });
	}
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
		WGET_USER_AGENT,
		'--tries=3',
		'--timeout=120',
		mirrorUrl
	];

	const code = await runWget(wgetArgs);
	throwIfCancelled(signal);

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

	await discoverAndDownloadAssets(out, baseUrl, onProgress, signal);

	onProgress(100, 'Download complete');
}
