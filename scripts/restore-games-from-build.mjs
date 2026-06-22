#!/usr/bin/env node
/**
 * Restore missing online/ shells and catalog JSON from the last production build.
 * Use when static/games/ has folder names but no online/index.html or metadata.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_ROOT = join(__dirname, '..', 'static', 'games');
const BUILD_ROOT = join(__dirname, '..', 'build', 'games');

function listIds(root) {
	if (!existsSync(root)) return [];
	return readdirSync(root, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith('_'))
		.map((d) => d.name);
}

function restore() {
	if (!existsSync(BUILD_ROOT)) {
		console.error('❌ build/games/ not found — run `pnpm build` first (or restore from backup).');
		process.exit(1);
	}

	let restoredOnline = 0;
	let skipped = 0;

	for (const gameId of listIds(BUILD_ROOT)) {
		const buildOnline = join(BUILD_ROOT, gameId, 'online', 'index.html');
		const staticOnline = join(STATIC_ROOT, gameId, 'online', 'index.html');

		if (!existsSync(buildOnline)) continue;

		if (existsSync(staticOnline)) {
			skipped++;
			continue;
		}

		const destOnline = join(STATIC_ROOT, gameId, 'online');
		mkdirSync(join(STATIC_ROOT, gameId), { recursive: true });
		cpSync(join(BUILD_ROOT, gameId, 'online'), destOnline, { recursive: true });
		restoredOnline++;
	}

	const buildMeta = join(BUILD_ROOT, 'games-metadata.json');
	const staticMeta = join(STATIC_ROOT, 'games-metadata.json');
	if (existsSync(buildMeta)) {
		const buildSize = statSync(buildMeta).size;
		const staticSize = existsSync(staticMeta) ? statSync(staticMeta).size : 0;
		if (buildSize > staticSize * 2) {
			cpSync(buildMeta, staticMeta);
			console.log(`✅ Restored games-metadata.json from build (${(buildSize / 1024 / 1024).toFixed(1)} MB)`);
		}
	}

	const buildList = join(BUILD_ROOT, 'games-list.json');
	const staticList = join(STATIC_ROOT, 'games-list.json');
	if (existsSync(buildList) && !existsSync(staticList)) {
		cpSync(buildList, staticList);
	}

	console.log(`✅ Restored online/ for ${restoredOnline} game(s) (${skipped} already had online shells)`);
}

restore();
