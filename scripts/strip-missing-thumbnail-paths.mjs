#!/usr/bin/env node
/**
 * If metadata.thumbnail points at a repo-local path under static/games/<id>/ but the file is
 * missing or trivially small, set thumbnail to "" so the app does not request a 404 URL.
 * Does not touch online/offline game bundles, only online/metadata.json.
 *
 * Usage: node scripts/strip-missing-thumbnail-paths.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = join(__dirname, '../static/games');

const MIN_BYTES = 32;

function listGameIds() {
	return readdirSync(GAMES_ROOT, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith('_'))
		.map((d) => d.name)
		.filter((id) => existsSync(join(GAMES_ROOT, id, 'online', 'metadata.json')));
}

function thumbnailToFsPath(gameId, thumbnail) {
	if (!thumbnail || typeof thumbnail !== 'string') return null;
	const t = thumbnail.trim();
	if (!t || t.startsWith('data:') || t.startsWith('http')) return null;
	const prefix = `/games/${gameId}/`;
	if (!t.startsWith(prefix)) return null;
	const rel = t.slice(prefix.length);
	return join(GAMES_ROOT, gameId, rel);
}

function main() {
	const dry = process.argv.includes('--dry-run');
	let cleared = 0;

	for (const gameId of listGameIds()) {
		const metaPath = join(GAMES_ROOT, gameId, 'online', 'metadata.json');
		let metadata;
		try {
			metadata = JSON.parse(readFileSync(metaPath, 'utf-8'));
		} catch {
			continue;
		}
		const thumb = metadata.thumbnail;
		const dest = thumbnailToFsPath(gameId, thumb);
		if (!dest) continue;

		let bad = !existsSync(dest);
		if (!bad) {
			try {
				bad = statSync(dest).size < MIN_BYTES;
			} catch {
				bad = true;
			}
		}

		if (!bad) continue;

		console.log(`${dry ? '[dry-run] ' : ''}${gameId}: clear missing thumbnail → ${thumb}`);
		if (!dry) {
			metadata.thumbnail = '';
			writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');
		}
		cleared++;
	}

	console.log(`\n${dry ? 'Would clear' : 'Cleared'} ${cleared} metadata thumbnail path(s).`);
}

main();
