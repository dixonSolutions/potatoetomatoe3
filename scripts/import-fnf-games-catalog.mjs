#!/usr/bin/env node
/**
 * FNF Games (fnf-games.io) catalog import.
 *
 * Discovers from the portal's own sitemap and embeds `fnf-games.io/embed/<slug>`.
 *
 * Robots note: fnf-games.io disallows `/embed/` and `/game/`, plus `?page=`
 * pagination and the engine payload extensions. So discovery never requests any
 * of those — the sitemap and the game detail pages are the only pages fetched,
 * and the embed URL is read out of the detail page's markup rather than by
 * following it. The shell's iframe still points at `/embed/…` because that is
 * the URL the portal itself frames; robots governs this crawl, not the player's
 * browser later on.
 *
 * Usage:
 *   node scripts/import-fnf-games-catalog.mjs
 *   node scripts/import-fnf-games-catalog.mjs --limit 20 --skip-existing
 */

import { join } from 'path';
import {
	DATA_DIR,
	fetchText,
	runPool,
	sleep,
	writeJson,
	writeOnlineShell
} from './lib/game-shell.mjs';
import { EXACT_JUNK_TITLES, NSFW_RE, normalizeTitleKey, slugify } from './lib/catalog-quality.mjs';

const ORIGIN = 'https://fnf-games.io';
const SITEMAP_URL = `${ORIGIN}/sitemap.xml`;
const MANIFEST_PATH = join(DATA_DIR, 'fnf-games-catalog.json');

/** Sitemap entries that are navigation, not games. */
const NON_GAME_PATHS = new Set([
	'',
	'/',
	'/about-us',
	'/contact-us',
	'/dmca',
	'/favorite-games',
	'/hot-games',
	'/new-games',
	'/privacy-policy',
	'/search',
	'/terms-of-service',
	'/terms-of-use',
	'/top-popular'
]);

/**
 * Adult-tone titles the shared NSFW filter does not catch.
 *
 * Deliberately narrow: "erect" is not on this list because Erect is the name of
 * an official Friday Night Funkin' remix style, so matching it would throw away
 * a pile of ordinary rhythm mods.
 */
const ADULT_EXTRA_RE = /\bpervert|\bhorny\b|\bthicc\b|rule ?34\b|\bfetish\b/i;

/**
 * Quality gate for this portal.
 *
 * `assessPortalTitleQuality` is deliberately not used here. Its junk-title
 * heuristic exists for Unity Play, where "test" and "sandbox" mark abandoned
 * user uploads. This portal is editorially curated, and the same words appear in
 * the real names of listed mods — Character Test Playground, FNAF Test, Ragdoll
 * Sandbox — so the heuristic only produces false negatives. The NSFW and
 * exact-junk checks still apply.
 *
 * @param {{ name?: string, description?: string }} game
 * @returns {{ ok: boolean, reason?: string }}
 */
function assessFnfGameQuality(game) {
	const name = String(game.name || '');
	const desc = String(game.description || '');
	if (NSFW_RE.test(name) || NSFW_RE.test(desc)) return { ok: false, reason: 'nsfw' };
	if (ADULT_EXTRA_RE.test(name) || ADULT_EXTRA_RE.test(desc)) {
		return { ok: false, reason: 'adult-tone' };
	}
	if (EXACT_JUNK_TITLES.has(normalizeTitleKey(name))) return { ok: false, reason: 'junk-title' };
	return { ok: true };
}

/** Portal tag → catalog category, most specific first. */
const TAG_CATEGORY = [
	['rhythm', 'rhythm'],
	['music', 'rhythm'],
	['dance', 'rhythm'],
	['sprunki', 'rhythm'],
	['horror', 'horror'],
	['scary', 'horror'],
	['zombie', 'zombie'],
	['shooting', 'shooter'],
	['shooter', 'shooter'],
	['racing', 'racing'],
	['car', 'racing'],
	['puzzle', 'puzzle'],
	['platform', 'platformer'],
	['io', 'io'],
	['physics', 'skill'],
	['agility', 'skill'],
	['fast-paced', 'skill'],
	['funny', 'funny'],
	['cartoon', 'casual']
];

function parseArgv() {
	const a = process.argv.slice(2);
	const num = (flag, fallback) => {
		const i = a.indexOf(flag);
		return i >= 0 && a[i + 1] ? parseInt(a[i + 1], 10) : fallback;
	};
	return {
		limit: num('--limit', 0),
		concurrency: Math.max(1, num('--concurrency', 4)),
		minRatings: num('--min-ratings', 0),
		skipExisting: a.includes('--skip-existing'),
		discoverOnly: a.includes('--discover-only'),
		force: a.includes('--force'),
		help: a.includes('--help') || a.includes('-h')
	};
}

function extractSitemapPaths(xml) {
	const paths = new Set();
	for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
		let path;
		try {
			const url = new URL(m[1]);
			if (url.hostname !== 'fnf-games.io') continue;
			path = url.pathname.replace(/\/+$/, '');
		} catch {
			continue;
		}
		/* Category listings (`/music.games`) and tag hubs are not playable pages. */
		if (NON_GAME_PATHS.has(path)) continue;
		if (path.endsWith('.games')) continue;
		if (path.startsWith('/tag/')) continue;
		if (!/^\/[a-z0-9][a-z0-9-]*$/.test(path)) continue;
		paths.add(path);
	}
	return [...paths].sort();
}

/** The detail page carries the game's own schema.org block among several site-wide ones. */
function extractSoftwareApplication(html) {
	for (const m of html.matchAll(
		/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
	)) {
		let parsed;
		try {
			parsed = JSON.parse(m[1].trim());
		} catch {
			continue;
		}
		for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
			if (node && node['@type'] === 'SoftwareApplication') return node;
		}
	}
	return null;
}

