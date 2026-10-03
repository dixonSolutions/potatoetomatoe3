/**
 * Shared plumbing for the catalog quality audit: catalog loading, resumable JSON caches,
 * a per-host polite request limiter, and an HTTP probe that records what a browser would
 * get when it frames an embed URL.
 *
 * Used by scripts/audit-catalog.mjs (probe + portal signals), scripts/catalog-quality/*.mjs
 * (host status, classification) and scripts/verify-game-launches.mjs (launch results).
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(__dirname, '..', '..');
export const GAMES_ROOT = join(ROOT, 'static', 'games');
export const DATA_DIR = join(ROOT, 'scripts', 'data');
export const AUDIT_DIR = join(DATA_DIR, 'catalog-audit');
export const HOST_STATUS_PATH = join(DATA_DIR, 'host-filter-status.json');
export const QUALITY_PATH = join(DATA_DIR, 'catalog-quality.json');

/** A current desktop Chrome; several portals serve a bot wall to unknown agents. */
export const BROWSER_UA =
	'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/*
 * Node's happy-eyeballs gives each resolved address 250 ms before moving on. Under a few
 * dozen parallel connects that surfaced as spurious UND_ERR_CONNECT_TIMEOUT after ~1.5 s
 * against hosts curl reached in 300 ms. A longer per-address window removes them.
 */
setDefaultAutoSelectFamilyAttemptTimeout(2000);

export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function readJson(path, fallback = null) {
	if (!existsSync(path)) return fallback;
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return fallback;
	}
}

