import { describe, expect, it } from 'vitest';
import { buildHomeRows, daySeed, feedCategories, seededShuffle } from './home-feed';

const game = (id: string, category = 'arcade') => ({ id, name: id.toUpperCase(), category });
const catalog = [
	...Array.from({ length: 40 }, (_, i) => game(`a${i}`, 'arcade')),
	...Array.from({ length: 30 }, (_, i) => game(`p${i}`, 'puzzle')),
	...Array.from({ length: 20 }, (_, i) => game(`r${i}`, 'racing')),
	...Array.from({ length: 10 }, (_, i) => game(`m${i}`, 'misc'))
];

describe('home feed', () => {
	it('shows only catalog rows on a first visit', () => {
		const rows = buildHomeRows({ best: catalog, played: [], favourites: [], recommended: [] });
		expect(rows.map((r) => r.key)).toEqual([
			'today',
			'top',
			'category-arcade',
			'category-puzzle',
			'category-racing'
		]);
	});

	it('orders rows like a Roblox home and never repeats a game', () => {
		const rows = buildHomeRows({
			best: catalog,
			played: [game('r3', 'racing'), game('r4', 'racing')],
			favourites: [game('p1', 'puzzle')],
			recommended: [game('r3', 'racing'), game('a5'), game('p2', 'puzzle')]
		});
		expect(rows.slice(0, 5).map((r) => r.key)).toEqual([
			'continue',
			'favourites',
			'recommended',
			'today',
			'top'
		]);
		/* Continue keeps r3; Recommended drops it. */
		expect(rows[2].games.map((g) => g.id)).toEqual(['a5', 'p2']);
		const ids = rows.flatMap((r) => r.games.map((g) => g.id));
		expect(new Set(ids).size).toBe(ids.length);
		/* The category you play comes first. */
		expect(rows.find((r) => r.key.startsWith('category-'))?.key).toBe('category-racing');
		expect(rows.find((r) => r.key === 'recommended')?.seeAll).toBe('/games?show=recommended');
	});

	it("keeps today's picks stable through a day and changes them the next", () => {
		const day = (d: number) => new Date(2026, 10, d, 9);
		const picks = (date: Date) =>
			buildHomeRows({ best: catalog, played: [], favourites: [], recommended: [], date })
				.find((r) => r.key === 'today')!
				.games.map((g) => g.id);
		expect(picks(day(27))).toEqual(picks(new Date(2026, 10, 27, 23)));
		expect(picks(day(27))).not.toEqual(picks(day(28)));
		expect(daySeed(day(27))).not.toBe(daySeed(day(28)));
	});

	it('shuffles without losing or duplicating items', () => {
		const out = seededShuffle(catalog, 42);
		expect(out).toHaveLength(catalog.length);
		expect(new Set(out.map((g) => g.id)).size).toBe(catalog.length);
	});

	it('never gives misc its own row', () => {
		expect(feedCategories([game('m1', 'misc')], catalog)).not.toContain('misc');
	});
});
