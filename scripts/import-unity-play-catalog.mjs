#!/usr/bin/env node
/**
 * Unity Play catalog import — discovers `unity-web` games from play.unity.com APIs,
 * writes static/games/<slug>/online/ shells with engine: "unity" and onlineEmbedUrl
 * pointing at the official build frame (Share → Embed equivalent).
 *
 * Online play uses /unity/player.html and, when available, the puller
 * /api/unity-play/:id proxy (same pattern as Y8 Unity titles).
 *
 * Usage:
 *   node scripts/import-unity-play-catalog.mjs
 *   node scripts/import-unity-play-catalog.mjs --limit 20
 *   node scripts/import-unity-play-catalog.mjs --skip-existing
 *   node scripts/import-unity-play-catalog.mjs --discover-only
 *   node scripts/import-unity-play-catalog.mjs --concurrency 6
 *   node scripts/import-unity-play-catalog.mjs --max-pages 50
 *   node scripts/import-unity-play-catalog.mjs --force
 */

import {
	mkdirSync,
	writeFileSync,
	existsSync,
	createWriteStream,
	readdirSync,
	readFileSync
} from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = join(__dirname, '../static/games');
const DATA_DIR = join(__dirname, 'data');
const MANIFEST_PATH = join(DATA_DIR, 'unity-play-catalog.json');

const API_BASE = 'https://play.unity.com/api/v1';
const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const DEFAULT_CATEGORY = 'arcade';

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

function parseArgv() {
	const a = process.argv.slice(2);
	const num = (flag, fallback) => {
		const i = a.indexOf(flag);
		return i >= 0 && a[i + 1] ? parseInt(a[i + 1], 10) : fallback;
	};
	return {
		limit: num('--limit', 0),
		concurrency: Math.max(1, num('--concurrency', 6)),
		maxPages: num('--max-pages', 0),
		skipExisting: a.includes('--skip-existing'),
		discoverOnly: a.includes('--discover-only'),
		force: a.includes('--force'),
		help: a.includes('--help') || a.includes('-h')
	};
}

function sleepJitter() {
	return sleep(80 + Math.floor(Math.random() * 120));
}

async function fetchJson(url, retries = 4) {
	for (let i = 0; i < retries; i++) {
		try {
			const res = await fetch(url, {
				headers: {
					'User-Agent': UA,
					Accept: 'application/json',
					'Accept-Language': 'en-US,en;q=0.9'
				},
				signal: AbortSignal.timeout(45000)
			});
			if (res.status === 429 || res.status >= 500) {
				throw new Error(`HTTP ${res.status}`);
			}
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return res.json();
		} catch (e) {
			if (i === retries - 1) throw e;
			await sleep(600 * (i + 1));
		}
	}
	throw new Error('unreachable');
}

async function downloadToFile(url, destPath) {
	const res = await fetch(url, {
		headers: { 'User-Agent': UA, Accept: 'image/*', Referer: 'https://play.unity.com/' },
		signal: AbortSignal.timeout(30000)
	});
	if (!res.ok) throw new Error(`HTTP ${res.status} image`);
	const body = res.body;
	if (!body) throw new Error('No response body');
	await pipeline(Readable.fromWeb(body), createWriteStream(destPath));
}

function normalizeSlug(slug, fallbackId) {
	const raw = (slug || fallbackId || '').toString().toLowerCase();
	const cleaned = raw
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
	return cleaned || `unity-${String(fallbackId).slice(0, 8)}`;
}

/** Block Unity Play SEO spam / adult listings that slip into public discovery. */
const ADULT_OR_SPAM_RE =
	/\b(xnxx|xvideos|pornhub|onlyfans|xxx[-_]?porn|porn[-_]?xxx|xxx[-_]?sex|sex[-_]?video|nsfw|hentai[-_]?porn)\b/i;

function isBlockedCatalogEntry(slug, name = '', description = '') {
	const haystack = `${slug}\n${name}\n${description}`;
	return ADULT_OR_SPAM_RE.test(haystack);
}

