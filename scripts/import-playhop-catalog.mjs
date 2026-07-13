#!/usr/bin/env node
/**
 * Playhop (Yandex Games) catalog import.
 * Discovers via catalogue search digraphs + feed, extracts iframe embed from app pages.
 *
 * Usage:
 *   node scripts/import-playhop-catalog.mjs
 *   node scripts/import-playhop-catalog.mjs --limit 50 --skip-existing
 */

import { join } from 'path';
import {
	DATA_DIR,
	fetchJson,
	fetchText,
	fetchTextCurl,
	runPool,
	sleep,
	writeJson,
	writeOnlineShell
} from './lib/game-shell.mjs';
import { assessPortalTitleQuality, slugify } from './lib/catalog-quality.mjs';

const MANIFEST_PATH = join(DATA_DIR, 'playhop-catalog.json');
const SEARCH = 'https://yandex.com/games/api/catalogue/v2/search';
const FEED = 'https://yandex.com/games/api/catalogue/v2/feed?lang=en';

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

function itemsFromSearch(data) {
	const items = [];
	for (const f of data.feed || []) {
		items.push(...(f.items || []));
	}
	return items;
}

function gamesFromFeed(data) {
	const out = [];
	for (const f of data.feed || []) {
		for (const w of f.widgets || []) {
			if (w?.type === 'game' && w.data) out.push(w.data);
		}
	}
	return out;
}

function mapItem(it) {
	const appID = it.appID || it.appId;
	if (!appID) return null;
	const title = it.title || `Playhop ${appID}`;
	const icon = it.media?.icon?.['prefix-url'] || it.media?.cover?.['prefix-url'];
	const thumb = icon ? `${icon}orig` : null;
	return {
		appID,
		title,
		slug: slugify(it.appSlug || title, `playhop-${appID}`),
		rating: it.rating,
		ratingCount: it.ratingCount,
		developer: it.developer?.name || 'Playhop',
		thumbnailUrl: thumb,
		pageUrl: `https://playhop.com/app/${appID}`
	};
}

async function discover() {
	const byId = new Map();

	try {
		const feed = await fetchJson(FEED, { referer: 'https://playhop.com/' });
		for (const g of gamesFromFeed(feed)) {
			const m = mapItem(g);
			if (m) byId.set(m.appID, m);
		}
	} catch (e) {
		console.warn(`  feed fail: ${e.message || e}`);
	}

	const letters = 'abcdefghijklmnopqrstuvwxyz0123456789';
	const queries = [];
	for (const a of letters) {
		for (const b of letters) queries.push(a + b);
	}
	for (const q of [
		'shrek',
		'escape',
		'super',
		'game',
		'play',
		'race',
		'run',
		'war',
		'io',
		'puzzle',
		'car',
		'soccer',
		'craft',
		'school',
		'horror',
		'survival'
	]) {
		queries.push(q);
	}

	let i = 0;
	for (const q of queries) {
		i++;
		try {
			const data = await fetchJson(`${SEARCH}?query=${encodeURIComponent(q)}&lang=en`, {
				referer: 'https://playhop.com/'
			});
			for (const it of itemsFromSearch(data)) {
				const m = mapItem(it);
				if (m) byId.set(m.appID, m);
			}
		} catch {
			/* single-letter / rate-limit — ignore */
		}
		if (i % 40 === 0) {
			process.stdout.write(`\r  Discovery queries ${i}/${queries.length}, unique ${byId.size}   `);
			await sleep(200);
		} else {
			await sleep(80);
		}
	}
	console.log(`\n  Playhop unique apps: ${byId.size}`);
	return [...byId.values()];
}

function extractPlayhopEmbed(html) {
	const iframe = html.match(
		/<iframe[^>]+src=["'](https:\/\/app-\d+\.games\.s3\.yandex\.net[^"']+)["']/i
	)?.[1];
	if (iframe) return iframe.replace(/&amp;/g, '&');
	const any = html.match(/https:\/\/app-\d+\.games\.s3\.yandex\.net\/[^"'\s]+/i)?.[0];
	return any ? any.replace(/&amp;/g, '&') : null;
}

async function importOne(entry, opts) {
	const quality = assessPortalTitleQuality({
		id: `playhop-${entry.appID}`,
		name: entry.title,
		description: ''
	});
	if (!quality.ok) return { id: String(entry.appID), skipped: true, reason: quality.reason };

	let embedUrl = null;
	try {
		const html = await fetchTextCurl(entry.pageUrl, { referer: 'https://playhop.com/' });
		embedUrl = extractPlayhopEmbed(html);
	} catch (e) {
		return { id: String(entry.appID), error: e.message || String(e) };
	}
	if (!embedUrl) {
		// Fall back to playhop app page itself (may still iframe).
		embedUrl = entry.pageUrl;
	}

	return writeOnlineShell(
		{
			id: `playhop-${entry.slug}`,
			name: entry.title,
			embedUrl,
			author: entry.developer || 'Playhop',
			description: `Play ${entry.title} via Playhop / Yandex Games.`,
			category: 'arcade',
			thumbnailUrl: entry.thumbnailUrl,
			sourcePortal: 'playhop',
			extra: {
				playhopAppId: entry.appID,
				playhopPageUrl: entry.pageUrl,
				playhopRating: entry.rating,
				playhopRatingCount: entry.ratingCount
			}
		},
		{
			skipExisting: opts.skipExisting,
			force: opts.force,
			referer: 'https://playhop.com/'
		}
	);
}

async function main() {
	const opts = parseArgv();
	if (opts.help) {
		console.log(`Usage: node scripts/import-playhop-catalog.mjs [--limit N] [--skip-existing] [--discover-only]`);
		process.exit(0);
	}

	console.log('Discovering Playhop / Yandex Games…');
	let catalog = await discover();
	// Prefer higher-rated when limiting
	catalog.sort((a, b) => (b.ratingCount || 0) - (a.ratingCount || 0));
	console.log(`Found ${catalog.length} apps.`);
	writeJson(MANIFEST_PATH, { fetchedAt: new Date().toISOString(), count: catalog.length, games: catalog });

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
				console.warn(`  fail ${g.appID}: ${r.error}`);
			} else if (r.skipped) skipped++;
			else ok++;
		} catch (e) {
			failed++;
			console.warn(`  fail ${g.appID}: ${e.message || e}`);
		}
		await sleep(100);
		return null;
	});
	console.log(`Done. ok=${ok} skipped=${skipped} failed=${failed}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
