#!/usr/bin/env node
/**
 * One-time cleanup: move static/games/<id>/online/_offline_bundle/ → static/games/<id>/offline/
 * and remove the old folder. The app loads mirrored builds from offline/ in "offline" host mode.
 *
 * Usage:
 *   node scripts/migrate-offline-bundle-to-offline.mjs           # apply
 *   node scripts/migrate-offline-bundle-to-offline.mjs --dry-run
 *
 * Then: node scripts/generate-games-list.js
 */

import { existsSync, readdirSync, rmSync, cpSync, mkdirSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const GAMES_ROOT = join(root, 'static', 'games');

const dryRun = process.argv.includes('--dry-run');

function gameIds() {
	if (!existsSync(GAMES_ROOT)) return [];
	return readdirSync(GAMES_ROOT, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith('_'))
		.map((d) => d.name);
}

function main() {
	const moved = [];
	const skipped = [];
	const errors = [];

	for (const id of gameIds()) {
		const bundleDir = join(GAMES_ROOT, id, 'online', '_offline_bundle');
		const offlineDir = join(GAMES_ROOT, id, 'offline');
		const bundleIndex = join(bundleDir, 'index.html');

		if (!existsSync(bundleIndex)) {
			skipped.push(`${id} (no online/_offline_bundle/index.html)`);
			continue;
		}

		try {
			if (dryRun) {
				moved.push(`${id} → would replace offline/ from _offline_bundle/`);
				continue;
			}

			const backupDir = join(GAMES_ROOT, id, 'offline.before-migrate');
			if (existsSync(offlineDir)) {
				if (existsSync(backupDir)) rmSync(backupDir, { recursive: true, force: true });
				renameSync(offlineDir, backupDir);
			}

			mkdirSync(join(GAMES_ROOT, id), { recursive: true });
			cpSync(bundleDir, offlineDir, { recursive: true });
			rmSync(bundleDir, { recursive: true, force: true });

			if (existsSync(backupDir)) rmSync(backupDir, { recursive: true, force: true });

			moved.push(id);
		} catch (e) {
			errors.push(`${id}: ${e?.message || e}`);
		}
	}

	console.log(dryRun ? 'Dry run (no changes):\n' : 'Migrated:\n');
	if (moved.length) console.log(moved.join('\n'));
	else console.log('  (none)');
	if (skipped.length) {
		console.log(`\nSkipped (${skipped.length}):`);
		for (const s of skipped.slice(0, 15)) console.log(`  - ${s}`);
		if (skipped.length > 15) console.log(`  … and ${skipped.length - 15} more`);
	}
	if (errors.length) {
		console.log('\nErrors:');
		for (const s of errors) console.log(`  - ${s}`);
		process.exit(1);
	}

	if (!dryRun && moved.length) {
		console.log('\nRegenerating game-entries.json…');
		execFileSync(process.execPath, [join(root, 'scripts', 'generate-games-list.js')], {
			cwd: root,
			stdio: 'inherit'
		});
	} else if (!dryRun) {
		console.log('\nNothing to migrate. Run: node scripts/generate-games-list.js');
	}
}

main();
