import { chromium } from 'playwright';
import { CDN_BASE } from './config.js';
import { discoverFromEmbeddedGame } from './embed.js';
import { parseGameHtml, type ExtractedGameInfo } from './extract.js';

/**
 * Discover game metadata from the embedded Google Sites launcher.
 */
export async function discoverGameInfo(): Promise<ExtractedGameInfo> {
	const browser = await chromium.launch({ headless: true });

	try {
		const embed = await discoverFromEmbeddedGame(browser);

		const parsed = parseGameHtml(embed.gameHtml);
		const cdnBase = parsed.cdnBase || deriveCdnBase(embed.fileUrl);

		console.log(`[discover] Embed page: ${embed.embedPageUrl}`);
		console.log(`[discover] Embed FILE_URL: ${embed.fileUrl}`);
		console.log(`[discover] CDN base: ${cdnBase}`);
		console.log(`[discover] Data parts: ${parsed.dataParts}, WASM parts: ${parsed.wasmParts}`);
		console.log(`[discover] Network assets: ${embed.networkAssetUrls.length}`);

		return {
			...parsed,
			cdnBase,
			embedPageUrl: embed.embedPageUrl,
			fileUrl: embed.fileUrl,
			networkAssetUrls: embed.networkAssetUrls,
			externalAssetUrls: [],
			gameHtml: embed.gameHtml
		};
	} finally {
		await browser.close();
	}
}

function deriveCdnBase(fileUrl: string): string {
	try {
		return new URL(fileUrl).href.replace(/\/1\.xml$/, '');
	} catch {
		return CDN_BASE;
	}
}
