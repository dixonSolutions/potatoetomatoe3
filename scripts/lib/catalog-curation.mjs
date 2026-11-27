/**
 * Catalog curation: what happens to a game the quality classifier calls broken or test.
 *
 * The classifier (scripts/catalog-quality/classify.mjs) only scores and hides. Curation acts
 * on the score: a game with a hard fault (dead host, wrong game, ad redirect, copy of
 * another entry, plays only on its portal's own site, …) is either
 *   - replaced by a working copy of the same game from another source (the original a copy
 *     points at, or the same title from the most official portal that has it), or
 *   - removed, when there is no working copy.
 * Soft signals (an HTTP 403 a bot would get, a missing thumbnail, a tutorial) only hide a
 * game, as before; curation never deletes on them.
 *
 * Removal is a denylist (scripts/data/catalog-curation.json), not a deletion: the index
 * generator leaves those ids out, the importers never bring them back, and an alias map
 * sends old links of replaced games to their replacement. Pure functions, no I/O here.
 */

import { titleKey } from '../catalog-quality/heuristics.mjs';

/** Faults that make a game unplayable or a duplicate, whatever its rating. */
export const HARD_REASONS = new Set([
	'portal-exclusive',
	'wrong-game',
	'ad-redirect',
	'copy-of',
	'same-embed-as',
	'duplicate',
	'http-400',
	'http-404',
	'http-410',
	'http-500',
	'http-522',
	'http-525',
	'unreachable',
	'hijacked-domain',
	'parked-domain',
	'redirects-away',
	'redirects-to',
	'redirect-target-403',
	'not-found-page',
	'no-target',
	'flash-no-emulator',
	'launch-failed',
	'microgame-template',
	'default-name',
	'test-description',
	'spam',
	'gibberish-name'
]);

/** Most official first: a replacement comes from the highest portal that has the game. */
export const PORTAL_PREFERENCE = [
	'coolmath',
	'poki',
	'unity-play',
	'addictinggames',
	'crazygames',
	'y8',
	'playhop',
	'local',
	'drive-u-7',
	'fnf-games',
	'github'
];

const PLAYABLE_TIERS = new Set(['featured', 'good', 'ok']);

/** "copy-of:abc" → { code: 'copy-of', ref: 'abc' }. */
export function parseReason(why) {
	const m = String(why).match(/^([a-z0-9-]+)(?:[:=]\s*(.+))?$/i);
	return m
		? { code: m[1].toLowerCase(), ref: m[2]?.trim() || null }
		: { code: String(why), ref: null };
}

/** The first hard fault behind a broken/test verdict, or null when there is none. */
export function hardReason(quality) {
	if (!quality || (quality.tier !== 'broken' && quality.tier !== 'test')) return null;
	for (const why of quality.why ?? []) {
		const r = parseReason(why);
		if (HARD_REASONS.has(r.code)) return r;
	}
	return null;
}

/**
 * A title match only names the same game when the title is specific: "Space" or "Snake"
 * on two portals are often different games, "3D Free Kick" or "Voxiom.io" are not.
 */
export function isDistinctiveTitle(key) {
	const k = String(key || '').trim();
	return k.split(' ').length >= 2
		? k.length >= 6
		: k.length >= 8 || (/\d/.test(k) && k.length >= 4);
}

function portalRank(portal) {
	const i = PORTAL_PREFERENCE.indexOf(portal || 'local');
	return i < 0 ? PORTAL_PREFERENCE.length : i;
}

/**
 * Decide every game's fate.
 *
 * @param {Array<{id: string, name?: string, sourcePortal?: string}>} games
 * @param {Map<string, {tier: string, q?: number, why?: string[]}> | Record<string, any>} quality
 * @param {{ keepIds?: Set<string>, maxRemoveShare?: number }} [opts]
 * @returns {{ replace: {id: string, by: string, reason: string}[], remove: {id: string, reason: string}[],
 *   keep: number, aborted?: string }}
 */
export function curateCatalog(games, quality, opts = {}) {
	const q = quality instanceof Map ? quality : new Map(Object.entries(quality ?? {}));
	const keepIds = opts.keepIds ?? new Set();
	const maxShare = opts.maxRemoveShare ?? 0.2;
	const byId = new Map(games.map((g) => [g.id, g]));
	const faults = new Map();
	for (const g of games) {
		if (keepIds.has(g.id)) continue;
		const r = hardReason(q.get(g.id));
		if (r) faults.set(g.id, r);
	}
	/* A working copy is playable and has no hard fault of its own. */
	const works = (id) => byId.has(id) && !faults.has(id) && PLAYABLE_TIERS.has(q.get(id)?.tier);
	const byTitle = new Map();
	for (const g of games) {
		if (!works(g.id)) continue;
		const key = titleKey(g.name || g.id);
		if (!key) continue;
		const list = byTitle.get(key) ?? [];
		list.push(g);
		byTitle.set(key, list);
	}
	const better = (a, b) =>
		(q.get(b.id)?.q ?? 50) - (q.get(a.id)?.q ?? 50) ||
		portalRank(a.sourcePortal) - portalRank(b.sourcePortal) ||
		a.id.localeCompare(b.id);

	const replace = [];
	const remove = [];
	for (const [id, r] of faults) {
		const g = byId.get(id);
		let by = null;
		/* A copy points at its original: that is the official source. */
		if (r.ref && works(r.ref)) by = r.ref;
		const key = titleKey(g.name || g.id);
		if (!by && isDistinctiveTitle(key)) {
			const same = (byTitle.get(key) ?? []).filter((c) => c.id !== id);
			if (same.length) by = [...same].sort(better)[0].id;
		}
		if (by) replace.push({ id, by, reason: r.code });
		else remove.push({ id, reason: r.code });
	}
	const out = { replace, remove, keep: games.length - replace.length - remove.length };
	if (games.length && (replace.length + remove.length) / games.length > maxShare) {
		out.aborted = `would drop ${replace.length + remove.length} of ${games.length} games (> ${Math.round(maxShare * 100)}%)`;
	}
	return out;
}

/** The denylist + alias file the generator, importers and client read. */
export function toCurationFile(plan, generatedAt = new Date().toISOString()) {
	const removed = {};
	for (const r of plan.remove) removed[r.id] = r.reason;
	for (const r of plan.replace) removed[r.id] = `${r.reason} → ${r.by}`;
	const aliases = {};
	for (const r of plan.replace) aliases[r.id] = r.by;
	return { version: 1, generatedAt, removed, aliases };
}

/** Follow alias chains (a → b → c) to the game that is still listed; null when none. */
export function resolveAlias(aliases, id, max = 8) {
	let cur = id;
	for (let i = 0; i < max && aliases?.[cur]; i++) cur = aliases[cur];
	return cur === id ? null : cur;
}
