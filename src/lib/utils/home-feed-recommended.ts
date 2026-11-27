import { getPreferences } from './preferences';
import { getHomeRecommendations, getHomeRecommendationsAsync } from './play-recommendations';

/**
 * Recommended games for Home and for the Games tab's Recommended filter. Never fails and
 * never comes back empty for a non-empty pool: the GPU ranker, else the CPU one, else the
 * pool's own best-first order. Results map back to the caller's entries.
 */
export async function recommendedGames<T extends { id: string; name: string }>(
	pool: readonly T[],
	limit: number,
	exclude: ReadonlySet<string> = new Set()
): Promise<T[]> {
	if (pool.length === 0) return [];
	const byId = new Map(pool.map((g) => [g.id, g]));
	const prefs = getPreferences();
	const want = limit + exclude.size;
	const keep = (ranked: readonly { id: string }[]) =>
		ranked
			.map((g) => byId.get(g.id))
			.filter((g): g is T => g !== undefined && !exclude.has(g.id))
			.slice(0, limit);
	/* The ranker's pool type is structural; the entries come back mapped through byId. */
	const input = pool as unknown as Parameters<typeof getHomeRecommendations>[0];
	try {
		const ranked = keep(await getHomeRecommendationsAsync(input, prefs, want));
		if (ranked.length > 0) return ranked;
	} catch {
		/* fall through to the CPU ranker */
	}
	try {
		const ranked = keep(getHomeRecommendations(input, prefs, want));
		if (ranked.length > 0) return ranked;
	} catch {
		/* fall through to catalog order */
	}
	return pool.filter((g) => !exclude.has(g.id)).slice(0, limit);
}
