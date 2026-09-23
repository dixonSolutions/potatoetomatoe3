#!/usr/bin/env node
/**
 * Audit every catalog game over plain HTTP: is its embed alive, can it be framed, is it a
 * parking or error page — and collect the portal's own popularity signals.
 *
 * Resumable and polite. Results are cached per portal under scripts/data/catalog-audit/,
 * so a rerun only fetches what is missing (or older than --max-age-days). A per-host
 * limiter keeps at most --per-host requests in flight to any one host, spaced by --gap ms.
 *
 * Phases:
 *   probe    GET each game's embed URL (and, for local shells, the URL their iframe points
 *            at; for Drive U 7, the gadget XML that holds the real game) → probe-<portal>.json
 *   signals  Fetch the portal's game page and read its public rating (schema.org
 *            AggregateRating) for CrazyGames, AddictingGames and Coolmath → signals-<portal>.json.
 *            Unity Play, Playhop and FNF signals already live in the importers' data.
 *
 * Usage:
 *   node --max-http-header-size=131072 scripts/audit-catalog.mjs --phase probe
 *   node scripts/audit-catalog.mjs --phase signals --portal crazygames
 *   node scripts/audit-catalog.mjs --phase probe --sample 20        # 20 per portal
 *   node scripts/audit-catalog.mjs --phase probe --ids slope,2048 --refresh
 *
 * Yandex (Playhop) hosts send header blocks larger than Node's 16 KB default, hence the flag.
 */

import { join } from 'node:path';
import {
	AUDIT_DIR,
	HostLimiter,
	JsonCache,
	decodeEntities,
	hostOf,
	loadCatalog,
	playTargetsOf,
	portalOf,
	probeUrl,
	runPool,
	sleep,
	BROWSER_UA
} from './catalog-quality/lib.mjs';

function parseArgv() {
	const args = process.argv.slice(2);
	const value = (flag, fallback) => {
		const index = args.indexOf(flag);
		return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
	};
	return {
		phase: value('--phase', 'probe'),
		portal: value('--portal', null),
		ids: value('--ids', null)?.split(',').filter(Boolean) || null,
		sample: Number(value('--sample', '0')),
		concurrency: Number(value('--concurrency', '12')),
		perHost: Number(value('--per-host', '2')),
		gapMs: Number(value('--gap', '250')),
		maxAgeDays: Number(value('--max-age-days', '30')),
		refresh: args.includes('--refresh'),
		retryFailed: args.includes('--retry-failed')
	};
}

function selectGames(catalog, opts) {
	let games = catalog;
	if (opts.ids) {
		const wanted = new Set(opts.ids);
		games = games.filter((game) => wanted.has(game.id));
	}
	if (opts.portal) games = games.filter((game) => portalOf(game) === opts.portal);
	if (opts.sample > 0) {
		const byPortal = new Map();
		for (const game of games) {
			const portal = portalOf(game);
			if (!byPortal.has(portal)) byPortal.set(portal, []);
			byPortal.get(portal).push(game);
		}
		games = [];
		for (const list of byPortal.values()) {
			const stride = Math.max(1, Math.floor(list.length / opts.sample));
			for (let i = 0, taken = 0; i < list.length && taken < opts.sample; i += stride, taken++) {
				games.push(list[i]);
			}
		}
	}
	return games;
}

function isStale(record, opts, expectedUrl) {
	if (!record) return true;
	if (opts.refresh) return true;
	if (expectedUrl && record.u !== expectedUrl && record.shell?.u !== expectedUrl) return true;
	if (opts.retryFailed && (record.s === 0 || record.s >= 400)) return true;
	const age = (Date.now() - Date.parse(record.at || 0)) / 86_400_000;
	return !(age <= opts.maxAgeDays);
}

class Progress {
	constructor(label, total) {
		this.label = label;
		this.total = total;
		this.done = 0;
		this.started = Date.now();
		this.lastLog = 0;
		this.counts = new Map();
	}

	tick(outcome) {
		this.done += 1;
		this.counts.set(outcome, (this.counts.get(outcome) || 0) + 1);
		const now = Date.now();
		if (now - this.lastLog > 10_000 || this.done === this.total) {
			this.lastLog = now;
			const rate = this.done / Math.max(1, (now - this.started) / 1000);
			const eta = Math.round((this.total - this.done) / Math.max(rate, 0.01));
			const summary = [...this.counts]
				.sort((a, b) => b[1] - a[1])
				.slice(0, 6)
				.map(([k, v]) => `${k}:${v}`)
				.join(' ');
			console.log(
				`[${this.label}] ${this.done}/${this.total} ${rate.toFixed(1)}/s eta ${eta}s  ${summary}`
			);
		}
	}
}

