/**
 * Cloudflare Worker: same-origin Unity play proxy for GitHub Pages.
 *
 * GET /api/unity-play/:gameId
 *   Resolves onlineEmbedUrl from CATALOG_BASE/games/:id/online/metadata.json,
 *   fetches the Unity frame HTML, injects catalog inject.js, rewrites relative
 *   asset URLs, and returns HTML embeddable from GitHub Pages.
 *
 * Optional: ?src=https://play.unity.com/... (allow-listed hosts only).
 */

const UA =
	'Mozilla/5.0 (compatible; PotatoTomatoUnityProxy/1.0; +https://github.com/dixonSolutions/potatoetomatoe3)';

const ALLOWED_EMBED_HOSTS = [
	'play.unity.com',
	'cdn.play.unity.com',
	'storage-direct.y8.com',
	'html-eu.storage.y8.com',
	'html5.gamedistribution.com',
	'html5.gamemonetize.com'
];

function corsHeaders(request, env) {
	const origin = request.headers.get('Origin') || '';
	const allowed = String(env.FRAME_ANCESTORS || '')
		.split(/\s+/)
		.map((s) => s.trim())
		.filter(Boolean);
	const ok =
		!origin ||
		allowed.length === 0 ||
		allowed.some((a) => origin === a || origin.startsWith(a.replace(/\/$/, '')));
	return {
		'Access-Control-Allow-Origin': ok && origin ? origin : allowed[0] || '*',
		'Access-Control-Allow-Methods': 'GET, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
		Vary: 'Origin'
	};
}

function frameAncestorsHeader(env) {
	const parts = String(env.FRAME_ANCESTORS || 'https://dixonsolutions.github.io')
		.split(/\s+/)
		.map((s) => s.trim())
		.filter(Boolean);
	return parts.length ? parts.join(' ') : "'self'";
}

function isAllowedEmbedUrl(raw) {
	try {
		const u = new URL(raw);
		if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
		return ALLOWED_EMBED_HOSTS.some(
			(host) => u.hostname === host || u.hostname.endsWith('.' + host)
		);
	} catch {
		return false;
	}
}

function extractIframeSrc(html) {
	const m = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
	if (!m?.[1]) return null;
	const src = m[1].replace(/&amp;/g, '&').trim();
	return src.startsWith('http') ? src : null;
}

function injectScript(html, injectSource) {
	if (html.includes('__ptUnityInjectInstalled')) return html;
	const tag = `<script>${injectSource}</script>`;
	if (/<head[^>]*>/i.test(html)) {
		return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
	}
	if (/<body[^>]*>/i.test(html)) {
		return html.replace(/<body([^>]*)>/i, `<body$1>${tag}`);
	}
	return tag + html;
}

function absolutizeAssets(html, baseUrl) {
	const base = new URL(baseUrl);
	return html.replace(
		/(src|href)=["'](?!https?:|\/\/|data:|blob:|#)([^"']+)["']/gi,
		(_m, attr, rel) => {
			try {
				return `${attr}="${new URL(rel, base).href}"`;
			} catch {
				return `${attr}="${rel}"`;
			}
		}
	);
}

async function resolveEmbedUrl(env, gameId, srcParam) {
	if (srcParam) {
		if (!isAllowedEmbedUrl(srcParam)) return null;
		return srcParam;
	}
	const catalogBase = String(env.CATALOG_BASE || '').replace(/\/$/, '');
	if (!catalogBase || !gameId) return null;

	const metaUrl = `${catalogBase}/games/${encodeURIComponent(gameId)}/online/metadata.json`;
	const metaRes = await fetch(metaUrl, {
		headers: { 'User-Agent': UA, Accept: 'application/json' }
	});
	if (metaRes.ok) {
		const meta = await metaRes.json();
		const embed = typeof meta?.onlineEmbedUrl === 'string' ? meta.onlineEmbedUrl.trim() : '';
		if (embed && isAllowedEmbedUrl(embed)) return embed;
	}

	const shellUrl = `${catalogBase}/games/${encodeURIComponent(gameId)}/online/index.html`;
	const shellRes = await fetch(shellUrl, {
		headers: { 'User-Agent': UA, Accept: 'text/html' }
	});
	if (!shellRes.ok) return null;
	const shellHtml = await shellRes.text();
	const iframeSrc = extractIframeSrc(shellHtml);
	if (iframeSrc && isAllowedEmbedUrl(iframeSrc)) return iframeSrc;
	return null;
}

async function loadInjectSource(env) {
	const catalogBase = String(env.CATALOG_BASE || '').replace(/\/$/, '');
	if (!catalogBase) return null;
	const res = await fetch(`${catalogBase}/unity/inject.js`, {
		headers: { 'User-Agent': UA, Accept: 'text/javascript,*/*' }
	});
	if (!res.ok) return null;
	return await res.text();
}

function jsonError(status, message, request, env) {
	return new Response(JSON.stringify({ error: message }), {
		status,
		headers: {
			'Content-Type': 'application/json',
			...corsHeaders(request, env)
		}
	});
}

export default {
	async fetch(request, env) {
		if (request.method === 'OPTIONS') {
			return new Response(null, { status: 204, headers: corsHeaders(request, env) });
		}
		if (request.method !== 'GET') {
			return jsonError(405, 'Method not allowed', request, env);
		}

		const url = new URL(request.url);
		if (url.pathname === '/health') {
			return new Response(JSON.stringify({ ok: true }), {
				headers: { 'Content-Type': 'application/json', ...corsHeaders(request, env) }
			});
		}

		const match = url.pathname.match(/^\/api\/unity-play\/([^/]+)\/?$/);
		if (!match) {
			return jsonError(404, 'Not found', request, env);
		}

		const gameId = decodeURIComponent(match[1]);
		if (!/^[a-z0-9][a-z0-9-]*$/i.test(gameId)) {
			return jsonError(400, 'Invalid game id', request, env);
		}

		const targetUrl = await resolveEmbedUrl(env, gameId, url.searchParams.get('src'));
		if (!targetUrl) {
			return jsonError(404, 'No allow-listed Unity embed URL for game', request, env);
		}

		const injectSource = await loadInjectSource(env);
		if (!injectSource) {
			return jsonError(502, 'Failed to load inject.js from CATALOG_BASE', request, env);
		}

		const upstream = await fetch(targetUrl, {
			headers: {
				'User-Agent': UA,
				Accept: 'text/html,application/xhtml+xml,*/*'
			}
		});
		if (!upstream.ok) {
			return jsonError(502, `Upstream fetch failed (${upstream.status})`, request, env);
		}

		let html = await upstream.text();
		html = injectScript(html, injectSource);
		html = absolutizeAssets(html, targetUrl);

		return new Response(html, {
			status: 200,
			headers: {
				'Content-Type': 'text/html; charset=utf-8',
				'Cache-Control': 'public, max-age=300',
				'Content-Security-Policy': `frame-ancestors ${frameAncestorsHeader(env)}`,
				'X-Content-Type-Options': 'nosniff',
				...corsHeaders(request, env)
			}
		});
	}
};
