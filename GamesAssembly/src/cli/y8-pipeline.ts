#!/usr/bin/env node
/**
 * 1) Run Y8 import (same CLI as scripts/pull-external-sources/import-y8-games.mjs)
 * 2) Regenerate games list at repo root
 * 3) Optionally mirror offline for Y8-hosted games that are still missing offline/
 *
 * Usage (forwarded to import script):
 *   pnpm run y8:pipeline -- --all --limit 10
 *   pnpm run y8:pipeline -- "https://www.y8.com/games/2048"
 *
 * Wrapper-only flags (strip before import):
 *   --offline-after          After import + generate-games-list, mirror missing Y8 offline bundles
 *   --offline-limit N        Cap offline games (with --offline-after)
 */
import { spawn } from 'node:child_process';
import { GENERATE_GAMES_LIST_SCRIPT, Y8_IMPORT_SCRIPT, REPO_ROOT } from '../paths.js';
import { listGameIdsWithOnlineShell, needsForceRemirror, needsOfflineMirror } from '../lib/offline-status.js';
import { readIframeSrcFromOnline } from '../lib/read-iframe-src.js';
import { isY8PlayableHost } from '../lib/hosts.js';
import { mirrorGameOffline } from '../mirror-game.js';

function runNode(script: string, args: string[]): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [script, ...args], {
			cwd: REPO_ROOT,
			stdio: 'inherit',
			env: process.env
		});
		child.on('error', reject);
		child.on('close', (code) => resolve(code ?? 1));
	});
}

function parseForwardArgv(): { forward: string[]; offlineAfter: boolean; offlineLimit: number } {
	const raw = process.argv.slice(2);
	const offlineAfter = raw.includes('--offline-after');
	const olIdx = raw.indexOf('--offline-limit');
	const offlineLimit =
		olIdx >= 0 && raw[olIdx + 1] ? parseInt(raw[olIdx + 1], 10) : 0;

	const skip = new Set<number>();
	for (let i = 0; i < raw.length; i++) {
		if (raw[i] === '--offline-after') skip.add(i);
		if (raw[i] === '--offline-limit') {
			skip.add(i);
			if (raw[i + 1] !== undefined) skip.add(i + 1);
			i++;
		}
	}
	const forward = raw.filter((_, i) => !skip.has(i));
	return { forward, offlineAfter, offlineLimit };
}

async function main() {
	const { forward, offlineAfter, offlineLimit } = parseForwardArgv();

	const importCode = await runNode(Y8_IMPORT_SCRIPT, forward);
	if (importCode !== 0) {
		process.exit(importCode);
	}

	const genCode = await runNode(GENERATE_GAMES_LIST_SCRIPT, []);
	if (genCode !== 0) {
		process.exit(genCode);
	}

	if (!offlineAfter) {
		console.log('\nTip: add --offline-after [--offline-limit N] to mirror missing Y8 offline bundles.');
		process.exit(0);
	}

	let ids = listGameIdsWithOnlineShell().filter(needsOfflineMirror);
	ids = ids.filter((id) => {
		const src = readIframeSrcFromOnline(id);
		if (!src) return false;
		try {
			return isY8PlayableHost(new URL(src).hostname);
		} catch {
			return false;
		}
	});
	if (offlineLimit > 0) ids = ids.slice(0, offlineLimit);

	console.log(`\n━━ Offline pass (Y8, missing mirror): ${ids.length} game(s) ━━`);

	let failed = 0;
	for (const id of ids) {
		console.log(`\n━━━ ${id} ━━━`);
		const code = await mirrorGameOffline(id, { force: needsForceRemirror(id) });
		if (code !== 0) failed++;
	}
	process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
