#!/usr/bin/env node
/**
 * For every game with online/index.html, mirror offline when offline/ is missing, empty, or index.html is tiny.
 *
 * Usage:
 *   pnpm run offline:missing
 *   pnpm run offline:missing -- --limit 20
 *   pnpm run offline:missing -- --y8-only
 */
import { readIframeSrcFromOnline } from '../lib/read-iframe-src.js';
import {
	listGameIdsWithOnlineShell,
	needsForceRemirror,
	needsOfflineMirror
} from '../lib/offline-status.js';
import { isY8PlayableHost } from '../lib/hosts.js';
import { mirrorGameOffline } from '../mirror-game.js';

const argv = process.argv.slice(2);
const limitIdx = argv.indexOf('--limit');
const limit = limitIdx >= 0 && argv[limitIdx + 1] ? parseInt(argv[limitIdx + 1], 10) : 0;
const y8Only = argv.includes('--y8-only');

async function main() {
	let ids = listGameIdsWithOnlineShell().filter(needsOfflineMirror);
	if (y8Only) {
		ids = ids.filter((id) => {
			const src = readIframeSrcFromOnline(id);
			if (!src) return false;
			try {
				return isY8PlayableHost(new URL(src).hostname);
			} catch {
				return false;
			}
		});
	}
	if (limit > 0) ids = ids.slice(0, limit);

	console.log(`Games needing offline mirror: ${ids.length}${y8Only ? ' (Y8 hosts only)' : ''}`);

	let failed = 0;
	for (const id of ids) {
		console.log(`\n━━━ ${id} ━━━`);
		const code = await mirrorGameOffline(id, { force: needsForceRemirror(id) });
		if (code !== 0) failed++;
	}

	console.log(`\nDone. Failed: ${failed}/${ids.length}`);
	process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
