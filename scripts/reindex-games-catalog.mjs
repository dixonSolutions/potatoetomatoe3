#!/usr/bin/env node
/**
 * Rebuild games-index shards from existing shard JSON (no full catalog scan), re-applying
 * the latest scripts/data/catalog-quality.json and sorting best-first, so the first shard
 * All Games and Home load is the top of the catalog.
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexDir = path.join(root, 'static/games/games-index');
const manifestPath = path.join(indexDir, 'manifest.json');
const INDEX_SHARD_SIZE = 500;

if (!fs.existsSync(manifestPath)) {
	console.error('Missing games-index/manifest.json — run generate-games-list first.');
	process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const quality = loadQualityMap();
const lean = [];
for (let i = 0; i < manifest.shardCount; i++) {
	const shardPath = path.join(indexDir, `shard-${String(i).padStart(3, '0')}.json`);
	if (!fs.existsSync(shardPath)) {
		console.error(`Missing ${shardPath}`);
		process.exit(1);
	}
	const shard = JSON.parse(fs.readFileSync(shardPath, 'utf8'));
	if (Array.isArray(shard)) {
		for (const entry of shard) {
			/* Drop stale scores first: a game the classifier no longer lists must not keep one. */
			const rest = { ...entry };
			delete rest.q;
			delete rest.d;
			lean.push(toLeanEntry(rest, quality.get(entry.id)));
		}
	}
}

lean.sort(compareLeanEntries);

const categories = [...new Set(lean.map((g) => g.category).filter(Boolean))].sort((a, b) =>
	a.localeCompare(b)
);

const shardCount = Math.max(1, Math.ceil(lean.length / INDEX_SHARD_SIZE));
for (let i = 0; i < shardCount; i++) {
	const slice = lean.slice(i * INDEX_SHARD_SIZE, (i + 1) * INDEX_SHARD_SIZE);
	fs.writeFileSync(
		path.join(indexDir, `shard-${String(i).padStart(3, '0')}.json`),
		JSON.stringify(slice)
	);
}

/* Remove leftover shards if count shrank (should not happen). */
for (let i = shardCount; i < manifest.shardCount; i++) {
	const leftover = path.join(indexDir, `shard-${String(i).padStart(3, '0')}.json`);
	if (fs.existsSync(leftover)) fs.unlinkSync(leftover);
}

const next = {
	version: 1,
	order: INDEX_ORDER,
	total: lean.length,
	shardSize: INDEX_SHARD_SIZE,
	shardCount,
	categories
};
fs.writeFileSync(manifestPath, JSON.stringify(next));
console.log(
	`Reindexed ${lean.length} games into ${shardCount} best-first shards (${INDEX_SHARD_SIZE}/shard)`
);