function normalizeTitleKey(name) {
	return String(name || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}

function frameEmbedUrl(gameUuid) {
	return `${API_BASE}/games/game/${gameUuid}/build/latest/frame`;
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
    <iframe class="game-iframe" id="game-area" src="${embedUrl}" scrolling="none" allowfullscreen allow="autoplay; fullscreen; gamepad; vr"></iframe>
</body>
</html>
`;
}

function mapGame(raw, categoryHint) {
	if (!raw?.id) return null;
	if (raw.type && raw.type !== 'unity-web') return null;
	if (raw.visibility && raw.visibility !== 'public') return null;
	if (raw.hasPassword) return null;
	const slug = normalizeSlug(raw.slug || raw.legacySlug, raw.id);
	const name = (raw.name || slug).trim();
	const description = String(raw.description || '').trim();
	if (isBlockedCatalogEntry(slug, name, description)) return null;
	const embedUrl = frameEmbedUrl(raw.id);
	return {
		id: raw.id,
		slug,
		name,
		description,
		authorUsername: raw.authorUsername || null,
		thumbnailUrl: raw.thumbnailUrl || null,
		gameUrl: raw.gameUrl || `https://play.unity.com/en/games/${raw.id}/${slug}`,
		latestBuildUrl: raw.latestBuildUrl || embedUrl,
		embedUrl,
		plays: raw.plays ?? 0,
		views: raw.views ?? 0,
		likes: raw.likes ?? 0,
		category: categoryHint || DEFAULT_CATEGORY,
		titleKey: normalizeTitleKey(raw.name)
	};
}

