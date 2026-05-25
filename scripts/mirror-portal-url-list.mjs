#!/usr/bin/env node
/**
 * Batch-run mirror-game-url.mjs over a JSON manifest (portal pages + individual game URLs).
 *
 * Limitations (read before running):
 * - Wget cannot execute JavaScript. SPAs (Poki, many Play-Games shells) often return HTML shells
 *   while real game assets load from APIs/CDNs — snapshots may be incomplete or 403 (Cloudflare).
 * - Homepages use small maxDepth on purpose so you do not mirror millions of files.
 * - You must have rights to redistribute anything you pull.
 *
 * Usage:
 *   node scripts/mirror-portal-url-list.mjs
 *   node scripts/mirror-portal-url-list.mjs --from-file ./my-manifest.json
 *   node scripts/mirror-portal-url-list.mjs --force          # re-mirror every entry (clears online/)
 *   node scripts/mirror-portal-url-list.mjs --dry-run
 *   node scripts/mirror-portal-url-list.mjs --no-generate    # skip generate-games-list.js
 *
 * Afterward (per game, optional local play):
 *   node scripts/download-games-offline.js <id>...
 *   node scripts/seed-offline-from-online.mjs
 *   node scripts/generate-games-list.js
 *
 * Or: pnpm run games:ensure-all-offline-bundles
 */

import { readFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const DEFAULT_MANIFEST = join(__dirname, 'data', 'portal-url-manifest.json');

function parseArgs(argv) {
	let fromFile = DEFAULT_MANIFEST;
	let force = false;
	let dryRun = false;
	let generate = true;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--from-file' && argv[i + 1]) fromFile = argv[++i];
		else if (a === '--force') force = true;
		else if (a === '--dry-run') dryRun = true;
		else if (a === '--no-generate') generate = false;
	}
	return { fromFile, force, dryRun, generate };
}

function validOnlineIndex(gameId) {
	const p = join(root, 'static', 'games', gameId, 'online', 'index.html');
	if (!existsSync(p)) return false;
	try {
		return statSync(p).size >= 64;
	} catch {
		return false;
	}
}

function loadManifest(path) {
	const raw = readFileSync(path, 'utf-8');
	const data = JSON.parse(raw);
	const entries = data.entries;
	if (!Array.isArray(entries)) {
		throw new Error('Manifest must contain an "entries" array');
	}
	return entries;
}

function main() {
	const { fromFile, force, dryRun, generate } = parseArgs(process.argv.slice(2));

	if (!existsSync(fromFile)) {
		console.error(`Manifest not found: ${fromFile}`);
		process.exit(1);
	}

	const entries = loadManifest(fromFile);
	const mirrorScript = join(root, 'scripts', 'mirror-game-url.mjs');

	let ok = 0;
	let skipped = 0;
	let failed = 0;

	for (let i = 0; i < entries.length; i++) {
		const e = entries[i];
		if (!e || typeof e.url !== 'string' || typeof e.id !== 'string') {
			console.warn(`Skipping invalid entry at index ${i}`);
			failed++;
			continue;
		}
		if (e.enabled === false) {
			console.log(`[skip disabled] ${e.id}`);
			skipped++;
			continue;
		}

		if (!force && validOnlineIndex(e.id)) {
			console.log(`[skip existing] ${e.id} — use --force to re-mirror`);
			skipped++;
			continue;
		}

		const args = [
			mirrorScript,
			'--url',
			e.url,
			'--id',
			e.id,
			'--max-depth',
			String(Math.max(1, parseInt(String(e.maxDepth ?? 8), 10) || 8)),
			'--name',
			String(e.name ?? e.id),
			'--author',
			String(e.author ?? 'Ported'),
			'--category',
			String(e.category ?? 'arcade')
		];
		if (force) args.push('--force');

		console.log(`\n=== (${i + 1}/${entries.length}) ${e.id} < ${e.url} ===\n`);

		if (dryRun) {
			console.log('dry-run:', process.execPath, args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '));
			ok++;
			continue;
		}

		try {
			execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
			ok++;
		} catch {
			failed++;
			console.error(`\n❌ mirror failed for ${e.id} — continuing with next entry\n`);
		}
	}

	console.log(`\n--- mirror-portal-url-list done: ${ok} ok, ${skipped} skipped, ${failed} failed ---\n`);

	if (!dryRun && generate && failed < entries.length) {
		console.log('Running generate-games-list.js…\n');
		try {
			execFileSync(process.execPath, [join(root, 'scripts', 'generate-games-list.js')], {
				cwd: root,
				stdio: 'inherit'
			});
		} catch {
			process.exit(1);
		}
	}

	if (failed > 0) process.exit(1);
}

main();
