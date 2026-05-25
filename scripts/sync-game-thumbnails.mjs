#!/usr/bin/env node
/**
 * For each catalog game, if metadata.json points at /games/<id>/online/assets/<file> but the file
 * is missing (or --force), fetch the iframe entry page and try og:image / twitter:image / icon,
 * then download the image into that path. No hand-authored placeholder images.
 *
 * Usage:
 *   node scripts/sync-game-thumbnails.mjs
 *   node scripts/sync-game-thumbnails.mjs --missing   # only games whose thumbnail file is missing or tiny
 *   node scripts/sync-game-thumbnails.mjs terris ultimate-sudoku
 *   node scripts/sync-game-thumbnails.mjs --force
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = join(__dirname, '../static/games');

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function listGameIds() {
    return readdirSync(GAMES_ROOT, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
        .map((d) => d.name)
        .filter((id) => existsSync(join(GAMES_ROOT, id, 'online', 'metadata.json')));
}

function parseIframeSrc(onlineIndexPath) {
    if (!existsSync(onlineIndexPath)) return null;
    const html = readFileSync(onlineIndexPath, 'utf-8');
    const m = html.match(/<iframe[^>]*src=["']([^"']+)["'][^>]*>/i);
    return m ? m[1] : null;
}

/**
 * Base URL for resolving relative links found in the iframe entry document.
 * Paths like /a7/tetris-flash (no trailing slash) would wrongly resolve flashtetris.png to /a7/…
 * without normalizing to a directory URL first.
 */
function documentBaseUrl(iframeSrc) {
    try {
        const u = new URL(iframeSrc);
        let p = u.pathname;
        if (p.endsWith('/')) return u.href;
        const segments = p.split('/').filter(Boolean);
        const last = segments[segments.length - 1] || '';
        if (last.includes('.')) {
            const i = p.lastIndexOf('/');
            u.pathname = i >= 0 ? p.slice(0, i + 1) : '/';
        } else {
            u.pathname = `${p.endsWith('/') ? p.slice(0, -1) : p}/`;
        }
        return u.href;
    } catch {
        return iframeSrc.endsWith('/') ? iframeSrc : `${iframeSrc}/`;
    }
}

function guessFaviconUrls(iframeSrc) {
    try {
        const base = documentBaseUrl(iframeSrc);
        const u = new URL(base);
        const out = [`${u.origin}/favicon.ico`];
        const path = u.pathname.replace(/\/$/, '');
        if (path && path !== '/') {
            out.push(`${u.origin}${path}/favicon.ico`);
        }
        return out;
    } catch {
        return [];
    }
}

function thumbnailToFsPath(gameId, thumbnail) {
    if (!thumbnail || typeof thumbnail !== 'string') return null;
    if (thumbnail.startsWith('data:') || thumbnail.startsWith('http')) return null;
    const prefix = `/games/${gameId}/`;
    if (!thumbnail.startsWith(prefix)) return null;
    const rel = thumbnail.slice(prefix.length);
    return join(GAMES_ROOT, gameId, rel);
}

/**
 * Local filesystem destination for a catalog thumbnail, and the `/games/<id>/…` string to store in metadata.
 * If metadata.thumbnail is empty, tries conventional paths under online/assets/.
 */
function resolveLocalThumbnailDest(gameId, metadata) {
    const raw = typeof metadata.thumbnail === 'string' ? metadata.thumbnail.trim() : '';
    if (raw.startsWith('http') || raw.startsWith('data:')) {
        return null;
    }

    let thumbPathForMeta = raw;
    let destPath = raw ? thumbnailToFsPath(gameId, raw) : null;

    if (!destPath) {
        const candidates = [
            `/games/${gameId}/online/assets/${gameId}.png`,
            `/games/${gameId}/online/assets/thumbnail.png`
        ];
        for (const c of candidates) {
            const p = thumbnailToFsPath(gameId, c);
            if (p) {
                destPath = p;
                thumbPathForMeta = c;
                break;
            }
        }
    }

    if (!destPath) {
        return null;
    }

    const metaNeedsUpdate = Boolean(thumbPathForMeta && raw !== thumbPathForMeta);
    return { destPath, thumbPathForMeta, metaNeedsUpdate };
}

