/**
 * Client-side play analytics and recommendations.
 * - Persists in localStorage (no server).
 * - Ranks candidates with TensorFlow.js matmul on WebGPU when available (see recommendation-tf.ts).
 * - Content-based weights (categories, authors), implicit feedback, recency, explicit category affinity.
 */

import type { GameMetadata } from '$lib/utils/games';
import type { GamePreferences } from '$lib/utils/preferences';
import Fuse from 'fuse.js';
import { cpuMatMulVec, scoreWithTensorFlow, initRecommendationBackend } from '$lib/utils/recommendation-tf';

const STORAGE_KEY = 'potato-tomato-play-analytics';

const VERSION = 2 as const;
const LEARN_RATE = 0.12;
const RECENT_CAT_MAX = 8;
const RECENT_CAT_BOOST = 0.18;

/** Feature dimension for TF / CPU dot-product scorer */
export const RECOMMEND_FEATURE_DIM = 8;

export interface PerGameStats {
	sessions: number;
	lastPlayed: number;
	totalPlayMs?: number;
}

export interface PlayAnalyticsV2 {
	version: typeof VERSION;
	categoryWeights: Record<string, number>;
	authorWeights: Record<string, number>;
	perGame: Record<string, PerGameStats>;
	recentCategories?: string[];
	/** -1 (dislike) … +1 (like) per category label */
	categoryAffinity: Record<string, number>;
	/** ISO date (UTC) -> gameId -> ms played that calendar day */
	dailyPlayByDate: Record<string, Record<string, number>>;
	/** 0 = no global daily cap */
	dailyGlobalLimitMs: number;
	dailyPerGameLimitMs: Record<string, number>;
}

function emptyAnalytics(): PlayAnalyticsV2 {
	return {
		version: VERSION,
		categoryWeights: {},
		authorWeights: {},
		perGame: {},
		recentCategories: [],
		categoryAffinity: {},
		dailyPlayByDate: {},
		dailyGlobalLimitMs: 0,
		dailyPerGameLimitMs: {}
	};
}

function migrateV1ToV2(raw: Record<string, unknown>): PlayAnalyticsV2 {
	const perGame: Record<string, PerGameStats> = {};
	const old = raw.perGame as Record<string, { sessions: number; lastPlayed: number }> | undefined;
	if (old && typeof old === 'object') {
		for (const [id, v] of Object.entries(old)) {
			perGame[id] = {
				sessions: v.sessions ?? 0,
				lastPlayed: v.lastPlayed ?? 0,
				totalPlayMs: 0
			};
		}
	}
	return {
		...emptyAnalytics(),
		categoryWeights: (raw.categoryWeights as Record<string, number>) ?? {},
		authorWeights: (raw.authorWeights as Record<string, number>) ?? {},
		perGame,
		recentCategories: Array.isArray(raw.recentCategories)
			? (raw.recentCategories as string[])
			: []
	};
}

export function loadPlayAnalytics(): PlayAnalyticsV2 {
	if (typeof localStorage === 'undefined') {
		return emptyAnalytics();
	}
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return emptyAnalytics();
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const ver = parsed.version;
		if (ver === 1) {
			return migrateV1ToV2(parsed);
		}
		if (ver !== VERSION) return emptyAnalytics();

		const p = parsed as Partial<PlayAnalyticsV2>;
		return {
			...emptyAnalytics(),
			...p,
			categoryWeights: { ...(p.categoryWeights ?? {}) },
			authorWeights: { ...(p.authorWeights ?? {}) },
			perGame: { ...(p.perGame ?? {}) },
			recentCategories: Array.isArray(p.recentCategories) ? [...p.recentCategories] : [],
			categoryAffinity: { ...(p.categoryAffinity ?? {}) },
			dailyPlayByDate: { ...(p.dailyPlayByDate ?? {}) },
			dailyPerGameLimitMs: { ...(p.dailyPerGameLimitMs ?? {}) }
		};
	} catch {
		return emptyAnalytics();
	}
}

