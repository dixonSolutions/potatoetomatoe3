#!/usr/bin/env node
/**
 * Classify every catalog game into a quality tier with a numeric score, from:
 *
 *   - portal popularity / ratings (Unity Play API, CrazyGames / AddictingGames / Coolmath
 *     page ratings, Playhop and FNF ratings the importers stored),
 *   - the HTTP probe (dead, parked, unframeable, Flash, Unity Web Player, wrong game),
 *   - real-browser launch tests (scripts/verify-game-launches.mjs --record),
 *   - title / description heuristics (templates, tests, tutorials, memes),
 *   - duplicates (shared embed URL, same title within and across portals).
 *
 * Writes scripts/data/catalog-quality.json. The generator carries each game's score and
 * DoE status into the catalog index; see docs/catalog-quality.md for the method.
 *
 * Usage:
 *   node scripts/catalog-quality/classify.mjs
 *   node scripts/catalog-quality/classify.mjs --candidates 700 > ids.txt   # launch-test list
 *   node scripts/catalog-quality/classify.mjs --spot 20                     # random per tier
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
	AUDIT_DIR,
	DATA_DIR,
	GAMES_ROOT,
	HOST_STATUS_PATH,
	QUALITY_PATH,
	LAUNCH_SAMPLE,
	isFrameRefused,
	loadCatalog,
	portalOf,
	readJson,
	stratifiedSample,
	writeKeyedJsonLines
} from './lib.mjs';
import { playHostsOf } from './host-status.mjs';
import { cleanDisplayName, isTitleMismatch, titleKey, titleSignals } from './heuristics.mjs';
import { KEEP_IDS, NSFW_RE } from '../lib/catalog-quality.mjs';

/**
 * Starting point for a game with no signals of its own, by how its portal curates.
 * Coolmath and CrazyGames review every title; Unity Play accepts any upload.
 */
const PORTAL_PRIOR = {
	coolmath: 0.74,
	crazygames: 0.7,
	github: 0.7,
	addictinggames: 0.58,
	local: 0.6,
	playhop: 0.55,
	'fnf-games': 0.5,
	'drive-u-7': 0.45,
	'unity-play': 0.3
};

/** Same patterns scripts/verify-game-launches.mjs reports as PORTAL_REFUSED. */
const PORTAL_REFUSAL_RE =
	/can be played (?:only|exclusively) on|can only be played on|only playable on|is no longer available|this game has been removed/i;

/** Intrinsic quality needed for featured (with a verified launch) and for good. */
const FEATURED_MIN_Q = 0.64;
const GOOD_MIN_Q = 0.56;
/** Launch odds below this keep a game out of good: relay-only, or a portal that mostly fails. */
const GOOD_MIN_LAUNCH = 0.25;

/** Tier → [low, high] of the published 0–99 score. Order matters: it is the ranking. */
export const TIER_BANDS = {
	featured: [80, 99],
	good: [60, 79],
	ok: [40, 59],
	joke: [20, 39],
	test: [10, 19],
	broken: [0, 9]
};

const DOE_CODE = { blocked: 'b', 'likely-blocked': 'l', 'likely-allowed': 'a', unknown: '?' };
const DOE_RANK = { blocked: 3, 'likely-blocked': 2, unknown: 1, 'likely-allowed': 0 };

/** A shell host that only bounces visitors to an ad network (seen in launch tests). */
const AD_REDIRECT_HOSTS = new Set(['let3r45jj02l930rzh903me09f3g9lhh5fz66play356hhjz30.com']);

/*
 * Lapsed game domains that now serve something else. Every pattern is from a real probe:
 * Vietnamese bookmakers ("Nhà Cái Uy Tín … Kèo"), a football-streaming/betting site, an
 * "Australia Casino … No Deposit Bonus" page, and domain-sale landing pages.
 */
const HIJACKED_TITLE_RE =
	/nhà cái|chơi kèo|bóng đá|no deposit bonus|welcome offer|domain names? for sale|brandable domain|for sale\s*[—–-]\s*compact|expireddomains/i;
const DOMAIN_MARKET_HOSTS_RE =
	/(?:^|\.)(?:atom\.com|flyingstart\.co|expireddomains\.com|dan\.com|afternic\.com|sedo\.com|hugedomains\.com|apps\.apple\.com|play\.google\.com)$/;

