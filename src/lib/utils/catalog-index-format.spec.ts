import { describe, expect, it } from 'vitest';
import { decodeShardV2, isShardV2, type CatalogDictionaries, type CatalogShardV2 } from './catalog-index-format';

/* The build script's encoder, loaded untyped (it is plain ESM run by node). */
const encoder: {
	encodeIndex: (lean: Lean[]) => { manifest: CatalogDictionaries & { shardSizes: number[]; shardCount: number }; shards: unknown[] };
	FIRST_SHARD_SIZE: number;
	SHARD_SIZE: number;
} = await import(
	/* @vite-ignore */ new URL('../../../scripts/catalog-quality/index-format.mjs', import.meta.url).href
);
const { encodeIndex, FIRST_SHARD_SIZE, SHARD_SIZE } = encoder;

type Lean = {
	id: string;
	name: string;
	author: string;
	category: string;
	thumbnail: string;
	engine?: string;
	q?: number;
	d?: string;
};

const sample: Lean[] = [
	{
		id: 'crazygames-fragen',
		name: 'Fragen',
		author: 'CrazyGames',
		category: 'arcade',
		thumbnail:
			'https://imgs.crazygames.com/fragen_16x9/20251022094210/fragen_16x9-cover?metadata=none&quality=100&width=1200&height=630&fit=crop',
		q: 99,
		d: 'b'
	},
	{
		id: 'cubix',
		name: 'Cubix',
		author: 'Someone Once',
		category: 'puzzle',
		thumbnail: 'https://play.unity.com/api/v1/files/file/362758bf-7a33-499e-90ec-9e7b1480bc0d/content',
		engine: 'unity'
	},
	{
		id: 'coolmath-candy-clicker',
		name: 'Candy Clicker',
		author: 'CrazyGames',
		category: 'clicker',
		thumbnail: '/games/coolmath-candy-clicker/online/assets/coolmath-candy-clicker.png',
		q: 0
	},
	{
		id: 'odd',
		name: 'Odd | Name',
		author: '',
		category: 'misc',
		thumbnail: 'https://example.com/a|b.png?x=1'
	},
	{ id: 'no-thumb', name: 'No Thumb', author: 'CrazyGames', category: 'arcade', thumbnail: '' }
];

function decodeAll(lean: Lean[]) {
	const { manifest, shards } = encodeIndex(lean);
	return {
		manifest,
		shards: shards as CatalogShardV2[],
		decoded: (shards as CatalogShardV2[]).flatMap((s) => decodeShardV2(manifest, s))
	};
}

describe('catalog index v2', () => {
	it('round-trips every field through the client decoder', () => {
		const { decoded } = decodeAll(sample);
		expect(decoded).toEqual(sample);
	});

	it('stores templated thumbnails and shared authors compactly', () => {
		const { manifest, shards } = decodeAll(sample);
		expect(shards[0].t[0]).toMatch(/^\d+\|fragen\|20251022094210$/);
		expect(shards[0].t[2]).toMatch(/^\d+\|coolmath-candy-clicker\.png$/);
		/* A URL with a pipe stays literal rather than being split. */
		expect(shards[0].t[3]).toBe('https://example.com/a|b.png?x=1');
		expect(manifest.authors).toEqual(['CrazyGames']);
		expect(shards[0].a).toEqual([0, 'Someone Once', 0, '', 0]);
	});

	it('paints from a small first shard and keeps the rest in few large ones', () => {
		const many: Lean[] = Array.from({ length: FIRST_SHARD_SIZE + SHARD_SIZE + 5 }, (_, i) => ({
			id: `g${i}`,
			name: `Game ${i}`,
			author: 'A',
			category: 'arcade',
			thumbnail: ''
		}));
		const { manifest, decoded } = decodeAll(many);
		expect(manifest.shardSizes).toEqual([FIRST_SHARD_SIZE, SHARD_SIZE, 5]);
		expect(manifest.shardCount).toBe(3);
		expect(decoded.map((g) => g.id)).toEqual(many.map((g) => g.id));
	});

	it('tells v2 shards from v1 row arrays', () => {
		expect(isShardV2([{ id: 'a' }])).toBe(false);
		expect(isShardV2({ id: ['a'] })).toBe(true);
		expect(isShardV2(null)).toBe(false);
	});
});
