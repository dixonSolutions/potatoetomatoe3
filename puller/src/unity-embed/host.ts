import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { DownloadResult } from './download.js';
import type { ExtractedGameInfo } from './extract.js';
import type { MergeResult } from './merge.js';
import { buildAdFreeHostHtml } from './adfree-host.js';
import { injectUnityPatches } from '../unity/inject-html.js';

export interface ManifestFile {
	path: string;
	size: number;
	sha256: string;
}

export interface GameManifest {
	productName: string;
	productVersion: string;
	pulledAt: string;
	cdnBase: string;
	embedPageUrl: string;
	embedFileUrl: string;
	externalAssetUrls: string[];
	assetRoutes: Record<string, string>;
	placeholderAssets?: string[];
	files: ManifestFile[];
}

function buildOfflineHtml(assetRoutes: Record<string, string>): string {
	return injectUnityPatches(buildAdFreeHostHtml(), assetRoutes);
}

/**
 * Write manifest.json and standalone offline index.html.
 */
export async function writeHostFiles(
	outDir: string,
	info: ExtractedGameInfo,
	downloads: DownloadResult[],
	merges: MergeResult[],
	assetRoutes: Record<string, string>
): Promise<GameManifest> {
	const files: ManifestFile[] = [];

	for (const dl of downloads) {
		if (dl.relativePath.includes('.part')) continue;
		files.push({ path: dl.relativePath, size: dl.size, sha256: dl.sha256 });
	}

	for (const merge of merges) {
		const mergedPath = path.join(outDir, merge.relativePath);
		const buffer = await fs.readFile(mergedPath);
		files.push({
			path: merge.relativePath,
			size: merge.size,
			sha256: createHash('sha256').update(buffer).digest('hex')
		});
	}

	const placeholderAssets = downloads.filter((dl) => dl.placeholder).map((dl) => dl.url);

	const manifest: GameManifest = {
		productName: 'Shrek Swamp Escape 2',
		productVersion: '0.1.0',
		pulledAt: new Date().toISOString(),
		cdnBase: info.cdnBase,
		embedPageUrl: info.embedPageUrl,
		embedFileUrl: info.fileUrl,
		externalAssetUrls: info.externalAssetUrls,
		assetRoutes,
		...(placeholderAssets.length > 0 ? { placeholderAssets } : {}),
		files
	};

	await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
	await fs.writeFile(path.join(outDir, 'asset-map.json'), JSON.stringify(assetRoutes, null, 2));
	await fs.writeFile(path.join(outDir, 'index.html'), buildOfflineHtml(assetRoutes));

	console.log(`[host] Wrote manifest.json (${files.length} files)`);
	console.log(`[host] Wrote asset-map.json (${Object.keys(assetRoutes).length} routes)`);
	console.log('[host] Wrote index.html (standalone offline host)');

	return manifest;
}
