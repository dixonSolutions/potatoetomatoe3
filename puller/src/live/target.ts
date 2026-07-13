import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { catalogOnlineDir, readGameMetadata } from '../catalog.js';
import { assertSafePlayUrl } from './safety.js';

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

/**
 * Resolve the live play target for a catalog game.
 * Prefer metadata.onlineEmbedUrl, else the online shell iframe src.
 */
export async function resolveLiveTargetUrl(gameId: string): Promise<string | null> {
	const meta = await readGameMetadata(gameId);
	const embed = typeof meta?.onlineEmbedUrl === 'string' ? meta.onlineEmbedUrl.trim() : '';
	if (embed) {
		assertSafePlayUrl(embed);
		return embed;
	}

	const indexPath = path.join(catalogOnlineDir(gameId), 'index.html');
	if (!existsSync(indexPath)) return null;
	const html = await fs.readFile(indexPath, 'utf-8');
	const iframeSrc = extractIframeSrc(html);
	if (!iframeSrc) return null;
	assertSafePlayUrl(iframeSrc);
	return iframeSrc;
}

export function normalizeBaseUrl(targetUrl: string): string {
	const parsed = new URL(targetUrl);
	if (!parsed.pathname.endsWith('/') && !/\.[a-z0-9]+$/i.test(parsed.pathname)) {
		parsed.pathname = `${parsed.pathname}/`;
	}
	return parsed.href;
}

export { extractIframeSrc };
