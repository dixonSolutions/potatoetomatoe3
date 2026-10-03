/**
 * How a catalog game appears in the lean client index (static/games/games-index/), shared
 * by scripts/generate-games-list.js and scripts/reindex-games-catalog.mjs so the two can
 * never disagree about field names or order.
 *
 * Quality travels as two short fields, a few bytes per game:
 *   q  0–99 score, banded by tier (featured 80–99, good 60–79, ok 40–59, joke 20–39,
 *      test 10–19, broken 0–9), so one number both orders the catalog and names the tier.
 *   d  NSW DoE filter status of the hosts the game loads from:
 *      'b' blocked (measured), 'l' likely blocked, 'a' likely allowed, '?' unknown.
 * Both come from scripts/data/catalog-quality.json (scripts/catalog-quality/classify.mjs).
 * A game missing from that file gets neither field; the client treats it as a mid "ok".
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanDisplayName } from './heuristics.mjs';

const QUALITY_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	'..',
	'data',
	'catalog-quality.json'
);

/** @returns {Map<string, { q: number, doe: string }>} */
export function loadQualityMap() {
	if (!existsSync(QUALITY_PATH)) return new Map();
	try {
		const data = JSON.parse(readFileSync(QUALITY_PATH, 'utf8'));
		return new Map(Object.entries(data?.games || {}));
	} catch {
		return new Map();
	}
}

/** Display name without the portal suffixes the importers copied from page titles. */
export { cleanDisplayName };

export function toLeanEntry(entry, quality) {
	const lean = {
		id: entry.id,
		name: cleanDisplayName(entry.name ?? ''),
		author: entry.author ?? '',
		category: entry.category ?? 'misc',
		thumbnail: entry.thumbnail ?? '',
		...(entry.engine ? { engine: entry.engine } : {})
	};
	if (quality && Number.isFinite(quality.q)) lean.q = quality.q;
	if (quality?.doe) lean.d = quality.doe;
	return lean;
}

/** Best first; A–Z within a score so equal games keep a stable, readable order. */
export function compareLeanEntries(a, b) {
	const qa = Number.isFinite(a.q) ? a.q : 45;
	const qb = Number.isFinite(b.q) ? b.q : 45;
	return (
		qb - qa ||
		String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' }) ||
		String(a.id ?? '').localeCompare(String(b.id ?? ''))
	);
}

/** Manifest `order` value, so the client knows shard 0 holds the best games. */
export const INDEX_ORDER = 'quality';
