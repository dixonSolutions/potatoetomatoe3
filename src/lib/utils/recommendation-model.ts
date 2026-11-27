/**
 * The on-device recommender: hashed item features, a user vector learned with BPR, one
 * matrix-vector product to score the whole catalog. See docs/recommendations.md.
 *
 * - Item features (feature hashing, Weinberger et al. 2009): category, author, engine,
 *   portal and title words, signed-hashed into FEATURE_DIM dims and L2-normalised. Games
 *   that share features land near each other, so a game nobody played still scores well
 *   when it resembles what you play.
 * - User vector: Bayesian Personalized Ranking (Rendle et al. 2009) over those features
 *   (the item side of LightFM's hybrid model): each positive game is pushed above a sampled
 *   game, each negative (errors, early leaves, dislikes) below one. Signals decay with a
 *   30-day half-life and nothing older than six months counts.
 * - Score = user·item + a quality prior that fades as history grows + explicit category
 *   affinity. A light diversity pass keeps one category from filling the row.
 *
 * Pure and synchronous apart from the mat-vec, which the caller may run on WebGPU.
 */

export const FEATURE_DIM = 64;
export const WINDOW_MS = 182 * 86_400_000;
export const HALF_LIFE_MS = 30 * 86_400_000;
/** A session shorter than this, without an error, counts as leaving early. */
export const EARLY_LEAVE_MS = 30_000;

export type ModelGame = {
	id: string;
	name: string;
	category?: string;
	author?: string;
	engine?: string;
	q?: number;
};

/** What the player did with one game, already restricted to the window. */
export type GameSignal = {
	id: string;
	starts?: number;
	playMs?: number;
	errors?: number;
	earlyLeaves?: number;
	favourite?: boolean;
	disliked?: boolean;
	/** Most recent interaction, ms since epoch. */
	last: number;
};

const STOP_WORDS = new Set([
	'the',
	'and',
	'for',
	'play',
	'online',
	'game',
	'games',
	'crazygames',
	'unblocked',
	'free',
	'html5'
]);
/** Id prefixes that name the portal a game came from. */
const PORTALS = new Set([
	'crazygames',
	'unity',
	'playhop',
	'addictinggames',
	'fnf',
	'coolmath',
	'y8',
	'poki'
]);

function fnv1a(s: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

function addHashed(row: Float32Array, offset: number, key: string, weight: number) {
	const h = fnv1a(key);
	row[offset + (h % FEATURE_DIM)] += (h & 0x80000000 ? -1 : 1) * weight;
}

export function titleTokens(name: string): string[] {
	const out: string[] = [];
	for (const w of name.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
		if (w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w)) out.push(w);
	}
	return out;
}

/** Write one game's normalised feature row into `out` at `offset`. */
export function writeFeatures(game: ModelGame, out: Float32Array, offset: number): void {
	if (game.category) addHashed(out, offset, `c:${game.category.toLowerCase()}`, 1.0);
	if (game.author) addHashed(out, offset, `a:${game.author.toLowerCase()}`, 0.7);
	if (game.engine) addHashed(out, offset, `e:${game.engine}`, 0.4);
	const portal = game.id.split('-')[0];
	if (PORTALS.has(portal)) addHashed(out, offset, `p:${portal}`, 0.3);
	const tokens = titleTokens(game.name);
	const tw = tokens.length ? 0.8 / Math.sqrt(tokens.length) : 0;
	for (const t of tokens) addHashed(out, offset, `t:${t}`, tw);
	let norm = 0;
	for (let k = 0; k < FEATURE_DIM; k++) norm += out[offset + k] ** 2;
	if (norm > 0) {
		const inv = 1 / Math.sqrt(norm);
		for (let k = 0; k < FEATURE_DIM; k++) out[offset + k] *= inv;
	}
}

export type FeatureMatrix = { ids: string[]; index: Map<string, number>; data: Float32Array };

export function buildFeatureMatrix(games: readonly ModelGame[]): FeatureMatrix {
	const data = new Float32Array(games.length * FEATURE_DIM);
	const ids: string[] = new Array(games.length);
	const index = new Map<string, number>();
	for (let i = 0; i < games.length; i++) {
		writeFeatures(games[i], data, i * FEATURE_DIM);
		ids[i] = games[i].id;
		index.set(games[i].id, i);
	}
	return { ids, index, data };
}

/** Signed signal strength of one game: > 0 liked, < 0 disliked or broken, decayed by age. */
export function signalWeight(s: GameSignal, now: number): number {
	const age = Math.max(0, now - s.last);
	if (age > WINDOW_MS) return 0;
	const decay = Math.pow(0.5, age / HALF_LIFE_MS);
	const minutes = (s.playMs ?? 0) / 60_000;
	let w = 0;
	w += Math.min(3, (s.starts ?? 0) * 0.5);
	w += Math.log2(1 + minutes);
	if (s.favourite) w += 3;
	w -= 2 * (s.errors ?? 0);
	w -= 0.75 * (s.earlyLeaves ?? 0);
	if (s.disliked) w -= 5;
	return w * decay;
}

/** Small deterministic PRNG (mulberry32). */
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

