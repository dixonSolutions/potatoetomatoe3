import { describe, expect, it } from 'vitest';
import {
	buildFeatureMatrix,
	matVecCpu,
	rankFromScores,
	signalWeight,
	trainUserModel,
	WINDOW_MS,
	type GameSignal,
	type ModelGame
} from './recommendation-model';

/** Deterministic PRNG for the synthetic catalog and users. */
function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const CATEGORIES = Array.from({ length: 25 }, (_, i) => `cat${i}`);

/**
 * A catalog shaped like the real one: categories, a long tail of authors, titles whose words
 * lean towards their genre, and a quality score unrelated to any one player's taste.
 */
function syntheticCatalog(n: number, seed = 1): ModelGame[] {
	const r = rng(seed);
	const words = CATEGORIES.map((c) => Array.from({ length: 12 }, (_, i) => `${c}word${i}`));
	const shared = Array.from({ length: 200 }, (_, i) => `common${i}`);
	return Array.from({ length: n }, (_, i) => {
		const ci = Math.floor(r() * CATEGORIES.length);
		const author = `author${Math.floor(Math.pow(r(), 2) * 400)}`;
		const name = [
			words[ci][Math.floor(r() * 12)],
			r() < 0.5 ? words[ci][Math.floor(r() * 12)] : shared[Math.floor(r() * 200)],
			shared[Math.floor(r() * 200)]
		].join(' ');
		return { id: `g${i}`, name, category: CATEGORIES[ci], author, q: Math.floor(20 + r() * 80) };
	});
}

type User = { likes: (g: ModelGame) => boolean; history: GameSignal[] };

function syntheticUser(catalog: ModelGame[], seed: number, now: number): User {
	const r = rng(seed);
	const cats = new Set([CATEGORIES[Math.floor(r() * 25)], CATEGORIES[Math.floor(r() * 25)]]);
	const authors = new Set(
		Array.from({ length: 3 }, () => catalog[Math.floor(r() * catalog.length)].author!)
	);
	const likes = (g: ModelGame) => cats.has(g.category!) || authors.has(g.author!);
	const liked = catalog.filter(likes);
	const others = catalog.filter((g) => !likes(g));
	const history: GameSignal[] = [];
	for (let i = 0; i < 12 && liked.length; i++) {
		const g = liked[Math.floor(r() * liked.length)];
		history.push({
			id: g.id,
			starts: 1 + Math.floor(r() * 4),
			playMs: (5 + r() * 40) * 60_000,
			favourite: r() < 0.2,
			last: now - r() * 60 * 86_400_000
		});
	}
	for (let i = 0; i < 6; i++) {
		const g = others[Math.floor(r() * others.length)];
		history.push({
			id: g.id,
			starts: 1,
			playMs: 10_000,
			earlyLeaves: 1,
			errors: r() < 0.3 ? 1 : 0,
			last: now - r() * 30 * 86_400_000
		});
	}
	return { likes, history };
}

function recommend(
	catalog: ModelGame[],
	matrix: ReturnType<typeof buildFeatureMatrix>,
	history: GameSignal[],
	now: number,
	limit = 10
) {
	const model = trainUserModel(matrix, history, now);
	const raw = matVecCpu(matrix.data, model.w, catalog.length);
	return rankFromScores(catalog, raw, model, { limit, exclude: new Set(history.map((h) => h.id)) });
}

describe('recommendation model', () => {
	const now = Date.UTC(2026, 10, 27);
	const catalog = syntheticCatalog(3000);
	const matrix = buildFeatureMatrix(catalog);

	it('beats the popularity baseline on synthetic players (hit rate @10)', () => {
		let modelHits = 0;
		let baselineHits = 0;
		const users = 60;
		const byQuality = [...catalog].sort((a, b) => b.q! - a.q! || a.id.localeCompare(b.id));
		for (let u = 0; u < users; u++) {
			const user = syntheticUser(catalog, 100 + u, now);
			const seen = new Set(user.history.map((h) => h.id));
			modelHits += recommend(catalog, matrix, user.history, now).filter(user.likes).length;
			baselineHits += byQuality
				.filter((g) => !seen.has(g.id))
				.slice(0, 10)
				.filter(user.likes).length;
		}
		const modelRate = modelHits / (users * 10);
		const baselineRate = baselineHits / (users * 10);
		console.log(
			`hit-rate@10 model ${modelRate.toFixed(3)} vs popularity ${baselineRate.toFixed(3)}`
		);
		expect(modelRate).toBeGreaterThan(baselineRate * 2);
		expect(modelRate).toBeGreaterThan(0.5);
	});

	it('falls back to the quality order with no history, and never comes back empty', () => {
		const model = trainUserModel(matrix, [], now);
		const recs = rankFromScores(catalog, null, model, { limit: 10, perCategory: 10 });
		expect(recs).toHaveLength(10);
		const best = [...catalog].sort((a, b) => b.q! - a.q! || a.id.localeCompare(b.id)).slice(0, 10);
		expect(recs.map((g) => g.id)).toEqual(best.map((g) => g.id));
	});

	it('keeps one category from filling the row', () => {
		const model = trainUserModel(matrix, [], now);
		const recs = rankFromScores(catalog, null, model, { limit: 12 });
		const counts = new Map<string, number>();
		for (const g of recs) counts.set(g.category!, (counts.get(g.category!) ?? 0) + 1);
		expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
	});

	it('ignores activity older than six months and decays the rest', () => {
		const s: GameSignal = { id: 'g1', starts: 3, playMs: 20 * 60_000, last: now };
		expect(signalWeight({ ...s, last: now - WINDOW_MS - 1 }, now)).toBe(0);
		expect(signalWeight({ ...s, last: now - 30 * 86_400_000 }, now)).toBeCloseTo(
			signalWeight(s, now) / 2,
			5
		);
		expect(
			signalWeight({ id: 'g2', starts: 1, errors: 1, earlyLeaves: 1, last: now }, now)
		).toBeLessThan(0);
	});

	it('ranks a 13.6k-game catalog in under 50 ms', () => {
		const big = syntheticCatalog(13_646, 3);
		const t0 = performance.now();
		const bigMatrix = buildFeatureMatrix(big);
		const built = performance.now();
		const user = syntheticUser(big, 5, now);
		const t1 = performance.now();
		recommend(big, bigMatrix, user.history, now, 18);
		const ranked = performance.now();
		console.log(
			`features ${(built - t0).toFixed(1)} ms (once per catalog), rank ${(ranked - t1).toFixed(1)} ms`
		);
		expect(ranked - t1).toBeLessThan(50);
	});
});