function outcomeOf(record) {
	if (!record) return 'none';
	if (record.s === 0) return `err`;
	if (record.fl?.length) return `${record.s}:${record.fl[0]}`;
	return String(record.s);
}

/** Round-robin across portals so one rate-limited host does not stall the whole pool. */
function interleaveByPortal(items, portalOfItem) {
	const byPortal = new Map();
	for (const item of items) {
		const portal = portalOfItem(item);
		if (!byPortal.has(portal)) byPortal.set(portal, []);
		byPortal.get(portal).push(item);
	}
	const out = [];
	for (let i = 0; out.length < items.length; i++) {
		for (const list of byPortal.values()) if (i < list.length) out.push(list[i]);
	}
	return out;
}

async function runProbe(catalog, opts) {
	const games = selectGames(catalog, opts);
	const caches = new Map();
	const cacheFor = (portal) => {
		if (!caches.has(portal)) {
			caches.set(portal, new JsonCache(join(AUDIT_DIR, `probe-${portal}.json`)));
		}
		return caches.get(portal);
	};

	const todo = [];
	for (const game of games) {
		const targets = playTargetsOf(game);
		const cache = cacheFor(portalOf(game));
		if (isStale(cache.get(game.id), opts, targets.primary)) todo.push({ game, targets });
	}
	console.log(`probe: ${games.length} selected, ${todo.length} to fetch`);
	if (!todo.length) return;

	const limiter = new HostLimiter({
		globalConcurrency: opts.concurrency,
		perHost: opts.perHost,
		minGapMs: opts.gapMs
	});
	const progress = new Progress('probe', todo.length);

	const interleaved = interleaveByPortal(todo, (item) => portalOf(item.game));

	const flushTimer = setInterval(() => {
		for (const cache of caches.values()) cache.flush();
	}, 30_000);

	await runPool(interleaved, opts.concurrency * 2, async ({ game, targets }) => {
		const record = {};
		if (targets.kind === 'shell') {
			record.shell = { bytes: targets.shell.bytes ?? null, reason: targets.shell.reason };
			if (targets.shell.url) record.shell.u = targets.shell.url;
		}
		if (targets.primary) {
			const host = hostOf(targets.primary);
			const main = await limiter.run(host, () => probeUrl(targets.primary));
			Object.assign(record, main);
			/* Playhop re-publishes builds behind a tiny script redirect; check the new build. */
			if (main.jr) {
				const next = await limiter.run(hostOf(main.jr), () => probeUrl(main.jr));
				record.jrs = { s: next.s, ct: next.ct, n: next.n, t: next.t, fl: next.fl, e: next.e };
			}
		} else {
			Object.assign(record, { s: -1, e: targets.shell?.reason || 'no-target' });
			record.at = new Date().toISOString().slice(0, 10);
		}
		if (targets.secondary) {
			const host = hostOf(targets.secondary);
			const inner = await limiter.run(host, () => probeUrl(targets.secondary));
			delete inner.at;
			record.inner = inner;
		}
		cacheFor(portalOf(game)).set(game.id, record);
		progress.tick(outcomeOf(record));
	});

	clearInterval(flushTimer);
	for (const cache of caches.values()) cache.flush();
}

/* ------------------------------------------------------------------ signals */

const SIGNAL_SOURCES = {
	crazygames: (game) => game.crazygamesPageUrl,
	addictinggames: (game) => game.addictingPageUrl,
	coolmath: (game) => game.coolmathPageUrl,
	/*
	 * Every Unity Play frame URL answers with the same SPA shell, so it says nothing about
	 * whether the game still exists. The public game API does: 403 once a game is gone, and
	 * live plays/likes, moderation state and the student/tutorial flags while it exists.
	 */
	'unity-play': (game) =>
		game.unityPlayGameId ? `https://play.unity.com/api/v1/games/game/${game.unityPlayGameId}` : null
};

/** Keep the Unity Play API fields that bear on quality; drop the rest of the payload. */
function parseUnityApi(json) {
	return {
		plays: json.plays,
		views: json.views,
		likes: json.likes,
		created: String(json.createdAt || '').slice(0, 10) || undefined,
		updated: String(json.updatedAt || '').slice(0, 10) || undefined,
		status: json.status,
		moderation: json.moderation,
		visibility: json.visibility,
		student: json.isStudent || undefined,
		tutorial: json.tutorialId || undefined,
		showcase: json.isShowcaseWinner ? 'winner' : json.isShowcaseSubmission ? 'entry' : undefined,
		mobile: json.hasMobileControls || undefined,
		hidden: json.hideFromAutomaticCategories || undefined,
		store:
			json.steamStoreUrl || json.googlePlayStoreUrl || json.appleAppStoreUrl ? true : undefined,
		attrs: Array.isArray(json.attributes) && json.attributes.length ? json.attributes : undefined
	};
}

