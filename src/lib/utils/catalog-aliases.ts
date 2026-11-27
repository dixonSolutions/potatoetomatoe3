/**
 * Old ids of games curation replaced with a working copy (scripts/catalog-quality/curate.mjs
 * writes them; the index generator publishes games-index/aliases.json). A link or favourite
 * to an old id opens the replacement instead of the broken copy.
 */
import { base } from '$app/paths';

let aliases: Promise<Record<string, string>> | null = null;

function loadAliases(fetchImpl: typeof fetch = fetch): Promise<Record<string, string>> {
	aliases ??= fetchImpl(`${base}/games/games-index/aliases.json`.replace(/\/{2,}/g, '/'))
		.then((r) => (r.ok ? r.json() : {}))
		.then((v) => (v && typeof v === 'object' ? (v as Record<string, string>) : {}))
		.catch(() => {
			aliases = null; /* offline or missing: try again next time */
			return {};
		});
	return aliases;
}

/** Follow a → b → c to the game that is still listed; null when `id` is not an old id. */
export function followAlias(map: Record<string, string>, id: string, max = 8): string | null {
	let cur = id;
	for (let i = 0; i < max && Object.hasOwn(map, cur); i++) cur = map[cur];
	return cur === id ? null : cur;
}

export async function resolveCatalogAlias(id: string): Promise<string | null> {
	return followAlias(await loadAliases(), id);
}
