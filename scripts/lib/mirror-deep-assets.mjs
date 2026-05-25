/**
 * After wget --page-requisites, many games load paths only from JS/JSON/CSS at runtime.
 * This module scans mirrored text files for same-origin asset references and fetches
 * missing files iteratively until stable (no game-specific hardcoded lists).
 */

import { readdirSync, readFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';

/** Extensions commonly referenced as separate files in HTML5 / Flash / Unity mirrors */
const FETCH_EXT = new Set([
    'mp3',
    'ogg',
    'wav',
    'm4a',
    'aac',
    'opus',
    'png',
    'jpg',
    'jpeg',
    'webp',
    'gif',
    'svg',
    'json',
    'swf',
    'wasm',
    'unityweb',
    'data',
    'symbols',
    'mem',
    'framework',
    'js',
    'css',
    'txt',
    'xml',
    'atlas',
    'fnt',
    'bin',
    'ttf',
    'woff',
    'woff2',
    'mp4',
    'webm',
    'glb',
    'obj',
    'mtl',
    'plist',
    'csv',
    'br',
    'lz4',
    'basis',
    'ktx2',
    'dds',
    'fbx',
    'ico'
]);

const SCAN_EXT = /\.(html?|js|mjs|cjs|css|json|map|svg|xml|txt)$/i;

function walkFiles(dir, out = []) {
    let entries;
    try {
        entries = readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
            walkFiles(p, out);
        } else if (e.isFile() && SCAN_EXT.test(e.name)) {
            out.push(p);
        }
    }
    return out;
}

function gameRootPathname(iframeSrc) {
    const u = new URL(iframeSrc);
    let path = u.pathname;
    if (path.endsWith('/')) path = path.slice(0, -1);
    const seg = path.split('/').filter(Boolean);
    const last = seg[seg.length - 1] || '';
    if (last.includes('.')) {
        seg.pop();
        path = '/' + seg.join('/');
    } else {
        path = '/' + seg.join('/');
    }
    return path || '/';
}

function cleanRef(s) {
    if (!s || typeof s !== 'string') return null;
    let x = s.trim().split('#')[0];
    const qi = x.indexOf('?');
    if (qi >= 0) x = x.slice(0, qi);
    return x.trim();
}

function normalizeToRelative(ref, iframeSrc) {
    const cleaned = cleanRef(ref);
    if (!cleaned || cleaned.length > 1024) return null;
    if (/^(data:|blob:|mailto:|javascript:)/i.test(cleaned)) return null;

    const base = new URL(iframeSrc);
    const origin = base.origin;
    const gameRoot = gameRootPathname(iframeSrc);

    const baseForRel = iframeSrc.endsWith('/') ? iframeSrc : `${iframeSrc}/`;

    let full;
    try {
        if (/^https?:\/\//i.test(cleaned)) {
            full = new URL(cleaned);
        } else if (cleaned.startsWith('//')) {
            full = new URL(base.protocol + cleaned);
        } else if (cleaned.startsWith('/')) {
            full = new URL(cleaned, origin);
        } else {
            full = new URL(cleaned, baseForRel);
        }
    } catch {
        return null;
    }

    if (full.origin !== origin) return null;

    let pathname = full.pathname;
    if (!pathname.startsWith(gameRoot === '/' ? '/' : gameRoot + '/') && pathname !== gameRoot) {
        if (gameRoot !== '/' && !pathname.startsWith(gameRoot + '/')) return null;
    }

    let rel;
    if (gameRoot === '/' || gameRoot === '') {
        rel = pathname.replace(/^\//, '');
    } else if (pathname.startsWith(gameRoot + '/')) {
        rel = pathname.slice(gameRoot.length + 1);
    } else if (pathname === gameRoot) {
        return null;
    } else {
        return null;
    }

    rel = rel.split('/').filter((s) => s && s !== '.' && s !== '..').join('/');
    if (!rel) return null;

    const ext = rel.split('.').pop()?.toLowerCase();
    if (!ext || !FETCH_EXT.has(ext)) return null;

    if (!isPlausibleAssetPath(rel)) return null;

    return rel;
}

/**
 * Reject strings that are not real file paths (e.g. Three.js console text ending in ".js").
 */
function isPlausibleAssetPath(rel) {
    if (rel.length > 240) return false;
    if (rel.includes('%')) return false;
    if (/[\s\u200b-\u200d\ufeff]/.test(rel)) return false;
    if (/has been moved|THREE\.Canvas|\.github\.|\.com\//i.test(rel)) return false;
    const parts = rel.split('/');
    if (parts.length > 32) return false;
    for (const seg of parts) {
        if (!seg || seg.length > 180) return false;
        if (!/^[a-zA-Z0-9._-]+$/.test(seg)) return false;
    }
    return true;
}

function collectFromText(content, iframeSrc, into) {
    const patterns = [
        /["']([^"']+\.[a-zA-Z0-9]{1,8})(?:\?[^"']*)?["']/g,
        /`([^`]+\.[a-zA-Z0-9]{1,8})(?:\?[^`]*)?`/g,
        /url\(\s*["']?([^)"']+)["']?\s*\)/gi
    ];
    for (const re of patterns) {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(content)) !== null) {
            const rel = normalizeToRelative(m[1], iframeSrc);
            if (rel) into.add(rel);
        }
    }
}

