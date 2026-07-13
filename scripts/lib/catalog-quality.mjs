/**
 * Shared quality heuristics for catalog imports / Unity Play purge.
 */

export const KEEP_IDS = new Set(['shrek-escape', 'shrek-5']);

export const NSFW_RE =
	/nsfw|hentai|porn|xxx|xnxx|\b18\+\b|\bsex\b|nude|onlyfans|หวย|ufabet|แทงบอล|ซื้อหวย/i;

export const JUNK_TITLE_RE =
	/\b(test|testing|wip|untitled|asdf|sandbox|tutorial|homework|assignment|microgame|create with code|my first|unity hub|betagame)\b|^demo$|^test\d*$/i;

export const EXACT_JUNK_TITLES = new Set(['webgl builds', 'unity hub', 'test', 'untitled']);

/** @param {string} name */
export function normalizeTitleKey(name) {
	return String(name || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.replace(/\s+/g, ' ');
}

/**
 * @param {{ name?: string, description?: string, plays?: number, titleKey?: string }} game
 * @param {{ minPlays?: number }} [opts]
 * @returns {{ ok: boolean, reason?: string }}
 */
export function assessUnityPlayQuality(game, opts = {}) {
	const minPlays = opts.minPlays ?? 100;
	const name = String(game.name || '');
	const desc = String(game.description || '');
	const plays = Number(game.plays) || 0;
	const key = game.titleKey || normalizeTitleKey(name);

	if (EXACT_JUNK_TITLES.has(key) || /^webgl builds$/i.test(name.trim())) {
		return { ok: false, reason: 'webgl-builds' };
	}
	if (NSFW_RE.test(name) || NSFW_RE.test(desc)) {
		return { ok: false, reason: 'nsfw' };
	}
	if (JUNK_TITLE_RE.test(name) || JUNK_TITLE_RE.test(key)) {
		return { ok: false, reason: 'junk-title' };
	}
	if (plays < minPlays) {
		return { ok: false, reason: 'low-plays' };
	}
	return { ok: true };
}

/**
 * Soft quality gate for third-party portals (title/desc only).
 * @param {{ name?: string, description?: string, id?: string }} game
 */
export function assessPortalTitleQuality(game) {
	const id = String(game.id || '');
	if (KEEP_IDS.has(id)) return { ok: true };
	const name = String(game.name || '');
	const desc = String(game.description || '');
	if (NSFW_RE.test(name) || NSFW_RE.test(desc)) return { ok: false, reason: 'nsfw' };
	if (EXACT_JUNK_TITLES.has(normalizeTitleKey(name))) return { ok: false, reason: 'junk-title' };
	if (JUNK_TITLE_RE.test(name)) return { ok: false, reason: 'junk-title' };
	return { ok: true };
}

/** @param {string} raw */
export function slugify(raw, fallback = 'game') {
	const cleaned = String(raw || '')
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
	return cleaned || fallback;
}
