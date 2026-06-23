#!/usr/bin/env node

import { readdirSync, existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Each catalog game lives under static/games/<id>/{shared,online,offline}/ */
const GAMES_ROOT = join(__dirname, '..', 'static', 'games');
const BUILD_GAMES_ROOT = join(__dirname, '..', 'build', 'games');

function listGameIds() {
	if (!existsSync(GAMES_ROOT)) {
		return [];
	}
	return readdirSync(GAMES_ROOT, { withFileTypes: true })
		.filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith('_'))
		.map((dirent) => dirent.name);
}

function toTitleCaseFromId(id) {
	return id
		.split('-')
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

function readMetadataForGame(gameId) {
	const candidates = [
		join(GAMES_ROOT, gameId, 'online', 'metadata.json'),
		join(GAMES_ROOT, gameId, 'shared', 'metadata.json'),
		join(GAMES_ROOT, gameId, 'metadata.json')
	];
	for (const metadataPath of candidates) {
		if (!existsSync(metadataPath)) continue;
		try {
			return JSON.parse(readFileSync(metadataPath, 'utf-8'));
		} catch (error) {
			console.error(`❌ Failed to read metadata for ${gameId}:`, error.message);
		}
	}
	return null;
}

/** Load prior catalog metadata so regeneration does not wipe thumbnails. */
function loadMetadataCache() {
	const cache = new Map();
	const sources = [
		join(GAMES_ROOT, 'games-metadata.json'),
		join(BUILD_GAMES_ROOT, 'games-metadata.json')
	];
	for (const path of sources) {
		if (!existsSync(path)) continue;
		try {
			const list = JSON.parse(readFileSync(path, 'utf-8'));
			if (!Array.isArray(list)) continue;
			for (const entry of list) {
				if (entry?.id && !cache.has(entry.id)) {
					cache.set(entry.id, entry);
				}
			}
		} catch {
			// try next source
		}
	}
	return cache;
}

function generateGamesList() {
	if (!existsSync(GAMES_ROOT)) {
		mkdirSync(GAMES_ROOT, { recursive: true });
	}

	const gameIds = listGameIds();
	const metadataCache = loadMetadataCache();

	const listOutputPath = join(GAMES_ROOT, 'games-list.json');
	writeFileSync(listOutputPath, JSON.stringify(gameIds, null, 2));

	console.log(`✅ Generated games list with ${gameIds.length} games`);
	console.log(`   Saved to: static/games/games-list.json`);

	const allMetadata = [];
	let metadataFileCount = 0;
	let cacheCount = 0;
	let synthesizedCount = 0;

	for (const gameId of gameIds) {
		const fromDisk = readMetadataForGame(gameId);
		if (fromDisk) {
			metadataFileCount += 1;
			allMetadata.push(fromDisk);
			continue;
		}

		const cached = metadataCache.get(gameId);
		if (cached) {
			cacheCount += 1;
			allMetadata.push(cached);
			continue;
		}

		synthesizedCount += 1;
		allMetadata.push({
			id: gameId,
			name: toTitleCaseFromId(gameId),
			author: 'Unknown',
			description: `Play ${toTitleCaseFromId(gameId)}`,
			thumbnail: '',
			category: 'misc'
		});
	}

	const metadataOutputPath = join(GAMES_ROOT, 'games-metadata.json');
	writeFileSync(metadataOutputPath, JSON.stringify(allMetadata, null, 2));

	console.log(`✅ Generated consolidated metadata with ${allMetadata.length} games`);
	console.log(
		`   Source metadata files: ${metadataFileCount}, from cache: ${cacheCount}, synthesized: ${synthesizedCount}`
	);
	console.log(`   Saved to: static/games/games-metadata.json`);

	if (synthesizedCount > metadataFileCount + cacheCount) {
		console.warn(
			`⚠️  ${synthesizedCount} games lack metadata/thumbnails. Run: node scripts/restore-games-from-build.mjs`
		);
	}
}

generateGamesList();
