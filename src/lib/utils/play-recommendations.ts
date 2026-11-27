/**
 * Client-side play analytics and recommendations.
 * - Persists in localStorage (no server).
 * - Ranks the whole catalog with a BPR-trained user vector over hashed game features
 *   (recommendation-model.ts), scored on WebGPU when available (recommendation-gpu.ts).
 * - Signals: starts, playtime, favourites, dislikes, launch errors and early leaves
 *   (play-events.ts), last six months only.
 */

import { canUseLocalStorage } from '$lib/utils/browser-storage';
import type { GameIndexEntry, GameMetadata } from '$lib/utils/games';
import type { GamePreferences } from '$lib/utils/preferences';
import {
	buildFeatureMatrix,
	FEATURE_DIM,
	matVecCpu,
	writeFeatures,
	rankFromScores,
	trainUserModel,
	type FeatureMatrix,
	type GameSignal
} from '$lib/utils/recommendation-model';
import { scoreCatalog } from '$lib/utils/recommendation-gpu';
import { loadPlayEvents, playEvents, type PlayEvent } from '$lib/utils/play-events';

const STORAGE_KEY = 'potato-tomato-play-analytics';

const VERSION = 2 as const;
const LEARN_RATE = 0.12;
const RECENT_CAT_MAX = 8;
/** Games usable for ranking (lean index or full metadata). */
export type RecommendableGame = GameIndexEntry & Partial<Pick<GameMetadata, 'description'>>;

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
		recentCategories: Array.isArray(raw.recentCategories) ? (raw.recentCategories as string[]) : []
	};
}

