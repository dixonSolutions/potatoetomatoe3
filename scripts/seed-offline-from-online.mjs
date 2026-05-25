#!/usr/bin/env node
/**
 * For catalog games that still lack a valid offline/index.html after wget, copy the shipped
 * online/ tree into offline/ so "offline" host mode has a same-origin document (self-contained
 * builds work; iframe shells still embed remote URLs until mirrored separately).
 */

import { existsSync, readdirSync, rmSync, cpSync, statSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const root = join(__dirname, '..');
const GAMES_ROOT = join(root, 'static', 'games');

const SKIP_TOP_LEVEL = new Set(['index.html.before-local-bundle']);

function offlineMirrorLooksValid(offlineIndexPath) {
	if (!existsSync(offlineIndexPath)) return false;
	try {
		return statSync(offlineIndexPath).size >= 64;
	} catch {
		return false;
	}
}

function gameIdsWithMetadata() {
	if (!existsSync(GAMES_ROOT)) return [];
	return readdirSync(GAMES_ROOT, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith('_'))
		.map((d) => d.name)
		.filter((id) => existsSync(join(GAMES_ROOT, id, 'online', 'metadata.json')));
}

function main() {
	const dryRun = process.argv.includes('--dry-run');
	const ids = gameIdsWithMetadata();
	const seeded = [];
	let already = 0;
	let noOnline = 0;

	for (const id of ids) {
		const offlineIndex = join(GAMES_ROOT, id, 'offline', 'index.html');
		if (offlineMirrorLooksValid(offlineIndex)) {
			already++;
			continue;
		}
		const onlineDir = join(GAMES_ROOT, id, 'online');
		const onlineIndex = join(onlineDir, 'index.html');
		if (!existsSync(onlineIndex)) {
			noOnline++;
			continue;
		}

		if (dryRun) {
			seeded.push(id);
			continue;
		}

		const offlineDir = join(GAMES_ROOT, id, 'offline');
		if (existsSync(offlineDir)) {
			rmSync(offlineDir, { recursive: true, force: true });
		}

		cpSync(onlineDir, offlineDir, {
			recursive: true,
			filter: (src) => {
				const b = basename(src);
				if (SKIP_TOP_LEVEL.has(b)) return false;
				return true;
			}
		});

		if (!offlineMirrorLooksValid(join(offlineDir, 'index.html'))) {
			console.error(`❌ ${id}: copy did not produce valid offline/index.html`);
			if (existsSync(offlineDir)) rmSync(offlineDir, { recursive: true, force: true });
			continue;
		}
		seeded.push(id);
	}

	console.log(
		dryRun
			? `[seed-offline-from-online] Dry run — would seed ${seeded.length} game(s) (${already} already OK, ${noOnline} no online/index.html)`
			: `[seed-offline-from-online] Seeded ${seeded.length} game(s); ${already} already had offline/; ${noOnline} missing online shell`
	);
	if (seeded.length && !dryRun) console.log(seeded.join(', '));
	if (dryRun && seeded.length) {
		console.log('Would seed:', seeded.slice(0, 40).join(', '), seeded.length > 40 ? '…' : '');
	}
}

main();
