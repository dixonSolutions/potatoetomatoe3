#!/usr/bin/env node
/**
 * Regenerate the catalog index only when missing or forced.
 * Flatpak/release builds always regenerate; `pnpm app` skips when the index is warm
 * so Tauri dev starts like the packaged app instead of rewriting 12k entries twice.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = path.join(root, 'static/games/games-index/manifest.json');
const force = process.env.FORCE_GAMES_GENERATE === '1' || process.argv.includes('--force');

function indexLooksHealthy() {
	try {
		if (!fs.existsSync(manifest)) return false;
		const data = JSON.parse(fs.readFileSync(manifest, 'utf8'));
		if (!data?.shardCount || !data?.total) return false;
		const shard0 = path.join(root, 'static/games/games-index/shard-000.json');
		return fs.existsSync(shard0);
	} catch {
		return false;
	}
}

if (!force && indexLooksHealthy()) {
	console.log('Catalog index present — skipping generate-games-list (set FORCE_GAMES_GENERATE=1 to rebuild)');
	process.exit(0);
}

const result = spawnSync(process.execPath, [path.join(root, 'scripts/generate-games-list.js')], {
	stdio: 'inherit',
	cwd: root
});
process.exit(result.status ?? 1);