function savePlayAnalytics(data: PlayAnalyticsV2): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
	} catch (e) {
		console.error('Failed to save play analytics:', e);
	}
}

function todayUtcKey(): string {
	return new Date().toISOString().slice(0, 10);
}

export function recordGamePlay(gameId: string, category: string, author: string): void {
	const data = loadPlayAnalytics();
	const now = Date.now();
	const prev = data.perGame[gameId];
	data.perGame[gameId] = {
		sessions: (prev?.sessions ?? 0) + 1,
		lastPlayed: now,
		totalPlayMs: prev?.totalPlayMs ?? 0
	};

	const cat = (category || 'unknown').trim() || 'unknown';
	const auth = (author || 'unknown').trim() || 'unknown';

	data.categoryWeights[cat] = (data.categoryWeights[cat] ?? 0) * (1 - LEARN_RATE) + LEARN_RATE;
	data.authorWeights[auth] = (data.authorWeights[auth] ?? 0) * (1 - LEARN_RATE) + LEARN_RATE;

	const rc = [...(data.recentCategories ?? [])].filter((c) => c !== cat);
	rc.unshift(cat);
	data.recentCategories = rc.slice(0, RECENT_CAT_MAX);

	savePlayAnalytics(data);
}

/** Accumulate active play time (call from game page while the session is visible). */
export function recordPlaytimeMs(gameId: string, ms: number): void {
	if (ms <= 0) return;
	const data = loadPlayAnalytics();
	const day = todayUtcKey();
	const prev = data.perGame[gameId];
	data.perGame[gameId] = {
		sessions: prev?.sessions ?? 0,
		lastPlayed: prev?.lastPlayed ?? Date.now(),
		totalPlayMs: (prev?.totalPlayMs ?? 0) + ms
	};
	if (!data.dailyPlayByDate[day]) data.dailyPlayByDate[day] = {};
	data.dailyPlayByDate[day][gameId] = (data.dailyPlayByDate[day][gameId] ?? 0) + ms;
	savePlayAnalytics(data);
}

export function getTotalPlaytimeMs(gameId: string): number {
	return loadPlayAnalytics().perGame[gameId]?.totalPlayMs ?? 0;
}

export function getTodayPlayMsForGame(gameId: string): number {
	const day = todayUtcKey();
	return loadPlayAnalytics().dailyPlayByDate[day]?.[gameId] ?? 0;
}

export function getTodayTotalPlayMs(): number {
	const day = todayUtcKey();
	const row = loadPlayAnalytics().dailyPlayByDate[day];
	if (!row) return 0;
	return Object.values(row).reduce((a, b) => a + b, 0);
}

export function setCategoryAffinity(category: string, value: number): void {
	const c = (category || 'unknown').trim() || 'unknown';
	const v = Math.max(-1, Math.min(1, value));
	const data = loadPlayAnalytics();
	data.categoryAffinity[c] = v;
	savePlayAnalytics(data);
}

export function clearCategoryAffinities(): void {
	const data = loadPlayAnalytics();
	data.categoryAffinity = {};
	savePlayAnalytics(data);
}

export function getCategoryAffinityMap(): Record<string, number> {
	return { ...loadPlayAnalytics().categoryAffinity };
}

export function setPlayLimits(opts: {
	dailyGlobalLimitMs?: number;
	perGame?: Record<string, number>;
}): void {
	const data = loadPlayAnalytics();
	if (opts.dailyGlobalLimitMs !== undefined) {
		data.dailyGlobalLimitMs = Math.max(0, opts.dailyGlobalLimitMs);
	}
	if (opts.perGame) {
		data.dailyPerGameLimitMs = { ...data.dailyPerGameLimitMs, ...opts.perGame };
	}
	savePlayAnalytics(data);
}

