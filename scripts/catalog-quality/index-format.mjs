/**
 * Catalog index v2: columnar shards with shared dictionaries.
 *
 * v1 stored one JSON object per game (`{"id":…,"name":…,"author":…,"thumbnail":"https://…"}`)
 * in 28 shards of 500. Half the bytes were thumbnail URLs that differ only in a slug or a
 * hash, and every row repeated its key names. v2 stores each field as a column, authors,
 * categories, engines and DoE states as indexes into manifest tables, and thumbnails as a
 * URL template plus its arguments. A small first shard paints Home; the rest come in a few
 * large shards.
 *
 * The client decoder is `src/lib/utils/catalog-index-format.ts`; both are tested together.
 */

import fs from 'node:fs';
import path from 'node:path';

export const INDEX_FORMAT_VERSION = 2;
/** First shard: the top of the catalog, enough for Home and the first Games screens. */
export const FIRST_SHARD_SIZE = 240;
export const SHARD_SIZE = 2000;

/**
 * Thumbnail templates: `{id}` is the game id, `{0}`, `{1}` … the captured groups. A URL
 * that matches none is stored as it is.
 */
export const THUMBNAIL_TEMPLATES = [
	{
		re: /^https:\/\/imgs\.crazygames\.com\/(.+?)_16x9\/(\d+)\/\1_16x9-cover\?metadata=none&quality=100&width=1200&height=630&fit=crop$/,
		tpl: 'https://imgs.crazygames.com/{0}_16x9/{1}/{0}_16x9-cover?metadata=none&quality=100&width=1200&height=630&fit=crop'
	},
	{
		re: /^https:\/\/imgs\.crazygames\.com\/(.+?)\?metadata=none&quality=100&width=1200&height=630&fit=crop$/,
		tpl: 'https://imgs.crazygames.com/{0}?metadata=none&quality=100&width=1200&height=630&fit=crop'
	},
	{
		re: /^https:\/\/play\.unity\.com\/api\/v1\/files\/file\/([^/?#]+)\/content$/,
		tpl: 'https://play.unity.com/api/v1/files/file/{0}/content'
	},
	{
		re: /^https:\/\/avatars\.mds\.yandex\.net\/get-games\/(\d+)\/([^/?#]+)\/orig$/,
		tpl: 'https://avatars.mds.yandex.net/get-games/{0}/{1}/orig'
	},
	{
		re: /^https:\/\/fnf-games\.io\/data\/image\/game\/([^/?#]+)\/\1\.png$/,
		tpl: 'https://fnf-games.io/data/image/game/{0}/{0}.png'
	},
	{
		re: /^https:\/\/fnf-games\.io\/data\/image\/game\/(.+)$/,
		tpl: 'https://fnf-games.io/data/image/game/{0}'
	},
	{
		re: /^https:\/\/prod\.addictinggames\.com\/sites\/default\/files\/(.+)$/,
		tpl: 'https://prod.addictinggames.com/sites/default/files/{0}'
	},
	{
		re: /^https:\/\/sites\.google\.com\/sitesv-images-rt\/(.+)$/,
		tpl: 'https://sites.google.com/sitesv-images-rt/{0}'
	},
	{ re: /^https:\/\/www\.coolmathgames\.com\/(.+)$/, tpl: 'https://www.coolmathgames.com/{0}' },
	{ id: true, re: null, tpl: '/games/{id}/online/assets/{0}' },
	{ id: true, re: null, tpl: '/games/{id}/{0}' }
];

function escapeRegex(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Template index and arguments for `url`, or null. */
export function matchThumbnail(url, id) {
	for (let i = 0; i < THUMBNAIL_TEMPLATES.length; i++) {
		const t = THUMBNAIL_TEMPLATES[i];
		let re = t.re;
		if (t.id) {
			const [head, tail] = t.tpl.split('{0}');
			re = new RegExp(`^${escapeRegex(head.replace('{id}', id))}(.+)${escapeRegex(tail ?? '')}$`);
		}
		if (!re) continue;
		const m = re.exec(url);
		if (m) return { tpl: i, args: m.slice(1) };
	}
	return null;
}

export function fillTemplate(tpl, id, args) {
	return tpl.replace(/\{(id|\d+)\}/g, (_, key) => (key === 'id' ? id : (args[Number(key)] ?? '')));
}

/**
 * A thumbnail cell: the URL itself, or `<tpl>|arg|arg…` (no stored URL starts with a digit
 * and a pipe, and `|` never appears in an argument the templates capture… checked here).
 */
function encodeThumbnail(url, id) {
	if (!url) return '';
	const m = matchThumbnail(url, id);
	if (m && m.args.every((a) => !a.includes('|'))) {
		const cell = [String(m.tpl), ...m.args].join('|');
		if (fillTemplate(THUMBNAIL_TEMPLATES[m.tpl].tpl, id, m.args) === url) return cell;
	}
	return url;
}

function tableIndex(table, map, value) {
	let i = map.get(value);
	if (i === undefined) {
		i = table.length;
		table.push(value);
		map.set(value, i);
	}
	return i;
}

/**
 * Encode lean entries (already in display order) into a v2 manifest and shards.
 * @param {Array<{id:string,name:string,author?:string,category?:string,thumbnail?:string,engine?:string,q?:number,d?:string}>} lean
 */
export function encodeIndex(lean, { order = 'quality' } = {}) {
	const authorCounts = new Map();
	for (const g of lean) authorCounts.set(g.author ?? '', (authorCounts.get(g.author ?? '') ?? 0) + 1);
	/* Authors seen more than once go in the table; one-offs stay inline. */
	const authors = [];
	const authorMap = new Map();
	for (const [a, n] of [...authorCounts].sort((x, y) => y[1] - x[1])) {
		if (n > 1) tableIndex(authors, authorMap, a);
	}
	const categories = [...new Set(lean.map((g) => g.category).filter(Boolean))].sort((a, b) =>
		a.localeCompare(b)
	);
	const categoryMap = new Map(categories.map((c, i) => [c, i]));
	const engines = [];
	const engineMap = new Map();
	const doe = [];
	const doeMap = new Map();

	const sizes = [];
	if (lean.length > 0) sizes.push(Math.min(FIRST_SHARD_SIZE, lean.length));
	for (let left = lean.length - (sizes[0] ?? 0); left > 0; left -= SHARD_SIZE) {
		sizes.push(Math.min(SHARD_SIZE, left));
	}
	const shards = [];
	let at = 0;
	for (const size of sizes) {
		const rows = lean.slice(at, at + size);
		at += size;
		shards.push({
			id: rows.map((g) => g.id),
			n: rows.map((g) => g.name ?? ''),
			a: rows.map((g) => {
				const i = authorMap.get(g.author ?? '');
				return i === undefined ? (g.author ?? '') : i;
			}),
			c: rows.map((g) => categoryMap.get(g.category) ?? -1),
			t: rows.map((g) => encodeThumbnail(g.thumbnail ?? '', g.id)),
			q: rows.map((g) => (Number.isFinite(g.q) ? g.q : -1)),
			d: rows.map((g) => (g.d ? tableIndex(doe, doeMap, g.d) : -1)),
			e: rows.map((g) => (g.engine ? tableIndex(engines, engineMap, g.engine) : -1))
		});
	}
	const manifest = {
		version: INDEX_FORMAT_VERSION,
		order,
		total: lean.length,
		shardCount: shards.length,
		shardSizes: sizes,
		categories,
		authors,
		engines,
		doe,
		thumbnailTemplates: THUMBNAIL_TEMPLATES.map((t) => t.tpl)
	};
	return { manifest, shards };
}

/** Decode one v2 shard back into lean entries (mirrors the client decoder). */
export function decodeShard(manifest, shard) {
	const out = [];
	for (let i = 0; i < shard.id.length; i++) {
		const id = shard.id[i];
		const a = shard.a[i];
		const t = shard.t[i];
		let thumbnail = t;
		const m = /^(\d+)\|/.exec(t);
		if (m) {
			const parts = t.split('|');
			thumbnail = fillTemplate(manifest.thumbnailTemplates[Number(parts[0])], id, parts.slice(1));
		}
		const entry = {
			id,
			name: shard.n[i],
			author: typeof a === 'number' ? manifest.authors[a] : a,
			category: shard.c[i] >= 0 ? manifest.categories[shard.c[i]] : 'misc',
			thumbnail
		};
		if (shard.e[i] >= 0) entry.engine = manifest.engines[shard.e[i]];
		if (shard.q[i] >= 0) entry.q = shard.q[i];
		if (shard.d[i] >= 0) entry.d = manifest.doe[shard.d[i]];
		out.push(entry);
	}
	return out;
}

export function shardFileName(index) {
	return `shard-${String(index).padStart(3, '0')}.json`;
}

/** Write `lean` as the v2 index in `indexDir`, removing shard files it no longer uses. */
export function writeIndexDir(indexDir, lean, { order = 'quality' } = {}) {
	fs.mkdirSync(indexDir, { recursive: true });
	const { manifest, shards } = encodeIndex(lean, { order });
	const keep = new Set(shards.map((_, i) => shardFileName(i)));
	for (const name of fs.readdirSync(indexDir)) {
		if (/^shard-\d+\.json$/.test(name) && !keep.has(name)) fs.unlinkSync(path.join(indexDir, name));
	}
	shards.forEach((shard, i) => {
		fs.writeFileSync(path.join(indexDir, shardFileName(i)), JSON.stringify(shard));
	});
	fs.writeFileSync(path.join(indexDir, 'manifest.json'), JSON.stringify(manifest));
	return manifest;
}

/** Read an index directory (v1 or v2) back into lean entries, in order. */
export function readIndexDir(indexDir) {
	const manifest = JSON.parse(fs.readFileSync(path.join(indexDir, 'manifest.json'), 'utf8'));
	const out = [];
	for (let i = 0; i < manifest.shardCount; i++) {
		const shard = JSON.parse(fs.readFileSync(path.join(indexDir, shardFileName(i)), 'utf8'));
		if (Array.isArray(shard)) out.push(...shard);
		else out.push(...decodeShard(manifest, shard));
	}
	return out;
}
