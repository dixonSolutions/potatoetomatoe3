import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
	collectGenericAssetRefs,
	discoverUnityAssetRefs,
	expandBuildManifest,
	isUnityShell,
	parseCreateUnityInstanceConfig,
	scanUnityLoaderBundle
} from '../unity/discover-assets.js';
import { fetchTextForDiscovery } from './parallel-wget.js';

const TEXT_EXT = /\.(html?|js|css|json|xml|txt)$/i;

export interface DiscoverOptions {
	outDir: string;
	baseUrl: string;
	/** Max BFS passes when expanding refs from fetched text. */
	maxPasses?: number;
	/** Prefer Unity-specific parsers when shell looks like WebGL. */
	unityOptimized?: boolean;
}

async function readTextSource(
	url: string,
	outDir: string,
	baseUrl: string,
	localPathForUrl: (base: string, asset: string, out: string) => string
): Promise<string | null> {
	const localPath = localPathForUrl(baseUrl, url, outDir);
	if (existsSync(localPath)) {
		try {
			const buf = await fs.readFile(localPath);
			if (buf.length > 8 * 1024 * 1024) return null;
			return buf.toString('utf-8');
		} catch {
			return null;
		}
	}
	if (!TEXT_EXT.test(url)) return null;
	return fetchTextForDiscovery(url);
}

/**
 * Discover all asset URLs before downloading.
 * Phase 1: BFS over text assets (local + remote fetch for discovery only).
 * Phase 2: Unity manifest expansion from Build/*.json and loader bundles.
 */
export async function discoverAllAssetUrls(
	options: DiscoverOptions,
	localPathForUrl: (base: string, asset: string, out: string) => string
): Promise<Set<string>> {
	const { outDir, baseUrl, maxPasses = 32, unityOptimized = true } = options;
	const discovered = new Set<string>();
	const seen = new Set<string>();
	const scanQueue = new Set<string>();

	const indexPath = path.join(outDir, 'index.html');
	const indexHtml = await fs.readFile(indexPath, 'utf-8');
	const unityMode = unityOptimized && isUnityShell(indexHtml);

	const addRefs = (text: string, fileUrl: string) => {
		if (unityMode) {
			discoverUnityAssetRefs(text, fileUrl, scanQueue, seen);
		} else {
			collectGenericAssetRefs(text, fileUrl, scanQueue, seen);
		}
	};

	addRefs(indexHtml, baseUrl);

	for (let pass = 0; pass < maxPasses && scanQueue.size > 0; pass++) {
		const batch = [...scanQueue];
		scanQueue.clear();

		const DISCOVERY_CONCURRENCY = 16;
		for (let i = 0; i < batch.length; i += DISCOVERY_CONCURRENCY) {
			const chunk = batch.slice(i, i + DISCOVERY_CONCURRENCY);
			await Promise.all(
				chunk.map(async (url) => {
					if (seen.has(url)) return;
					seen.add(url);
					discovered.add(url);

					const text = await readTextSource(url, outDir, baseUrl, localPathForUrl);
					if (!text) return;

					addRefs(text, url);

					if (unityMode && /\.json$/i.test(url)) {
						try {
							const manifest = JSON.parse(text) as Record<string, unknown>;
							for (const assetUrl of expandBuildManifest(manifest, url)) {
								if (!seen.has(assetUrl)) scanQueue.add(assetUrl);
								discovered.add(assetUrl);
							}
						} catch {
							// not JSON manifest
						}
					}

					if (unityMode && /\.(loader|framework)\.js$/i.test(url)) {
						for (const assetUrl of scanUnityLoaderBundle(text, url)) {
							if (!seen.has(assetUrl)) scanQueue.add(assetUrl);
							discovered.add(assetUrl);
						}
						const inline = parseCreateUnityInstanceConfig(text);
						for (const val of Object.values(inline)) {
							try {
								const abs = new URL(val, url).href;
								if (!seen.has(abs)) scanQueue.add(abs);
								discovered.add(abs);
							} catch {
								// skip
							}
						}
					}
				})
			);
		}
	}

	return discovered;
}