export function getPlayLimits(): { dailyGlobalLimitMs: number; dailyPerGameLimitMs: Record<string, number> } {
	const d = loadPlayAnalytics();
	return {
		dailyGlobalLimitMs: d.dailyGlobalLimitMs,
		dailyPerGameLimitMs: { ...d.dailyPerGameLimitMs }
	};
}

/** True when a global daily cap is set and today’s total tracked play meets or exceeds it (UTC day). */
export function isGlobalDailyLimitExceeded(): boolean {
	const data = loadPlayAnalytics();
	const globalLimit = data.dailyGlobalLimitMs;
	if (!globalLimit || globalLimit <= 0) return false;
	return getTodayTotalPlayMs() >= globalLimit;
}

export function isTodayPlayLimitReached(gameId: string): boolean {
	const data = loadPlayAnalytics();
	const day = todayUtcKey();
	const playedGame = data.dailyPlayByDate[day]?.[gameId] ?? 0;
	const perGameLimit = data.dailyPerGameLimitMs[gameId];
	if (perGameLimit && perGameLimit > 0 && playedGame >= perGameLimit) return true;

	const globalLimit = data.dailyGlobalLimitMs;
	if (globalLimit && globalLimit > 0) {
		const total = getTodayTotalPlayMs();
		if (total >= globalLimit) return true;
	}
	return false;
}

function sumValues(rec: Record<string, number>): number {
	return Object.values(rec).reduce((a, b) => a + b, 0);
}

function normalizeWeights(rec: Record<string, number>): Record<string, number> {
	const s = sumValues(rec);
	if (s <= 0) return {};
	const out: Record<string, number> = {};
	for (const [k, v] of Object.entries(rec)) {
		out[k] = v / s;
	}
	return out;
}

