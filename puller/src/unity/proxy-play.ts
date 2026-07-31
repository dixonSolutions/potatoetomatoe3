import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { catalogOnlineDir, readGameMetadata, readLocalEmbedHtml } from '../catalog.js';
import { normalizeBaseUrl } from '../live/target.js';
import { isCrazyGamesShellHtml } from './crazygames-unwrap.js';
import { injectUnityPatches, isOpenFlGameHtml, isUnityGameHtml } from './inject-html.js';
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

function isRemoteHttpUrl(url: string): boolean {
	try {
		const u = new URL(url);
		return u.protocol === 'http:' || u.protocol === 'https:';
	} catch {
		return false;
	}
}

/** Prefer a real CDN/HTML embed; Sites gadget pages are not Unity documents. */
function isPreferredUnityEmbed(url: string): boolean {
	if (!isRemoteHttpUrl(url)) return false;
	if (/sites\.google\.com\/view\//i.test(url)) return false;
	return true;
}

async function resolveUnityPlayUrl(gameId: string): Promise<string | null> {
	const meta = await readGameMetadata(gameId);
	const embed = typeof meta?.onlineEmbedUrl === 'string' ? meta.onlineEmbedUrl.trim() : '';
	if (embed && isPreferredUnityEmbed(embed)) return embed;
	const remotePlay =
		typeof meta?.remotePlayUrl === 'string' ? meta.remotePlayUrl.trim() : '';
	if (remotePlay && isPreferredUnityEmbed(remotePlay)) return remotePlay;

	const indexPath = path.join(catalogOnlineDir(gameId), 'index.html');
	if (!existsSync(indexPath)) return null;
	const html = await fs.readFile(indexPath, 'utf-8');
	const iframeSrc = extractIframeSrc(html);
	if (iframeSrc && isPreferredUnityEmbed(iframeSrc)) return iframeSrc;
	return null;
}

/** Directory form so `Build/x` resolves under `/game/` not the parent of `/game`. */
export function documentBaseHref(baseHref: string): string {
	return normalizeBaseUrl(baseHref);
}

function ensureHtmlBaseTag(html: string, baseHref: string): string {
	const href = documentBaseHref(baseHref);
	if (/<base\b/i.test(html)) {
		return html.replace(/<base\b[^>]*>/i, `<base href="${href}">`);
	}
	if (/<head\b[^>]*>/i.test(html)) {
		return html.replace(/<head\b[^>]*>/i, (open) => `${open}<base href="${href}">`);
	}
	return `<base href="${href}">${html}`;
}

/**
 * Absolutize relative src/href and legacy UnityLoader.instantiate JSON paths.
 * Extensionless remote paths (…/mob-city) must be treated as directories.
 */
export function absolutizeAgainstBase(html: string, baseHref: string): string {
	try {
		const base = new URL(documentBaseHref(baseHref));
		let out = html.replace(
			/(src|href)=["'](?!https?:|\/\/|data:|blob:|#)([^"']+)["']/gi,
			(_m, attr, rel) => `${attr}="${new URL(rel, base).href}"`
		);
		/* UnityLoader.instantiate("el", "Build/game.json") — not matched by src/href rewrite. */
		out = out.replace(
			/(UnityLoader\.instantiate\s*\(\s*[^,]+,\s*)(["'])(?!https?:|\/\/|data:|blob:)([^"']+)\2/gi,
			(_m, prefix: string, quote: string, rel: string) =>
				`${prefix}${quote}${new URL(rel, base).href}${quote}`
		);
		return ensureHtmlBaseTag(out, base.href);
	} catch {
		return html;
	}
}

export type UnityPlayHtmlResult =
	| { kind: 'unity'; html: string }
	| { kind: 'live-relay'; reason: 'openfl' | 'non-unity' }
	| null;

/**
 * Fetch remote Unity build HTML (or load local embed.html), inject patches.
 * Returns `live-relay` for OpenFL/Lime / non-Unity shells so the HTTP handler can
 * use game-live rewrite (avoids a circular import with live/proxy.ts).
 */
export async function fetchProxiedUnityHtml(gameId: string): Promise<UnityPlayHtmlResult> {
	const targetUrl = await resolveUnityPlayUrl(gameId);
	if (targetUrl) {
		const res = await fetch(targetUrl, {
			headers: {
				'User-Agent': WGET_USER_AGENT,
				Accept: 'text/html,application/xhtml+xml,*/*'
			},
			signal: AbortSignal.timeout(60000)
		});
		if (res.ok) {
			const raw = await res.text();
			if (isOpenFlGameHtml(raw)) return { kind: 'live-relay', reason: 'openfl' };
			/* Portal shell → game-live rewrite; never invent a bare UnityLoader page. */
			if (isCrazyGamesShellHtml(raw)) return { kind: 'live-relay', reason: 'non-unity' };
			if (!isUnityGameHtml(raw)) return { kind: 'live-relay', reason: 'non-unity' };
			let html = injectUnityPatches(raw);
			html = absolutizeAgainstBase(html, res.url || targetUrl);
			return { kind: 'unity', html };
		}
	}

	const local = await readLocalEmbedHtml(gameId);
	if (!local) return null;
	if (isOpenFlGameHtml(local.html)) return { kind: 'live-relay', reason: 'openfl' };
	if (isCrazyGamesShellHtml(local.html)) return { kind: 'live-relay', reason: 'non-unity' };
	if (!isUnityGameHtml(local.html)) return { kind: 'live-relay', reason: 'non-unity' };
	let html = injectUnityPatches(local.html);
	html = absolutizeAgainstBase(html, local.baseHref);
	return { kind: 'unity', html };
}
