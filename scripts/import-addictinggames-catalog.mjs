#!/usr/bin/env node
/**
 * AddictingGames catalog import.
 * Discovers genre/tag pages via __NEXT_DATA__, then game pages for embed URLs.
 *
 * Usage:
 *   node scripts/import-addictinggames-catalog.mjs
 *   node scripts/import-addictinggames-catalog.mjs --limit 40 --skip-existing
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
import { assessPortalTitleQuality, slugify } from './lib/catalog-quality.mjs';

const MANIFEST_PATH = join(DATA_DIR, 'addictinggames-catalog.json');
const BASE = 'https://www.addictinggames.com';

function parseArgv() {
	const a = process.argv.slice(2);
	const num = (flag, fallback) => {
		const i = a.indexOf(flag);
		return i >= 0 && a[i + 1] ? parseInt(a[i + 1], 10) : fallback;
	};
	return {
		limit: num('--limit', 0),
		concurrency: Math.max(1, num('--concurrency', 4)),
		skipExisting: a.includes('--skip-existing'),
		discoverOnly: a.includes('--discover-only'),
		force: a.includes('--force'),
		help: a.includes('--help') || a.includes('-h')
	};
}

function extractNextData(html) {
	const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
	if (!m) return null;
	try {
		return JSON.parse(m[1]);
	} catch {
		return null;
	}
}

async function discoverGenrePaths() {
	const html = await fetchText(`${BASE}/all-categories`, { referer: BASE });
	const data = extractNextData(html);
	const props = data?.props?.pageProps || {};
	const paths = new Set();
	for (const g of props.genres || []) {
		if (g.path) paths.add(g.path);
		else if (g.slug) paths.add(`/${g.slug}`);
	}
	for (const t of props.tags || []) {
		if (t.path) paths.add(t.path);
	}
	// Fallback popular genre list
	for (const p of [
		'/action-games',
		'/puzzle-games',
		'/sports-games',
		'/car-games',
		'/shooting-games',
		'/strategy-games',
		'/io-games',
		'/zombie-games',
		'/funny-games',
		'/new-games',
		'/top-games',
		'/most-addicting-games'
	]) {
		paths.add(p);
	}
	return [...paths];
}

function gamesFromPageProps(props, category) {
	const out = [];
	const lists = [props.games, props.mobileGames, props.items].filter(Boolean);
	for (const list of lists) {
		if (!Array.isArray(list)) continue;
		for (const g of list) {
			const path =
				g.path ||
				g.url ||
				(g.genreSlug && g.slug ? `/${g.genreSlug}/${g.slug}` : null) ||
				(g.slug ? `/${category.replace(/-games$/, '')}/${g.slug}` : null);
			if (!path || typeof path !== 'string') continue;
			const pageUrl = path.startsWith('http')
				? path
				: `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
			const slug = slugify(g.slug || path.split('/').pop(), 'ag');
			out.push({
				slug,
				pageUrl,
				name: g.title || g.name || slug,
				description: g.description || g.shortDescription || '',
				thumbnailUrl: g.thumbnailUrl || g.image || g.thumb || null,
				category: (g.genre || category || 'arcade').toString().toLowerCase().replace(/\s+/g, '-')
			});
		}
	}
	return out;
}

async function discover() {
	const genrePaths = await discoverGenrePaths();
	console.log(`  Genre/tag paths: ${genrePaths.length}`);
	const bySlug = new Map();

	for (const path of genrePaths) {
		try {
			const html = await fetchText(`${BASE}${path}`, { referer: BASE });
			const data = extractNextData(html);
			const props = data?.props?.pageProps || {};
			const cat = props.genre || props.slug || path.replace(/^\//, '');
			for (const g of gamesFromPageProps(props, cat)) {
				if (!bySlug.has(g.slug)) bySlug.set(g.slug, g);
			}
			// also scrape hrefs as fallback
			for (const m of html.matchAll(/href="(\/[a-z0-9-]+\/[a-z0-9-]+)"/gi)) {
				const href = m[1];
				if (
					/^\/(about|tag|all-|new-|top-|most-|free-|hot-|indie-|multiplayer|playlists)/i.test(href)
				) {
					continue;
				}
				const slug = slugify(href.split('/').pop(), 'ag');
				if (!bySlug.has(slug)) {
					bySlug.set(slug, {
						slug,
						pageUrl: `${BASE}${href}`,
						name: slug.replace(/-/g, ' '),
						description: '',
						thumbnailUrl: null,
						category: 'arcade'
					});
				}
			}
			process.stdout.write(`\r  Discovery unique: ${bySlug.size}   `);
			await sleep(150);
		} catch (e) {
			console.warn(`\n  genre fail ${path}: ${e.message || e}`);
		}
	}
	console.log('');
	return [...bySlug.values()];
}

function extractEmbed(html) {
	const iframe = html.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1];
	if (iframe && !/ads?|doubleclick|googlesyndication/i.test(iframe)) {
		return iframe.replace(/&amp;/g, '&');
	}
	const candidates = [
		html.match(/"gameUrl"\s*:\s*"([^"]+)"/i)?.[1],
		html.match(/"embedUrl"\s*:\s*"([^"]+)"/i)?.[1],
		html.match(/"game_url"\s*:\s*"([^"]+)"/i)?.[1],
		html.match(/https?:\/\/[^"'\s]+\/games\/[^"'\s]+\/index\.html/i)?.[0],
		html.match(/https?:\/\/html5\.gamedistribution\.com\/[^"'\s]+/i)?.[0],
		html.match(/https?:\/\/[^"'\s]*addictinggames[^"'\s]+\/[^"'\s]+\.html/i)?.[0]
	].filter(Boolean);
	return candidates[0]?.replace(/\\u002F/g, '/').replace(/\\\//g, '/') || null;
}

async function importOne(entry, opts) {
	const html = await fetchText(entry.pageUrl, { referer: BASE });
	const data = extractNextData(html);
	const props = data?.props?.pageProps || {};
	const game = props.game || props.gameData || {};
	const name = game.title || game.name || entry.name;
	const description = game.description || entry.description || '';
	const thumb = game.thumbnailUrl || game.image || entry.thumbnailUrl;
	const embedUrl = game.gameUrl || game.embedUrl || game.iframeUrl || extractEmbed(html) || null;

	if (!embedUrl) return { id: entry.slug, error: 'no embed URL' };

	const quality = assessPortalTitleQuality({
		id: `addicting-${entry.slug}`,
		name,
		description
	});
	if (!quality.ok) return { id: entry.slug, skipped: true, reason: quality.reason };

	return writeOnlineShell(
		{
			id: `addicting-${entry.slug}`,
			name,
			embedUrl,
			author: 'Addicting Games',
			description,
			category: entry.category || 'arcade',
			thumbnailUrl: thumb,
			sourcePortal: 'addictinggames',
			extra: { addictingPageUrl: entry.pageUrl }
		},
		{
			skipExisting: opts.skipExisting,
			force: opts.force,
			referer: BASE,
			embedBase: BASE
		}
	);
}

async function main() {
	const opts = parseArgv();
	if (opts.help) {
		console.log(
			`Usage: node scripts/import-addictinggames-catalog.mjs [--limit N] [--skip-existing] [--discover-only]`
		);
		process.exit(0);
	}

	console.log('Discovering AddictingGames…');
	let catalog = await discover();
	console.log(`Found ${catalog.length} games.`);
	writeJson(MANIFEST_PATH, {
		fetchedAt: new Date().toISOString(),
		count: catalog.length,
		games: catalog
	});

	if (opts.discoverOnly) return;
	if (opts.limit > 0) catalog = catalog.slice(0, opts.limit);

	console.log(`Importing ${catalog.length} (concurrency ${opts.concurrency})…`);
	let ok = 0,
		skipped = 0,
		failed = 0;
	await runPool(catalog, opts.concurrency, async (g) => {
		try {
			const r = await importOne(g, opts);
			if (r.error) {
				failed++;
				console.warn(`  fail ${g.slug}: ${r.error}`);
			} else if (r.skipped) skipped++;
			else ok++;
		} catch (e) {
			failed++;
			console.warn(`  fail ${g.slug}: ${e.message || e}`);
		}
		await sleep(80);
		return null;
	});
	console.log(`Done. ok=${ok} skipped=${skipped} failed=${failed}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