function mulberry32(seed: number) {
	return function () {
		let t = (seed += 0x6d2b79f5);
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function shuffleDeterministic<T>(arr: T[], seed: number): T[] {
	const copy = [...arr];
	const rand = mulberry32(seed);
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[copy[i], copy[j]] = [copy[j], copy[i]];
	}
	return copy;
}

export function getBrowseShuffleSeed(): number {
	if (typeof sessionStorage === 'undefined') {
		return 0xdec0de;
	}
	const key = 'potato-tomato-browse-shuffle-seed';
	let raw = sessionStorage.getItem(key);
	if (!raw) {
		raw = String(Date.now() ^ (Math.random() * 0x7fffffff));
		sessionStorage.setItem(key, raw);
	}
	return parseInt(raw, 10) || 0xdec0de;
}

function likedAuthorHints(prefs: GamePreferences, byId: Map<string, GameMetadata>): Set<string> {
	const authors = new Set<string>();
	for (const id of prefs.liked) {
		const g = byId.get(id);
		if (g?.author) authors.add(g.author);
	}
	return authors;
}

function learningSignalStrength(analytics: PlayAnalyticsV2, prefs: GamePreferences): number {
	return sumValues(analytics.categoryWeights) + prefs.liked.length * 0.1;
}

/** Hand-tuned weights for feature vector (same order as buildFeatureRow). */
const SCORE_WEIGHTS = new Float32Array([
	2.2, // categoryNorm
	1.0, // authorNorm
	0.25, // likedAuthor
	0.08, // likedGame
	0.18, // recency
	0.45, // freshness (inverse sessions)
	0.12, // days since play
	1.0 // category affinity (0..1)
]);

function buildFeatureRow(
	game: GameMetadata,
	analytics: PlayAnalyticsV2,
	prefs: GamePreferences,
	catNorm: Record<string, number>,
	authNorm: Record<string, number>,
	likedAuthors: Set<string>,
	recentIdx: Map<string, number>,
	recentCats: string[]
): Float32Array {
	const now = Date.now();
	const dayMs = 86_400_000;
	const affinityRaw = analytics.categoryAffinity[game.category] ?? 0;
	const affinity01 = (affinityRaw + 1) / 2;

	const sessions = analytics.perGame[game.id]?.sessions ?? 0;
	const last = analytics.perGame[game.id]?.lastPlayed;
	const freshness = 1 / (1 + sessions * 0.12);
	let daysNorm = 0;
	if (last != null) {
		const days = (now - last) / dayMs;
		daysNorm = Math.min(1, days / 30);
	}

	const ri = recentIdx.get(game.category);
	let recency = 0;
	if (ri !== undefined && recentCats.length > 0) {
		recency = RECENT_CAT_BOOST * (1 - ri / Math.max(1, recentCats.length));
	}

	const f = new Float32Array(RECOMMEND_FEATURE_DIM);
	f[0] = catNorm[game.category] ?? 0;
	f[1] = authNorm[game.author] ?? 0;
	f[2] = likedAuthors.has(game.author) ? 1 : 0;
	f[3] = prefs.liked.includes(game.id) ? 1 : 0;
	f[4] = recency;
	f[5] = freshness;
	f[6] = daysNorm;
	f[7] = affinity01;
	return f;
}

function scoreGamesCpu(
	games: GameMetadata[],
	analytics: PlayAnalyticsV2,
	prefs: GamePreferences,
	byId: Map<string, GameMetadata>
): { game: GameMetadata; score: number }[] {
	const disliked = new Set(prefs.disliked);
	const effectiveCat: Record<string, number> = { ...analytics.categoryWeights };
	for (const id of prefs.liked) {
		const g = byId.get(id);
		if (g?.category) {
			const c = g.category;
			effectiveCat[c] = (effectiveCat[c] ?? 0) + 0.35;
		}
	}
	const catNorm = normalizeWeights(effectiveCat);
	const authNorm = normalizeWeights(analytics.authorWeights);
	const likedAuthors = likedAuthorHints(prefs, byId);
	const recentCats = analytics.recentCategories ?? [];
	const recentIdx = new Map<string, number>();
	for (let i = 0; i < recentCats.length; i++) {
		const c = recentCats[i];
		if (!recentIdx.has(c)) recentIdx.set(c, i);
	}

	const n = games.length;
	const features = new Float32Array(n * RECOMMEND_FEATURE_DIM);
	for (let i = 0; i < n; i++) {
		const row = buildFeatureRow(
			games[i],
			analytics,
			prefs,
			catNorm,
			authNorm,
			likedAuthors,
			recentIdx,
			recentCats
		);
		features.set(row, i * RECOMMEND_FEATURE_DIM);
	}
	const scores = cpuMatMulVec(features, SCORE_WEIGHTS, n, RECOMMEND_FEATURE_DIM);
	return games.map((game, i) => ({
		game,
		score: scores[i] + (game.id.charCodeAt(0) % 7) * 0.001
	}));
}

/**
 * Home page (sync): CPU-only ranking — same math as async path without TensorFlow.
 */
export function getHomeRecommendations(
	allGames: GameMetadata[],
	prefs: GamePreferences,
	limit: number
): GameMetadata[] {
	const analytics = loadPlayAnalytics();
	const disliked = new Set(prefs.disliked);
	const byId = new Map(allGames.map((g) => [g.id, g]));
	const candidates = allGames.filter((g) => !disliked.has(g.id));
	if (candidates.length === 0) return [];

	if (learningSignalStrength(analytics, prefs) < 0.02) {
		return shuffleDeterministic(candidates, 42_069).slice(0, limit);
	}

	const scored = scoreGamesCpu(candidates, analytics, prefs, byId);
	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, limit).map((s) => s.game);
}

/**
 * Home page (async): TensorFlow matmul on GPU when available.
 */
