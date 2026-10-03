/**
 * Quality-first catalog ordering and filtering.
 *
 * Every index row may carry two short fields written by the catalog generator from
 * scripts/data/catalog-quality.json (see docs/catalog-quality.md):
 *
 *   q  0–99 score, banded by tier, so one number both orders the catalog and names the
 *      tier: featured 80–99, good 60–79, ok 40–59, joke 20–39, test 10–19, broken 0–9.
 *   d  NSW DoE filter status of the hosts the game loads from: 'b' blocked (measured),
 *      'l' likely blocked, 'a' likely allowed, '?' unknown. See docs/nsw-doe-filtering.md.
 *
 * Rows without a score (a game added after the last classifier run) behave like a middling
 * "ok" game: shown, ranked mid-catalog, DoE status unknown.
 */

export type QualityTier = 'featured' | 'good' | 'ok' | 'joke' | 'test' | 'broken';
export type DoeStatus = 'b' | 'l' | 'a' | '?';

export type QualityFields = {
	q?: number;
	d?: DoeStatus;
};

/** Score for rows the classifier has not seen yet: the middle of the "ok" band. */
export const UNSCORED_QUALITY = 45;

/** Lowest score of each tier, best tier first. */
export const TIER_FLOORS: readonly (readonly [QualityTier, number])[] = [
	['featured', 80],
	['good', 60],
	['ok', 40],
	['joke', 20],
	['test', 10],
	['broken', 0]
];

/** Tiers hidden from browse and home unless the user asks to see everything. */
export const HIDDEN_TIERS: ReadonlySet<QualityTier> = new Set(['test', 'broken']);

export function qualityScore(entry: QualityFields): number {
	const q = entry.q;
	return typeof q === 'number' && Number.isFinite(q) ? q : UNSCORED_QUALITY;
}

export function qualityTier(entry: QualityFields): QualityTier {
	const q = qualityScore(entry);
	for (const [tier, floor] of TIER_FLOORS) if (q >= floor) return tier;
	return 'broken';
}

/** Development tests, templates, junk uploads and games that do not launch. */
export function isHiddenByDefault(entry: QualityFields): boolean {
	return HIDDEN_TIERS.has(qualityTier(entry));
}

export function doeStatus(entry: QualityFields): DoeStatus {
	const d = entry.d;
	return d === 'b' || d === 'l' || d === 'a' ? d : '?';
}

/**
 * Likely to work on a NSW DoE school network: not measured blocked and not on a host that
 * shares a site or category with one. Unknown hosts stay in — no evidence either way.
 */
export function isLikelySchoolNetworkFriendly(entry: QualityFields): boolean {
	const d = doeStatus(entry);
	return d === 'a' || d === '?';
}

/** Best first; A–Z within a score, matching the generator's shard order. */
export function compareByQuality<T extends QualityFields & { name?: string; id?: string }>(
	a: T,
	b: T
): number {
	return (
		qualityScore(b) - qualityScore(a) ||
		String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, {
			sensitivity: 'base'
		}) ||
		String(a.id ?? '').localeCompare(String(b.id ?? ''))
	);
}

export type CatalogQualityFilter = {
	/** Include test and broken entries. */
	showAll?: boolean;
	/** Only games likely to load on a NSW DoE school network. */
	schoolNetworkOnly?: boolean;
};

export function passesQualityFilter(entry: QualityFields, filter: CatalogQualityFilter): boolean {
	return (
		(filter.showAll || !isHiddenByDefault(entry)) &&
		(!filter.schoolNetworkOnly || isLikelySchoolNetworkFriendly(entry))
	);
}

export function applyQualityFilter<T extends QualityFields>(
	games: readonly T[],
	filter: CatalogQualityFilter
): T[] {
	if (filter.showAll && !filter.schoolNetworkOnly) return games.slice();
	return games.filter((game) => passesQualityFilter(game, filter));
}

/** How many rows the default view leaves out, for the "Show all" affordance. */
export function countHiddenByDefault(games: readonly QualityFields[]): number {
	let hidden = 0;
	for (const game of games) if (isHiddenByDefault(game)) hidden += 1;
	return hidden;
}

/**
 * What suggestions are drawn from: the featured and good tiers, when there are enough of them
 * to personalise from. "ok" is everything that merely launches — thousands of thin student
 * uploads — fine to find by searching or browsing, not to put in front of someone unasked.
 */
export function suggestionPool<T extends QualityFields>(games: readonly T[], min = 200): T[] {
	const strong = games.filter((game) => {
		const tier = qualityTier(game);
		return tier === 'featured' || tier === 'good';
	});
	return strong.length >= min ? strong : games.slice();
}

/** The strongest games, for "Featured"-style rows: featured tier, topped up with good. */
export function topQualityGames<T extends QualityFields>(games: readonly T[]): T[] {
	const featured = games.filter((game) => qualityTier(game) === 'featured');
	if (featured.length >= 24) return featured;
	return games.filter((game) => {
		const tier = qualityTier(game);
		return tier === 'featured' || tier === 'good';
	});
}

const FILTER_PREFS_KEY = 'potato-tomato-catalog-quality-filter';

/** The browse page's quality filter, remembered per device so Home follows it too. */
export function readQualityFilterPrefs(): CatalogQualityFilter {
	try {
		if (typeof localStorage === 'undefined') return {};
		const raw = JSON.parse(localStorage.getItem(FILTER_PREFS_KEY) || '{}');
		return { showAll: raw?.showAll === true, schoolNetworkOnly: raw?.schoolNetworkOnly === true };
	} catch {
		return {};
	}
}

export function writeQualityFilterPrefs(filter: CatalogQualityFilter): void {
	try {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(
			FILTER_PREFS_KEY,
			JSON.stringify({
				showAll: Boolean(filter.showAll),
				schoolNetworkOnly: Boolean(filter.schoolNetworkOnly)
			})
		);
	} catch {
		/* Storage full or blocked: the filter still applies for this visit. */
	}
}