/** example.co.uk-style suffixes are rare here; two labels is close enough to "same site". */
function siteOf(host) {
	return String(host || '')
		.split('.')
		.slice(-2)
		.join('.');
}

function parseArgv() {
	const args = process.argv.slice(2);
	const value = (flag, fallback) => {
		const index = args.indexOf(flag);
		return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
	};
	return {
		candidates: Number(value('--candidates', '0')),
		spot: Number(value('--spot', '0')),
		seed: Number(value('--seed', '11'))
	};
}

function loadPortalCaches(prefix) {
	const out = new Map();
	for (const portal of Object.keys(PORTAL_PRIOR)) {
		const cache = readJson(join(AUDIT_DIR, `${prefix}-${portal}.json`));
		for (const [id, record] of Object.entries(cache?.results || {})) out.set(id, record);
	}
	return out;
}

/* ------------------------------------------------------------------ signals */

/**
 * The portal's own verdict on a game, as { rating 0–1, votes, plays }. Ratings are
 * Bayesian-smoothed later against the portal mean, so a 10/10 from three votes does not
 * outrank a 9/10 from thirty thousand.
 */
function portalSignal(game, signals, unityCatalog) {
	const portal = portalOf(game);
	const page = signals.get(game.id);
	switch (portal) {
		case 'crazygames':
		case 'addictinggames':
		case 'coolmath': {
			if (!page || page.r == null) return null;
			const best = page.best || (portal === 'crazygames' ? 10 : 5);
			return { rating: page.r / best, votes: page.rc || 0 };
		}
		case 'playhop':
			return game.playhopRating != null
				? { rating: game.playhopRating / 5, votes: game.playhopRatingCount || 0 }
				: null;
		case 'fnf-games':
			return game.portalRating != null
				? { rating: game.portalRating / 10, votes: game.portalRatingCount || 0 }
				: null;
		case 'unity-play': {
			const live = page?.s === 200 ? page : null;
			const stored = unityCatalog.get(game.unityPlayGameId);
			const plays = live?.plays ?? stored?.plays ?? 0;
			const likes = live?.likes ?? stored?.likes ?? 0;
			/*
			 * Unity Play shows plays and likes, no rating. Likes are rare (75 % have none), so
			 * likes per play is the closest thing to approval; negative likes mean players
			 * actively down-voted it.
			 */
			const rating = Math.max(0, Math.min(1, 0.5 + Math.log10(1 + Math.max(0, likes)) / 5));
			return { rating: likes < 0 ? 0.1 : rating, votes: Math.max(0, likes), plays };
		}
		default:
			return null;
	}
}

/** Percentile rank of each value within its list (ties share the mid rank). */
function percentileRanks(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const cache = new Map();
	return (value) => {
		if (cache.has(value)) return cache.get(value);
		let lo = 0;
		let hi = sorted.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (sorted[mid] < value) lo = mid + 1;
			else hi = mid;
		}
		let end = lo;
		while (end < sorted.length && sorted[end] === value) end++;
		const rank = sorted.length > 1 ? (lo + end - 1) / 2 / (sorted.length - 1) : 0.5;
		cache.set(value, rank);
		return rank;
	};
}

/* ------------------------------------------------------------------ probe verdicts */

/**
 * What the HTTP probe says about launching this game.
 * @returns {{ dead?: string, relayOnly?: string, flags: string[] }}
 */