/** Write via a temp file so an interrupted run never leaves a truncated cache behind. */
export function writeJsonAtomic(path, value, { pretty = false } = {}) {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}`;
	writeFileSync(tmp, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
	renameSync(tmp, path);
}

export function loadCatalog() {
	const path = join(GAMES_ROOT, 'games-metadata.json');
	const list = readJson(path);
	if (!Array.isArray(list)) throw new Error(`Missing or unreadable catalog: ${path}`);
	return list;
}

export function portalOf(game) {
	return game.sourcePortal || 'local';
}

export function hostOf(url) {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return null;
	}
}

/**
 * Collapse per-game hosts to the name a filter would categorise:
 * `app-264700.games.s3.yandex.net` and `2048.game-files.crazygames.com` are one service each.
 */
export function hostGroupOf(host) {
	if (!host) return null;
	return host
		.replace(/^app-\d+\.games\.s3\.yandex\.net$/, 'app-*.games.s3.yandex.net')
		.replace(/^[a-z0-9-]+\.game-files\.crazygames\.com$/, '*.game-files.crazygames.com');
}

/**
 * Local catalog shells are ~700-byte pages that iframe a third party. Return that URL.
 * @returns {{ url: string | null, reason?: string }}
 */
export function readShellIframeTarget(gameId) {
	const path = join(GAMES_ROOT, gameId, 'online', 'index.html');
	if (!existsSync(path)) return { url: null, reason: 'no-index' };
	const html = readFileSync(path, 'utf8');
	const match = html.match(/<iframe[^>]*\ssrc=["']([^"']+)["']/i);
	if (!match) return { url: null, reason: 'no-iframe', bytes: html.length };
	const src = match[1].trim();
	if (!/^https?:\/\//i.test(src)) return { url: null, reason: 'relative-iframe', src };
	return { url: src, bytes: html.length };
}

/**
 * Where a game's playable document actually lives, in the order a launch would reach it.
 * `primary` is what the app frames; `secondary` is the content the primary wraps when the
 * primary is only a wrapper (Google Sites gadget XML, a local shell's iframe).
 */
export function playTargetsOf(game) {
	if (game.onlineEmbedUrl) {
		const secondary =
			portalOf(game) === 'drive-u-7' && game.gadgetXmlUrl ? game.gadgetXmlUrl : null;
		return { primary: game.onlineEmbedUrl, secondary, kind: 'embed' };
	}
	const shell = readShellIframeTarget(game.id);
	return { primary: shell.url, secondary: null, kind: 'shell', shell };
}

const openCaches = new Set();
for (const signal of ['SIGINT', 'SIGTERM']) {
	process.once(signal, () => {
		/* An interrupted run keeps everything fetched so far; the next run resumes from it. */
		for (const cache of openCaches) cache.flush();
		process.exit(130);
	});
}

/** Resumable per-key cache stored as one JSON file, flushed periodically and on Ctrl-C. */
export class JsonCache {
	constructor(path, { version = 1 } = {}) {
		openCaches.add(this);
		this.path = path;
		this.version = version;
		const existing = readJson(path);
		this.results = existing?.version === version && existing.results ? existing.results : {};
		this.changed = new Set();
		this.dirty = false;
		this.lastFlush = Date.now();
	}

	get(key) {
		return this.results[key];
	}

	has(key) {
		return Object.prototype.hasOwnProperty.call(this.results, key);
	}

	set(key, value) {
		this.results[key] = value;
		this.changed.add(key);
		this.dirty = true;
		if (Date.now() - this.lastFlush > 20_000) this.flush();
	}

	flush() {
		if (!this.dirty) return;
		/*
		 * Two runs may share a cache (a sample and a top-tier pass in parallel). Re-read the
		 * file and lay only this run's changes over it, so neither erases the other's work.
		 */
		const onDisk = readJson(this.path);
		if (onDisk?.version === this.version && onDisk.results) {
			const merged = { ...onDisk.results };
			for (const key of this.changed) merged[key] = this.results[key];
			this.results = merged;
		}
		const entries = Object.entries(this.results).sort(([a], [b]) => a.localeCompare(b));
		writeKeyedJsonLines(this.path, {
			header: {
				version: this.version,
				updatedAt: new Date().toISOString(),
				count: entries.length
			},
			key: 'results',
			entries
		});
		this.dirty = false;
		this.lastFlush = Date.now();
	}
}

/**
 * Valid JSON with one keyed entry per line, so a rerun that changes a few games shows up
 * as a few changed lines in a diff rather than one rewritten multi-megabyte line.
 */
export function writeKeyedJsonLines(path, { header, key, entries }) {
	mkdirSync(dirname(path), { recursive: true });
	const head = JSON.stringify(header).slice(0, -1);
	const body = entries
		.map(([id, value]) => `${JSON.stringify(id)}:${JSON.stringify(value)}`)
		.join(',\n');
	const tmp = `${path}.tmp-${process.pid}`;
	writeFileSync(tmp, `${head},${JSON.stringify(key)}:{\n${body}\n}}\n`);
	renameSync(tmp, path);
}

/**
 * Global concurrency cap plus a per-host cap and minimum gap between requests to the same
 * host. Politeness matters more than speed here: most hosts are one portal CDN each.
 */
export class HostLimiter {
	constructor({ globalConcurrency = 12, perHost = 2, minGapMs = 250 } = {}) {
		this.globalConcurrency = globalConcurrency;
		this.perHost = perHost;
		this.minGapMs = minGapMs;
		this.active = 0;
		this.hosts = new Map();
	}

	#hostState(host) {
		let state = this.hosts.get(host);
		if (!state) {
			state = { active: 0, nextAt: 0 };
			this.hosts.set(host, state);
		}
		return state;
	}

	async run(host, fn) {
		const key = hostGroupOf(host) || 'unknown';
		for (;;) {
			const state = this.#hostState(key);
			const now = Date.now();
			if (this.active < this.globalConcurrency && state.active < this.perHost) {
				if (state.nextAt <= now) {
					state.active += 1;
					state.nextAt = now + this.minGapMs;
					this.active += 1;
					try {
						return await fn();
					} finally {
						state.active -= 1;
						this.active -= 1;
					}
				}
				await sleep(state.nextAt - now);
				continue;
			}
			await sleep(50);
		}
	}
}

/** Run `worker` over `items` with at most `concurrency` in flight. */
export async function runPool(items, concurrency, worker) {
	let index = 0;
	const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
		while (index < items.length) {
			const item = items[index++];
			await worker(item);
		}
	});
	await Promise.all(runners);
}

const BODY_SNIFF_BYTES = 192 * 1024;

/** Read at most `limit` bytes of a response body, then cancel the rest of the download. */
async function readBodyPrefix(response, limit = BODY_SNIFF_BYTES) {
	if (!response.body) return { text: '', bytes: 0, truncated: false };
	const reader = response.body.getReader();
	const chunks = [];
	let bytes = 0;
	let truncated = false;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			bytes += value.byteLength;
			if (bytes >= limit) {
				truncated = true;
				break;
			}
		}
	} finally {
		if (truncated) await reader.cancel().catch(() => {});
	}
	const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
	return { text, bytes, truncated };
}

function frameAncestorsOf(csp) {
	if (!csp) return null;
	const directive = csp
		.split(';')
		.map((part) => part.trim())
		.find((part) => part.toLowerCase().startsWith('frame-ancestors'));
	return directive ? directive.slice('frame-ancestors'.length).trim() || "'none'" : null;
}

/**
 * Pages that answer 200 but are not the game. Each pattern was taken from a real response
 * seen while sampling the catalog, not guessed.
 */
const BODY_FLAGS = [
	['block-page', /Secure Internet at Edge|edgeportal\.det\.nsw/i],
	[
		'parked',
		/domain (?:is )?for sale|buy this domain|this domain (?:may be|is) for sale|parkingcrew|sedoparking|bodis\.com|dan\.com\/buy|afternic|hugedomains/i
	],
	[
		'not-found',
		/<title>[^<]*(?:404|not found|page not found|file not found|no such bucket|nosuchkey)[^<]*<\/title>|<Code>NoSuchKey<\/Code>|<Code>NoSuchBucket<\/Code>|There isn't a GitHub Pages site here|404: NOT_FOUND/i
	],
	[
		'removed',
		/game (?:is )?(?:no longer|not) available|this game has been removed|game not found|has been (?:deleted|removed)|content is not available|unpublished/i
	],
	['access-denied', /<title>[^<]*(?:access denied|forbidden|attention required)[^<]*<\/title>/i],
	/* Flash needs an emulator; a page that ships Ruffle is fine, a bare .swf embed is not. */
	['flash-embed', /\.swf["'?]/i],
	['ruffle', /ruffle/i],
	/* CrazyGames marks CrazyGames-exclusive builds; embedded elsewhere they show "Oooops". */
	['embed-disabled', /"disableEmbedding"\s*:\s*true/],
	/* The pre-2018 Unity browser plugin (NPAPI) — no current browser can run these. */
	['unity-webplayer', /UnityObject2?\.js|\.unity3d["'?]/i]
];

/** Tiny pages that only bounce to another URL from script. */
const JS_REDIRECT_RE =
	/(?:var\s+newUrl\s*=|(?:window\.)?location(?:\.href)?\s*=|location\.replace\()\s*\(?\s*["'](https?:\/\/[^"']+)["']/i;

function withoutHash(url) {
	const index = url.indexOf('#');
	return index >= 0 ? url.slice(0, index) : url;
}

/**
 * GET a URL the way a framing browser would and record the facts that decide whether it
 * can be played in an iframe: status, final URL, content type, framing headers, size, and
 * obvious error/parking pages.
 */
export async function probeUrl(url, opts = {}) {
	const attempts = opts.attempts ?? 3;
	let record;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		record = await probeOnce(url, opts);
		/* Only transport failures are retried; an HTTP answer is the answer. */
		if (record.s !== 0) break;
		/*
		 * A chain this machine's CA store cannot complete (Let's Encrypt's newer roots, for
		 * one) is not a dead host. Record the TLS fault and look at the page anyway.
		 */
		if (TLS_CHAIN_ERRORS.has(record.e)) {
			const insecure = await probeWithCurl(url, opts);
			if (insecure.s > 0) return { ...insecure, tls: record.e };
			break;
		}
		if (attempt < attempts) await sleep(1500 * attempt);
	}
	return record;
}

const TLS_CHAIN_ERRORS = new Set([
	'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
	'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
	'SELF_SIGNED_CERT_IN_CHAIN',
	'DEPTH_ZERO_SELF_SIGNED_CERT',
	'CERT_HAS_EXPIRED',
	'ERR_TLS_CERT_ALTNAME_INVALID'
]);

const PROBE_HEADERS = {
	'User-Agent': BROWSER_UA,
	Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
	'Accept-Language': 'en-AU,en;q=0.9',
	'Sec-Fetch-Dest': 'iframe',
	'Sec-Fetch-Mode': 'navigate'
};

/** Fill in body-derived facts: size, title, and the error/parking/format flags. */
function analyseBody(record, { text, bytes, truncated, declared }) {
	record.n = truncated && declared > 0 ? declared : bytes;
	if (truncated && !(declared > 0)) record.nt = 1;
	const title = text.match(/<title[^>]*>([^<]{0,200})<\/title>/i)?.[1];
	if (title) record.t = decodeEntities(title).replace(/\s+/g, ' ').trim().slice(0, 100);
	const head = text.slice(0, 64 * 1024);
	const flags = BODY_FLAGS.filter(([, re]) => re.test(head)).map(([name]) => name);
	if (record.ct === 'application/x-shockwave-flash') flags.push('swf');
	if (bytes < 2048) {
		const redirect = head.match(JS_REDIRECT_RE)?.[1];
		if (redirect) {
			flags.push('js-redirect');
			record.jr = redirect;
		}
	}
	if (flags.length) record.fl = flags;
	/* Keep a short body sample only when the page is suspiciously small. */
	if (bytes < 1200) record.b = text.replace(/\s+/g, ' ').trim().slice(0, 300);
}

function recordHeaders(record, get) {
	const contentType = get('content-type');
	if (contentType) record.ct = contentType.split(';')[0].trim().toLowerCase();
	const xfo = get('x-frame-options');
	if (xfo) record.xfo = xfo.trim().toUpperCase();
	const fa = frameAncestorsOf(get('content-security-policy'));
	if (fa) record.fa = fa.slice(0, 160);
}

async function probeOnce(url, { timeoutMs = 25_000, referer } = {}) {
	const started = Date.now();
	const record = { u: url };
	try {
		const response = await fetch(url, {
			redirect: 'follow',
			headers: { ...PROBE_HEADERS, ...(referer ? { Referer: referer } : {}) },
			signal: AbortSignal.timeout(timeoutMs)
		});
		record.s = response.status;
		if (response.url && withoutHash(response.url) !== withoutHash(url)) record.f = response.url;
		recordHeaders(record, (name) => response.headers.get(name));
		const declared = Number(response.headers.get('content-length'));
		const body = await readBodyPrefix(response);
		analyseBody(record, { ...body, declared });
	} catch (error) {
		record.s = 0;
		record.e = describeFetchError(error);
	}
	record.ms = Date.now() - started;
	record.at = new Date().toISOString().slice(0, 10);
	return record;
}

/** Same probe through curl without certificate verification, for TLS-chain failures only. */
async function probeWithCurl(url, { timeoutMs = 25_000 } = {}) {
	const started = Date.now();
	const marker = '\n__PROBE__';
	const args = ['-skL', '--max-time', String(Math.ceil(timeoutMs / 1000))];
	args.push('-D', '-', '-w', `${marker}%{http_code} %{url_effective}`);
	for (const [name, value] of Object.entries(PROBE_HEADERS)) args.push('-H', `${name}: ${value}`);
	args.push(url);
	const record = { u: url };
	const output = await new Promise((resolve) => {
		execFile('curl', args, { maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (_err, stdout) =>
			resolve(stdout || '')
		);
	});
	const markerAt = output.lastIndexOf(marker);
	if (markerAt < 0) return { ...record, s: 0, e: 'curl-failed', ms: Date.now() - started };
	const [code, effective] = output.slice(markerAt + marker.length).split(' ');
	record.s = Number(code) || 0;
	if (effective && withoutHash(effective) !== withoutHash(url)) record.f = effective;
	/* With -L, -D prints every hop's headers; the last block belongs to the final response. */
	const raw = output.slice(0, markerAt);
	let rest = raw;
	let headerBlock = '';
	for (;;) {
		const match = rest.match(/^HTTP\/[\d.]+ \d{3}[^]*?\r?\n\r?\n/);
		if (!match) break;
		headerBlock = match[0];
		rest = rest.slice(match[0].length);
	}
	const headers = new Map();
	for (const line of headerBlock.split(/\r?\n/).slice(1)) {
		const colon = line.indexOf(':');
		if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1));
	}
	recordHeaders(record, (name) => headers.get(name) ?? null);
	analyseBody(record, {
		text: rest,
		bytes: Buffer.byteLength(rest),
		truncated: false,
		declared: Number(headers.get('content-length'))
	});
	record.ms = Date.now() - started;
	record.at = new Date().toISOString().slice(0, 10);
	return record;
}

function describeFetchError(error) {
	const cause = error?.cause;
	const code = cause?.code || error?.code;
	const name = error?.name === 'TimeoutError' ? 'timeout' : null;
	return String(name || code || cause?.message || error?.message || error).slice(0, 120);
}

export function decodeEntities(text) {
	return String(text)
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#0?39;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&nbsp;/g, ' ');
}

/** Framing is refused for a cross-origin parent by either header. */
export function isFrameRefused(record) {
	if (!record) return false;
	if (record.xfo && /DENY|SAMEORIGIN/.test(record.xfo)) return true;
	if (record.fa) {
		const value = record.fa.toLowerCase();
		if (value.includes("'none'") || value === "'self'") return true;
	}
	return false;
}

/** mulberry32 — small, seedable, good enough for sampling. */
export function seededRandom(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function hashString(text) {
	let h = 2166136261;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
	return h >>> 0;
}

/** The launch-test sample documented in docs/catalog-quality.md: 40 per portal, seed 2026. */
export const LAUNCH_SAMPLE = { perPortal: 40, seed: 2026 };

/**
 * Stratified random sample: games grouped by portal, each group sorted by id, shuffled with
 * a seed derived from the portal name, first `perPortal` taken. Deterministic, so the
 * classifier can tell which launch results are the unbiased sample and which are top-tier
 * checks (which would inflate a portal's launch rate).
 */
export function stratifiedSample(catalog, { perPortal, seed, portal = null }) {
	const byPortal = new Map();
	for (const game of catalog) {
		const name = portalOf(game);
		if (portal && name !== portal) continue;
		if (!byPortal.has(name)) byPortal.set(name, []);
		byPortal.get(name).push(game);
	}
	const picked = [];
	for (const [name, games] of byPortal) {
		const sorted = [...games].sort((a, b) => a.id.localeCompare(b.id));
		const rand = seededRandom(seed ^ hashString(name));
		for (let i = sorted.length - 1; i > 0; i--) {
			const j = Math.floor(rand() * (i + 1));
			[sorted[i], sorted[j]] = [sorted[j], sorted[i]];
		}
		picked.push(...sorted.slice(0, perPortal));
	}
	return picked;
}
