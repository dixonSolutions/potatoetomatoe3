import { describe, expect, it } from 'vitest';
import {
	UNSCORED_QUALITY,
	applyQualityFilter,
	compareByQuality,
	countHiddenByDefault,
	doeStatus,
	isHiddenByDefault,
	isLikelySchoolNetworkFriendly,
	passesQualityFilter,
	qualityScore,
	qualityTier,
	topQualityGames,
	type DoeStatus
} from './catalog-quality';

type Row = { id: string; name: string; q?: number; d?: DoeStatus };

const row = (id: string, q?: number, d?: DoeStatus): Row => ({ id, name: id, q, d });

describe('qualityTier', () => {
	it('reads the tier from the banded score', () => {
		expect(qualityTier({ q: 99 })).toBe('featured');
		expect(qualityTier({ q: 80 })).toBe('featured');
		expect(qualityTier({ q: 79 })).toBe('good');
		expect(qualityTier({ q: 60 })).toBe('good');
		expect(qualityTier({ q: 59 })).toBe('ok');
		expect(qualityTier({ q: 40 })).toBe('ok');
		expect(qualityTier({ q: 39 })).toBe('joke');
		expect(qualityTier({ q: 20 })).toBe('joke');
		expect(qualityTier({ q: 19 })).toBe('test');
		expect(qualityTier({ q: 10 })).toBe('test');
		expect(qualityTier({ q: 9 })).toBe('broken');
		expect(qualityTier({ q: 0 })).toBe('broken');
	});

	it('treats an unscored row as a middling ok game', () => {
		expect(qualityScore({})).toBe(UNSCORED_QUALITY);
		expect(qualityTier({})).toBe('ok');
		expect(isHiddenByDefault({})).toBe(false);
	});

	it('ignores a non-numeric score from a malformed row', () => {
		expect(qualityScore({ q: Number.NaN })).toBe(UNSCORED_QUALITY);
	});
});

describe('isHiddenByDefault', () => {
	it('hides tests and broken games only', () => {
		expect(isHiddenByDefault({ q: 15 })).toBe(true);
		expect(isHiddenByDefault({ q: 3 })).toBe(true);
		expect(isHiddenByDefault({ q: 25 })).toBe(false);
		expect(isHiddenByDefault({ q: 45 })).toBe(false);
	});
});

describe('DoE status', () => {
	it('keeps allowed and unknown, drops blocked and likely blocked', () => {
		expect(isLikelySchoolNetworkFriendly({ d: 'a' })).toBe(true);
		expect(isLikelySchoolNetworkFriendly({ d: '?' })).toBe(true);
		expect(isLikelySchoolNetworkFriendly({})).toBe(true);
		expect(isLikelySchoolNetworkFriendly({ d: 'l' })).toBe(false);
		expect(isLikelySchoolNetworkFriendly({ d: 'b' })).toBe(false);
	});

	it('reads anything unexpected as unknown', () => {
		expect(doeStatus({ d: 'x' as DoeStatus })).toBe('?');
	});
});

describe('compareByQuality', () => {
	it('orders best first, then A–Z', () => {
		const list = [row('b', 50), row('a', 50), row('c', 90), row('d'), row('e', 5)];
		expect(list.sort(compareByQuality).map((g) => g.id)).toEqual(['c', 'a', 'b', 'd', 'e']);
	});
});

describe('applyQualityFilter', () => {
	const games = [
		row('featured-blocked', 90, 'b'),
		row('good-allowed', 70, 'a'),
		row('ok-unknown', 45, '?'),
		row('joke-likely-blocked', 30, 'l'),
		row('test-allowed', 15, 'a'),
		row('broken-allowed', 2, 'a'),
		row('unscored')
	];
	const ids = (list: Row[]) => list.map((g) => g.id);

	it('hides tests and broken by default', () => {
		expect(ids(applyQualityFilter(games, {}))).toEqual([
			'featured-blocked',
			'good-allowed',
			'ok-unknown',
			'joke-likely-blocked',
			'unscored'
		]);
		expect(countHiddenByDefault(games)).toBe(2);
	});

	it('shows everything when asked, as a copy', () => {
		const all = applyQualityFilter(games, { showAll: true });
		expect(ids(all)).toEqual(ids(games));
		expect(all).not.toBe(games);
	});

	it('narrows to school-network-friendly games', () => {
		expect(ids(applyQualityFilter(games, { schoolNetworkOnly: true }))).toEqual([
			'good-allowed',
			'ok-unknown',
			'unscored'
		]);
		expect(ids(applyQualityFilter(games, { schoolNetworkOnly: true, showAll: true }))).toEqual([
			'good-allowed',
			'ok-unknown',
			'test-allowed',
			'broken-allowed',
			'unscored'
		]);
	});
});

describe('passesQualityFilter', () => {
	it('checks one row against the same rules as the list filter', () => {
		expect(passesQualityFilter({ q: 70, d: 'a' }, { schoolNetworkOnly: true })).toBe(true);
		expect(passesQualityFilter({ q: 70, d: 'b' }, { schoolNetworkOnly: true })).toBe(false);
		expect(passesQualityFilter({ q: 5 }, {})).toBe(false);
		expect(passesQualityFilter({ q: 5 }, { showAll: true })).toBe(true);
	});
});

describe('topQualityGames', () => {
	it('tops up a thin featured tier with good games', () => {
		const games = [row('f', 85), row('g', 65), row('o', 45)];
		expect(topQualityGames(games).map((g) => g.id)).toEqual(['f', 'g']);
	});

	it('uses featured alone once there are enough', () => {
		const featured = Array.from({ length: 24 }, (_, i) => row(`f${i}`, 85));
		const games = [...featured, row('g', 65)];
		expect(topQualityGames(games)).toHaveLength(24);
	});
});
