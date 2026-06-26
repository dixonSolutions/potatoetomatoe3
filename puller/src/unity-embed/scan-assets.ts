import fs from 'node:fs/promises';
import path from 'node:path';

const MEDIA_EXT = /\.(png|jpe?g|gif|webp|svg|mp3|ogg|wav|webm|bmp|ico|ttf|woff2?)(@2x|@3x)?$/i;

/** Hosts that are documentation / social links, not game media. */
const BLOCKED_HOSTS = new Set([
	'docs.unity3d.com',
	'www.notion.so',
	'ash-message-bf4.notion.site',
	't.me',
	'localhost',
	'scripts.sil.org',
	'go.microsoft.com',
	'www.w3.org',
	'schemas.microsoft.com',
	'www.ascendercorp.com',
	'newtypography.co.uk'
]);

/**
 * Scan raw text/binary content for external media URLs referenced by the game.
 */
export function scanContentForMediaUrls(content: string): string[] {
	const found = new Set<string>();

	// Split on scheme to handle URLs concatenated in Unity binary blobs.
	for (const part of content.split(/https?:\/\//)) {
		if (!part) continue;
		const chunk = `https://${part.slice(0, 512)}`;
		const match = chunk.match(/^https:\/\/[a-zA-Z0-9.-]+(?:\/[^\s"'\x00<>]*)?/);
		if (!match) continue;

		let url = match[0].replace(/[)\]},;]+$/, '');
		// Trim trailing garbage after known media extensions
		url = url.replace(
			/(\.(?:png|jpe?g|gif|webp|svg|mp3|ogg|wav|webm|bmp|ico|ttf|woff2?)(?:@2x|@3x)?).*/i,
			'$1'
		);

		if (isDownloadableMediaUrl(url)) {
			found.add(url);
		}
	}

	// Standard regex pass for well-formed URLs in HTML/JS
	const regex =
		/https?:\/\/[^\s"'<>]+?\.(?:png|jpe?g|gif|webp|svg|mp3|ogg|wav|webm|bmp|ico|ttf|woff2?)(?:@2x|@3x)?/gi;
	for (const url of content.match(regex) ?? []) {
		if (isDownloadableMediaUrl(url)) {
			found.add(url);
		}
	}

	return [...found];
}

export function isDownloadableMediaUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
		if (BLOCKED_HOSTS.has(parsed.hostname)) return false;
		if (!MEDIA_EXT.test(parsed.pathname)) return false;
		// Skip CDN assets we already mirror from the embed repo
		if (parsed.hostname.includes('jsdelivr.net') && parsed.pathname.includes('777kze777/shreh')) {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}

/**
 * Map an external URL to a local assets/ path mirroring host + pathname.
 */
export function externalUrlToRelativePath(url: string): string {
	const parsed = new URL(url);
	const cleanPath = parsed.pathname.replace(/^\/+/, '');
	return path.posix.join('assets', parsed.hostname, cleanPath);
}

/**
 * Scan game wrapper HTML and Unity build files on disk for external media URLs.
 */
export async function scanGameDirectory(outDir: string, gameHtml: string): Promise<string[]> {
	const urls = new Set<string>(scanContentForMediaUrls(gameHtml));

	const filesToScan = [
		'Build/Shrek2.framework.js',
		'Build/Shrek2.loader.js',
		'Build/Shrek2.data.br',
		'Build/Shrek2.wasm.br'
	];

	for (const rel of filesToScan) {
		const filePath = path.join(outDir, rel);
		try {
			const buf = await fs.readFile(filePath);
			const text = buf.toString('latin1');
			for (const url of scanContentForMediaUrls(text)) {
				urls.add(url);
			}
		} catch {
			// File may not exist yet during first pass.
		}
	}

	return [...urls].sort();
}

/**
 * Build remote -> local routing map for offline play.
 */
export function buildAssetRouteMap(urls: string[]): Record<string, string> {
	const map: Record<string, string> = {};
	for (const url of urls) {
		const rel = externalUrlToRelativePath(url);
		// Relative to game root (index.html lives beside assets/)
		map[url] = rel.replace(/\\/g, '/');
	}
	return map;
}
