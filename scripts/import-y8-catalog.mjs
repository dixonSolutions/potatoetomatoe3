#!/usr/bin/env node
/**
 * Y8 catalog import — discovers games from https://www.y8.com/feed (RSS) and category feeds,
 * loads each game page, extracts the WebGL/HTML5 embed URL (storage.y8.com / storage-direct.y8.com),
 * detects Unity builds, and writes static/games/<slug>/online/ shells.
 *
 * Replaces Poki as the primary portal source for new catalog entries.
 *
 * Usage:
 *   node scripts/import-y8-catalog.mjs
 *   node scripts/import-y8-catalog.mjs --limit 50
 *   node scripts/import-y8-catalog.mjs --skip-existing
 *   node scripts/import-y8-catalog.mjs --discover-only
 *   node scripts/import-y8-catalog.mjs --concurrency 4
 */

import { mkdirSync, writeFileSync, existsSync, createWriteStream } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = join(__dirname, '../static/games');
const DATA_DIR = join(__dirname, 'data');
const MANIFEST_PATH = join(DATA_DIR, 'y8-catalog.json');

const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const FEED_URLS = [
	'https://www.y8.com/feed',
	'https://www.y8.com/categories/action/feed',
	'https://www.y8.com/categories/sports/feed',
	'https://www.y8.com/categories/puzzle/feed',
	'https://www.y8.com/categories/racing/feed'
];

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

function parseArgv() {
	const a = process.argv.slice(2);
	const limitIdx = a.indexOf('--limit');
	const concIdx = a.indexOf('--concurrency');
	return {
		limit: limitIdx >= 0 && a[limitIdx + 1] ? parseInt(a[limitIdx + 1], 10) : 0,
		concurrency: Math.max(1, concIdx >= 0 && a[concIdx + 1] ? parseInt(a[concIdx + 1], 10) : 4),
		skipExisting: a.includes('--skip-existing'),
		discoverOnly: a.includes('--discover-only'),
		help: a.includes('--help') || a.includes('-h')
	};
}

function slugFromLink(link) {
	try {
		const p = new URL(link).pathname.split('/').filter(Boolean);
		const gamesIdx = p.indexOf('games');
		if (gamesIdx >= 0 && p[gamesIdx + 1]) return p[gamesIdx + 1].toLowerCase();
		return p[p.length - 1]?.toLowerCase() ?? null;
	} catch {
		return null;
	}
}

/** Parse RSS/Atom items from feed XML. */
function parseFeedItems(xml) {
	const items = [];
	const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
	let m;
	while ((m = itemRegex.exec(xml)) !== null) {
		const block = m[1];
		const title = block.match(/<title(?:\s[^>]*)?>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]?.trim();
		const link =
			block.match(/<link(?:\s[^>]*)?>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i)?.[1]?.trim() ||
			block.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1];
		const desc = block.match(/<description(?:\s[^>]*)?>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1];
		const category = block.match(/<category(?:\s[^>]*)?>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/category>/i)?.[1]?.trim();
		if (link) {
			items.push({
				title: title?.replace(/<[^>]+>/g, '') ?? '',
				link: link.replace(/&amp;/g, '&'),
				description: desc?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? '',
				category: category?.toLowerCase().replace(/\s+/g, '-') ?? 'arcade'
			});
		}
	}
	return items;
}