export async function getHomeRecommendationsAsync(
	allGames: GameMetadata[],
	prefs: GamePreferences,
	limit: number
): Promise<GameMetadata[]> {
	const analytics = loadPlayAnalytics();
	const disliked = new Set(prefs.disliked);
	const byId = new Map(allGames.map((g) => [g.id, g]));
	const candidates = allGames.filter((g) => !disliked.has(g.id));
	if (candidates.length === 0) return [];

	if (learningSignalStrength(analytics, prefs) < 0.02) {
		return shuffleDeterministic(candidates, 42_069).slice(0, limit);
	}

	const effectiveCat: Record<string, number> = { ...analytics.categoryWeights };
	for (const id of prefs.liked) {
		const g = byId.get(id);
		if (g?.category) {
			const c = g.category;
			effectiveCat[c] = (effectiveCat[c] ?? 0) + 0.35;
		}
	}
	const catNorm = normalizeWeights(effectiveCat);
	const authNorm = normalizeWeights(analytics.authorWeights);
	const likedAuthors = likedAuthorHints(prefs, byId);
	const recentCats = analytics.recentCategories ?? [];
	const recentIdx = new Map<string, number>();
	for (let i = 0; i < recentCats.length; i++) {
		const c = recentCats[i];
		if (!recentIdx.has(c)) recentIdx.set(c, i);
	}

	const n = candidates.length;
	const features = new Float32Array(n * RECOMMEND_FEATURE_DIM);
	for (let i = 0; i < n; i++) {
		const row = buildFeatureRow(
			candidates[i],
			analytics,
			prefs,
			catNorm,
			authNorm,
			likedAuthors,
			recentIdx,
			recentCats
		);
		features.set(row, i * RECOMMEND_FEATURE_DIM);
	}

	let scores: Float32Array;
	if (typeof window !== 'undefined') {
		await initRecommendationBackend();
		scores = await scoreWithTensorFlow(features, SCORE_WEIGHTS, n, RECOMMEND_FEATURE_DIM);
	} else {
		scores = cpuMatMulVec(features, SCORE_WEIGHTS, n, RECOMMEND_FEATURE_DIM);
	}

	const combined = candidates.map((game, i) => ({
		game,
		score: scores[i] + (game.id.charCodeAt(0) % 7) * 0.001
	}));
	combined.sort((a, b) => b.score - a.score);
	return combined.slice(0, limit).map((s) => s.game);
}

export function getRecommendationsForGamePage(
	allGames: GameMetadata[],
	current: GameMetadata,
	currentId: string,
	prefs: GamePreferences,
	limit: number
): GameMetadata[] {
	const analytics = loadPlayAnalytics();
	const disliked = new Set(prefs.disliked);
	const byId = new Map(allGames.map((g) => [g.id, g]));

	const effectiveCat: Record<string, number> = { ...analytics.categoryWeights };
	for (const id of prefs.liked) {
		const g = byId.get(id);
		if (g?.category) {
			const c = g.category;
			effectiveCat[c] = (effectiveCat[c] ?? 0) + 0.25;
		}
	}
	const catNorm = normalizeWeights(effectiveCat);
	const authNorm = normalizeWeights(analytics.authorWeights);
	const likedAuthors = likedAuthorHints(prefs, byId);

	const fuse = new Fuse(allGames, {
		keys: [
			{ name: 'category', weight: 0.45 },
			{ name: 'name', weight: 0.3 },
			{ name: 'description', weight: 0.2 },
			{ name: 'author', weight: 0.05 }
		],
		threshold: 0.42,
		includeScore: true
	});
	const query = `${current.category} ${current.name}`;
	const fuseHits = fuse.search(query);
	const fuseScoreById = new Map<string, number>();
	for (const r of fuseHits) {
		fuseScoreById.set(r.item.id, 1 - (r.score ?? 0));
	}

	const pool = allGames.filter((g) => g.id !== currentId && !disliked.has(g.id));
	const recentCats = analytics.recentCategories ?? [];
	const recentIdx = new Map<string, number>();
	for (let i = 0; i < recentCats.length; i++) {
		const c = recentCats[i];
		if (!recentIdx.has(c)) recentIdx.set(c, i);
	}

	const scored = pool.map((game) => {
		let score = 1.8 * (catNorm[game.category] ?? 0);
		score += 0.9 * (authNorm[game.author] ?? 0);
		if (likedAuthors.has(game.author)) score += 0.22;
		score += 0.55 * (fuseScoreById.get(game.id) ?? 0);

		if (prefs.disliked.some((id) => byId.get(id)?.author === game.author)) {
			score -= 0.25;
		}

		const sessions = analytics.perGame[game.id]?.sessions ?? 0;
		score -= sessions * 0.02;

		const aff = analytics.categoryAffinity[game.category] ?? 0;
		score += aff * 0.4;

		return { game, score };
	});

	scored.sort((a, b) => b.score - a.score);
	let out = scored.slice(0, limit).map((s) => s.game);

	if (out.length < limit) {
		const need = limit - out.length;
		const have = new Set(out.map((g) => g.id));
		const sameCat = allGames
			.filter(
				(g) =>
					g.id !== currentId &&
					!disliked.has(g.id) &&
					!have.has(g.id) &&
					g.category === current.category
			)
			.slice(0, need);
		out = [...out, ...sameCat];
	}

	return out.slice(0, limit);
}