function extractMeta(html, slug) {
	const ld = extractSoftwareApplication(html) || {};
	const attr = (name) => html.match(new RegExp(`${name}="([^"]+)"`, 'i'))?.[1] || '';
	const og = (prop) =>
		html.match(new RegExp(`property="og:${prop}"\\s+content="([^"]+)"`, 'i'))?.[1] || '';

	const title = String(ld.name || attr('data-game-name') || og('title') || slug.replace(/-/g, ' '));
	const description = String(ld.description || og('description') || '');
	const rating = ld.aggregateRating || {};

	const tags = new Set();
	for (const m of html.matchAll(/href="\/tag\/([a-z0-9-]+)"/gi)) tags.add(m[1]);

	return {
		title: title.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(),
		description: description.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(),
		thumb: String(ld.image || og('image') || '') || null,
		tags: [...tags],
		ratingValue: Number(rating.ratingValue) || null,
		ratingCount: Number(rating.ratingCount) || 0
	};
}

/**
 * Read the embed path out of the page without requesting it (robots disallows /embed/).
 * The portal's own markup appends an empty `pub_id`, which is dropped here.
 */
function extractEmbedUrl(html, slug) {
	const m = html.match(/\/embed\/[A-Za-z0-9._~-]+(?:\?[^"'\s)<>]*)?/);
	if (!m) return null;
	let url;
	try {
		url = new URL(m[0].replace(/&amp;/g, '&'), ORIGIN);
	} catch {
		return null;
	}
	if (url.pathname !== `/embed/${slug}`) return null;
	for (const [key, value] of [...url.searchParams]) {
		if (!value) url.searchParams.delete(key);
	}
	return url.href;
}

function pickCategory(tags, slug) {
	const set = new Set(tags);
	for (const [tag, category] of TAG_CATEGORY) {
		if (set.has(tag)) return category;
	}
	/* The portal is overwhelmingly Friday Night Funkin' mods; the rest are filler arcade. */
	return /^(fnf|friday-night|funkin|vs-)/.test(slug) || /funkin/.test(slug) ? 'rhythm' : 'arcade';
}

async function discover() {
	const xml = await fetchText(SITEMAP_URL, { referer: `${ORIGIN}/`, accept: 'application/xml' });
	return extractSitemapPaths(xml).map((path) => ({
		path,
		pageUrl: `${ORIGIN}${path}`,
		slug: slugify(path.slice(1), 'fnf-game')
	}));
}

async function importOne(entry, opts) {
	const html = await fetchText(entry.pageUrl, { referer: `${ORIGIN}/` });
	const embedUrl = extractEmbedUrl(html, entry.slug);
	if (!embedUrl) return { id: entry.slug, error: 'no /embed/ URL on page' };

	const meta = extractMeta(html, entry.slug);
	const id = `fnf-games-${entry.slug}`;

	const quality = assessFnfGameQuality(meta);
	if (!quality.ok) return { id: entry.slug, skipped: true, reason: quality.reason };
	if (opts.minRatings > 0 && meta.ratingCount < opts.minRatings) {
		return { id: entry.slug, skipped: true, reason: 'few-ratings' };
	}

	return writeOnlineShell(
		{
			id,
			name: meta.title,
			embedUrl,
			author: 'FNF Games',
			description: meta.description,
			category: pickCategory(meta.tags, entry.slug),
			thumbnailUrl: meta.thumb,
			engine: 'html5',
			sourcePortal: 'fnf-games',
			extra: {
				sourceSiteUrl: entry.pageUrl,
				fnfGamesSlug: entry.slug,
				...(meta.tags.length ? { tags: meta.tags } : {}),
				...(meta.ratingValue ? { portalRating: meta.ratingValue } : {}),
				...(meta.ratingCount ? { portalRatingCount: meta.ratingCount } : {})
			}
		},
		{
			skipExisting: opts.skipExisting,
			force: opts.force,
			referer: `${ORIGIN}/`,
			embedBase: ORIGIN
		}
	);
}

async function main() {
	const opts = parseArgv();
	if (opts.help) {
		console.log(
			`Usage: node scripts/import-fnf-games-catalog.mjs [--limit N] [--concurrency N] [--min-ratings N] [--skip-existing] [--force] [--discover-only]`
		);
		process.exit(0);
	}

	console.log('Discovering FNF Games…');
	let catalog = await discover();
	console.log(`Found ${catalog.length} games.`);
	writeJson(MANIFEST_PATH, {
		fetchedAt: new Date().toISOString(),
		source: SITEMAP_URL,
		count: catalog.length,
		games: catalog
	});

	if (opts.discoverOnly) return;
	if (opts.limit > 0) catalog = catalog.slice(0, opts.limit);

	console.log(`Importing ${catalog.length} (concurrency ${opts.concurrency})…`);
	let ok = 0;
	let skipped = 0;
	let failed = 0;
	const reasons = new Map();
	await runPool(catalog, opts.concurrency, async (g) => {
		try {
			const r = await importOne(g, opts);
			if (r.error) {
				failed++;
				console.warn(`  fail ${g.slug}: ${r.error}`);
			} else if (r.skipped) {
				skipped++;
				if (r.reason) reasons.set(r.reason, (reasons.get(r.reason) || 0) + 1);
			} else ok++;
		} catch (e) {
			failed++;
			console.warn(`  fail ${g.slug}: ${e.message || e}`);
		}
		await sleep(60);
		return null;
	});
	const detail = [...reasons].map(([r, n]) => `${r}=${n}`).join(' ');
	console.log(`Done. ok=${ok} skipped=${skipped} failed=${failed}${detail ? ` (${detail})` : ''}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