async function fetchText(url, retries = 3) {
	for (let i = 0; i < retries; i++) {
		try {
			const res = await fetch(url, {
				headers: {
					'User-Agent': UA,
					Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					'Accept-Language': 'en-US,en;q=0.9'
				},
				signal: AbortSignal.timeout(45000)
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return res.text();
		} catch (e) {
			if (i === retries - 1) throw e;
			await sleep(800 * (i + 1));
		}
	}
	throw new Error('unreachable');
}

function extractEmbedUrl(html) {
	const iframeMatch = html.match(
		/<iframe[^>]+src=["'](https?:\/\/storage(?:-direct)?\.y8\.com[^"']+)["']/i
	);
	if (iframeMatch?.[1]) return iframeMatch[1].replace(/&amp;/g, '&');

	const scriptUrl =
		html.match(/["'](https?:\/\/storage(?:-direct)?\.y8\.com[^"']+\/index\.html[^"']*)["']/i)?.[1] ||
		html.match(/game[_-]?url\s*[:=]\s*["'](https?:\/\/[^"']+)["']/i)?.[1] ||
		html.match(/"embed_url"\s*:\s*"([^"]+)"/i)?.[1];
	if (scriptUrl) return scriptUrl.replace(/&amp;/g, '&').replace(/\\\//g, '/');

	const storage = html.match(/https?:\/\/storage(?:-direct)?\.y8\.com\/[^\s"'<>]+/i)?.[0];
	if (storage && !storage.includes('/images/')) return storage.replace(/&amp;/g, '&');

	return null;
}

function detectUnity(html) {
	return /UnityLoader|createUnityInstance|Build\/.*\.(json|loader\.js)|\.wasm|unity-webgl/i.test(html);
}

function extractOgImage(html) {
	const m = html.match(/property="og:image"\s+content="([^"]+)"/i);
	return m ? m[1] : null;
}

async function downloadToFile(url, destPath) {
	const res = await fetch(url, {
		headers: { 'User-Agent': UA, Accept: 'image/*', Referer: 'https://www.y8.com/' },
		signal: AbortSignal.timeout(30000)
	});
	if (!res.ok) throw new Error(`HTTP ${res.status} image`);
	const body = res.body;
	if (!body) throw new Error('No response body');
	await pipeline(Readable.fromWeb(body), createWriteStream(destPath));
}

function createOnlineIndexHtml(embedUrl, title) {
	const safeTitle = String(title || 'Game')
		.replace(/</g, '')
		.replace(/>/g, '')
		.slice(0, 120);
	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeTitle}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; overflow: hidden; }
        .game-iframe { width: 100%; height: 100%; border: none; display: block; }
    </style>
</head>
<body>
    <iframe class="game-iframe" id="game-area" src="${embedUrl}" scrolling="none" allowfullscreen></iframe>
</body>
</html>
`;
}

async function discoverAllGames() {
	const bySlug = new Map();

	for (const feedUrl of FEED_URLS) {
		try {
			const xml = await fetchText(feedUrl);
			const items = parseFeedItems(xml);
			for (const item of items) {
				const slug = slugFromLink(item.link);
				if (!slug || slug.length < 2) continue;
				if (!bySlug.has(slug)) {
					bySlug.set(slug, { slug, ...item });
				}
			}
			process.stdout.write(`\r   Feed ${feedUrl.split('/').pop()} → ${bySlug.size} unique games   `);
			await sleep(200);
		} catch (e) {
			console.warn(`\n   ⚠️  Feed failed ${feedUrl}: ${e.message || e}`);
		}
	}
	console.log('');
	return [...bySlug.values()];
}

async function importOne(entry, opts) {
	const slug = entry.slug;
	const gameId = slug.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
	const onlineDir = join(GAMES_ROOT, gameId, 'online');
	const assetsDir = join(onlineDir, 'assets');
	const metaPath = join(onlineDir, 'metadata.json');

	if (opts.skipExisting && existsSync(metaPath)) {
		return { slug, skipped: true };
	}

	const pageHtml = await fetchText(entry.link);
	let embedUrl = extractEmbedUrl(pageHtml);

	if (embedUrl && /\.html?(\?|$)/i.test(embedUrl)) {
		try {
			const embedHtml = await fetchText(embedUrl);
			const inner = extractEmbedUrl(embedHtml);
			if (inner && inner !== embedUrl) embedUrl = inner;
		} catch {
			/* keep outer embed */
		}
	}

	if (!embedUrl) {
		return { slug, error: 'no embed URL (storage.y8.com) found on game page' };
	}

	const title = entry.title || slug;
	const description =
		entry.description?.slice(0, 2000) || `Play ${title} on Potato Tomato (mirrored from Y8).`;
	const category = entry.category || 'arcade';
	const unity = detectUnity(pageHtml);

	mkdirSync(assetsDir, { recursive: true });
	mkdirSync(join(GAMES_ROOT, gameId, 'shared'), { recursive: true });

	const thumbName = `${gameId.replace(/[^a-z0-9-]/gi, '-')}.png`;
	const thumbRel = `/games/${gameId}/online/assets/${thumbName}`;
	const og = extractOgImage(pageHtml);
	if (og) {
		try {
			await downloadToFile(og, join(assetsDir, thumbName));
		} catch {
			/* sync-game-thumbnails.mjs can fill later */
		}
	}
	if (!existsSync(join(assetsDir, thumbName))) {
		writeFileSync(join(assetsDir, '.gitkeep'), '');
	}

	const metadata = {
		id: gameId,
		name: title,
		author: 'Y8',
		description,
		thumbnail: thumbRel,
		category,
		...(unity
			? {
					engine: 'unity',
					onlineEmbedUrl: embedUrl,
					pullStrategy: 'generic',
					sourcePortal: 'y8'
				}
			: { sourcePortal: 'y8' })
	};

	writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');
	writeFileSync(join(onlineDir, 'index.html'), createOnlineIndexHtml(embedUrl, title), 'utf-8');

	return { slug, ok: true, embedUrl, unity };
}

async function runPool(items, concurrency, fn) {
	const ret = new Array(items.length);
	let ix = 0;
	async function worker() {
		while (true) {
			const j = ix++;
			if (j >= items.length) return;
			ret[j] = await fn(items[j], j);
		}
	}
	await Promise.all(Array.from({ length: concurrency }, () => worker()));
	return ret;
}

async function main() {
	const opts = parseArgv();
	if (opts.help) {
		console.log(`Usage:
  node scripts/import-y8-catalog.mjs [options]

Options:
  --discover-only     Fetch catalog manifest only (writes scripts/data/y8-catalog.json)
  --skip-existing     Skip games that already have online/metadata.json
  --limit N           Process only first N games after discovery
  --concurrency N     Parallel game-page fetches (default 4)
`);
		process.exit(0);
	}

	mkdirSync(DATA_DIR, { recursive: true });

	console.log('Discovering games from Y8 RSS feeds…');
	const catalog = await discoverAllGames();
	console.log(`Found ${catalog.length} unique games.`);

	writeFileSync(
		MANIFEST_PATH,
		`${JSON.stringify({ fetchedAt: new Date().toISOString(), count: catalog.length, games: catalog }, null, 2)}\n`,
		'utf-8'
	);
	console.log(`Wrote ${MANIFEST_PATH}`);

	if (opts.discoverOnly) {
		console.log('Done (--discover-only).');
		return;
	}

	let todo = catalog;
	if (opts.limit > 0) {
		todo = catalog.slice(0, opts.limit);
		console.log(`Applying --limit ${opts.limit} → ${todo.length} games.`);
	}

	console.log(`Importing ${todo.length} games (concurrency ${opts.concurrency})…`);

	let ok = 0;
	let skipped = 0;
	let failed = 0;
	let unityCount = 0;

	const results = await runPool(todo, opts.concurrency, async (g) => {
		const slug = g.slug;
		try {
			const r = await importOne(g, opts);
			if (r.skipped) {
				skipped++;
				return r;
			}
			if (r.error) {
				failed++;
				console.error(`❌ ${slug}: ${r.error}`);
				return r;
			}
			ok++;
			if (r.unity) unityCount++;
			if (ok % 25 === 0) console.log(`   … ${ok} imported (${unityCount} Unity)`);
			return r;
		} catch (e) {
			failed++;
			console.error(`❌ ${slug}:`, e.message || e);
			return { slug, error: String(e.message || e) };
		}
	});

	console.log('\nSummary:');
	console.log(`   OK: ${ok} (${unityCount} Unity WebGL)`);
	console.log(`   Skipped (--skip-existing): ${skipped}`);
	console.log(`   Failed: ${failed}`);

	const errPath = join(DATA_DIR, 'y8-import-errors.json');
	const errs = results.filter((r) => r && r.error);
	if (errs.length) {
		writeFileSync(errPath, `${JSON.stringify(errs, null, 2)}\n`, 'utf-8');
		console.log(`   Errors logged to ${errPath}`);
	}

	console.log('\nNext: node scripts/generate-games-list.js');
	console.log('Then:  pnpm puller:start   # Unity games get splash-stripped offline mirrors');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
