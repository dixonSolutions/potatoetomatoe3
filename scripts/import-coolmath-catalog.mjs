#!/usr/bin/env node
/**
 * Coolmath Games catalog import.
 * Discovers from https://www.coolmathgames.com/1-complete-game-list
 * Embeds public_games/ folders extracted from each game's /play page.
 *
 * Usage:
 *   node scripts/import-coolmath-catalog.mjs
 *   node scripts/import-coolmath-catalog.mjs --limit 20 --skip-existing
 */

import { writeFileSync } from 'fs';
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

const LIST_URL = 'https://www.coolmathgames.com/1-complete-game-list';
const MANIFEST_PATH = join(DATA_DIR, 'coolmath-catalog.json');

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

function extractGamePaths(html) {
	const paths = new Set();
	for (const m of html.matchAll(/href="(\/0-[a-z0-9-]+)"/gi)) {
		paths.add(m[1]);
	}
	return [...paths].sort();
}

function extractPublicGameUrl(html) {
	const m =
		html.match(/sites\/default\/files\/public_games\/(\d+)\/?/i) ||
		html.match(/"(?:u|url)"\s*:\s*"(sites\\\/default\\\/files\\\/public_games\\\/\d+\\?\/?)"/i);
	if (m) {
		const id = m[1].match(/\d+/)?.[0] || m[1];
		if (/^\d+$/.test(id)) {
			return `https://www.coolmathgames.com/sites/default/files/public_games/${id}/`;
		}
	}
	const abs = html.match(
		/https?:\/\/www\.coolmathgames\.com\/sites\/default\/files\/public_games\/\d+\/?/i
	);
	return abs ? abs[0] : null;
}

function extractMeta(html, path) {
	const title =
		html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1] ||
		html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1] ||
		path.replace(/^\/0-/, '').replace(/-/g, ' ');
	const description =
		html.match(/property="og:description"\s+content="([^"]+)"/i)?.[1] ||
		html.match(/name="description"\s+content="([^"]+)"/i)?.[1] ||
		'';
	const thumb =
		html.match(/property="og:image"\s+content="([^"]+)"/i)?.[1] ||
		html.match(/rel="image_src"\s+href="([^"]+)"/i)?.[1] ||
		null;
	return {
		title: title.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(),
		description: description.replace(/&amp;/g, '&').trim(),
		thumb
	};
}

async function discover() {
	const html = await fetchText(LIST_URL, { referer: 'https://www.coolmathgames.com/' });
	const paths = extractGamePaths(html);
	return paths.map((path) => ({
		path,
		pageUrl: `https://www.coolmathgames.com${path}`,
		playUrl: `https://www.coolmathgames.com${path}/play`,
		slug: slugify(path.replace(/^\/0-/, ''), 'coolmath')
	}));
}

async function importOne(entry, opts) {
	const pageHtml = await fetchText(entry.pageUrl, { referer: LIST_URL });
	const playHtml = await fetchText(entry.playUrl, { referer: entry.pageUrl }).catch(() => pageHtml);
	const embedUrl = extractPublicGameUrl(playHtml) || extractPublicGameUrl(pageHtml);
	if (!embedUrl) return { id: entry.slug, error: 'no public_games embed' };

	const meta = extractMeta(pageHtml, entry.path);
	const quality = assessPortalTitleQuality({
		id: `coolmath-${entry.slug}`,
		name: meta.title,
		description: meta.description
	});
	if (!quality.ok) return { id: entry.slug, skipped: true, reason: quality.reason };

	return writeOnlineShell(
		{
			id: `coolmath-${entry.slug}`,
			name: meta.title,
			embedUrl,
			author: 'Coolmath Games',
			description: meta.description,
			category: 'arcade',
			thumbnailUrl: meta.thumb,
			sourcePortal: 'coolmath',
			extra: { coolmathPath: entry.path, coolmathPageUrl: entry.pageUrl }
		},
		{
			skipExisting: opts.skipExisting,
			force: opts.force,
			referer: 'https://www.coolmathgames.com/'
		}
	);
}

async function main() {
	const opts = parseArgv();
	if (opts.help) {
		console.log(`Usage: node scripts/import-coolmath-catalog.mjs [--limit N] [--skip-existing] [--discover-only]`);
		process.exit(0);
	}

	console.log('Discovering Coolmath Games…');
	let catalog = await discover();
	console.log(`Found ${catalog.length} game paths.`);
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
		await sleep(80);
		return null;
	});
	console.log(`Done. ok=${ok} skipped=${skipped} failed=${failed}`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
