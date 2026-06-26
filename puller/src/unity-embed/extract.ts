import path from 'node:path';
import { externalUrlToRelativePath, isDownloadableMediaUrl } from './scan-assets.js';

export interface ExtractedGameInfo {
	embedPageUrl: string;
	fileUrl: string;
	cdnBase: string;
	dataParts: number;
	wasmParts: number;
	mediaUrls: string[];
	networkAssetUrls: string[];
	externalAssetUrls: string[];
	gameHtml: string;
}

const CDN_REGEX = /var\s+CDN\s*=\s*["']([^"']+)["']/;
const DATA_PARTS_REGEX = /var\s+DATA_PARTS\s*=\s*(\d+)/;
const WASM_PARTS_REGEX = /var\s+WASM_PARTS\s*=\s*(\d+)/;

/** Match absolute http(s) asset URLs inside the game wrapper HTML. */
const ABSOLUTE_URL_REGEX = /https?:\/\/[^"'\s)]+/g;

/** Known game asset filename patterns. */
const ASSET_FILENAME =
	/(?:Shrek2\.(?:data|wasm)\.br(?:\.part\d+)?|Shrek2\.(?:framework|loader)\.js|background\.jpg|logo\.png|style\.css)$/i;

/**
 * Extract playable HTML from the 1.xml wrapper (CDATA) if present.
 */
export function extractHtmlFromWrapper(raw: string): string {
	const cdataMatch = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
	if (cdataMatch) return cdataMatch[1];
	if (raw.includes('<!DOCTYPE html>') || raw.includes('<html')) return raw;
	return raw;
}

/**
 * Parse game metadata from the injected embed HTML (1.xml wrapper).
 */
export function parseGameHtml(
	html: string
): Omit<ExtractedGameInfo, 'embedPageUrl' | 'fileUrl' | 'networkAssetUrls' | 'gameHtml'> {
	const content = extractHtmlFromWrapper(html);
	const cdnMatch = content.match(CDN_REGEX);
	const dataMatch = content.match(DATA_PARTS_REGEX);
	const wasmMatch = content.match(WASM_PARTS_REGEX);

	const cdnBase = cdnMatch?.[1]?.replace(/\/Build$/, '') ?? '';
	const mediaUrls = extractAssetUrls(content).filter(
		(url) => !url.endsWith('/Build') && !url.includes('/Build/')
	);

	return {
		cdnBase,
		dataParts: dataMatch ? Number.parseInt(dataMatch[1], 10) : 8,
		wasmParts: wasmMatch ? Number.parseInt(wasmMatch[1], 10) : 4,
		mediaUrls
	};
}

/** @deprecated Alias for parseGameHtml */
export const parseGameXml = parseGameHtml;

/**
 * Extract game asset URLs from HTML or network capture lists.
 */
export function extractAssetUrls(html: string): string[] {
	const urls = html.match(ABSOLUTE_URL_REGEX) ?? [];
	return [...new Set(urls)].filter((url) => {
		try {
			const pathname = new URL(url).pathname;
			const filename = pathname.split('/').pop() ?? '';
			return ASSET_FILENAME.test(filename) || ASSET_FILENAME.test(pathname);
		} catch {
			return false;
		}
	});
}

/**
 * Resolve a remote URL to a local output path under app/static/game.
 */
export function urlToRelativePath(url: string, cdnBase: string): string | null {
	if (isDownloadableMediaUrl(url)) {
		return externalUrlToRelativePath(url);
	}

	try {
		const parsed = new URL(url);
		const pathname = parsed.pathname;

		// jsdelivr gh path: /gh/owner/repo@ref/path/to/file
		const ghMatch = pathname.match(/\/gh\/[^/]+\/[^/]+@[^/]+\/(.+)$/);
		if (ghMatch) {
			return decodeURIComponent(ghMatch[1]);
		}

		// Legacy split used by this repo's CDN
		const legacy = pathname.split('/gh/777kze777/shreh@main/')[1];
		if (legacy) {
			return decodeURIComponent(legacy);
		}

		// Same-origin relative to CDN base
		const cdn = new URL(cdnBase);
		if (parsed.origin === cdn.origin && parsed.pathname.startsWith(cdn.pathname)) {
			const rel = parsed.pathname.slice(cdn.pathname.length).replace(/^\//, '');
			return decodeURIComponent(rel);
		}

		// Bare filename fallback for known assets
		const filename = pathname.split('/').pop() ?? '';
		if (
			filename.startsWith('Shrek2.') ||
			['background.jpg', 'logo.png', 'style.css'].includes(filename)
		) {
			if (filename.includes('.js') || filename.includes('.br')) {
				return `Build/${filename}`;
			}
			return filename;
		}
	} catch {
		return null;
	}
	return null;
}

/**
 * Build download URL list from parsed metadata + network capture.
 */
export function buildAssetUrls(info: ExtractedGameInfo): string[] {
	const urls = new Set<string>();

	for (const url of info.networkAssetUrls) {
		if (urlToRelativePath(url, info.cdnBase)) {
			urls.add(url);
		}
	}

	for (const url of info.externalAssetUrls) {
		urls.add(url);
	}

	const buildBase = `${info.cdnBase}/Build`;
	urls.add(`${buildBase}/Shrek2.framework.js`);
	urls.add(`${buildBase}/Shrek2.loader.js`);

	for (let i = 0; i < info.dataParts; i++) {
		urls.add(`${buildBase}/Shrek2.data.br.part${i}`);
	}
	for (let i = 0; i < info.wasmParts; i++) {
		urls.add(`${buildBase}/Shrek2.wasm.br.part${i}`);
	}

	for (const media of info.mediaUrls) {
		urls.add(media);
	}

	return [...urls].filter((u) => !u.endsWith('/Build'));
}
