#!/usr/bin/env node

import { readdirSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Each catalog game lives under static/games/<id>/{shared,online,offline}/ */
const GAMES_ROOT = join(__dirname, '..', 'static', 'games');

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

function generateGamesList() {
	const gameIds = listGameIds();

	// Generate games list
	const listOutputPath = join(__dirname, '..', 'static', 'games', 'games-list.json');
	writeFileSync(listOutputPath, JSON.stringify(gameIds, null, 2));

	console.log(`✅ Generated games list with ${gameIds.length} games`);
	console.log(`   Saved to: static/games/games-list.json`);

	// Generate consolidated metadata (best-effort; synthesize when metadata files are absent)
	const allMetadata = [];
	let metadataFileCount = 0;
	let synthesizedCount = 0;
	for (const gameId of gameIds) {
		const metadata = readMetadataForGame(gameId);
		if (metadata) {
			metadataFileCount += 1;
			allMetadata.push(metadata);
			continue;
		}

		synthesizedCount += 1;
		allMetadata.push({
			id: gameId,
			name: toTitleCaseFromId(gameId),
			author: 'Unknown',
			description: `Play ${toTitleCaseFromId(gameId)} offline`,
			thumbnail: '',
			category: 'misc'
		});
	}

	const metadataOutputPath = join(__dirname, '..', 'static', 'games', 'games-metadata.json');
	writeFileSync(metadataOutputPath, JSON.stringify(allMetadata, null, 2));

	console.log(`✅ Generated consolidated metadata with ${allMetadata.length} games`);
	console.log(`   Source metadata files: ${metadataFileCount}, synthesized: ${synthesizedCount}`);
	console.log(`   Saved to: static/games/games-metadata.json`);

	/** Relative path under static/games/<id>/ for offline host mode (LazyGameFrame); online mode always uses online/index.html. */
	const gameEntries = {};
	for (const gameId of gameIds) {
		const offlineEntry = join(GAMES_ROOT, gameId, 'offline', 'index.html');
		gameEntries[gameId] = existsSync(offlineEntry) ? 'offline/index.html' : 'index.html';
	}
	const entriesPath = join(__dirname, '..', 'static', 'games', 'game-entries.json');
	writeFileSync(entriesPath, JSON.stringify(gameEntries, null, 2));
	console.log(
		`✅ Generated game entry paths (${Object.values(gameEntries).filter((p) => p.startsWith('offline/')).length} local offline mirrors)`
	);
	console.log(`   Saved to: static/games/game-entries.json`);
}

generateGamesList();
