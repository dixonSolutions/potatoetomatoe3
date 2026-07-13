#!/usr/bin/env node
/**
 * CrazyGames catalog import.
 * Discovers from sitemap XML + nested HTML game sitemaps.
 * Embeds https://games.crazygames.com/en_US/<slug>/index.html
 *
 * Usage:
 *   node scripts/import-crazygames-catalog.mjs
 *   node scripts/import-crazygames-catalog.mjs --limit 50 --skip-existing
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

const MANIFEST_PATH = join(DATA_DIR, 'crazygames-catalog.json');
const SITEMAP = 'https://www.crazygames.com/sitemap';

function parseArgv() {
	const a = process.argv.slice(2);
	const num = (flag, fallback) => {
		const i = a.indexOf(flag);
		return i >= 0 && a[i + 1] ? parseInt(a[i + 1], 10) : fallback;
	};
	return {
		limit: num('--limit', 0),
		concurrency: Math.max(1, num('--concurrency', 5)),
		skipExisting: a.includes('--skip-existing'),
		discoverOnly: a.includes('--discover-only'),
		force: a.includes('--force'),
		help: a.includes('--help') || a.includes('-h')
	};
}

function collectGameUrls(text) {
	const urls = new Set();
	for (const m of text.matchAll(/https:\/\/www\.crazygames\.com\/game\/([a-z0-9-]+)/gi)) {
		urls.add(`https://www.crazygames.com/game/${m[1].toLowerCase()}`);
	}
	for (const m of text.matchAll(/href="(\/game\/[a-z0-9-]+)"/gi)) {
		urls.add(`https://www.crazygames.com${m[1].toLowerCase()}`);
	}
	return urls;
}

async function discover() {
	const bySlug = new Map();
	const main = await fetchText(SITEMAP, {
		accept: 'application/xml,text/xml,*/*',
		referer: 'https://www.crazygames.com/'
	});
	for (const url of collectGameUrls(main)) {
		const slug = slugify(url.split('/game/')[1], 'crazy');
		bySlug.set(slug, { slug, pageUrl: url });
	}

	const nested = [...main.matchAll(/<loc>(https:\/\/www\.crazygames\.com\/sitemap\/games[^<]*)<\/loc>/gi)].map(
		(m) => m[1]
	);
	console.log(`  Main sitemap games: ${bySlug.size}; nested pages: ${nested.length}`);

	for (const smUrl of nested) {
		try {
			const html = await fetchText(smUrl, { referer: SITEMAP });
			for (const url of collectGameUrls(html)) {
				const slug = slugify(url.split('/game/')[1], 'crazy');
				if (!bySlug.has(slug)) bySlug.set(slug, { slug, pageUrl: url });
			}
			process.stdout.write(`\r  Discovery unique: ${bySlug.size}   `);
			await sleep(120);
		} catch (e) {
			console.warn(`\n  nested fail ${smUrl}: ${e.message || e}`);
		}
	}
	console.log('');
	return [...bySlug.values()];
}

function extractFromGamePage(html, slug) {
	const embed =
		html.match(/https:\/\/games\.crazygames\.com\/en_US\/[a-z0-9-]+\/index\.html/i)?.[0] ||
		`https://games.crazygames.com/en_US/${slug}/index.html`;
	const title =
		html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1] ||
		html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1] ||
		slug.replace(/-/g, ' ');
	const description =
		html.match(/property="og:description"\s+content="([^"]+)"/i)?.[1] ||
		html.match(/name="description"\s+content="([^"]+)"/i)?.[1] ||
		'';
	const thumb = html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1] || null;
	return {
		embedUrl: embed,
		title: title.replace(/&amp;/g, '&').trim(),
		description: description.replace(/&amp;/g, '&').trim(),
		thumb
	};
}

async function importOne(entry, opts) {
	let meta = {
		embedUrl: `https://games.crazygames.com/en_US/${entry.slug}/index.html`,
		title: entry.slug.replace(/-/g, ' '),
		description: '',
		thumb: null
	};
	try {
		const html = await fetchText(entry.pageUrl, { referer: 'https://www.crazygames.com/' });
		meta = extractFromGamePage(html, entry.slug);
	} catch {
		/* use constructed embed */
	}

	const quality = assessPortalTitleQuality({
		id: `crazygames-${entry.slug}`,
		name: meta.title,
		description: meta.description
	});
	if (!quality.ok) return { id: entry.slug, skipped: true, reason: quality.reason };

	return writeOnlineShell(
		{
			id: `crazygames-${entry.slug}`,
			name: meta.title,
			embedUrl: meta.embedUrl,
			author: 'CrazyGames',
			description: meta.description,
			category: 'arcade',
			thumbnailUrl: meta.thumb,
			sourcePortal: 'crazygames',
			extra: { crazygamesPageUrl: entry.pageUrl, crazygamesSlug: entry.slug }
		},
		{
			skipExisting: opts.skipExisting,
			force: opts.force,
			referer: 'https://www.crazygames.com/'
		}
	);
}

async function main() {
	const opts = parseArgv();
	if (opts.help) {
		console.log(`Usage: node scripts/import-crazygames-catalog.mjs [--limit N] [--skip-existing] [--discover-only]`);
		process.exit(0);
	}

	console.log('Discovering CrazyGames…');
	let catalog = await discover();
	console.log(`Found ${catalog.length} games.`);
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
				console.warn(`  fail ${g.slug}: ${r.error}`);
			} else if (r.skipped) skipped++;
			else ok++;
		} catch (e) {
			failed++;
			console.warn(`  fail ${g.slug}: ${e.message || e}`);
		}
		await sleep(60);
		return null;
	});
	console.log(`Done. ok=${ok} skipped=${skipped} failed=${failed}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