export type UserModel = { w: Float32Array; positives: number; negatives: number };

/**
 * Learn the user vector with BPR-SGD: positives above random catalog games, random games
 * above negatives. Deterministic for a given seed.
 */
export function trainUserModel(
	matrix: FeatureMatrix,
	signals: readonly GameSignal[],
	now: number,
	{ epochs = 40, lr = 0.08, reg = 0.002, seed = 7 } = {}
): UserModel {
	const w = new Float32Array(FEATURE_DIM);
	const pos: [number, number][] = [];
	const neg: [number, number][] = [];
	for (const s of signals) {
		const row = matrix.index.get(s.id);
		if (row === undefined) continue;
		const weight = signalWeight(s, now);
		if (weight > 0.05) pos.push([row, weight]);
		else if (weight < -0.05) neg.push([row, -weight]);
	}
	const n = matrix.ids.length;
	if ((pos.length === 0 && neg.length === 0) || n < 2) {
		return { w, positives: pos.length, negatives: neg.length };
	}
	const maxW = Math.max(...pos.map((p) => p[1]), ...neg.map((p) => p[1]));
	const positiveRows = new Set(pos.map((p) => p[0]));
	const rand = rng(seed);
	const d = matrix.data;
	const step = (hi: number, lo: number, weight: number) => {
		const a = hi * FEATURE_DIM;
		const b = lo * FEATURE_DIM;
		let x = 0;
		for (let k = 0; k < FEATURE_DIM; k++) x += w[k] * (d[a + k] - d[b + k]);
		const g = (lr * (weight / maxW)) / (1 + Math.exp(x));
		for (let k = 0; k < FEATURE_DIM; k++) {
			w[k] += g * (d[a + k] - d[b + k]) - lr * reg * w[k];
		}
	};
	const sample = () => {
		for (let tries = 0; tries < 8; tries++) {
			const j = Math.floor(rand() * n);
			if (!positiveRows.has(j)) return j;
		}
		return Math.floor(rand() * n);
	};
	for (let e = 0; e < epochs; e++) {
		for (const [i, weight] of pos) for (let r = 0; r < 4; r++) step(i, sample(), weight);
		for (const [i, weight] of neg) for (let r = 0; r < 4; r++) step(sample(), i, weight);
	}
	return { w, positives: pos.length, negatives: neg.length };
}

/** Plain CPU mat-vec: scores[i] = data[i,:]·w. */
export function matVecCpu(data: Float32Array, w: Float32Array, n: number): Float32Array {
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		const o = i * FEATURE_DIM;
		let s = 0;
		for (let k = 0; k < FEATURE_DIM; k++) s += data[o + k] * w[k];
		out[i] = s;
	}
	return out;
}

export type RankOptions = {
	limit: number;
	exclude?: ReadonlySet<string>;
	/** Explicit -1…1 per category, from Settings. */
	categoryAffinity?: Record<string, number>;
	/** Games-per-category cap in the result before others get a turn. */
	perCategory?: number;
};

/** Quality prior in 0…1 (unscored games sit in the middle). */
function prior(g: ModelGame): number {
	return (Number.isFinite(g.q) ? (g.q as number) : 45) / 100;
}

/**
 * Turn raw user·item scores into the final ranking. With no history the quality prior
 * alone orders the catalog (the popularity baseline), still category-diverse.
 */
export function rankFromScores<T extends ModelGame>(
	games: readonly T[],
	raw: Float32Array | null,
	model: UserModel,
	options: RankOptions
): T[] {
	const history = model.positives + model.negatives;
	const priorWeight = 0.15 + 0.85 / (1 + 0.25 * history);
	let wnorm = 0;
	for (let k = 0; k < FEATURE_DIM; k++) wnorm += model.w[k] ** 2;
	const userScale = wnorm > 0 ? 1 / Math.sqrt(wnorm) : 0;
	const affinity = options.categoryAffinity ?? {};
	const exclude = options.exclude ?? new Set<string>();
	const scored: { g: T; s: number }[] = [];
	for (let i = 0; i < games.length; i++) {
		const g = games[i];
		if (exclude.has(g.id)) continue;
		const fit = raw && userScale ? raw[i] * userScale : 0;
		const aff = g.category ? (affinity[g.category] ?? 0) : 0;
		scored.push({ g, s: fit + priorWeight * prior(g) + 0.35 * aff });
	}
	scored.sort((a, b) => b.s - a.s || a.g.id.localeCompare(b.g.id));
	/* Diversity: at most `perCategory` per category in the first pass, then fill. */
	const cap = options.perCategory ?? Math.max(2, Math.ceil(options.limit / 4));
	const counts = new Map<string, number>();
	const out: T[] = [];
	const skipped: T[] = [];
	for (const { g } of scored) {
		if (out.length >= options.limit) break;
		const c = g.category ?? '';
		const n = counts.get(c) ?? 0;
		if (n >= cap) {
			if (skipped.length < options.limit) skipped.push(g);
			continue;
		}
		counts.set(c, n + 1);
		out.push(g);
	}
	for (const g of skipped) {
		if (out.length >= options.limit) break;
		out.push(g);
	}
	return out;
}
