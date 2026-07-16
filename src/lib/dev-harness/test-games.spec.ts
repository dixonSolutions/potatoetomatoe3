import { describe, expect, it } from 'vitest';
import {
	HARNESS_TEST_GAME_COUNT,
	HARNESS_TEST_GAMES,
	listHarnessTestGameIds,
	validateHarnessTestGames
} from './test-games';

describe('harness test games', () => {
	it(`has exactly ${HARNESS_TEST_GAME_COUNT} unique curated games`, () => {
		const issues = validateHarnessTestGames();
		expect(issues).toEqual([]);
		expect(HARNESS_TEST_GAMES).toHaveLength(HARNESS_TEST_GAME_COUNT);
		expect(new Set(listHarnessTestGameIds()).size).toBe(HARNESS_TEST_GAME_COUNT);
	});

	it('covers multiple portals, engines, and pull strategies', () => {
		const portals = new Set(HARNESS_TEST_GAMES.map((g) => g.sourcePortal));
		const engines = new Set(HARNESS_TEST_GAMES.map((g) => g.engine));
		const strategies = new Set(HARNESS_TEST_GAMES.map((g) => g.pullStrategy));
		expect(portals.size).toBeGreaterThanOrEqual(5);
		expect(engines.has('unity')).toBe(true);
		expect(engines.has('html5')).toBe(true);
		expect(strategies.has('embed')).toBe(true);
		expect(strategies.has('generic')).toBe(true);
		expect(strategies.has('local-embed')).toBe(true);
	});

	it('flags structural problems', () => {
		const broken = validateHarnessTestGames([
			...HARNESS_TEST_GAMES.slice(0, 2),
			{ ...HARNESS_TEST_GAMES[0], id: 'dup' },
			{ ...HARNESS_TEST_GAMES[0], id: 'dup' }
		]);
		expect(broken.some((i) => i.code === 'count')).toBe(true);
		expect(broken.some((i) => i.code === 'duplicate')).toBe(true);
	});
});
