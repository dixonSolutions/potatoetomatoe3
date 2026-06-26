import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { catalogOnlineDir, readGameMetadata } from '../catalog.js';
import { injectUnityPatches } from './inject-html.js';
import { WGET_USER_AGENT } from '../config.js';

function extractIframeSrc(html: string): string | null {
	const patterns = [/<iframe[^>]+src=["']([^"']+)["']/i];
	for (const re of patterns) {
		const m = html.match(re);
		if (m?.[1]) {
			const src = m[1].replace(/&amp;/g, '&').trim();
			if (src.startsWith('http')) return src;
		}
	}
	return null;
}

async function resolveUnityPlayUrl(gameId: string): Promise<string | null> {
	const meta = await readGameMetadata(gameId);
	const embed = typeof meta?.onlineEmbedUrl === 'string' ? meta.onlineEmbedUrl.trim() : '';
	if (embed) return embed;

	const indexPath = path.join(catalogOnlineDir(gameId), 'index.html');
	if (!existsSync(indexPath)) return null;
	const html = await fs.readFile(indexPath, 'utf-8');
	return extractIframeSrc(html);
}

/**
 * Fetch remote Unity build HTML, inject patches, serve same-origin via puller.
 */
export async function fetchProxiedUnityHtml(gameId: string): Promise<string | null> {
	const targetUrl = await resolveUnityPlayUrl(gameId);
	if (!targetUrl) return null;

	const res = await fetch(targetUrl, {
		headers: {
			'User-Agent': WGET_USER_AGENT,
			Accept: 'text/html,application/xhtml+xml,*/*'
		},
		signal: AbortSignal.timeout(60000)
	});
	if (!res.ok) return null;

	let html = await res.text();
	html = injectUnityPatches(html);

	/* Rewrite relative asset paths to absolute against build origin */
	const base = new URL(targetUrl);
	html = html.replace(
		/(src|href)=["'](?!https?:|\/\/|data:|blob:|#)([^"']+)["']/gi,
		(_m, attr, rel) => `${attr}="${new URL(rel, base).href}"`
	);

	return html;
}
