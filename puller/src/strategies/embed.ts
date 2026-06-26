import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { GAMES_DATA_DIR } from '../config.js';
import { outDirForGame } from '../unity-embed/config.js';
import { discoverGameInfo } from '../unity-embed/discover.js';
import { downloadAssets, downloadUrlList } from '../unity-embed/download.js';
import { writeHostFiles } from '../unity-embed/host.js';
import { mergeSplitFiles } from '../unity-embed/merge.js';
import { buildAssetRouteMap, scanGameDirectory } from '../unity-embed/scan-assets.js';
import type { ProgressReporter } from './types.js';

export async function pullEmbedGame(gameId: string, onProgress: ProgressReporter): Promise<void> {
	const outDir = outDirForGame(GAMES_DATA_DIR, gameId);
	await fs.mkdir(outDir, { recursive: true });

	onProgress(5, 'Discovering game source…');

	const info = await discoverGameInfo(gameId);
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ ignoreHTTPSErrors: true });
	const request = context.request;
	const browserPage = await context.newPage();

	try {
		onProgress(15, 'Downloading core Unity assets…');
		let downloads = await downloadAssets(request, info, outDir);
		const merges = await mergeSplitFiles(outDir);

		onProgress(45, 'Scanning for external media…');
		info.externalAssetUrls = await scanGameDirectory(outDir, info.gameHtml);

		if (info.externalAssetUrls.length > 0) {
			onProgress(55, `Downloading ${info.externalAssetUrls.length} external asset(s)…`);
			const externalDownloads = await downloadUrlList(
				request,
				info.externalAssetUrls,
				outDir,
				info.cdnBase,
				browserPage
			);
			downloads = [...downloads, ...externalDownloads];
		}

		onProgress(85, 'Writing offline host files…');
		const assetRoutes = buildAssetRouteMap(info.externalAssetUrls);
		await writeHostFiles(outDir, info, downloads, merges, assetRoutes);

		onProgress(100, 'Download complete');
	} finally {
		await context.close();
		await browser.close();
	}
}
