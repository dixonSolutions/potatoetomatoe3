#!/usr/bin/env node
/**
 * Rebuild games-index shards from existing shard JSON (no full catalog scan).
 * Sorts A–Z so All Games can lazy-load pages as you scroll.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexDir = path.join(root, 'static/games/games-index');
const manifestPath = path.join(indexDir, 'manifest.json');
const INDEX_SHARD_SIZE = 500;

if (!fs.existsSync(manifestPath)) {
	console.error('Missing games-index/manifest.json — run generate-games-list first.');
	process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const lean = [];
for (let i = 0; i < manifest.shardCount; i++) {
	const shardPath = path.join(indexDir, `shard-${String(i).padStart(3, '0')}.json`);
	if (!fs.existsSync(shardPath)) {
		console.error(`Missing ${shardPath}`);
		process.exit(1);
	}
	const shard = JSON.parse(fs.readFileSync(shardPath, 'utf8'));
	if (Array.isArray(shard)) lean.push(...shard);
}

lean.sort(
	(a, b) =>
		String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' }) ||
		String(a.id ?? '').localeCompare(String(b.id ?? ''))
);

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
	total: lean.length,
	shardSize: INDEX_SHARD_SIZE,
	shardCount,
	categories
};
fs.writeFileSync(manifestPath, JSON.stringify(next));
console.log(
	`Reindexed ${lean.length} games into ${shardCount} A–Z shards (${INDEX_SHARD_SIZE}/shard)`
);
