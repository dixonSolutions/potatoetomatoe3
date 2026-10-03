import { describe, expect, it } from 'vitest';
import {
	gameSimilarity,
	getRecommendationsForGamePage,
	similarityProfile,
	type RecommendableGame
} from './play-recommendations';

const prefs = { liked: [], disliked: [] };

function game(id: string, name: string, category: string, author = 'Someone'): RecommendableGame {
	return { id, name, category, author, thumbnail: '' };
}

describe('gameSimilarity', () => {
	const current = similarityProfile(
		game('castle', 'A Castle for Trolls 🕹️ Play on CrazyGames', 'strategy', 'CrazyGames')
	);

	it('ranks a same-category game with a shared title word above a stranger', () => {
		const sibling = game('castle-2', 'Castle Defense', 'strategy');
		const stranger = game('kart', 'Boom Karts', 'racing');
		expect(gameSimilarity(current, sibling)).toBeGreaterThan(gameSimilarity(current, stranger));
		expect(gameSimilarity(current, stranger)).toBe(0);
	});

	it('ignores the portal suffix every imported title carries', () => {
		const unrelated = game('x', 'Hex Color Idle 🕹️ Play on CrazyGames', 'puzzle', 'Other');
		expect(gameSimilarity(current, unrelated)).toBe(0);
	});

	it('stays within 0..1', () => {
		const same = game(
			'castle',
			'A Castle for Trolls 🕹️ Play on CrazyGames',
			'strategy',
			'CrazyGames'
		);
		expect(gameSimilarity(current, same)).toBeCloseTo(1, 5);
	});
});

describe('getRecommendationsForGamePage', () => {
	it('recommends from the same category first', () => {
		const current = game('castle', 'Castle Wars', 'strategy');
		const all = [
			current,
			game('castle-defense', 'Castle Defense', 'strategy'),
			game('kart', 'Boom Karts', 'racing'),
			game('chess', 'Chess Master', 'strategy'),
			game('pool', 'Pool Party', 'sports')
		];
		const recs = getRecommendationsForGamePage(all, current, current.id, prefs, 2);
		expect(recs.map((g) => g.id)).toEqual(['castle-defense', 'chess']);
	});

	it('scores the whole catalog in well under a frame budget', () => {
		/*
		 * Regression: a Fuse search over every row here was one 2.5 s long task on the player
		 * page, right after the card click, holding up the game's first frame.
		 */
		const categories = ['arcade', 'puzzle', 'racing', 'strategy', 'sports', 'action'];
		const all = Array.from({ length: 14_000 }, (_, i) =>
			game(`g${i}`, `Game Title Number ${i} Adventure`, categories[i % categories.length]!)
		);
		const current = all[1234]!;
		const start = performance.now();
		const recs = getRecommendationsForGamePage(all, current, current.id, prefs, 4);
		expect(performance.now() - start).toBeLessThan(250);
		expect(recs).toHaveLength(4);
	});
});
