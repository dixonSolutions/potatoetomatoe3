#!/usr/bin/env node
/**
 * Drive U 7 (Google Sites) catalog import.
 *
 * Discovers game pages from https://sites.google.com/view/drive-u-7-home/home,
 * extracts the jsDelivr Google-Gadget XML each page embeds, pulls the HTML out of
 * the Module CDATA, and writes Potato Tomato online shells.
 *
 * Prefer a remote playable HTML URL when one exists on the CDN; otherwise keep a
 * local online/embed.html that the puller live / unity-play proxies can serve.
 *
 * Usage:
 *   node scripts/import-drive-u7-catalog.mjs
 *   node scripts/import-drive-u7-catalog.mjs --limit 50
 *   node scripts/import-drive-u7-catalog.mjs --skip-existing
 *   node scripts/import-drive-u7-catalog.mjs --discover-only
 *   node scripts/import-drive-u7-catalog.mjs --concurrency 8
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
	DATA_DIR,
	GAMES_ROOT,
	UA,
	fetchText,
	runPool,
	sleep,
	writeJson,
	writeOnlineShell
} from './lib/game-shell.mjs';
import { slugify } from './lib/catalog-quality.mjs';

const HOME = 'https://sites.google.com/view/drive-u-7-home/home';
const SITE_ORIGIN = 'https://sites.google.com';
const MANIFEST_PATH = join(DATA_DIR, 'drive-u7-catalog.json');

const HUB_SLUGS = new Set([
	'home',
	'flash-games',
	'driving-games',
	'new-games',
	'contact',
	'chat',
	'classroom-center',
	'pokemon-series',
	'friday-n-funkin-series',
	'fortzonna'
]);

const CATEGORY_PREFIXES = new Set([
	'flash-games',
	'driving-games',
	'new-games',
	'pokemon-series',
	'friday-n-funkin-series',
	'fortzonna'
]);

function parseArgv() {
	const a = process.argv.slice(2);
	const num = (flag, fallback) => {
		const i = a.indexOf(flag);
		return i >= 0 && a[i + 1] ? parseInt(a[i + 1], 10) : fallback;
	};
	return {
		limit: num('--limit', 0),
		concurrency: Math.max(1, num('--concurrency', 6)),
		skipExisting: a.includes('--skip-existing'),
		discoverOnly: a.includes('--discover-only'),
		force: a.includes('--force'),
		help: a.includes('--help') || a.includes('-h')
	};
}

function decodeSitesHtml(html) {
	return html
		.replace(/\\u003d/g, '=')
		.replace(/\\u0026/g, '&')
		.replace(/\\\//g, '/')
		.replace(/&amp;/g, '&')
		.replace(/&#39;/g, "'")
		.replace(/&quot;/g, '"');
}

function titleFromSlug(slug) {
	return slug
		.split('-')
		.filter(Boolean)
		.map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
		.join(' ');
}

function categoryFromPath(cat, slug) {
	if (cat === 'flash-games') return 'flash';
	if (cat === 'driving-games') return 'racing';
	if (cat === 'pokemon-series') return 'adventure';
	if (cat === 'friday-n-funkin-series') return 'rhythm';
	if (cat === 'new-games') return 'arcade';
	if (/race|drift|drive|kart|truck|moto|car|bike/.test(slug)) return 'racing';
	if (/soccer|basket|football|volley|boxing|hockey|golf|pool/.test(slug)) return 'sports';
	if (/granny|horror|scary|fnaf|backrooms/.test(slug)) return 'horror';
	if (/puzzle|2048|tetris|match|sudoku/.test(slug)) return 'puzzle';
	return 'arcade';
}

/** Discover unique game pages linked from the home (and nested hub) HTML. */
function discoverFromHtml(html, bySlug) {
	const decoded = decodeSitesHtml(html);
	const paths = new Set(decoded.match(/\/view\/drive-u-7-home\/[a-z0-9][-a-z0-9_/]*/gi) || []);
	for (const p of paths) {
		const parts = p.replace(/\/+$/, '').split('/').filter(Boolean);
		// ["view","drive-u-7-home", slug] or ["view","drive-u-7-home", cat, slug]
		if (parts.length === 3) {
			const slug = parts[2].toLowerCase();
			if (HUB_SLUGS.has(slug)) continue;
			if (!bySlug.has(slug)) {
				bySlug.set(slug, {
					slug,
					categoryKey: 'root',
					pagePath: p,
					pageUrl: `${SITE_ORIGIN}${p}`,
					name: titleFromSlug(slug),
					category: categoryFromPath('root', slug)
				});
			}
		} else if (parts.length >= 4) {
			const cat = parts[2].toLowerCase();
			const slug = parts[3].toLowerCase();
			if (!CATEGORY_PREFIXES.has(cat)) continue;
			if (HUB_SLUGS.has(slug)) continue;
			const existing = bySlug.get(slug);
			if (!existing || existing.categoryKey !== 'root') {
				bySlug.set(slug, {
					slug,
					categoryKey: cat,
					pagePath: p,
					pageUrl: `${SITE_ORIGIN}${p}`,
					name: titleFromSlug(slug),
					category: categoryFromPath(cat, slug)
				});
			}
		}
	}
}

