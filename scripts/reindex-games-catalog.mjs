#!/usr/bin/env node
/**
 * Rebuild the games index from the existing index (no full catalog scan), re-applying
 * the latest scripts/data/catalog-quality.json and sorting best-first, so the first shard
 * Home and Games load is the top of the catalog. Reads a v1 or v2 index, writes v2.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	INDEX_ORDER,
	compareLeanEntries,
	loadQualityMap,
	toLeanEntry
} from './catalog-quality/index-entry.mjs';
import { readIndexDir, writeIndexDir } from './catalog-quality/index-format.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexDir = path.join(root, 'static/games/games-index');

if (!fs.existsSync(path.join(indexDir, 'manifest.json'))) {
	console.error('Missing games-index/manifest.json — run generate-games-list first.');
	process.exit(1);
}

const quality = loadQualityMap();
const lean = readIndexDir(indexDir).map((entry) => {
	/* Drop stale scores first: a game the classifier no longer lists must not keep one. */
	const rest = { ...entry };
	delete rest.q;
	delete rest.d;
	return toLeanEntry(rest, quality.get(entry.id));
});
lean.sort(compareLeanEntries);

const manifest = writeIndexDir(indexDir, lean, { order: INDEX_ORDER });
console.log(`Reindexed ${lean.length} games into ${manifest.shardCount} best-first shards (v${manifest.version})`);