function probeVerdict(game, probe, unitySignal) {
	const flags = [];
	/*
	 * Drive U 7 plays through the `local` route: the catalog's own online/embed.html, one
	 * per game, which frames the game from jsDelivr (often in Ruffle). The Google Sites page
	 * and the shared jsDelivr file the probe fetched are not what the app runs, so they
	 * cannot make the game dead, a duplicate or the wrong game.
	 */
	if (game.localEmbed) {
		if (!existsSync(join(GAMES_ROOT, game.id, 'online', 'embed.html'))) {
			return { dead: 'no-local-embed', flags };
		}
		return { flags: ['local-route'] };
	}
	if (!probe) return { flags: ['unprobed'] };
	const shellHost = probe.shell?.u ? new URL(probe.shell.u).hostname : null;
	if (shellHost && AD_REDIRECT_HOSTS.has(shellHost)) return { dead: 'ad-redirect', flags };
	/* A shell with no iframe is a page of its own, framed as it is by the direct route. */
	if (probe.s === -1 && probe.e === 'no-iframe') return { flags: ['self-contained-shell'] };
	if (probe.s === -1) return { dead: `no-target:${probe.e || 'shell'}`, flags };
	if (probe.s === 0) return { dead: `unreachable:${probe.e || 'error'}`, flags };
	if (probe.s >= 400) return { dead: `http-${probe.s}`, flags };
	if (HIJACKED_TITLE_RE.test(`${probe.t || ''} ${probe.jrs?.t || ''}`)) {
		return { dead: 'hijacked-domain', flags };
	}
	if (probe.f) {
		const from = new URL(probe.u).hostname;
		const to = new URL(probe.f).hostname;
		if (DOMAIN_MARKET_HOSTS_RE.test(to)) return { dead: `redirects-to:${to}`, flags };
		/* Sent to another site whose page is not this game: the listing no longer holds. */
		if (siteOf(from) !== siteOf(to) && isTitleMismatch(game.name, probe.t)) {
			return { dead: `redirects-away:${to}`, flags };
		}
	}
	const fl = new Set(probe.fl || []);
	if (fl.has('parked')) return { dead: 'parked-domain', flags };
	if (fl.has('embed-disabled')) return { dead: 'portal-exclusive', flags };
	if (fl.has('not-found')) return { dead: 'not-found-page', flags };
	/*
	 * A bare .swf: no frame can show it, but the desktop app's relay serves it in Ruffle
	 * (src-tauri/src/relay.rs). Plays on desktop only — not broken, but capped at ok.
	 */
	if (fl.has('swf')) return { relayOnly: 'flash-via-relay', flags };
	if (fl.has('unity-webplayer')) return { dead: 'unity-web-player-plugin', flags };
	if (fl.has('flash-embed') && !fl.has('ruffle')) return { dead: 'flash-no-emulator', flags };
	if (probe.jrs && (probe.jrs.s === 0 || probe.jrs.s >= 400)) {
		return { dead: `redirect-target-${probe.jrs.s || 'unreachable'}`, flags };
	}
	if (probe.inner && (probe.inner.s === 0 || probe.inner.s >= 400)) {
		return { dead: `gadget-${probe.inner.s || 'unreachable'}`, flags };
	}
	if (portalOf(game) === 'unity-play' && unitySignal) {
		if (unitySignal.s === 403 || unitySignal.s === 404)
			return { dead: 'unity-game-deleted', flags };
		if (unitySignal.status && unitySignal.status !== 'valid') {
			return { dead: `unity-status-${unitySignal.status}`, flags };
		}
		if (unitySignal.moderation && unitySignal.moderation !== 'public') {
			flags.push(`unity-moderation-${unitySignal.moderation}`);
		}
	}
	if (fl.has('removed')) flags.push('removed-text');
	if (probe.tls) flags.push('tls-chain');
	if (isFrameRefused(probe)) return { relayOnly: 'frame-refused', flags };
	/* jsDelivr serves .html as text/plain; the browser shows source unless relayed. */
	if (probe.ct === 'text/plain' && /\.html?(?:$|\?)/i.test(probe.u)) {
		return { relayOnly: 'html-as-text', flags };
	}
	return { flags };
}

/* ------------------------------------------------------------------ launch verdicts */

/**
 * @returns {{ verified: boolean, failed: boolean, attempts: number, how?: string }}
 */
