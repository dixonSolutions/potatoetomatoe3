#!/usr/bin/env node
/**
 * Mirror a game entry URL into static/games/<id>/online/ for local hosting.
 *
 * Requires: `wget` on PATH (same approach as download-games-offline.js).
 *
 * Intended use: pull a **published** HTML5 build from a URL you control (e.g. preservation
 * when original source is lost) into this repo for local / offline hosting.
 *
 * Rights: mirror only content you may host. If the URL is not yours, you need permission
 * or a suitable license—do not assume “public on the web” means you can redistribute it.
 *
 * Usage:
 *   node scripts/mirror-game-url.mjs --url "https://example.com/game/" --id my-game
 *   node scripts/mirror-game-url.mjs --url "https://cdn.example.com/game/index.html" --id my-game --name "My Game"
 *
 * Afterward:
 *   node scripts/generate-games-list.js
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, renameSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
	const out = {
		url: null,
		id: null,
		name: null,
		author: 'Ported',
		category: 'arcade',
		force: false,
		/** Max wget recursion depth (prevents mirroring an entire portal when the URL is a homepage). */
		maxDepth: 8
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--url' && argv[i + 1]) out.url = argv[++i];
		else if (a === '--id' && argv[i + 1]) out.id = argv[++i];
		else if (a === '--name' && argv[i + 1]) out.name = argv[++i];
		else if (a === '--author' && argv[i + 1]) out.author = argv[++i];
		else if (a === '--category' && argv[i + 1]) out.category = argv[++i];
		else if (a === '--max-depth' && argv[i + 1]) out.maxDepth = Math.max(1, parseInt(argv[++i], 10) || 8);
		else if (a === '--force') out.force = true;
	}
	return out;
}

const WGET_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function main() {
	const { url, id, name, author, category, maxDepth, force } = parseArgs(process.argv.slice(2));
	if (!url || !id) {
		console.error(
			'Usage: node scripts/mirror-game-url.mjs --url <entry URL> --id <folder-id> [--name "Title"] [--author x] [--category arcade] [--max-depth N] [--force]'
		);
		process.exit(1);
	}

	const safeId = id.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/^-+|-+$/g, '') || 'game';
	const targetDir = join(__dirname, '..', 'static', 'games', safeId, 'online');

	if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
		if (force) {
			console.warn(`--force: clearing ${targetDir}`);
			rmSync(targetDir, { recursive: true, force: true });
		} else {
			console.error(`Target already exists and is not empty: ${targetDir}`);
			console.error('Remove or rename it first, pick a different --id, or pass --force.');
			process.exit(1);
		}
	}

	mkdirSync(join(__dirname, '..', 'static', 'games', safeId, 'shared'), { recursive: true });
	mkdirSync(targetDir, { recursive: true });

	const urlObj = new URL(url);
	const pathSegments = urlObj.pathname.split('/').filter((p) => p.length > 0);
	const cutDirs = Math.max(0, pathSegments.length);

	// Use finite -l instead of --mirror (-l inf) so listing/home URLs do not crawl whole sites.
	const wgetCommand = `wget -q --show-progress --tries=3 --timeout=90 --user-agent='${WGET_UA}' -r -N -l ${maxDepth} -np --convert-links --adjust-extension --page-requisites -e robots=off --no-host-directories --cut-dirs=${cutDirs} -P "${targetDir}" "${url}"`;

	console.log(`Mirroring into ${targetDir} (max depth ${maxDepth})…`);
	try {
		await execAsync(wgetCommand, { maxBuffer: 50 * 1024 * 1024 });
	} catch (e) {
		console.error('wget failed:', e.message);
		process.exit(1);
	}

	// Ensure index.html
	const files = readdirSync(targetDir);
	let indexPath = join(targetDir, 'index.html');
	if (!files.includes('index.html')) {
		const htmlFiles = files.filter((f) => f.endsWith('.html'));
		if (htmlFiles.length === 1) {
			renameSync(join(targetDir, htmlFiles[0]), indexPath);
			console.log(`Renamed ${htmlFiles[0]} → index.html`);
		} else if (htmlFiles.length > 1) {
			const pick = htmlFiles.find((f) => f.toLowerCase().includes('index') || f.includes(safeId)) ?? htmlFiles[0];
			renameSync(join(targetDir, pick), indexPath);
			console.log(`Renamed ${pick} → index.html`);
		}
	}

	const metaPath = join(targetDir, 'metadata.json');
	if (!existsSync(metaPath)) {
		const displayName = name ?? safeId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
		const meta = {
			id: safeId,
			name: displayName,
			author,
			description: `Play ${displayName} — hosted locally.`,
			thumbnail: `/games/${safeId}/online/assets/thumbnail.png`,
			category
		};
		writeFileSync(metaPath, JSON.stringify(meta, null, 2));
		console.log('Wrote stub metadata.json — edit thumbnail path and details if needed.');
	}

	console.log('\nDone. Run: node scripts/generate-games-list.js');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
