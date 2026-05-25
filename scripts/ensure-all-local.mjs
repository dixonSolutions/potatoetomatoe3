#!/usr/bin/env node
/**
 * Drive every catalog game toward static/games/<id>/offline/index.html (same-origin player URL):
 * 1) For games missing a valid offline mirror, wget-mirror only those IDs (fresh or --force re-mirror bad dirs).
 * 2) Copy online/ → offline/ for any title still missing a valid mirror (self-contained shells).
 * 3) Regenerate game-entries.json.
 *
 * Games with no http iframe in index.html cannot be auto-mirrored; they stay on index.html.
 * wget failures may remove offline/ unless download-games-offline.js is run with --keep-broken.
 */

import { execFileSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const GAMES_ROOT = join(root, 'static', 'games');

const BATCH = 25;

function offlineMirrorLooksValid(offlineIndexPath) {
	if (!existsSync(offlineIndexPath)) return false;
	try {
		return statSync(offlineIndexPath).size >= 64;
	} catch {
		return false;
	}
}

function offlineBundleIndex(id) {
	return join(GAMES_ROOT, id, 'offline', 'index.html');
}

function gameIdsWithMetadata() {
	return readdirSync(GAMES_ROOT, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith('_'))
		.map((d) => d.name)
		.filter((id) => existsSync(join(GAMES_ROOT, id, 'online', 'metadata.json')));
}

function runNode(scriptRelative, args = []) {
	execFileSync(process.execPath, [join(root, scriptRelative), ...args], {
		cwd: root,
		stdio: 'inherit'
	});
}

function runDownloadBatches(gameIds, force, extraArgs) {
	const script = join(root, 'scripts/download-games-offline.js');
	for (let i = 0; i < gameIds.length; i += BATCH) {
		const batch = gameIds.slice(i, i + BATCH);
		const argv = [script, ...extraArgs, ...(force ? ['--force'] : []), ...batch];
		execFileSync(process.execPath, argv, { cwd: root, stdio: 'inherit' });
	}
}

function main() {
	const argv = process.argv.slice(2);
	const keepBroken = argv.includes('--keep-broken');
	const extraDownloadArgs = keepBroken ? ['--keep-broken'] : [];

	const ids = gameIdsWithMetadata();
	const missingBundle = ids.filter((id) => !offlineMirrorLooksValid(offlineBundleIndex(id)));

	const needFresh = [];
	const needForce = [];

	for (const id of missingBundle) {
		const offlineDir = join(GAMES_ROOT, id, 'offline');
		const offlineIndex = join(offlineDir, 'index.html');
		if (!existsSync(offlineDir)) {
			needFresh.push(id);
			continue;
		}
		if (!offlineMirrorLooksValid(offlineIndex)) {
			needForce.push(id);
			continue;
		}
	}

	console.log(
		`\n[ensure-all-local] Games missing offline/index.html: ${missingBundle.length} / ${ids.length}`
	);
	console.log(`  • No offline/ mirror yet: ${needFresh.length}`);
	console.log(`  • Invalid/partial offline/ (will --force re-mirror): ${needForce.length}\n`);

	if (needFresh.length) {
		console.log('Downloading (new mirrors)…\n');
		runDownloadBatches(needFresh, false, extraDownloadArgs);
	}
	if (needForce.length) {
		console.log('Re-downloading (--force) broken offline mirrors…\n');
		runDownloadBatches(needForce, true, extraDownloadArgs);
	}

	console.log('\n[ensure-all-local] Seeding offline/ from online/ for any games still without a valid mirror…\n');
	runNode('scripts/seed-offline-from-online.mjs');

	runNode('scripts/generate-games-list.js');

	const entriesPath = join(root, 'static/games/game-entries.json');
	let localCount = 0;
	let legacyCount = 0;
	const stillLegacy = [];
	if (existsSync(entriesPath)) {
		const entries = JSON.parse(readFileSync(entriesPath, 'utf-8'));
		for (const [gid, rel] of Object.entries(entries)) {
			if (rel && String(rel).startsWith('offline/')) localCount++;
			else {
				legacyCount++;
				stillLegacy.push(gid);
			}
		}
	}

	console.log('\n--- Summary ---');
	console.log(`Local offline mirrors (offline/): ${localCount}`);
	console.log(`Legacy shell (index.html only): ${legacyCount}`);
	if (stillLegacy.length && stillLegacy.length <= 40) {
		console.log('Still legacy:', stillLegacy.join(', '));
	} else if (stillLegacy.length) {
		console.log(`Still legacy (first 30): ${stillLegacy.slice(0, 30).join(', ')} …`);
	}
	console.log('Done.\n');
}

main();