function launchVerdict(record, verdict, game) {
	if (!record) return { verified: false, failed: false, attempts: 0 };
	/* A test of a route the app does not use for this game (Drive U 7's remote URL) says nothing. */
	const route = game.localEmbed ? 'local' : 'direct';
	if ((record.route || 'direct') !== route) return { verified: false, failed: false, attempts: 0 };
	const hist = record.hist || '';
	/*
	 * Only a strict pass counts as verified: the screen settled into a rich game picture
	 * with no loading text. Earlier, looser passes (Coolmath and CrazyGames loaders counted
	 * as launches, found by reviewing screenshots) are unconfirmed until re-tested.
	 */
	if (record.status === 'LAUNCHED' && record.strict) {
		return { verified: true, failed: false, attempts: hist.length };
	}
	if (record.status === 'LAUNCHED' || record.status === 'LOADER') {
		return { verified: false, failed: false, attempts: hist.length, status: record.status };
	}
	/*
	 * The launch test frames games directly, like the web and Android builds. A game whose
	 * host refuses framing is expected to fail there and still plays through the desktop
	 * relay, so a direct failure is not proof it is broken everywhere.
	 */
	if (verdict?.relayOnly) {
		return { verified: false, failed: false, attempts: hist.length, status: record.status };
	}
	/*
	 * Failed on a retry with the generous timeout (≥150 s): believe it — unless a canvas
	 * was there and simply never drew. Unity builds that launched in 15 s early in the run
	 * stayed blank later on the same machine under load, so a blank canvas says more about
	 * the test machine than the game. Those stay unconfirmed.
	 */
	const retried =
		hist.length >= 2 && (record.timeout || 0) >= 150_000 && record.status !== 'BLANK_CANVAS';
	/*
	 * The browser refused the frame, or the portal did ("can be played exclusively on
	 * CrazyGames.com", "Gone"): no amount of waiting changes that.
	 */
	const refused =
		record.status === 'FRAME_ERROR' ||
		record.status === 'PORTAL_REFUSED' ||
		(record.text || []).some((t) => PORTAL_REFUSAL_RE.test(t));
	/*
	 * The launch test covers the first route that needs no desktop relay. Any game with an
	 * online URL also has the desktop relay in its chain (planOnlineRoutes), which was not
	 * tested, so failing here fails one route, not every route: the game is not broken, it
	 * just is not known to play on the web and Android builds. Only a portal refusal
	 * ("exclusively on CrazyGames.com" checks the page's own origin, which no relay can
	 * fake) or a game with no other route (a catalog shell) counts as failed everywhere.
	 */
	const failedHere = retried || refused;
	const hasOtherRoute = Boolean(game.onlineEmbedUrl || game.remotePlayUrl);
	const everyRoute =
		failedHere &&
		(record.status === 'PORTAL_REFUSED' ||
			(record.text || []).some((t) => PORTAL_REFUSAL_RE.test(t)) ||
			!hasOtherRoute);
	return {
		verified: false,
		failed: everyRoute,
		firstRouteFailed: failedHere && !everyRoute,
		hardFail: refused || /N$/.test(hist),
		attempts: hist.length,
		status: record.status
	};
}

/* ------------------------------------------------------------------ main */