/** Read schema.org AggregateRating, plus CrazyGames' own vote counts when present. */
function parseRatingSignals(html) {
	const out = {};
	const rating = html.match(/"aggregateRating"\s*:\s*\{([^}]*)\}/);
	if (rating) {
		const block = rating[1];
		const num = (key) => {
			const m = block.match(new RegExp(`"${key}"\\s*:\\s*"?([0-9.]+)`));
			return m ? Number(m[1]) : undefined;
		};
		out.r = num('ratingValue');
		out.rc = num('ratingCount');
		out.best = num('bestRating');
	}
	const up = html.match(/"upvotes"\s*:\s*(\d+)/);
	const down = html.match(/"downvotes"\s*:\s*(\d+)/);
	if (up) out.up = Number(up[1]);
	if (down) out.down = Number(down[1]);
	const published = html.match(/"datePublished"\s*:\s*"([0-9-]{10})/);
	if (published) out.pub = published[1];
	const kids = html.match(/"isKids"\s*:\s*(true|false)/);
	if (kids) out.kids = kids[1] === 'true';
	const title = html.match(/<title[^>]*>([^<]{0,200})<\/title>/i)?.[1];
	if (title) out.t = decodeEntities(title).trim().slice(0, 100);
	return out;
}

async function fetchSignalPage(url) {
	let record;
	for (let attempt = 1; attempt <= 3; attempt++) {
		record = await fetchSignalPageOnce(url);
		if (record.s !== 0 && record.s !== 429 && record.s < 500) break;
		await sleep(2000 * attempt);
	}
	return record;
}

async function fetchSignalPageOnce(url) {
	const record = {};
	try {
		const response = await fetch(url, {
			redirect: 'follow',
			headers: {
				'User-Agent': BROWSER_UA,
				Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
				'Accept-Language': 'en-AU,en;q=0.9'
			},
			signal: AbortSignal.timeout(30_000)
		});
		record.s = response.status;
		if (response.url && response.url !== url) record.f = response.url;
		const body = await response.text();
		if (/application\/json/.test(response.headers.get('content-type') || '')) {
			if (response.ok) Object.assign(record, parseUnityApi(JSON.parse(body)));
		} else {
			Object.assign(record, parseRatingSignals(body));
		}
	} catch (error) {
		record.s = 0;
		record.e = String(error?.cause?.code || error?.name || error).slice(0, 80);
	}
	record.at = new Date().toISOString().slice(0, 10);
	return record;
}

async function runSignals(catalog, opts) {
	const games = selectGames(catalog, opts).filter((game) => SIGNAL_SOURCES[portalOf(game)]);
	const caches = new Map();
	const cacheFor = (portal) => {
		if (!caches.has(portal)) {
			caches.set(portal, new JsonCache(join(AUDIT_DIR, `signals-${portal}.json`)));
		}
		return caches.get(portal);
	};
	const todo = games.filter((game) => {
		const record = cacheFor(portalOf(game)).get(game.id);
		return (
			isStale(record, opts, null) ||
			(opts.retryFailed && record?.r == null && record?.plays == null)
		);
	});
	console.log(`signals: ${games.length} selected, ${todo.length} to fetch`);
	if (!todo.length) return;

	const limiter = new HostLimiter({
		globalConcurrency: opts.concurrency,
		perHost: opts.perHost,
		minGapMs: opts.gapMs
	});
	const progress = new Progress('signals', todo.length);
	const flushTimer = setInterval(() => {
		for (const cache of caches.values()) cache.flush();
	}, 30_000);

	const interleaved = interleaveByPortal(todo, portalOf);
	await runPool(interleaved, opts.concurrency * 2, async (game) => {
		const url = SIGNAL_SOURCES[portalOf(game)](game);
		if (!url) return;
		const record = await limiter.run(hostOf(url), () => fetchSignalPage(url));
		cacheFor(portalOf(game)).set(game.id, record);
		const hasSignal = record.r != null || record.plays != null;
		progress.tick(record.s === 200 ? (hasSignal ? 'ok' : 'no-signal') : `http-${record.s}`);
	});

	clearInterval(flushTimer);
	for (const cache of caches.values()) cache.flush();
}

async function main() {
	const opts = parseArgv();
	const catalog = loadCatalog();
	if (opts.phase === 'probe') await runProbe(catalog, opts);
	else if (opts.phase === 'signals') await runSignals(catalog, opts);
	else {
		console.error(`Unknown --phase ${opts.phase} (probe | signals)`);
		process.exit(1);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
