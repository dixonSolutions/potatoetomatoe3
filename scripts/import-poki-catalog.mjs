#!/usr/bin/env node
/**
 * Non-hardcoded Poki catalog import: discovers all games from embedded RTK state on
 * https://poki.com/en/all-games (getAllGames pagination), then for each slug loads
 * the game page and reads getGame(...) → file.content (games.poki.com iframe URL).
 *
 * Writes static/games/<slug>/online/index.html + metadata.json + assets thumbnail.
 * Does not mirror gameplay assets — run `node scripts/download-games-offline.js` after.
 *
 * Usage:
 *   node scripts/import-poki-catalog.mjs
 *   node scripts/import-poki-catalog.mjs --limit 20
 *   node scripts/import-poki-catalog.mjs --skip-existing
 *   node scripts/import-poki-catalog.mjs --discover-only
 *   node scripts/import-poki-catalog.mjs --concurrency 6
 */

import { mkdirSync, writeFileSync, existsSync, createWriteStream } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = join(__dirname, '../static/games');
const DATA_DIR = join(__dirname, 'data');
const MANIFEST_PATH = join(DATA_DIR, 'poki-catalog.json');

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function parseArgv() {
    const a = process.argv.slice(2);
    const limitIdx = a.indexOf('--limit');
    const concIdx = a.indexOf('--concurrency');
    return {
        limit: limitIdx >= 0 && a[limitIdx + 1] ? parseInt(a[limitIdx + 1], 10) : 0,
        concurrency: Math.max(1, concIdx >= 0 && a[concIdx + 1] ? parseInt(a[concIdx + 1], 10) : 6),
        skipExisting: a.includes('--skip-existing'),
        discoverOnly: a.includes('--discover-only'),
        help: a.includes('--help') || a.includes('-h')
    };
}

/** Extract `window.INITIAL_STATE = {...};` without naive regex (nested braces). */
function parseInitialState(html) {
    const start = html.indexOf('window.INITIAL_STATE = ');
    if (start < 0) throw new Error('window.INITIAL_STATE not found');
    let i = start + 'window.INITIAL_STATE = '.length;
    if (html[i] !== '{') throw new Error('INITIAL_STATE does not start with {');
    let depth = 0;
    let inStr = null;
    let esc = false;
    const begin = i;
    for (; i < html.length; i++) {
        const c = html[i];
        if (inStr) {
            if (esc) {
                esc = false;
                continue;
            }
            if (c === '\\') {
                esc = true;
                continue;
            }
            if (c === inStr) inStr = null;
            continue;
        }
        if (c === '"' || c === "'") {
            inStr = c;
            continue;
        }
        if (c === '{') depth++;
        if (c === '}') {
            depth--;
            if (depth === 0) {
                i++;
                break;
            }
        }
    }
    return JSON.parse(html.slice(begin, i));
}

function stripHtml(html) {
    if (!html || typeof html !== 'string') return '';
    return html
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 2000);
}

function normalizeEmbedUrl(content) {
    if (!content || typeof content !== 'string') return null;
    const t = content.trim();
    if (t.startsWith('//')) return `https:${t}`;
    if (/^https?:\/\//i.test(t)) return t;
    return `https://${t.replace(/^\/+/, '')}`;
}

function pickCategory(data) {
    const b = data.breadcrumb && data.breadcrumb[0];
    if (b && b.slug) return b.slug;
    const c = data.categories && data.categories[0];
    if (c && c.slug) return c.slug;
    return 'arcade';
}

function extractOgImage(html) {
    const m = html.match(/property="og:image"\s+content="([^"]+)"/i);
    return m ? m[1] : null;
}