export function loadPlayAnalytics(): PlayAnalyticsV2 {
	if (!canUseLocalStorage()) {
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
	if (!canUseLocalStorage()) return;
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

	if (typeof window !== 'undefined') {
		void import('$lib/utils/desktop-tray')
			.then((m) => m.syncDesktopTrayRecent())
			.catch(() => {
				/* tray sync is best-effort */
			});
	}
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

export function getPlayLimits(): {
	dailyGlobalLimitMs: number;
	dailyPerGameLimitMs: Record<string, number>;
} {
	const d = loadPlayAnalytics();
	return {
		dailyGlobalLimitMs: d.dailyGlobalLimitMs,
		dailyPerGameLimitMs: { ...d.dailyPerGameLimitMs }
	};
}

/** Turn off global and per-game daily caps (same as disabling the limit in Settings). */
export function disableDailyPlayLimits(): void {
	const data = loadPlayAnalytics();
	data.dailyGlobalLimitMs = 0;
	data.dailyPerGameLimitMs = {};
	savePlayAnalytics(data);
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

/** Turn play analytics, favourites and the event log into per-game model signals. */
export function gatherSignals(
	analytics: PlayAnalyticsV2,
	prefs: GamePreferences,
	events: readonly PlayEvent[] = playEvents(),
	now = Date.now()
): GameSignal[] {
	const byId = new Map<string, GameSignal>();
	const get = (id: string, last: number) => {
		let s = byId.get(id);
		if (!s) {
			s = { id, last };
			byId.set(id, s);
		} else if (last > s.last) {
			s.last = last;
		}
		return s;
	};
	for (const [id, stats] of Object.entries(analytics.perGame)) {
		const s = get(id, stats.lastPlayed || 0);
		s.starts = stats.sessions;
		s.playMs = stats.totalPlayMs ?? 0;
	}
	for (const e of events) {
		const s = get(e.id, e.t);
		if (e.k === 'error') s.errors = (s.errors ?? 0) + 1;
		else s.earlyLeaves = (s.earlyLeaves ?? 0) + 1;
	}
	/* Favourites and dislikes carry no date: they count as current. */
	for (const id of prefs.liked) get(id, now).favourite = true;
	for (const id of prefs.disliked) get(id, now).disliked = true;
	return [...byId.values()];
}

let matrixCache: { key: string; matrix: FeatureMatrix } | null = null;

function catalogKey(games: readonly RecommendableGame[]): string {
	return `${games.length}:${games[0]?.id}:${games[games.length - 1]?.id}`;
}

/** Feature rows for the catalog, built once per catalog (about 20 ms for 13k games). */
function featureMatrix(games: readonly RecommendableGame[]): FeatureMatrix {
	const key = catalogKey(games);
	if (matrixCache?.key !== key) matrixCache = { key, matrix: buildFeatureMatrix(games) };
	return matrixCache.matrix;
}

function prepareRanking(allGames: RecommendableGame[], prefs: GamePreferences) {
	const analytics = loadPlayAnalytics();
	const disliked = new Set(prefs.disliked);
	const matrix = featureMatrix(allGames);
	const model = trainUserModel(matrix, gatherSignals(analytics, prefs), Date.now());
	return { analytics, disliked, matrix, model };
}

/**
 * Home page (sync, CPU): the BPR model over hashed features, see recommendation-model.ts.
 * With no history this is the catalog's quality order, diversified by category.
 */
export function getHomeRecommendations(
	allGames: RecommendableGame[],
	prefs: GamePreferences,
	limit: number
): RecommendableGame[] {
	if (allGames.length === 0) return [];
	const { analytics, disliked, matrix, model } = prepareRanking(allGames, prefs);
	const raw = matVecCpu(matrix.data, model.w, allGames.length);
	return rankFromScores(allGames, raw, model, {
		limit,
		exclude: disliked,
		categoryAffinity: analytics.categoryAffinity
	});
}

/** Home page (async): the same ranking, with the catalog mat-vec on WebGPU when available. */
export async function getHomeRecommendationsAsync(
	allGames: RecommendableGame[],
	prefs: GamePreferences,
	limit: number
): Promise<RecommendableGame[]> {
	if (allGames.length === 0) return [];
	const { analytics, disliked, matrix, model } = prepareRanking(allGames, prefs);
	await loadPlayEvents();
	const raw = await scoreCatalog(matrix.data, model.w, allGames.length);
	return rankFromScores(allGames, raw, model, {
		limit,
		exclude: disliked,
		categoryAffinity: analytics.categoryAffinity
	});
}

/**
 * Words that say nothing about what a game is: portal suffixes the importers left in names
 * ("… 🕹️ Play on CrazyGames") and filler every title shares.
 */
const SIMILARITY_STOP_WORDS = new Set([
	'the',
	'and',
	'for',
	'play',
	'online',
	'game',
	'games',
	'crazygames',
	'unblocked',
	'free'
]);

function nameTokens(name: string): Set<string> {
	const out = new Set<string>();
	for (const word of name.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
		if (word.length >= 3 && !SIMILARITY_STOP_WORDS.has(word)) out.add(word);
	}
	return out;
}

export type SimilarityProfile = { category: string; author: string; tokens: Set<string> };

export function similarityProfile(game: RecommendableGame): SimilarityProfile {
	return { category: game.category, author: game.author, tokens: nameTokens(game.name) };
}

/**
 * How alike two games look from their catalog row alone, 0..1: same category, shared
 * words in the name, same author — weighted as the fuzzy search it replaces was.
 *
 * That search (Fuse over every row, keyed on category/name/author) ran synchronously on
 * the player page and took 2.5 s on a fast desktop for the 13.6k-game catalog — measured
 * as one long task starting right after a card click, which held the Play button (and
 * with it the game) until it finished. A school laptop is several times slower. This is
 * one pass of set lookups, a few milliseconds for the whole catalog.
 */
export function gameSimilarity(profile: SimilarityProfile, game: RecommendableGame): number {
	let score = 0;
	if (game.category && game.category === profile.category) score += 0.45;
	if (game.author && game.author === profile.author) score += 0.2;
	if (profile.tokens.size > 0) {
		const other = nameTokens(game.name);
		let shared = 0;
		for (const token of other) if (profile.tokens.has(token)) shared++;
		const union = profile.tokens.size + other.size - shared;
		if (union > 0) score += 0.35 * (shared / union);
	}
	return score;
}

export function getRecommendationsForGamePage(
	allGames: RecommendableGame[],
	current: RecommendableGame,
	currentId: string,
	prefs: GamePreferences,
	limit: number
): RecommendableGame[] {
	if (allGames.length === 0) return [];
	const { analytics, disliked, matrix, model } = prepareRanking(allGames, prefs);
	/*
	 * "More like this": the current game's feature row, nudged by the player's own taste.
	 * Both are unit-length, so the game dominates and taste breaks ties.
	 */
	const target = new Float32Array(FEATURE_DIM);
	writeFeatures(current, target, 0);
	let wnorm = 0;
	for (let k = 0; k < FEATURE_DIM; k++) wnorm += model.w[k] ** 2;
	const taste = wnorm > 0 ? 0.35 / Math.sqrt(wnorm) : 0;
	for (let k = 0; k < FEATURE_DIM; k++) target[k] += taste * model.w[k];
	const raw = matVecCpu(matrix.data, target, allGames.length);
	const exclude = new Set(disliked);
	exclude.add(currentId);
	return rankFromScores(
		allGames,
		raw,
		{ ...model, w: target },
		{
			limit,
			exclude,
			categoryAffinity: analytics.categoryAffinity,
			perCategory: limit
		}
	);
}

export function getRecentlyPlayedGames(
	allGames: RecommendableGame[],
	prefs: GamePreferences,
	limit: number
): RecommendableGame[] {
	const analytics = loadPlayAnalytics();
	const disliked = new Set(prefs.disliked);
	const byId = new Map(allGames.map((g) => [g.id, g]));

	const ordered = Object.entries(analytics.perGame)
		.map(([id, v]) => ({ id, lastPlayed: v.lastPlayed }))
		.sort((a, b) => b.lastPlayed - a.lastPlayed);

	const out: RecommendableGame[] = [];
	for (const { id } of ordered) {
		if (out.length >= limit) break;
		const g = byId.get(id);
		if (g && !disliked.has(g.id)) out.push(g);
	}

	if (out.length < limit) {
		const have = new Set(out.map((g) => g.id));
		const filler = getHomeRecommendations(allGames, prefs, limit * 2).filter(
			(g) => !have.has(g.id)
		);
		for (const g of filler) {
			if (out.length >= limit) break;
			out.push(g);
		}
	}

	return out.slice(0, limit);
}

export function getPlaySessionsList(): {
	gameId: string;
	sessions: number;
	lastPlayed: number;
	totalPlayMs: number;
}[] {
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
	allGames: RecommendableGame[],
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
