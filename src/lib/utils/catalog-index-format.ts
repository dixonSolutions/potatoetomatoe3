/**
 * Client decoder for the catalog index v2 (columnar shards with shared dictionaries).
 * The encoder and the format notes are `scripts/catalog-quality/index-format.mjs`.
 */

export interface CatalogShardV2 {
	id: string[];
	/** Display names. */
	n: string[];
	/** Author: index into `manifest.authors`, or the name itself. */
	a: (number | string)[];
	/** Category index, -1 for none. */
	c: number[];
	/** Thumbnail URL, or `<template>|arg|arg…`. */
	t: string[];
	/** Quality score, -1 for unscored. */
	q: number[];
	/** DoE status index, -1 for none. */
	d: number[];
	/** Engine index, -1 for none. */
	e: number[];
}

export interface CatalogDictionaries {
	categories: string[];
	authors?: string[];
	engines?: string[];
	doe?: string[];
	thumbnailTemplates?: string[];
}

export interface DecodedIndexEntry {
	id: string;
	name: string;
	author: string;
	category: string;
	thumbnail: string;
	engine?: string;
	q?: number;
	d?: string;
}

export function fillTemplate(tpl: string, id: string, args: string[]): string {
	return tpl.replace(/\{(id|\d+)\}/g, (_, key: string) =>
		key === 'id' ? id : (args[Number(key)] ?? '')
	);
}

export function isShardV2(data: unknown): data is CatalogShardV2 {
	return (
		typeof data === 'object' &&
		data !== null &&
		!Array.isArray(data) &&
		Array.isArray((data as CatalogShardV2).id)
	);
}

export function decodeShardV2(dict: CatalogDictionaries, shard: CatalogShardV2): DecodedIndexEntry[] {
	const out: DecodedIndexEntry[] = new Array(shard.id.length);
	const templates = dict.thumbnailTemplates ?? [];
	for (let i = 0; i < shard.id.length; i++) {
		const id = shard.id[i];
		const a = shard.a[i];
		const t = shard.t[i] ?? '';
		let thumbnail = t;
		const pipe = t.indexOf('|');
		if (pipe > 0 && pipe < 4 && /^\d+$/.test(t.slice(0, pipe))) {
			const parts = t.split('|');
			const tpl = templates[Number(parts[0])];
			if (tpl) thumbnail = fillTemplate(tpl, id, parts.slice(1));
		}
		const entry: DecodedIndexEntry = {
			id,
			name: shard.n[i] ?? '',
			author: typeof a === 'number' ? (dict.authors?.[a] ?? '') : (a ?? ''),
			category: shard.c[i] >= 0 ? (dict.categories[shard.c[i]] ?? 'misc') : 'misc',
			thumbnail
		};
		if (shard.e[i] >= 0 && dict.engines?.[shard.e[i]]) entry.engine = dict.engines[shard.e[i]];
		if (shard.q[i] >= 0) entry.q = shard.q[i];
		if (shard.d[i] >= 0 && dict.doe?.[shard.d[i]]) entry.d = dict.doe[shard.d[i]];
		out[i] = entry;
	}
	return out;
}
