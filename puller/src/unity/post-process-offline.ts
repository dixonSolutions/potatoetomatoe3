import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
	buildAssetRouteMap,
	externalUrlToRelativePath,
	scanContentForMediaUrls
} from '../unity-embed/scan-assets.js';
import { inferBuildProductName } from './discover-assets.js';
import { injectUnityPatches, isUnityGameHtml } from './inject-html.js';

async function listBuildFiles(outDir: string): Promise<string[]> {
	const buildDir = path.join(outDir, 'Build');
	if (!existsSync(buildDir)) return [];
	const entries = await fs.readdir(buildDir);
	return entries.map((f) => path.posix.join('Build', f));
}

/**
 * Scan mirrored Unity offline folder for external asset URLs referenced in build files.
 */
export async function discoverExternalUnityAssets(
	outDir: string,
	indexHtml: string
): Promise<string[]> {
	const urls = new Set<string>(scanContentForMediaUrls(indexHtml));
	const product = inferBuildProductName(indexHtml);

	const toScan = await listBuildFiles(outDir);
	if (product) {
		for (const suffix of ['.framework.js', '.loader.js', '.data', '.wasm', '.data.br', '.wasm.br']) {
			toScan.push(path.posix.join('Build', `${product}${suffix}`));
		}
	}

	for (const rel of toScan) {
		const filePath = path.join(outDir, rel);
		if (!existsSync(filePath)) continue;
		try {
			const buf = await fs.readFile(filePath);
			if (buf.length > 16 * 1024 * 1024) continue;
			for (const url of scanContentForMediaUrls(buf.toString('latin1'))) {
				urls.add(url);
			}
		} catch {
			// skip unreadable
		}
	}

	return [...urls].sort();
}

/**
 * Post-process a generic Unity offline mirror: asset map, inject patches, rewrite index.html.
 */
export async function postProcessUnityOfflineMirror(
	outDir: string,
	baseUrl: string,
	entryRel = 'index.html'
): Promise<{ assetRoutes: Record<string, string>; externalCount: number }> {
	const entryPath = path.join(outDir, entryRel);
	const entryHtml = await fs.readFile(entryPath, 'utf-8');

	if (!isUnityGameHtml(entryHtml)) {
		return { assetRoutes: {}, externalCount: 0 };
	}

	const externalUrls = await discoverExternalUnityAssets(outDir, entryHtml);
	const assetRoutes = buildAssetRouteMap(externalUrls);

	if (externalUrls.length > 0) {
		await fs.writeFile(
			path.join(outDir, 'asset-map.json'),
			JSON.stringify(assetRoutes, null, 2)
		);
	}

	const patched = injectUnityPatches(entryHtml, assetRoutes);
	await fs.writeFile(entryPath, patched);

	console.log(
		`[unity] Post-processed ${path.basename(outDir)} — ${externalUrls.length} external route(s), product=${inferBuildProductName(entryHtml) ?? 'unknown'}`
	);

	return { assetRoutes, externalCount: externalUrls.length };
}

/** Resolve a remote URL to a path under offline/assets/ (for documentation / tooling). */
export function externalAssetLocalPath(url: string): string {
	return externalUrlToRelativePath(url);
}