function extractImageUrlFromHtml(html, baseUrl) {
    const patterns = [
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
        /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
        /<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)["']/i,
        /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']apple-touch-icon["']/i,
        /<link[^>]+rel=["']shortcut icon["'][^>]+href=["']([^"']+)["']/i,
        /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']shortcut icon["']/i,
        /<link[^>]+rel=["']icon["'][^>]+href=["']([^"']+)["']/i,
        /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']icon["']/i,
        /<meta[^>]+itemprop=["']image["'][^>]+content=["']([^"']+)["']/i,
        /<meta[^>]+content=["']([^"']+)["'][^>]+itemprop=["']image["']/i
    ];
    for (const re of patterns) {
        const m = html.match(re);
        if (m?.[1]) {
            try {
                return new URL(m[1], baseUrl).href;
            } catch {
                /* continue */
            }
        }
    }
    return null;
}

function extractJsonLdImage(html, baseUrl) {
    const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        let data;
        try {
            data = JSON.parse(m[1].trim());
        } catch {
            continue;
        }
        const stack = Array.isArray(data) ? [...data] : [data];
        while (stack.length) {
            const v = stack.pop();
            if (!v || typeof v !== 'object') continue;
            if (Array.isArray(v)) {
                v.forEach((x) => stack.push(x));
                continue;
            }
            const img = v.image;
            if (img) {
                const url =
                    typeof img === 'string'
                        ? img
                        : typeof img === 'object' && img !== null
                          ? img.url || img['@id']
                          : null;
                if (url && typeof url === 'string') {
                    try {
                        return new URL(url, baseUrl).href;
                    } catch {
                        /* continue */
                    }
                }
            }
            for (const k of Object.keys(v)) {
                if (k !== '@context') stack.push(v[k]);
            }
        }
    }
    return null;
}

function extractFirstSameOriginImg(html, baseUrl) {
    const re = /<img[^>]+src=["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        const src = m[1]?.trim();
        if (!src || src.startsWith('data:')) continue;
        try {
            const u = new URL(src, baseUrl);
            const base = new URL(baseUrl);
            if (u.origin !== base.origin) continue;
            if (/\.(png|jpe?g|webp|gif|ico|svg)(\?|$)/i.test(u.pathname)) return u.href;
        } catch {
            /* next */
        }
    }
    return null;
}

/** Any remote <img src> that looks like a raster/vector asset (og/twitter often missing on game shells). */
function extractFirstImageLikeImg(html, baseUrl) {
    const re = /<img[^>]+src=["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        const src = m[1]?.trim();
        if (!src || src.startsWith('data:')) continue;
        try {
            const u = new URL(src, baseUrl);
            if (!/^https?:$/i.test(u.protocol)) continue;
            if (/\.(png|jpe?g|webp|gif|ico|svg)(\?|$)/i.test(u.pathname)) return u.href;
        } catch {
            /* next */
        }
    }
    return null;
}

async function fetchText(url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
}

async function downloadToFile(url, destPath) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    mkdirSync(dirname(destPath), { recursive: true });
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 32) throw new Error(`too small (${buf.length} bytes)`);
    writeFileSync(destPath, buf);
}

async function tryDownloadFirst(destPath, urls) {
    const seen = new Set();
    for (const raw of urls) {
        if (!raw || seen.has(raw)) continue;
        seen.add(raw);
        try {
            await downloadToFile(raw, destPath);
            return raw;
        } catch {
            /* try next candidate */
        }
    }
    return null;
}

async function syncOne(gameId, force) {
    const metaPath = join(GAMES_ROOT, gameId, 'online', 'metadata.json');
    const metadata = JSON.parse(readFileSync(metaPath, 'utf-8'));
    const resolved = resolveLocalThumbnailDest(gameId, metadata);
    if (!resolved) {
        const t = metadata.thumbnail;
        if (typeof t === 'string' && (t.startsWith('http') || t.startsWith('data:'))) {
            console.log(`⏭️  ${gameId}: remote thumbnail URL — skip`);
        } else {
            console.log(`⏭️  ${gameId}: no local thumbnail path — skip`);
        }
        return;
    }

    const { destPath, thumbPathForMeta, metaNeedsUpdate } = resolved;

    if (existsSync(destPath)) {
        try {
            if (!force && statSync(destPath).size > 64) {
                console.log(`⏭️  ${gameId}: thumbnail exists`);
                return;
            }
        } catch {
            /* refetch */
        }
    }

    const iframeSrc = parseIframeSrc(join(GAMES_ROOT, gameId, 'online', 'index.html'));
    if (!iframeSrc?.startsWith('http')) {
        console.warn(`⚠️  ${gameId}: no http iframe — cannot resolve thumbnail`);
        return;
    }

    const baseUrl = documentBaseUrl(iframeSrc);
    let entryHtml;
    try {
        entryHtml = await fetchText(iframeSrc);
    } catch (e) {
        console.warn(`⚠️  ${gameId}: could not fetch iframe page: ${e.message}`);
        return;
    }

    const candidates = [];
    const push = (u) => {
        if (u && typeof u === 'string') candidates.push(u);
    };
    push(extractImageUrlFromHtml(entryHtml, baseUrl));
    push(extractJsonLdImage(entryHtml, baseUrl));
    push(extractFirstSameOriginImg(entryHtml, baseUrl));
    push(extractFirstImageLikeImg(entryHtml, baseUrl));
    for (const u of guessFaviconUrls(iframeSrc)) push(u);

    const ok = await tryDownloadFirst(destPath, candidates);
    if (ok) {
        console.log(
            `✅ ${gameId}: ${thumbPathForMeta} <- ${ok.slice(0, 88)}${ok.length > 88 ? '…' : ''}`
        );
        if (metaNeedsUpdate) {
            metadata.thumbnail = thumbPathForMeta;
            writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');
        }
        return;
    }

    console.warn(`⚠️  ${gameId}: no usable image (tried meta/icons, <img>, favicon guesses)`);
}

function thumbnailNeedsFetch(gameId, force) {
    const metaPath = join(GAMES_ROOT, gameId, 'online', 'metadata.json');
    const metadata = JSON.parse(readFileSync(metaPath, 'utf-8'));
    const resolved = resolveLocalThumbnailDest(gameId, metadata);
    if (!resolved) return false;
    const { destPath } = resolved;
    if (!existsSync(destPath)) return true;
    try {
        return force || statSync(destPath).size < 65;
    } catch {
        return true;
    }
}

async function main() {
    const argv = process.argv.slice(2);
    const force = argv.includes('--force');
    const onlyMissing = argv.includes('--missing');
    const ids = argv.filter((a) => a !== '--force' && a !== '--missing');

    let all = ids.length > 0 ? ids.filter((id) => listGameIds().includes(id)) : listGameIds();

    if (onlyMissing) {
        all = all.filter((id) => thumbnailNeedsFetch(id, force));
    }

    if (all.length === 0) {
        console.error('No games to process.');
        process.exit(1);
    }

    console.log(
        `Thumbnail sync: ${all.length} game(s)${force ? ' (--force)' : ''}${onlyMissing ? ' (--missing)' : ''}\n`
    );

    for (const id of all) {
        await syncOne(id, force);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