/** Index existing catalog for dedupe (embed URL + skip non-Poki without --force). */
function buildExistingIndex() {
	const byEmbed = new Map();
	const byGameId = new Map();
	const metaByDir = new Map();

	if (!existsSync(GAMES_ROOT)) return { byEmbed, byGameId, metaByDir };

	for (const dirent of readdirSync(GAMES_ROOT, { withFileTypes: true })) {
		if (!dirent.isDirectory() || dirent.name.startsWith('_')) continue;
		const metaPath = join(GAMES_ROOT, dirent.name, 'online', 'metadata.json');
		if (!existsSync(metaPath)) continue;
		try {
			const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
			metaByDir.set(dirent.name, meta);
			const embed = typeof meta.onlineEmbedUrl === 'string' ? meta.onlineEmbedUrl.trim() : '';
			if (embed) byEmbed.set(embed, dirent.name);
			if (meta.unityPlayGameId) byGameId.set(meta.unityPlayGameId, dirent.name);
			const m = embed.match(/\/games\/game\/([0-9a-f-]{36})\//i);
			if (m?.[1]) byGameId.set(m[1].toLowerCase(), dirent.name);
		} catch {
			/* ignore bad metadata */
		}
	}
	return { byEmbed, byGameId, metaByDir };
}

function isPokiMeta(meta) {
	if (!meta) return false;
	if (String(meta.author || '').toLowerCase() === 'poki') return true;
	if (String(meta.sourcePortal || '').toLowerCase() === 'poki') return true;
	const embed = String(meta.onlineEmbedUrl || '');
	return /games\.poki\.com|poki\.com\//i.test(embed);
}

async function discoverFromCategories(byId, maxPages) {
	const rows = await fetchJson(`${API_BASE}/games/list/by-category`);
	if (!Array.isArray(rows)) return;

	for (const row of rows) {
		const cat = row?.category;
		const slug = cat?.slug || DEFAULT_CATEGORY;
		const categoryId = cat?.id;
		const inline = row?.games || [];
		for (const g of inline) {
			const mapped = mapGame(g, slug);
			if (mapped && !byId.has(mapped.id)) byId.set(mapped.id, mapped);
		}
		if (!categoryId) continue;

		let skip = 0;
		const limit = 50;
		let pages = 0;
		while (true) {
			if (maxPages > 0 && pages >= maxPages) break;
			const data = await fetchJson(
				`${API_BASE}/games/list/by-category/${encodeURIComponent(categoryId)}?skip=${skip}&limit=${limit}`
			);
			const results = data?.results || [];
			if (!results.length) break;
			for (const g of results) {
				const mapped = mapGame(g, slug);
				if (mapped && !byId.has(mapped.id)) byId.set(mapped.id, mapped);
			}
			pages++;
			skip += results.length;
			const total = typeof data.total === 'number' ? data.total : null;
			process.stdout.write(
				`\r   Category ${slug}: ${byId.size} unique (skip=${skip}${total != null ? `/${total}` : ''})   `
			);
			if (total != null && skip >= total) break;
			if (results.length < limit) break;
			await sleepJitter();
		}
	}
	console.log('');
}

async function discoverUnityWebByQuery(byId, maxPages) {
	let token = null;
	let pages = 0;
	while (true) {
		if (maxPages > 0 && pages >= maxPages) break;
		const qs = new URLSearchParams({ query: '', type: 'unity-web' });
		if (token) qs.set('nextToken', token);
		const data = await fetchJson(`${API_BASE}/games/list/by-query?${qs}`);
		const results = data?.results || [];
		if (!results.length) break;
		for (const g of results) {
			const mapped = mapGame(g, DEFAULT_CATEGORY);
			if (!mapped) continue;
			if (byId.has(mapped.id)) {
				/* keep richer category hint if we already have one */
				continue;
			}
			byId.set(mapped.id, mapped);
		}
		pages++;
		token = data?.nextPageToken || null;
		process.stdout.write(`\r   by-query unity-web: page ${pages}, unique ${byId.size}   `);
		if (!token) break;
		await sleepJitter();
	}
	console.log('');
}

async function discoverPopularAndRecent(byId, maxPages) {
	for (const kind of ['by-popular', 'by-recent']) {
		let skip = 0;
		const limit = 50;
		let pages = 0;
		while (true) {
			if (maxPages > 0 && pages >= maxPages) break;
			const data = await fetchJson(
				`${API_BASE}/games/list/${kind}?skip=${skip}&limit=${limit}`
			);
			const results = data?.results || [];
			if (!results.length) break;
			for (const g of results) {
				const mapped = mapGame(g, DEFAULT_CATEGORY);
				if (mapped && !byId.has(mapped.id)) byId.set(mapped.id, mapped);
			}
			pages++;
			skip += results.length;
			process.stdout.write(`\r   ${kind}: page ${pages}, unique ${byId.size}   `);
			const total = typeof data.total === 'number' ? data.total : null;
			if (total != null && skip >= total) break;
			if (results.length < limit) break;
			/* Popular/recent are mostly Struckd — stop early if density is poor */
			const uw = results.filter((g) => g?.type === 'unity-web').length;
			if (uw === 0 && pages >= 3) break;
			await sleepJitter();
		}
		console.log('');
	}
}

async function discoverAllGames(opts) {
	const byId = new Map();
	const maxPages = opts.maxPages;

	console.log('Discovering Unity Play category shelves…');
	await discoverFromCategories(byId, maxPages || 20);

	console.log('Discovering unity-web via by-query…');
	await discoverUnityWebByQuery(byId, maxPages);

	console.log('Supplementing from popular/recent…');
	await discoverPopularAndRecent(byId, maxPages || 10);

	return [...byId.values()].sort((a, b) => (b.plays || 0) - (a.plays || 0));
}

async function importOne(entry, opts, index) {
	const gameId = entry.slug;
	const onlineDir = join(GAMES_ROOT, gameId, 'online');
	const assetsDir = join(onlineDir, 'assets');
	const metaPath = join(onlineDir, 'metadata.json');
	const embedUrl = entry.embedUrl;

	const existingByUuid = index.byGameId.get(String(entry.id).toLowerCase());
	if (existingByUuid && existingByUuid !== gameId) {
		return {
			slug: gameId,
			skipped: true,
			reason: `canonical embed already mapped to ${existingByUuid}`
		};
	}

	const existingByEmbed = index.byEmbed.get(embedUrl);
	if (existingByEmbed && existingByEmbed !== gameId) {
		return {
			slug: gameId,
			skipped: true,
			reason: `embed URL already mapped to ${existingByEmbed}`
		};
	}

	if (existsSync(metaPath)) {
		const existing = index.metaByDir.get(gameId);
		if (opts.skipExisting) {
			return { slug: gameId, skipped: true, reason: 'skip-existing' };
		}
		if (!opts.force && existing && !isPokiMeta(existing)) {
			return {
				slug: gameId,
				skipped: true,
				reason: 'existing non-Poki catalog entry (pass --force to overwrite)'
			};
		}
	}

	mkdirSync(assetsDir, { recursive: true });
	mkdirSync(join(GAMES_ROOT, gameId, 'shared'), { recursive: true });
	// Keep assets/ for optional local mirrors; prefer remote Unity CDN thumbs to avoid multi-GB git trees.
	if (!existsSync(join(assetsDir, '.gitkeep'))) {
		writeFileSync(join(assetsDir, '.gitkeep'), '');
	}

	const author =
		entry.authorUsername && entry.authorUsername !== 'Unknown'
			? entry.authorUsername
			: 'Unity Play';

	const description =
		entry.description?.slice(0, 2000) ||
		`Play ${entry.name} on Potato Tomato (mirrored from Unity Play).`;

	const thumbnail =
		entry.thumbnailUrl ||
		`/games/${gameId}/online/assets/${gameId.replace(/[^a-z0-9-]/gi, '-')}.png`;

	const metadata = {
		id: gameId,
		name: entry.name,
		author,
		description,
		thumbnail,
		category: entry.category || DEFAULT_CATEGORY,
		engine: 'unity',
		onlineEmbedUrl: embedUrl,
		pullStrategy: 'generic',
		sourcePortal: 'unity-play',
		unityPlayGameId: entry.id,
		unityPlayUrl: entry.gameUrl
	};

	writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');
	writeFileSync(join(onlineDir, 'index.html'), createOnlineIndexHtml(embedUrl, entry.name), 'utf-8');

	index.byEmbed.set(embedUrl, gameId);
	index.byGameId.set(String(entry.id).toLowerCase(), gameId);
	index.metaByDir.set(gameId, metadata);

	return { slug: gameId, ok: true, embedUrl, unityPlayGameId: entry.id };
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
  node scripts/import-unity-play-catalog.mjs [options]

Options:
  --discover-only     Fetch catalog manifest only (writes scripts/data/unity-play-catalog.json)
  --skip-existing     Skip games that already have online/metadata.json
  --limit N           Process only first N games after discovery
  --concurrency N     Parallel imports (default 6)
  --max-pages N       Cap discovery pagination per source (0 = no cap for by-query)
  --force             Overwrite existing non-Poki catalog entries
`);
		process.exit(0);
	}

	mkdirSync(DATA_DIR, { recursive: true });

	console.log('Discovering games from Unity Play…');
	const catalog = await discoverAllGames(opts);
	console.log(`Found ${catalog.length} unique unity-web games.`);

	const titleDupes = new Map();
	for (const g of catalog) {
		const k = g.titleKey;
		if (!k) continue;
		if (!titleDupes.has(k)) titleDupes.set(k, []);
		titleDupes.get(k).push(g.slug);
	}
	const dupeTitles = [...titleDupes.entries()].filter(([, ids]) => ids.length > 1);
	if (dupeTitles.length) {
		console.log(
			`Note: ${dupeTitles.length} normalized title collisions (kept as distinct slugs/IDs).`
		);
	}

	writeFileSync(
		MANIFEST_PATH,
		`${JSON.stringify(
			{
				fetchedAt: new Date().toISOString(),
				count: catalog.length,
				titleCollisions: dupeTitles.length,
				games: catalog
			},
			null,
			2
		)}\n`,
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

	const index = buildExistingIndex();
	console.log(`Importing ${todo.length} games (concurrency ${opts.concurrency})…`);

	let ok = 0;
	let skipped = 0;
	let failed = 0;

	const results = await runPool(todo, opts.concurrency, async (g) => {
		try {
			const r = await importOne(g, opts, index);
			if (r.skipped) {
				skipped++;
				return r;
			}
			if (r.error) {
				failed++;
				console.error(`❌ ${g.slug}: ${r.error}`);
				return r;
			}
			ok++;
			if (ok % 25 === 0) console.log(`   … ${ok} imported`);
			return r;
		} catch (e) {
			failed++;
			console.error(`❌ ${g.slug}:`, e.message || e);
			return { slug: g.slug, error: String(e.message || e) };
		}
	});

	console.log('\nSummary:');
	console.log(`   OK: ${ok}`);
	console.log(`   Skipped: ${skipped}`);
	console.log(`   Failed: ${failed}`);

	const errPath = join(DATA_DIR, 'unity-play-import-errors.json');
	const errs = results.filter((r) => r && r.error);
	if (errs.length) {
		writeFileSync(errPath, `${JSON.stringify(errs, null, 2)}\n`, 'utf-8');
		console.log(`   Errors logged to ${errPath}`);
	}

	console.log('\nNext: node scripts/generate-games-list.js');
	console.log('Then:  pnpm puller:start   # Unity Play frames proxy via /api/unity-play/:id');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
