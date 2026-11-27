/**
 * Home feed rows, modelled on the Roblox home: Continue, Favourites, Recommended for you,
 * Today's picks, then rows of the best games overall and in the categories you play.
 *
 * Pure: the page gathers the inputs (catalog, history, favourites, recommender output) and
 * this decides what each row shows. A game appears in one row only, in row order, so the
 * feed never repeats itself. Rows with nothing to show are left out.
 */

export type FeedGame = { id: string; name: string; category?: string };

export type FeedRow<T extends FeedGame> = {
	key: string;
	title: string;
	games: T[];
	/** Games tab link that shows the whole set behind the row. */
	seeAll?: string;
};

export const ROW_SIZE = 18;
/** Today's picks rotate daily through this many of the best games. */
export const TODAYS_PICKS_POOL = 300;
export const CATEGORY_ROWS = 3;

/** Same number all day, a different one tomorrow (local calendar day). */
export function daySeed(date: Date = new Date()): number {
	const day = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
	let h = day ^ 0x9e3779b9;
	h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
	return (h ^ (h >>> 16)) >>> 0;
}

/** Fisher–Yates with a seeded xorshift, so a day's picks are stable across reloads. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
	const out = [...items];
	let s = seed >>> 0 || 1;
	for (let i = out.length - 1; i > 0; i--) {
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		const j = (s >>> 0) % (i + 1);
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

function label(category: string): string {
	return category.charAt(0).toUpperCase() + category.slice(1);
}

/**
 * Categories to give their own row: the ones the player plays most, then the biggest in
 * the top of the catalog. `misc` never gets a row.
 */
export function feedCategories(
	played: readonly FeedGame[],
	best: readonly FeedGame[],
	count = CATEGORY_ROWS
): string[] {
	const score = new Map<string, number>();
	played.forEach((g, i) => {
		const c = g.category?.toLowerCase();
		if (!c || c === 'misc') return;
		/* Recent plays count more. */
		score.set(c, (score.get(c) ?? 0) + 1000 + Math.max(0, 100 - i));
	});
	for (const g of best.slice(0, 600)) {
		const c = g.category?.toLowerCase();
		if (!c || c === 'misc') continue;
		score.set(c, (score.get(c) ?? 0) + 1);
	}
	return [...score.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, count)
		.map(([c]) => c);
}

export function buildHomeRows<T extends FeedGame>(input: {
	/** Games worth suggesting, best first (tests and broken games already removed). */
	best: readonly T[];
	/** The player's recent games, most recent first. */
	played: readonly T[];
	favourites: readonly T[];
	/** Recommender output, best first; may be empty while it computes. */
	recommended: readonly T[];
	date?: Date;
	rowSize?: number;
}): FeedRow<T>[] {
	const size = input.rowSize ?? ROW_SIZE;
	const used = new Set<string>();
	const rows: FeedRow<T>[] = [];
	const take = (games: readonly T[], n = size): T[] => {
		const out: T[] = [];
		for (const g of games) {
			if (out.length >= n) break;
			if (used.has(g.id)) continue;
			used.add(g.id);
			out.push(g);
		}
		return out;
	};
	const push = (row: FeedRow<T>) => {
		if (row.games.length > 0) rows.push(row);
	};

	/* The player's own rows keep their games even when another row would want them. */
	push({ key: 'continue', title: 'Continue', games: take(input.played) });
	push({
		key: 'favourites',
		title: 'Favourites',
		games: take(input.favourites),
		seeAll: '/games?show=favourites'
	});
	push({
		key: 'recommended',
		title: 'Recommended for you',
		games: take(input.recommended),
		seeAll: '/games?show=recommended'
	});
	push({
		key: 'today',
		title: "Today's picks",
		games: take(seededShuffle(input.best.slice(0, TODAYS_PICKS_POOL), daySeed(input.date)))
	});
	push({ key: 'top', title: 'Top rated', games: take(input.best), seeAll: '/games' });
	for (const c of feedCategories(input.played, input.best)) {
		push({
			key: `category-${c}`,
			title: `Top ${label(c)}`,
			games: take(input.best.filter((g) => g.category?.toLowerCase() === c)),
			seeAll: `/games?category=${encodeURIComponent(c)}`
		});
	}
	return rows;
}
