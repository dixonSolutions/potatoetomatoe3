import { chromium } from 'playwright';
import { DEFAULT_CDN_BASE } from './config.js';
import { discoverFromEmbeddedGame } from './embed.js';
import { parseGameHtml, type ExtractedGameInfo } from './extract.js';
import { readGameMetadata } from '../catalog.js';

/**
 * Discover Unity embed metadata from a game's Google Sites launcher page.
 * `embedPageUrl` comes from game metadata (`embedPageUrl` field) or offline manifest.
 */
export async function discoverGameInfo(gameId: string): Promise<ExtractedGameInfo> {
	const meta = await readGameMetadata(gameId);
	const embedPageUrl =
		(typeof meta?.embedPageUrl === 'string' && meta.embedPageUrl.trim()) ||
		(typeof meta?.embedDiscoveryUrl === 'string' && meta.embedDiscoveryUrl.trim()) ||
		'';

	if (!embedPageUrl) {
		throw new Error(
			`Game "${gameId}" uses embed pull strategy but has no embedPageUrl in metadata. ` +
				'Add embedPageUrl to online/metadata.json or set pullStrategy to generic.'
		);
	}

	const browser = await chromium.launch({ headless: true });

	try {
		const embed = await discoverFromEmbeddedGame(browser, embedPageUrl);

		const parsed = parseGameHtml(embed.gameHtml);
		const cdnBase = parsed.cdnBase || deriveCdnBase(embed.fileUrl);

		console.log(`[discover] Game: ${gameId}`);
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
		return DEFAULT_CDN_BASE;
	}
}
