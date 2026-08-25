#!/usr/bin/env node

/**
 * Repair HTML-escaped thumbnail URLs already written into the catalog.
 *
 * Importers stored covers exactly as scraped from page markup, so `&` arrived as `&amp;`.
 * An image CDN then reads `?width=400&amp;fit=crop` as a parameter named `amp;fit` and
 * ignores everything after the first — so a URL that literally says `width=1200` returns
 * the full-resolution original. Verified against one CrazyGames cover:
 *
 *   ...?metadata=none&quality=80&width=400&height=225&fit=crop   ->  400x225,     18 KB
 *   ...?metadata=none&amp;quality=100&amp;width=1200&amp;...     ->  2730x1535,  321 KB
 *
 * On a Galaxy Tab Active3 that was 72 million pixels decoded to fill 1.8 million pixels
 * of layout on one Home screen. See docs/game-launch-quality.md.
 *
 * The app also sizes covers at request time (`sizedThumbnailUrl`), so this is belt and
 * braces — but it fixes the stored data, which is what the importer would otherwise keep
 * regenerating and what any other consumer of the catalog reads.
 *
 * Usage:
 *   node scripts/repair-catalog-thumbnail-urls.mjs            # report only
 *   node scripts/repair-catalog-thumbnail-urls.mjs --write
 */

import { readdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { decodeUrlEntities } from './lib/game-shell.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = join(__dirname, '..', 'static', 'games');

/** Every metadata field that can hold a cover URL. */
const THUMBNAIL_FIELDS = ['thumbnail', 'thumbnailRemote'];

function metadataPathFor(gameId) {
	const candidates = [
		join(GAMES_ROOT, gameId, 'online', 'metadata.json'),
		join(GAMES_ROOT, gameId, 'shared', 'metadata.json'),
		join(GAMES_ROOT, gameId, 'metadata.json')
	];
	return candidates.find((candidate) => existsSync(candidate)) || null;
}

function main() {
	const write = process.argv.includes('--write');
	if (!existsSync(GAMES_ROOT)) {
		console.error(`[repair-thumbnails] missing ${GAMES_ROOT}`);
		process.exit(1);
	}

	let scanned = 0;
	let changedGames = 0;
	let changedFields = 0;
	const samples = [];

	for (const entry of readdirSync(GAMES_ROOT, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
		const metaPath = metadataPathFor(entry.name);
		if (!metaPath) continue;

		let meta;
		try {
			meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
		} catch {
			continue;
		}
		scanned++;

		let dirty = false;
		for (const field of THUMBNAIL_FIELDS) {
			const value = meta[field];
			if (typeof value !== 'string' || !value) continue;
			const fixed = decodeUrlEntities(value);
			if (fixed === value) continue;
			meta[field] = fixed;
			dirty = true;
			changedFields++;
			if (samples.length < 3) samples.push(`${entry.name}.${field}`);
		}

		if (dirty) {
			changedGames++;
			if (write) writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
		}
	}

	console.log(`[repair-thumbnails] scanned ${scanned} games`);
	console.log(`[repair-thumbnails] ${changedFields} escaped URLs across ${changedGames} games`);
	for (const s of samples) console.log(`  e.g. ${s}`);
	if (!write) {
		console.log('[repair-thumbnails] report only — pass --write to apply');
	} else {
		console.log('[repair-thumbnails] written; run `node scripts/generate-games-list.js` next');
	}
}

main();