async function fetchText(url) {
    const res = await fetch(url, {
        headers: {
            'User-Agent': UA,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
}

async function downloadToFile(url, destPath) {
    const res = await fetch(url, {
        headers: {
            'User-Agent': UA,
            Accept: 'image/*',
            Referer: 'https://poki.com/'
        }
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
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        html, body {
            width: 100%;
            height: 100%;
            overflow: hidden;
        }
        .game-iframe {
            width: 100%;
            height: 100%;
            border: none;
            display: block;
        }
    </style>
</head>
<body>
    <iframe class="game-iframe" id="game-area" src="${embedUrl}" scrolling="none" allowfullscreen></iframe>
</body>
</html>
`;
}

async function discoverAllGames() {
    const out = [];
    for (let page = 1; page < 500; page++) {
        const url =
            page === 1 ? 'https://poki.com/en/all-games' : `https://poki.com/en/all-games/${page}`;
        const html = await fetchText(url);
        const state = parseInitialState(html);
        const qk = Object.keys(state.api.queries).find((k) => k.startsWith('getAllGames('));
        if (!qk) throw new Error(`getAllGames not in INITIAL_STATE (page ${page})`);
        const games = state.api.queries[qk]?.data?.games;
        if (!games || games.length === 0) break;
        out.push(...games);
        process.stdout.write(`\r   Catalog page ${page} (+${games.length}) total ${out.length}   `);
        await sleep(120);
    }
    console.log('');
    const bySlug = new Map();
    for (const g of out) {
        if (g && g.slug) bySlug.set(g.slug, g);
    }
    return [...bySlug.values()];
}

function getGetGameData(state) {
    const qk = Object.keys(state.api.queries).find((k) => k.startsWith('getGame('));
    if (!qk) return null;
    const q = state.api.queries[qk];
    if (!q || q.status !== 'fulfilled' || !q.data) return null;
    return q.data;
}

async function importOne(slug, opts) {
    const gameId = slug;
    const onlineDir = join(GAMES_ROOT, gameId, 'online');
    const assetsDir = join(onlineDir, 'assets');
    const metaPath = join(onlineDir, 'metadata.json');

    if (opts.skipExisting && existsSync(metaPath)) {
        return { slug, skipped: true };
    }

    const gameUrl = `https://poki.com/en/g/${encodeURI(slug)}`;
    const html = await fetchText(gameUrl);
    const state = parseInitialState(html);
    const data = getGetGameData(state);
    if (!data) {
        return { slug, error: 'getGame data missing' };
    }

    const raw = data.file?.content ?? data.content;
    const embedUrl = normalizeEmbedUrl(raw);
    if (!embedUrl) {
        return { slug, error: 'no file.content / content URL' };
    }

    const title = data.title || data.english_title || slug;
    const description = stripHtml(data.description) || `Play ${title} offline (mirrored from Poki).`;
    const category = pickCategory(data);

    mkdirSync(assetsDir, { recursive: true });
    mkdirSync(join(GAMES_ROOT, gameId, 'shared'), { recursive: true });

    const thumbName = `${slug.replace(/[^a-z0-9-]/gi, '-')}.png`;
    const thumbRel = `/games/${gameId}/online/assets/${thumbName}`;
    const og = extractOgImage(html);
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
        author: 'Poki',
        description,
        thumbnail: thumbRel,
        category
    };

    writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');
    writeFileSync(join(onlineDir, 'index.html'), createOnlineIndexHtml(embedUrl, title), 'utf-8');

    return { slug, ok: true, embedUrl };
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
  node scripts/import-poki-catalog.mjs [options]

Options:
  --discover-only     Fetch catalog manifest only (writes scripts/data/poki-catalog.json)
  --skip-existing     Skip games that already have online/metadata.json
  --limit N           Process only first N games after discovery
  --concurrency N     Parallel game-page fetches (default 6)
`);
        process.exit(0);
    }

    mkdirSync(DATA_DIR, { recursive: true });

    console.log('Discovering full catalog from Poki (getAllGames pagination)…');
    const catalog = await discoverAllGames();
    console.log(`Found ${catalog.length} unique games by slug.`);

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

    const results = await runPool(todo, opts.concurrency, async (g) => {
        const slug = g.slug;
        try {
            const r = await importOne(slug, opts);
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
            if (ok % 50 === 0) console.log(`   … ${ok} imported`);
            return r;
        } catch (e) {
            failed++;
            console.error(`❌ ${slug}:`, e.message || e);
            return { slug, error: String(e.message || e) };
        }
    });

    console.log('\nSummary:');
    console.log(`   OK: ${ok}`);
    console.log(`   Skipped (--skip-existing): ${skipped}`);
    console.log(`   Failed: ${failed}`);

    const errPath = join(DATA_DIR, 'poki-import-errors.json');
    const errs = results.filter((r) => r && r.error);
    if (errs.length) {
        writeFileSync(errPath, `${JSON.stringify(errs, null, 2)}\n`, 'utf-8');
        console.log(`   Errors logged to ${errPath}`);
    }

    console.log('\nNext: node scripts/generate-games-list.js');
    console.log('Then:  node scripts/download-games-offline.js   # mirrors iframe targets into offline/');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