function seededRandom(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function classifyCatalog() {
	const catalog = loadCatalog();
	const probes = loadPortalCaches('probe');
	const signals = loadPortalCaches('signals');
	const launches = readJson(join(AUDIT_DIR, 'launch.json'))?.results || {};
	const hostStatus = readJson(HOST_STATUS_PATH)?.hosts || {};
	const unityCatalog = new Map(
		(readJson(join(DATA_DIR, 'unity-play-catalog.json'))?.games || []).map((g) => [g.id, g])
	);

	/* ---- per-game raw facts ---- */
	const rows = catalog.map((game) => {
		const portal = portalOf(game);
		const probe = probes.get(game.id);
		const signal = portalSignal(game, signals, unityCatalog);
		const unityApi = portal === 'unity-play' ? signals.get(game.id) : null;
		const verdict = probeVerdict(game, probe, unityApi);
		const launch = launchVerdict(launches[game.id], verdict, game);
		const text = titleSignals(game);
		const hosts = playHostsOf(game, probe);
		let doe = 'likely-allowed';
		const doeHosts = [];
		for (const host of hosts.keys()) {
			const status = hostStatus[host]?.status || 'unknown';
			doeHosts.push(`${host}:${status}`);
			if (DOE_RANK[status] > DOE_RANK[doe]) doe = status;
		}
		if (!hosts.size) doe = 'unknown';
		return { game, portal, probe, signal, unityApi, verdict, launch, text, doe, doeHosts };
	});

	/*
	 * ---- portal launch rates from the random sample only ----
	 * Top-tier candidates are launch-tested too, but they are the portal's best games and
	 * would inflate its rate; only the seeded stratified sample estimates it.
	 */
	const sampleIds = new Set(stratifiedSample(catalog, LAUNCH_SAMPLE).map((game) => game.id));
	const portalLaunch = {};
	for (const row of rows) {
		const bucket = (portalLaunch[row.portal] ||= {
			tested: 0,
			launched: 0,
			painted: 0,
			unsure: 0,
			failed: 0
		});
		if (row.launch.attempts && sampleIds.has(row.game.id)) {
			bucket.tested += 1;
			if (row.launch.verified) bucket.launched += 1;
			else if (row.launch.failed || row.launch.hardFail) bucket.failed += 1;
			/* Passed the looser first-pass check and was not re-tested under the strict one. */ else if (
				row.launch.status === 'LAUNCHED'
			)
				bucket.painted += 1;
			/* Painted but unconfirmed (a DOM game, a loader, still loading at the deadline). */ else
				bucket.unsure += 1;
		}
	}
	for (const bucket of Object.values(portalLaunch)) {
		/*
		 * Laplace-smoothed so a portal with three tests cannot claim 100 %. A loose pass
		 * counts three quarters of a launch, an unconfirmed result under half: most loose
		 * passes that were re-tested held, most unconfirmed ones were slow loaders.
		 */
		const credit = bucket.launched + 0.75 * bucket.painted + 0.4 * bucket.unsure;
		bucket.rate = Math.round(((credit + 1) / (bucket.tested + 2)) * 1000) / 1000;
	}

	/* ---- per-portal percentiles of rating and popularity ---- */
	const byPortal = new Map();
	for (const row of rows) {
		if (!row.signal) continue;
		if (!byPortal.has(row.portal)) byPortal.set(row.portal, []);
		byPortal.get(row.portal).push(row);
	}
	const portalStats = {};
	for (const [portal, list] of byPortal) {
		const rated = list.filter((row) => row.signal.votes > 0 || row.signal.plays != null);
		const meanRating =
			rated.reduce((sum, row) => sum + row.signal.rating * Math.max(1, row.signal.votes), 0) /
			Math.max(
				1,
				rated.reduce((sum, row) => sum + Math.max(1, row.signal.votes), 0)
			);
		/* Prior weight: the portal's median vote count, so thin ratings lean on the mean. */
		const votesSorted = rated.map((row) => row.signal.votes).sort((a, b) => a - b);
		const m = Math.max(5, votesSorted[Math.floor(votesSorted.length / 2)] || 5);
		for (const row of list) {
			const { rating, votes } = row.signal;
			row.bayes = (rating * votes + meanRating * m) / (votes + m);
			row.popularity = Math.log10(1 + (row.signal.plays ?? votes));
		}
		const ratingRank = percentileRanks(list.map((row) => row.bayes));
		const popRank = percentileRanks(list.map((row) => row.popularity));
		for (const row of list) {
			row.ratingPct = ratingRank(row.bayes);
			row.popPct = popRank(row.popularity);
		}
		portalStats[portal] = { meanRating: Math.round(meanRating * 1000) / 1000, priorVotes: m };
	}

	/* ---- borrow signals across portals for unrated mirrors (same title) ---- */
	const bestByTitle = new Map();
	for (const row of rows) {
		row.key = titleKey(row.game.name);
		if (row.ratingPct == null || !row.key) continue;
		const merit = 0.5 * row.ratingPct + 0.5 * row.popPct;
		const current = bestByTitle.get(row.key);
		if (!current || merit > current.merit) bestByTitle.set(row.key, { merit, row });
	}

	/* ---- intrinsic quality Q ---- */
	for (const row of rows) {
		const prior = PORTAL_PRIOR[row.portal] ?? 0.5;
		const reasons = [];
		let ratingPct = row.ratingPct;
		let popPct = row.popPct;
		if (ratingPct == null) {
			const borrowed = bestByTitle.get(row.key);
			if (borrowed && borrowed.row.portal !== row.portal) {
				ratingPct = borrowed.row.ratingPct;
				popPct = borrowed.row.popPct;
				reasons.push(`rated-as:${borrowed.row.game.id}`);
			} else {
				ratingPct = 0.5;
				popPct = 0.5;
				reasons.push('no-signal');
			}
		}
		let q = 0.4 * prior + 0.35 * ratingPct + 0.25 * popPct;

		const thumbnail = String(row.game.thumbnail || '').trim();
		if (!thumbnail || thumbnail.endsWith('.gitkeep')) {
			q -= 0.08;
			reasons.push('no-thumbnail');
		}
		if (row.text.lowEffort.includes('no-description')) q -= 0.04;
		if (row.portal === 'unity-play' && row.unityApi?.s === 200) {
			if (row.unityApi.showcase === 'winner') {
				q += 0.1;
				reasons.push('unity-showcase-winner');
			} else if (row.unityApi.showcase === 'entry') {
				q += 0.04;
				reasons.push('unity-showcase');
			}
			if (row.unityApi.store) {
				q += 0.05;
				reasons.push('store-listing');
			}
			if (row.unityApi.student) q -= 0.03;
		}
		row.q = Math.max(0, Math.min(1, q));
		row.reasons = reasons;
	}

	/* ---- duplicates: shared embed URL, then same title ---- */
	const byEmbed = new Map();
	for (const row of rows) {
		/* Drive U 7 plays its own per-game embed.html, so a shared remote file is no duplicate. */
		if (row.game.localEmbed) continue;
		const url = row.game.onlineEmbedUrl?.split('#')[0] || row.probe?.shell?.u;
		if (!url) continue;
		if (!byEmbed.has(url)) byEmbed.set(url, []);
		byEmbed.get(url).push(row);
	}
	for (const group of byEmbed.values()) {
		if (group.length < 2) continue;
		/* The page title says which entry the shared file really is, when it says anything. */
		const pageTitle = group[0].probe?.t;
		const matching = group.filter((row) => !isTitleMismatch(row.game.name, pageTitle));
		const keep = (matching.length ? matching : group).sort((a, b) => b.q - a.q)[0];
		for (const row of group) {
			if (row === keep) continue;
			row.duplicateOf = keep.game.id;
			/* The shared page names another game: this entry was mislabelled, not re-uploaded. */
			if (matching.length && !matching.includes(row)) row.wrongGame = pageTitle;
			row.reasons.push(`same-embed-as:${keep.game.id}`);
		}
	}
	const byTitle = new Map();
	for (const row of rows) {
		if (!row.key || row.duplicateOf) continue;
		if (!byTitle.has(row.key)) byTitle.set(row.key, []);
		byTitle.get(row.key).push(row);
	}
	for (const group of byTitle.values()) {
		if (group.length < 2) continue;
		group.sort((a, b) => b.q - a.q);
		const [best, ...rest] = group;
		for (const row of rest) {
			const author = String(row.game.author || '').toLowerCase();
			if (
				row.portal === 'unity-play' &&
				best.portal === 'unity-play' &&
				author === String(best.game.author || '').toLowerCase()
			) {
				/* Same uploader, same title: a re-upload of one project. */
				row.duplicateOf = best.game.id;
				row.reasons.push(`reupload-of:${best.game.id}`);
			} else if (row.portal !== best.portal) {
				/*
				 * Another portal's copy of the same game: keep it, rank it behind the best
				 * one. Same-portal title clashes on curated portals are sequels and remakes
				 * ("Aurie" / "Aurie+"), not copies.
				 */
				row.q = Math.max(0, row.q - 0.06);
				row.reasons.push(`copy-of:${best.game.id}`);
			}
		}
	}

	/* ---- tier assignment ---- */
	for (const row of rows) {
		const { game, verdict, launch, text } = row;
		const portalRate = portalLaunch[row.portal]?.rate ?? 0.5;
		let launchP;
		if (launch.verified) launchP = 1;
		else if (launch.failed) launchP = 0;
		else if (verdict.dead) launchP = 0;
		/* Failed the web/Android route; only the untested desktop relay is left. */ else if (
			launch.firstRouteFailed
		)
			launchP = 0.1;
		/* Plays only through the desktop app's relay; never on the web or Android builds. */ else if (
			verdict.relayOnly
		)
			launchP = 0.2;
		else if (launch.attempts) launchP = portalRate * 0.5;
		else launchP = portalRate;
		row.launchP = launchP;

		const title = cleanDisplayName(game.name);
		if (verdict.dead) {
			row.tier = 'broken';
			row.reasons.unshift(verdict.dead);
		} else if (launch.failed) {
			row.tier = 'broken';
			row.reasons.unshift(`launch-failed:${launch.status}`);
		} else if (wrongGameOf(row)) {
			row.tier = 'broken';
			row.reasons.unshift(`wrong-game:${wrongGameOf(row)}`);
		} else if (NSFW_RE.test(title) && !KEEP_IDS.has(game.id)) {
			row.tier = 'test';
			row.reasons.unshift('nsfw');
		} else if (
			row.duplicateOf &&
			row.reasons.some((r) => r.startsWith('same-embed-as') || r.startsWith('reupload-of'))
		) {
			row.tier = 'test';
			row.reasons.unshift('duplicate');
		} else if (isTestUpload(row)) {
			row.tier = 'test';
		} else if (text.joke.length) {
			row.tier = 'joke';
			row.reasons.unshift(...text.joke);
		} else {
			row.tier = null; /* decided below, relative to the rest of the catalog */
		}
		row.reasons.push(...verdict.flags);
		if (verdict.relayOnly) row.reasons.push(`relay-only:${verdict.relayOnly}`);
	}

	/* featured / good / ok among the playable, serious rest. */
	const eligible = rows.filter((row) => row.tier === null);
	/*
	 * Tiers follow intrinsic quality q; launch odds only gate them. Letting a 22-game launch
	 * sample decide "good" swung thousands of games between tiers from one rerun to the next.
	 * Featured needs a verified launch; good needs better-than-even-odds evidence against
	 * nothing (not relay-only, portal not mostly failing).
	 */
	const merit = (row) => row.q * (0.35 + 0.65 * row.launchP);
	for (const row of eligible) {
		/* A card with no cover looks broken next to the rest; it cannot lead the catalog. */
		const hasCover = !row.reasons.includes('no-thumbnail');
		if (hasCover && row.launch.verified && row.q >= FEATURED_MIN_Q) row.tier = 'featured';
		else if (hasCover && row.q >= GOOD_MIN_Q && row.launchP >= GOOD_MIN_LAUNCH) row.tier = 'good';
		else row.tier = 'ok';
	}

	/* ---- banded score ---- */
	const byTier = new Map();
	for (const row of rows) {
		if (!byTier.has(row.tier)) byTier.set(row.tier, []);
		byTier.get(row.tier).push(row);
	}
	for (const [tier, list] of byTier) {
		const [low, high] = TIER_BANDS[tier];
		const rank = percentileRanks(list.map((row) => merit(row)));
		for (const row of list) row.score = Math.round(low + (high - low) * rank(merit(row)));
	}

	return { rows, portalLaunch, portalStats };
}

/**
 * Development tests, templates and junk uploads. Popular games keep their tier even with
 * a throwaway name: 50,000 plays of "Game" means players found something there.
 */
/**
 * The entry points at a different game than it names. Drive U 7 reuses one jsDelivr file
 * for several titles; the Playhop importer stored another app's build for 88 entries
 * ("Chess" loads Tank Stars, "Backgammon" loads a sniper game).
 * @returns {string | null} what it actually loads, when known
 */
function wrongGameOf(row) {
	const { game, probe } = row;
	if (row.wrongGame) return String(row.wrongGame).slice(0, 40);
	if (row.portal === 'playhop') {
		const embedApp = String(game.onlineEmbedUrl || '').match(/\/\/app-(\d+)\./)?.[1];
		if (embedApp && game.playhopAppId && Number(embedApp) !== Number(game.playhopAppId)) {
			return `app-${embedApp}`;
		}
	}
	if (
		row.portal === 'drive-u-7' &&
		!game.localEmbed &&
		isTitleMismatch(game.name, probe?.t) &&
		!/^classroom resources/i.test(probe?.t || '')
	) {
		return String(probe?.t).slice(0, 40);
	}
	return null;
}

function isTestUpload(row) {
	const { text, portal } = row;
	const plays = row.signal?.plays ?? null;
	const votes = row.signal?.votes ?? 0;
	/* A Unity showcase win is an editorial pick, whatever template the game started from. */
	const popular =
		(plays != null && plays >= 5000) || votes >= 50 || row.unityApi?.showcase === 'winner';
	const reasons = [];
	/* Spam and ad-bounce uploads are junk wherever they are and however "popular". */
	for (const reason of ['spam', 'redirect-description']) {
		if (text.test.includes(reason)) reasons.push(reason);
	}
	if (portal === 'unity-play' && row.unityApi?.likes < 0) reasons.push('negative-likes');
	/*
	 * Name/description templates only mean "test upload" on an open upload site. On a
	 * curated portal or a mirror, "2048" or "31" is simply the game's name.
	 */
	if (portal === 'unity-play' && !popular) {
		for (const reason of text.test) if (!reasons.includes(reason)) reasons.push(reason);
		if (text.lowEffort.includes('microgame-template') && (plays ?? 0) < 2000) {
			reasons.push('microgame-template');
		}
		if (row.unityApi?.tutorial) reasons.push('unity-tutorial');
	}
	if (!reasons.length) return false;
	row.reasons.unshift(...reasons);
	return true;
}

function main() {
	const opts = parseArgv();
	const { rows, portalLaunch, portalStats } = classifyCatalog();

	if (opts.candidates) {
		/*
		 * Games that would be featured if they launched: launch-test these, best first, so
		 * everything in the top tier has been seen to load.
		 */
		const pending = rows
			.filter((row) => row.tier === 'good' || row.tier === 'ok')
			.filter((row) => row.q >= FEATURED_MIN_Q && !row.reasons.includes('no-thumbnail'))
			.filter((row) => !row.launch.verified && !row.launch.failed)
			.sort((a, b) => b.q * (0.35 + 0.65 * b.launchP) - a.q * (0.35 + 0.65 * a.launchP))
			.slice(0, opts.candidates);
		console.log(pending.map((row) => row.game.id).join('\n'));
		return;
	}

	const tierCounts = {};
	const tierByPortal = {};
	const doeCounts = {};
	for (const row of rows) {
		tierCounts[row.tier] = (tierCounts[row.tier] || 0) + 1;
		const portalCounts = (tierByPortal[row.portal] ||= {});
		portalCounts[row.tier] = (portalCounts[row.tier] || 0) + 1;
		doeCounts[row.doe] = (doeCounts[row.doe] || 0) + 1;
	}

	if (opts.spot) {
		const rand = seededRandom(opts.seed);
		for (const tier of Object.keys(TIER_BANDS)) {
			const list = rows.filter((row) => row.tier === tier);
			console.log(`\n=== ${tier} (${list.length}) ===`);
			const picked = [...list].sort(() => rand() - 0.5).slice(0, opts.spot);
			for (const row of picked) {
				console.log(
					`${String(row.score).padStart(2)} ${row.portal.padEnd(14)} ${row.game.id.slice(0, 38).padEnd(39)} ${cleanDisplayName(row.game.name).slice(0, 34).padEnd(35)} q=${row.q.toFixed(2)} L=${row.launchP.toFixed(2)} ${row.reasons.slice(0, 3).join(' ')}`
				);
			}
		}
		console.log('\n', tierCounts);
		return;
	}

	const games = {};
	for (const row of [...rows].sort((a, b) => a.game.id.localeCompare(b.game.id))) {
		games[row.game.id] = {
			tier: row.tier,
			q: row.score,
			doe: DOE_CODE[row.doe],
			launch: row.launch.verified
				? 'verified'
				: row.launch.failed
					? 'failed'
					: row.launch.attempts
						? 'unconfirmed'
						: undefined,
			why: row.reasons.slice(0, 4)
		};
	}
	/* One game per line, so a rerun's diff shows which games moved. */
	writeKeyedJsonLines(QUALITY_PATH, {
		header: {
			version: 1,
			generatedAt: new Date().toISOString(),
			method: 'See docs/catalog-quality.md',
			tierBands: TIER_BANDS,
			tierCounts,
			tierByPortal,
			doeCounts,
			portalLaunch,
			portalStats
		},
		key: 'games',
		entries: Object.entries(games)
	});
	console.log('tiers:', tierCounts);
	console.log('doe:', doeCounts);
	console.log('launch sample:', portalLaunch);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
