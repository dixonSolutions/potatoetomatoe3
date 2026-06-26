import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readDownloadCache } from '../download-cache.js';
import { throwIfCancelled } from '../cancel-registry.js';
import { catalogOnlineDir, offlineDir } from '../catalog.js';
import { wgetCommonArgs } from '../config.js';
import { discoverAllAssetUrls } from '../download/discover-all.js';
import { downloadFilesParallel } from '../download/parallel-wget.js';
import { resolveMirroredEntryHtml } from '../generic/entry-html.js';
import { postProcessGenericOfflineMirror } from '../generic/post-process-offline.js';
import {
	expandBuildManifest,
	findUnityLoaderBuildJson,
	isUnityShell
} from '../unity/discover-assets.js';
import { writeOfflineManifest } from '../offline-manifest.js';
import { postProcessUnityOfflineMirror } from '../unity/post-process-offline.js';
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

interface PromotedMirror {
	baseUrl: string;
	entryRel: string;
}

/** Hoist mirrored game files under offline/ and record the real HTML entry in offline-manifest.json. */
async function promoteGameRootToOfflineDir(
	mirrorDir: string,
	iframeSrc: string
): Promise<PromotedMirror> {
	const entryPath = await resolveMirroredEntryHtml(mirrorDir, iframeSrc);
	const contentRoot = (await findGameContentRoot(mirrorDir)) ?? path.dirname(entryPath);
	const staging = path.join(path.dirname(mirrorDir), `${path.basename(mirrorDir)}.__staging__`);

	await fs.rm(staging, { recursive: true, force: true });
	await fs.mkdir(staging, { recursive: true });
	await fs.cp(contentRoot, staging, { recursive: true });

	const entryName = path.basename(entryPath);
	const stagedEntry = path.join(staging, entryName);

	if (!existsSync(stagedEntry)) {
		await fs.rm(staging, { recursive: true, force: true });
		throw new Error(`Could not prepare offline entry (${entryName})`);
	}

	const entryRel = path.relative(staging, stagedEntry).split(path.sep).join('/');

	await fs.rm(mirrorDir, { recursive: true, force: true });
	await fs.rename(staging, mirrorDir);

	const baseUrl = normalizeGameBaseUrl(iframeSrc);
	await writeOfflineManifest(mirrorDir, { entry: entryRel, mirroredFrom: iframeSrc });

	return { baseUrl, entryRel };
}

function wgetExitMessage(code: number): string {
	if (code === 5) {
		return 'wget mirror failed: SSL certificate could not be verified (exit 5). The game host uses an invalid or expired certificate.';
	}
	if (code === 4) {
		return 'wget mirror failed: network failure (exit 4). Check your connection and try again.';
	}
	return `wget mirror failed with exit code ${code}`;
}

function isWgetFailure(code: number): boolean {
	// 8 = server errors (404s on optional assets) — common on font mirrors
	return code !== 0 && code !== 8;
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
	const absPathParts = abs.pathname.split('/').filter(Boolean);

	if (abs.origin !== base.origin) {
		return path.join(outDir, '_external', abs.hostname, ...absPathParts);
	}

	const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
	if (!abs.pathname.startsWith(basePath)) {
		return path.join(outDir, ...absPathParts);
	}

	const baseParts = base.pathname.split('/').filter(Boolean);
	const relParts = absPathParts.slice(baseParts.length);
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
	entryRel: string,
	onProgress: ProgressReporter,
	signal?: AbortSignal
): Promise<void> {
	throwIfCancelled(signal);
	onProgress(55, 'Discovering all asset URLs…');

	const urls = await discoverAllAssetUrls(
		{ outDir, baseUrl, entryRel, unityOptimized: true },
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
	const entryHtml = await fs.readFile(path.join(outDir, entryRel), 'utf-8');
	await validateRequiredAssets(outDir, baseUrl, entryHtml);
}

export async function pullGenericGame(
	gameId: string,
	onProgress: ProgressReporter,
	signal?: AbortSignal
): Promise<void> {
	const onlineIndex = path.join(catalogOnlineDir(gameId), 'index.html');
	const out = offlineDir(gameId);

	throwIfCancelled(signal);
	onProgress(5, 'Reading online shell…');
	const html = await fs.readFile(onlineIndex, 'utf-8');
	const iframeSrc = extractIframeSrc(html);

	if (!iframeSrc) {
		onProgress(20, 'No iframe — copying online shell to offline…');
		await fs.rm(out, { recursive: true, force: true });
		await fs.cp(catalogOnlineDir(gameId), out, { recursive: true });
		await writeOfflineManifest(out, { entry: 'index.html' });
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
		...wgetCommonArgs(),
		'--tries=3',
		'--timeout=120',
		mirrorUrl
	];

	const code = await runWget(wgetArgs);
	throwIfCancelled(signal);

	onProgress(50, 'Preparing offline layout…');
	let baseUrl: string;
	let entryRel: string;
	try {
		({ baseUrl, entryRel } = await promoteGameRootToOfflineDir(out, iframeSrc));
	} catch (error) {
		if (isWgetFailure(code)) {
			throw new Error(wgetExitMessage(code));
		}
		throw error;
	}

	if (isWgetFailure(code)) {
		throw new Error(wgetExitMessage(code));
	}

	const entryPath = path.join(out, entryRel);
	if (!existsSync(entryPath)) {
		throw new Error(`Mirror completed but entry HTML missing: ${entryRel}`);
	}

	await discoverAndDownloadAssets(out, baseUrl, entryRel, onProgress, signal);

	const entryHtml = await fs.readFile(entryPath, 'utf-8');
	if (isUnityShell(entryHtml)) {
		throwIfCancelled(signal);
		onProgress(95, 'Injecting Unity patches & asset routes…');
		await postProcessUnityOfflineMirror(out, baseUrl, entryRel);
	} else {
		throwIfCancelled(signal);
		onProgress(95, 'Patching offline SDK & links…');
		await postProcessGenericOfflineMirror(out, entryRel);
	}

	onProgress(100, 'Download complete');
}