function hashGameId(gameId: string): number {
	let h = 0;
	for (let i = 0; i < gameId.length; i++) {
		h = (Math.imul(31, h) + gameId.charCodeAt(i)) | 0;
	}
	return Math.abs(h);
}

export function getPlaySessions(gameId: string): number {
	return loadPlayAnalytics().perGame[gameId]?.sessions ?? 0;
}

export function getLocalDisplayStats(
	gameId: string,
	sessions: number = 0
): { ratingPct: number; activeLabel: string } {
	const h = hashGameId(gameId);
	const baseRating = 65 + (h % 28);
	const ratingPct = Math.min(99, baseRating + Math.min(8, sessions * 2));
	const baseActive = 30 + (h % 400) + sessions * 42;
	const activeLabel = formatCompactPlayers(baseActive);
	return { ratingPct, activeLabel };
}

function formatCompactPlayers(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return String(Math.max(1, Math.round(n)));
}

export function getRecentlyPlayedGames(
	allGames: GameMetadata[],
	prefs: GamePreferences,
	limit: number
): GameMetadata[] {
	const analytics = loadPlayAnalytics();
	const disliked = new Set(prefs.disliked);
	const byId = new Map(allGames.map((g) => [g.id, g]));

	const ordered = Object.entries(analytics.perGame)
		.map(([id, v]) => ({ id, lastPlayed: v.lastPlayed }))
		.sort((a, b) => b.lastPlayed - a.lastPlayed);

	const out: GameMetadata[] = [];
	for (const { id } of ordered) {
		if (out.length >= limit) break;
		const g = byId.get(id);
		if (g && !disliked.has(g.id)) out.push(g);
	}

	if (out.length < limit) {
		const have = new Set(out.map((g) => g.id));
		const filler = getHomeRecommendations(allGames, prefs, limit * 2).filter((g) => !have.has(g.id));
		for (const g of filler) {
			if (out.length >= limit) break;
			out.push(g);
		}
	}

	return out.slice(0, limit);
}

export function getPlaySessionsList(): { gameId: string; sessions: number; lastPlayed: number; totalPlayMs: number }[] {
	const p = loadPlayAnalytics().perGame;
	return Object.entries(p)
		.map(([gameId, v]) => ({
			gameId,
			sessions: v.sessions,
			lastPlayed: v.lastPlayed,
			totalPlayMs: v.totalPlayMs ?? 0
		}))
		.sort((a, b) => b.lastPlayed - a.lastPlayed);
}

/** Top-N games the async recommender would surface (for analytics UI). */
export async function getTopRecommendedPreview(
	allGames: GameMetadata[],
	prefs: GamePreferences,
	n: number
): Promise<{ id: string; name: string; scoreApprox: number }[]> {
	const list = await getHomeRecommendationsAsync(allGames, prefs, n);
	return list.map((g, i) => ({
		id: g.id,
		name: g.name,
		scoreApprox: Math.round((1 - i / Math.max(1, n)) * 100)
	}));
}
