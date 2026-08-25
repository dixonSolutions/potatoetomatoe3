/**
 * Shared helpers for writing online game shells under static/games/<id>/online/.
 */

import {
	mkdirSync,
	writeFileSync,
	existsSync,
	createWriteStream,
	readFileSync,
	unlinkSync
} from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { slugify } from './catalog-quality.mjs';
import {
	shouldDownloadThumbnail,
	enforceMaxSingleThumb,
	writeThumbBudgetLedger
} from './thumb-budget.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '../..');
export const GAMES_ROOT = join(ROOT, 'static/games');
export const DATA_DIR = join(__dirname, '../data');

export const UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

export async function fetchText(url, opts = {}) {
	const retries = opts.retries ?? 3;
	const referer = opts.referer;
	for (let i = 0; i < retries; i++) {
		try {
			const res = await fetch(url, {
				headers: {
					'User-Agent': UA,
					Accept: opts.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					'Accept-Language': 'en-US,en;q=0.9',
					...(referer ? { Referer: referer } : {})
				},
				signal: AbortSignal.timeout(opts.timeoutMs ?? 45000),
				// Playhop/Yandex can send oversized cookie/header blocks
				dispatcher: undefined
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return await res.text();
		} catch (e) {
			if (i === retries - 1) throw e;
			await sleep(500 * (i + 1));
		}
	}
	throw new Error('unreachable');
}

export async function fetchTextCurl(url, opts = {}) {
	const { spawn } = await import('child_process');
	const args = ['-sL', '-A', UA, '--max-time', String(Math.ceil((opts.timeoutMs ?? 60000) / 1000))];
	if (opts.referer) args.push('-H', `Referer: ${opts.referer}`);
	if (opts.accept) args.push('-H', `Accept: ${opts.accept}`);
	args.push(url);
	return await new Promise((resolve, reject) => {
		const child = spawn('curl', args, { maxBuffer: 20 * 1024 * 1024 });
		let out = '';
		let err = '';
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (c) => (out += c));
		child.stderr.on('data', (c) => (err += c));
		child.on('close', (code) => {
			if (code === 0) resolve(out);
			else reject(new Error(err || `curl exit ${code}`));
		});
	});
}

export async function fetchJson(url, opts = {}) {
	const text = await fetchText(url, {
		...opts,
		accept: 'application/json,text/plain,*/*'
	});
	return JSON.parse(text);
}

export async function downloadToFile(url, destPath, referer) {
	const res = await fetch(url, {
		headers: {
			'User-Agent': UA,
			Accept: 'image/*,*/*',
			...(referer ? { Referer: referer } : {})
		},
		signal: AbortSignal.timeout(30000)
	});
	if (!res.ok) throw new Error(`HTTP ${res.status} download`);
	if (!res.body) throw new Error('No response body');
	await pipeline(Readable.fromWeb(res.body), createWriteStream(destPath));
}

/**
 * Undo HTML escaping on a URL scraped out of page markup.
 *
 * A URL lifted from an `href`/`src` attribute or from JSON embedded in HTML arrives with
 * `&` written as `&amp;`. For an embed that is merely ugly, but for an image CDN it is
 * silently destructive: `?width=1200&amp;fit=crop` is parsed as a parameter literally
 * named `amp;fit`, so every parameter after the first is ignored. 3,218 CrazyGames covers
 * were stored that way, and the CDN returned the full-resolution original — 2730x1535 and
 * 321 KB for a URL that asked for 1200x630 — which the app then decoded into a 138px
 * grid tile. See docs/game-launch-quality.md.
 *
 * @param {unknown} rawUrl
 * @returns {string} The URL with entities decoded, or '' when not a string.
 */
export function decodeUrlEntities(rawUrl) {
	if (typeof rawUrl !== 'string') return '';
	return rawUrl.replace(/&amp;/g, '&').replace(/&#0*38;/g, '&');
}

/**
 * Normalise a portal embed URL into an https absolute URL usable as an iframe src.
 *
 * Portals hand back protocol-relative (`//cdn/…`), root-relative (`/games/…`) and
 * plain-http URLs interchangeably. Resolving those against a portal base without
 * checking produces doubled hosts (`https://portal//cdn.host/…`), and an http embed
 * is blocked outright as mixed content once the app is served over https.
 *
 * @param {unknown} rawUrl Embed URL exactly as scraped from the portal.
 * @param {string} [baseUrl] Portal origin used to resolve relative URLs.
 * @returns {string | null} Absolute https URL, or null when unusable.
 */
export function normalizeEmbedUrl(rawUrl, baseUrl) {
	if (typeof rawUrl !== 'string') return null;
	const trimmed = decodeUrlEntities(rawUrl).trim();
	/* Scrapers stringify missing fields, yielding literal "undefined"/"null". */
	if (!trimmed || trimmed === 'undefined' || trimmed === 'null') return null;

	/* Protocol-relative must be resolved by scheme, never by string concatenation. */
	const candidate = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;

	let parsed;
	try {
		parsed = baseUrl ? new URL(candidate, baseUrl) : new URL(candidate);
	} catch {
		return null;
	}

	if (parsed.protocol === 'http:') parsed.protocol = 'https:';
	if (parsed.protocol !== 'https:') return null;
	/* A bare origin is a portal landing page, not a playable embed. */
	if (!parsed.hostname.includes('.')) return null;
	/* `origin + undefined` concatenation leaves a syntactically valid but dead host. */
	if (/(undefined|null)$/i.test(parsed.hostname)) return null;

	return parsed.href;
}

export function createOnlineIndexHtml(embedUrl, title) {
	const safeTitle = String(title || 'Game')
		.replace(/</g, '')
		.replace(/>/g, '')
		.slice(0, 120);
	const safeUrl = String(embedUrl).replace(/"/g, '&quot;');
	return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeTitle}</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; overflow: hidden; background: #111; }
        .game-iframe { width: 100%; height: 100%; border: none; display: block; }
    </style>
</head>
<body>
    <iframe class="game-iframe" id="game-area" src="${safeUrl}" title="${safeTitle}" scrolling="none" allowfullscreen allow="fullscreen; autoplay; gamepad; keyboard-map"></iframe>
</body>
</html>
`;
}

/**
 * @param {object} entry
 * @param {string} entry.id
 * @param {string} entry.name
 * @param {string} entry.embedUrl
 * @param {string} [entry.author]
 * @param {string} [entry.description]
 * @param {string} [entry.category]
 * @param {string} [entry.thumbnailUrl]
 * @param {string} entry.sourcePortal
 * @param {string} [entry.engine]
 * @param {string} [entry.pullStrategy]
 * @param {Record<string, unknown>} [entry.extra]
 * @param {{ skipExisting?: boolean, force?: boolean, referer?: string, embedBase?: string }} opts
 */
export async function writeOnlineShell(entry, opts = {}) {
	const gameId = slugify(entry.id, `game-${Date.now()}`);
	const embedUrl = normalizeEmbedUrl(entry.embedUrl, opts.embedBase);
	if (!embedUrl) {
		return { id: gameId, error: `unusable embed URL: ${String(entry.embedUrl)}` };
	}
	const onlineDir = join(GAMES_ROOT, gameId, 'online');
	const assetsDir = join(onlineDir, 'assets');
	const metaPath = join(onlineDir, 'metadata.json');

	if (opts.skipExisting && existsSync(metaPath) && !opts.force) {
		return { id: gameId, skipped: true };
	}

	mkdirSync(assetsDir, { recursive: true });
	mkdirSync(join(GAMES_ROOT, gameId, 'shared'), { recursive: true });

	/* Decode before the protocol test — see decodeUrlEntities for why this matters. */
	const thumbCandidate = decodeUrlEntities(entry.thumbnailUrl).trim();
	const remoteThumb = /^https?:\/\//i.test(thumbCandidate) ? thumbCandidate : null;
	const thumbName = `${gameId}.png`;
	const thumbRel = `/games/${gameId}/online/assets/${thumbName}`;
	const thumbPath = join(assetsDir, thumbName);
	let thumbnail = remoteThumb || '';
	let thumbnailStored = remoteThumb ? 'remote' : 'none';

	const decision = shouldDownloadThumbnail(0, {
		budgetBytes: opts.thumbBudgetBytes,
		maxSingleBytes: opts.thumbMaxSingleBytes
	});
	const wantLocal =
		Boolean(remoteThumb) && decision.download && (!existsSync(thumbPath) || opts.force);

	if (wantLocal) {
		try {
			await downloadToFile(remoteThumb, thumbPath, opts.referer);
			const enforced = enforceMaxSingleThumb(thumbPath, {
				maxSingleBytes: opts.thumbMaxSingleBytes
			});
			if (enforced.kept) {
				thumbnail = thumbRel;
				thumbnailStored = 'local';
			} else {
				thumbnail = remoteThumb;
				thumbnailStored = 'remote';
			}
		} catch {
			thumbnail = remoteThumb;
			thumbnailStored = 'remote';
		}
	} else if (remoteThumb) {
		thumbnail = remoteThumb;
		thumbnailStored = 'remote';
		if (existsSync(thumbPath) && opts.force) {
			try {
				unlinkSync(thumbPath);
			} catch {
				/* ignore */
			}
		}
	} else if (existsSync(thumbPath)) {
		thumbnail = thumbRel;
		thumbnailStored = 'local';
	}

	if (!existsSync(thumbPath) && thumbnailStored !== 'local') {
		writeFileSync(join(assetsDir, '.gitkeep'), '');
	}

	writeThumbBudgetLedger({ lastGameId: gameId, lastThumbnailStored: thumbnailStored });

	const metadata = {
		id: gameId,
		name: entry.name,
		author: entry.author || entry.sourcePortal,
		description:
			entry.description?.slice(0, 2000) ||
			`Play ${entry.name} on Potato Tomato (via ${entry.sourcePortal}).`,
		thumbnail,
		...(remoteThumb ? { thumbnailRemote: remoteThumb } : {}),
		thumbnailStored,
		category: entry.category || 'arcade',
		sourcePortal: entry.sourcePortal,
		onlineEmbedUrl: embedUrl,
		pullStrategy: entry.pullStrategy || 'generic',
		...(entry.engine ? { engine: entry.engine } : {}),
		...(entry.extra || {})
	};

	writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');
	writeFileSync(
		join(onlineDir, 'index.html'),
		createOnlineIndexHtml(embedUrl, entry.name),
		'utf-8'
	);

	return { id: gameId, ok: true, embedUrl };
}

export async function runPool(items, concurrency, fn) {
	const ret = new Array(items.length);
	let ix = 0;
	async function worker() {
		while (true) {
			const j = ix++;
			if (j >= items.length) return;
			ret[j] = await fn(items[j], j);
		}
	}
	await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
	return ret;
}

export function readJsonSafe(path) {
	try {
		return JSON.parse(readFileSync(path, 'utf-8'));
	} catch {
		return null;
	}
}

export function writeJson(path, data) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}