/** Real `src` / `href` attributes only — not `data-src`, `ng-src`, etc. */
const HTML_SRC_HREF_RE = /(?:^|[\s>])(?:src|href)=["']([^"']+)["']/gi;

function collectFromHtmlSrcHrefAttributes(content, iframeSrc, into) {
    let m;
    HTML_SRC_HREF_RE.lastIndex = 0;
    while ((m = HTML_SRC_HREF_RE.exec(content)) !== null) {
        const raw = m[1].trim();
        if (!raw || raw.startsWith('data:') || raw.startsWith('http') || raw.startsWith('//')) continue;
        if (raw.startsWith('/')) continue;
        if (/^(javascript:|mailto:|blob:)/i.test(raw)) continue;
        const rel = normalizeToRelative(raw, iframeSrc);
        if (rel) into.add(rel);
    }
}

function walkJsonStrings(val, cb) {
    if (val === null || val === undefined) return;
    const t = typeof val;
    if (t === 'string') {
        cb(val);
    } else if (t === 'object' && !Array.isArray(val)) {
        for (const k of Object.keys(val)) walkJsonStrings(val[k], cb);
    } else if (Array.isArray(val)) {
        for (const item of val) walkJsonStrings(item, cb);
    }
}

function collectFromJsonFile(filePath, iframeSrc, into) {
    let raw;
    try {
        raw = readFileSync(filePath, 'utf-8');
    } catch {
        return;
    }
    if (raw.length > 12 * 1024 * 1024) return;
    let data;
    try {
        data = JSON.parse(raw);
    } catch {
        return;
    }
    walkJsonStrings(data, (s) => {
        if (typeof s !== 'string' || s.length > 1024) return;
        const rel = normalizeToRelative(s, iframeSrc);
        if (rel) into.add(rel);
        const rel2 = normalizeToRelative(s.replace(/^\//, ''), iframeSrc);
        if (rel2) into.add(rel2);
    });
}

/**
 * Discover all same-origin asset paths referenced from mirrored files under targetDir.
 * @param {string} targetDir
 * @param {string} iframeSrc
 * @returns {Set<string>}
 */
export function discoverReferencedAssets(targetDir, iframeSrc) {
    const found = new Set();
    const files = walkFiles(targetDir);
    for (const fp of files) {
        if (fp.endsWith('.json')) {
            collectFromJsonFile(fp, iframeSrc, found);
            continue;
        }
        let st;
        try {
            st = statSync(fp);
        } catch {
            continue;
        }
        if (st.size > 25 * 1024 * 1024) continue;
        let content;
        try {
            content = readFileSync(fp, 'utf-8');
        } catch {
            continue;
        }
        collectFromText(content, iframeSrc, found);
        if (/\.html?$/i.test(fp)) {
            collectFromHtmlSrcHrefAttributes(content, iframeSrc, found);
        }
    }
    return found;
}

/**
 * Repeatedly fetch missing discovered assets until no new files appear or maxRounds.
 * @param {string} targetDir
 * @param {string} iframeSrc
 * @param {(relPath: string, destAbs: string, url: string) => Promise<void>} fetchOne
 * @param {{ maxRounds?: number, onRound?: (n: number, count: number) => void }} [opts]
 */
export async function iterativelyFetchDiscoveredAssets(targetDir, iframeSrc, fetchOne, opts = {}) {
    const maxRounds = opts.maxRounds ?? 25;
    const base = new URL(iframeSrc.endsWith('/') ? iframeSrc : `${iframeSrc}/`);

    for (let round = 1; round <= maxRounds; round++) {
        const rels = [...discoverReferencedAssets(targetDir, iframeSrc)];
        let fetched = 0;
        let checked = 0;
        const progressEvery = 75;

        if (rels.length > 0) {
            console.log(
                `   📎 Deep assets round ${round}: ${rels.length} referenced path(s) to check (sequential fetches — large games can take minutes with no other output)`
            );
        }

        for (const rel of rels) {
            checked++;
            if (checked % progressEvery === 0) {
                console.log(`   📎 … ${checked}/${rels.length} paths checked, ${fetched} file(s) fetched so far this round`);
            }
            const dest = join(targetDir, rel);
            if (existsSync(dest)) {
                try {
                    if (statSync(dest).size > 0) continue;
                } catch {
                    continue;
                }
            }
            mkdirSync(dirname(dest), { recursive: true });
            const url = new URL(rel, base).href;
            try {
                await fetchOne(rel, dest, url);
                if (existsSync(dest) && statSync(dest).size > 0) {
                    fetched++;
                }
            } catch {
                /* try next */
            }
        }

        if (opts.onRound) opts.onRound(round, fetched);
        if (fetched === 0) break;
    }
}