async function discoverAll() {
	const bySlug = new Map();
	const homeHtml = await fetchText(HOME, { referer: SITE_ORIGIN });
	discoverFromHtml(homeHtml, bySlug);

	/* Also crawl category hubs for any links missing from home. */
	for (const hub of CATEGORY_PREFIXES) {
		const url = `${SITE_ORIGIN}/view/drive-u-7-home/${hub}`;
		try {
			const html = await fetchText(url, { referer: HOME });
			discoverFromHtml(html, bySlug);
			await sleep(120);
		} catch (e) {
			console.warn(`  hub fail ${hub}: ${e.message || e}`);
		}
	}

	return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

function extractXmlUrl(pageHtml) {
	const decoded = decodeSitesHtml(pageHtml);
	const match = decoded.match(/https:\/\/cdn\.jsdelivr\.net\/gh\/[^"'\\\s<>]+\.xml/i);
	return match ? match[0].replace(/&amp;/g, '&') : null;
}

/**
 * Many Drive U 7 pages inject playable markup via `const gameHTML = \`...\``.
 * Recover that HTML when there is no gadget XML.
 */
function extractInlineGameHtml(pageHtml) {
	const decoded = decodeSitesHtml(pageHtml)
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");

	const patterns = [
		/const\s+gameHTML\s*=\s*`([\s\S]*?)`\s*\.trim\(\)/i,
		/let\s+gameHTML\s*=\s*`([\s\S]*?)`\s*\.trim\(\)/i,
		/var\s+gameHTML\s*=\s*`([\s\S]*?)`\s*\.trim\(\)/i,
		/const\s+gameHTML\s*=\s*`([\s\S]*?)`;/i
	];
	for (const re of patterns) {
		const m = decoded.match(re);
		if (!m?.[1]) continue;
		let html = m[1].trim();
		if (!html) continue;
		if (!/^<!DOCTYPE|^<html[\s>]/i.test(html)) {
			html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#000}object,embed,canvas,#gameContainer,.webgl-content{width:100%;height:100%}</style>
</head>
<body>
${html}
</body>
</html>`;
		}
		return html;
	}
	return null;
}

function extractCdataHtml(xml) {
	const m = xml.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
	if (!m?.[1]) return null;
	const html = m[1].trim();
	if (!/<html[\s>]/i.test(html) && !/<body[\s>]/i.test(html) && !/<script[\s>]/i.test(html)) {
		return null;
	}
	return html;
}

function xmlDirBase(xmlUrl) {
	try {
		const u = new URL(xmlUrl);
		u.hash = '';
		u.search = '';
		const path = u.pathname.replace(/\/[^/]*$/, '/');
		u.pathname = path;
		return u.href;
	} catch {
		return null;
	}
}

function absolutizeHtml(html, baseHref) {
	if (!baseHref) return html;
	let base;
	try {
		base = new URL(baseHref);
	} catch {
		return html;
	}
	const toAbs = (raw) => {
		const v = raw.trim();
		if (!v || /^(https?:|data:|blob:|javascript:|#|\/\/)/i.test(v)) return raw;
		try {
			return new URL(v, base).href;
		} catch {
			return raw;
		}
	};
	return html
		.replace(/(src|href)=["']([^"']+)["']/gi, (_m, attr, rel) => `${attr}="${toAbs(rel)}"`)
		.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (_m, _q, rel) => `url("${toAbs(rel.trim())}")`);
}

function detectUnity(html) {
	return /UnityLoader|createUnityInstance|unity-canvas|Build\/.*\.(json|loader\.js)|\.wasm|unity-webgl/i.test(
		html
	);
}

function extractTitle(pageHtml, fallback) {
	const decoded = decodeSitesHtml(pageHtml);
	const og =
		decoded.match(/property=["']og:title["']\s+content=["']([^"']+)["']/i)?.[1] ||
		decoded.match(/content=["']([^"']+)["']\s+property=["']og:title["']/i)?.[1];
	const clean = (raw) => {
		let t = String(raw || '')
			.replace(/\s*[|–-]\s*Unblocked.*$/i, '')
			.replace(/^Classroom Resources\s*[|–-]\s*/i, '')
			.replace(/\s*[|–-]\s*Classroom Resources.*$/i, '')
			.trim();
		return t || fallback;
	};
	if (og) return clean(og);
	const title = decoded.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
	if (title && !/google sites/i.test(title)) return clean(title);
	return fallback;
}

function extractThumb(pageHtml) {
	const decoded = decodeSitesHtml(pageHtml);
	const og =
		decoded.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1] ||
		decoded.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i)?.[1];
	return og && /^https?:\/\//i.test(og) ? og : null;
}

function candidateRemoteHtmlUrls(html, xmlUrl) {
	const out = [];
	const seen = new Set();
	const add = (u) => {
		if (!u || seen.has(u)) return;
		if (!/^https?:\/\/cdn\.jsdelivr\.net\/gh\//i.test(u)) return;
		if (/\.(png|jpe?g|gif|webp|css|js|wasm|data|br|gz|json|xml|ico|svg)(\?|$)/i.test(u)) return;
		seen.add(u);
		out.push(u);
	};

	for (const m of html.matchAll(/https:\/\/cdn\.jsdelivr\.net\/gh\/[^"'\\\s<>]+/gi)) {
		const u = m[0].replace(/&amp;/g, '&');
		if (/\/index\.html(?:\?|$)/i.test(u) || /\.html(?:\?|$)/i.test(u)) add(u.split('#')[0]);
	}

	const buildUrl = html.match(/BUILD_URL\s*=\s*["'](https:\/\/cdn\.jsdelivr\.net\/gh\/[^"']+)["']/i)?.[1];
	if (buildUrl) {
		try {
			const parent = new URL('.', new URL(buildUrl.endsWith('/') ? buildUrl : `${buildUrl}/`));
			add(new URL('index.html', parent).href);
		} catch {
			/* ignore */
		}
	}

	const base = xmlDirBase(xmlUrl);
	if (base) {
		add(new URL('index.html', base).href);
		/* Sibling repo roots sometimes host index.html next to Build/ */
		const hosts = [...html.matchAll(/https:\/\/cdn\.jsdelivr\.net\/gh\/[^/"']+\/[^/"'@]+@[^/"']+\//gi)].map(
			(m) => m[0]
		);
		for (const h of hosts.slice(0, 8)) {
			add(new URL('index.html', h).href);
		}
	}

	return out;
}

async function probeRemoteHtml(urls) {
	for (const url of urls) {
		try {
			const res = await fetch(url, {
				method: 'GET',
				headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
				signal: AbortSignal.timeout(20000)
			});
			if (!res.ok) continue;
			const text = await res.text();
			if (text.length < 80) continue;
			if (!/<html[\s>]/i.test(text) && !/<canvas[\s>]/i.test(text) && !/<script[\s>]/i.test(text)) {
				continue;
			}
			/* Skip accidental XML gadgets. */
			if (/<ModulePrefs[\s>]/i.test(text) && /<!\[CDATA\[/i.test(text)) continue;
			return { url, html: text };
		} catch {
			/* try next */
		}
	}
	return null;
}

function writeLocalEmbed(gameId, html, embedBaseUrl) {
	const onlineDir = join(GAMES_ROOT, gameId, 'online');
	mkdirSync(onlineDir, { recursive: true });
	const withBase =
		embedBaseUrl && !/<base\s/i.test(html)
			? html.replace(/<head([^>]*)>/i, `<head$1><base href="${embedBaseUrl}">`)
			: html;
	writeFileSync(join(onlineDir, 'embed.html'), withBase, 'utf-8');
}

async function importOne(game, opts) {
	const gameId = slugify(game.slug, `drive-u7-${game.slug}`);
	const metaPath = join(GAMES_ROOT, gameId, 'online', 'metadata.json');
	if (opts.skipExisting && existsSync(metaPath) && !opts.force) {
		return { id: gameId, skipped: true };
	}

	const pageHtml = await fetchText(game.pageUrl, { referer: HOME });
	const xmlUrl = extractXmlUrl(pageHtml);
	let localHtml = null;
	let embedBaseUrl = null;
	let gadgetXmlUrl = null;

	if (xmlUrl) {
		gadgetXmlUrl = xmlUrl;
		const xml = await fetchText(xmlUrl, {
			referer: game.pageUrl,
			accept: 'application/xml,text/xml,*/*'
		});
		const cdata = extractCdataHtml(xml);
		if (cdata) {
			embedBaseUrl = xmlDirBase(xmlUrl);
			localHtml = absolutizeHtml(cdata, embedBaseUrl);
		}
	}

	if (!localHtml) {
		localHtml = extractInlineGameHtml(pageHtml);
		if (localHtml) {
			const firstCdn = localHtml.match(/https:\/\/cdn\.jsdelivr\.net\/gh\/[^"'\\\s<>]+/i)?.[0];
			embedBaseUrl = firstCdn ? firstCdn.replace(/\/[^/]*$/, '/') : 'https://cdn.jsdelivr.net/';
			localHtml = absolutizeHtml(localHtml, embedBaseUrl);
		}
	}

	if (!localHtml) {
		return { id: gameId, error: xmlUrl ? 'no cdata html' : 'no gadget xml' };
	}

	const unity = detectUnity(localHtml);
	const remote = await probeRemoteHtml(candidateRemoteHtmlUrls(localHtml, xmlUrl || embedBaseUrl || ''));
	const embedUrl = remote?.url || null;
	const name = extractTitle(pageHtml, game.name);
	const thumb = extractThumb(pageHtml);

	/* Always keep a local embed for the puller when remote HTML is missing or Unity-only-in-gadget. */
	writeLocalEmbed(gameId, localHtml, embedBaseUrl);

	const shellEmbed =
		embedUrl ||
		/* Fallback shell points at the Sites page so the catalog still has a clickable preview URL. */
		game.pageUrl;

	const result = await writeOnlineShell(
		{
			id: gameId,
			name,
			author: 'Drive U 7',
			description: `Imported from Drive U 7 (${game.pageUrl}).`,
			category: game.category,
			thumbnailUrl: thumb || undefined,
			sourcePortal: 'drive-u-7',
			embedUrl: shellEmbed,
			engine: unity ? 'unity' : undefined,
			pullStrategy: embedUrl ? 'embed' : 'local-embed',
			extra: {
				embedPageUrl: game.pageUrl,
				...(gadgetXmlUrl ? { gadgetXmlUrl } : {}),
				localEmbed: true,
				...(embedBaseUrl ? { embedBaseUrl } : {}),
				...(embedUrl ? { remotePlayUrl: embedUrl } : {})
			}
		},
		{
			skipExisting: false,
			force: opts.force,
			referer: game.pageUrl
		}
	);

	return {
		id: gameId,
		ok: true,
		unity,
		embedUrl: shellEmbed,
		remote: Boolean(embedUrl),
		skipped: result.skipped
	};
}

async function main() {
	const opts = parseArgv();
	if (opts.help) {
		console.log(`Usage: node scripts/import-drive-u7-catalog.mjs [options]
  --limit N
  --concurrency N   (default 6)
  --skip-existing
  --discover-only
  --force`);
		return;
	}

	console.log('Discovering Drive U 7 games…');
	let catalog = await discoverAll();
	console.log(`Found ${catalog.length} unique games`);
	writeJson(MANIFEST_PATH, {
		source: HOME,
		scrapedAt: new Date().toISOString(),
		count: catalog.length,
		games: catalog
	});

	if (opts.discoverOnly) {
		console.log(`Wrote ${MANIFEST_PATH}`);
		return;
	}

	if (opts.limit > 0) catalog = catalog.slice(0, opts.limit);

	let ok = 0;
	let skipped = 0;
	let failed = 0;
	const failures = [];

	await runPool(catalog, opts.concurrency, async (g) => {
		try {
			const r = await importOne(g, opts);
			if (r.error) {
				failed++;
				failures.push({ slug: g.slug, error: r.error });
				console.warn(`  fail ${g.slug}: ${r.error}`);
			} else if (r.skipped) {
				skipped++;
			} else {
				ok++;
				if (ok % 25 === 0) console.log(`  … ${ok} imported`);
			}
		} catch (e) {
			failed++;
			failures.push({ slug: g.slug, error: String(e.message || e) });
			console.warn(`  fail ${g.slug}: ${e.message || e}`);
		}
		await sleep(60);
		return null;
	});

	writeJson(join(DATA_DIR, 'drive-u7-import-report.json'), {
		ok,
		skipped,
		failed,
		failures: failures.slice(0, 200)
	});
	console.log(`Done. ok=${ok} skipped=${skipped} failed=${failed}`);
	console.log('Next: node scripts/generate-games-list.js');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
