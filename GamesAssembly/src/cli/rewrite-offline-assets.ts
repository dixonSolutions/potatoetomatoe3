#!/usr/bin/env node
/**
 * Fix offline mirrors so references match on-disk files (cache-bust ?query and %3F-in-path).
 *
 * Usage:
 *   pnpm run rewrite-offline-urls
 *   pnpm run rewrite-offline-urls -- moto-x3m
 *   pnpm run rewrite-offline-urls -- --quiet
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
	rewriteAllOfflineMirrorsUnder,
	rewriteOfflineMirrorAssetUrls
} from '../lib/offline-asset-url-rewrite.js';
import { GAMES_ROOT } from '../paths.js';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const quiet = argv.includes('--quiet');
const gameId = argv.find((a) => !a.startsWith('--'));

const HEARTBEAT_EVERY = 50;

function main() {
	const started = Date.now();

	if (gameId) {
		const dir = join(GAMES_ROOT, gameId, 'offline');
		if (!quiet) {
			console.log('Offline URL rewrite (single game)\n');
			console.log(`  game id:   ${gameId}`);
			console.log(`  offline:   ${dir}`);
		}
		if (!existsSync(dir)) {
			console.error(`\nError: no offline/ folder at ${dir}`);
			process.exit(1);
		}
		if (!quiet) console.log('  scanning…\n');
		const r = rewriteOfflineMirrorAssetUrls(dir);
		const ms = Date.now() - started;
		if (!quiet) {
			console.log(`Done in ${ms} ms.`);
			console.log(`  text files scanned: ${r.filesScanned}`);
			console.log(`  files updated:      ${r.filesModified}`);
			if (r.filesModified === 0) {
				console.log('\n(no matching cache-bust / %3F patterns, or nothing to change)');
			}
		} else {
			console.log(`${gameId}\t${r.filesModified}\t${r.filesScanned}`);
		}
		process.exit(0);
	}

	if (!quiet) {
		console.log('Offline URL rewrite (all games with offline/)\n');
		console.log(`  games root: ${GAMES_ROOT}`);
		console.log('  (strip ?query / fix %3F-in-path where the plain file exists on disk)\n');
	}

	let filesUpdatedRunning = 0;
	let lastHeartbeat = 0;

	const summary = rewriteAllOfflineMirrorsUnder(GAMES_ROOT, {
		onGame: quiet
			? undefined
			: ({ gameId: id, index, total, result: res }) => {
					filesUpdatedRunning += res.filesModified;
					if (res.filesModified > 0) {
						console.log(
							`  • ${id}: ${res.filesModified} file(s) updated (${res.filesScanned} scanned)`
						);
					}
					if (index - lastHeartbeat >= HEARTBEAT_EVERY || index === total) {
						console.log(
							`  … progress ${index}/${total} games (${filesUpdatedRunning} file update(s) so far)`
						);
						lastHeartbeat = index;
					}
			  }
	});

	const ms = Date.now() - started;

	if (!quiet) {
		console.log('\n--- Summary ---');
		console.log(`  games with offline/:     ${summary.gamesWithOffline}`);
		console.log(`  games with ≥1 change:    ${summary.gamesTouched}`);
		console.log(`  text files scanned (sum): ${summary.filesScanned}`);
		console.log(`  files updated (sum):    ${summary.filesModified}`);
		console.log(`  time:                    ${ms} ms`);
		if (summary.gamesWithOffline === 0) {
			console.log('\n(no static/games/*/offline folders found — nothing to do)');
		} else if (summary.filesModified === 0) {
			console.log('\n(no rewrites needed — mirrors already normalized or patterns not present)');
		}
		console.log('');
	} else {
		console.log(
			`${summary.gamesWithOffline}\t${summary.gamesTouched}\t${summary.filesModified}\t${summary.filesScanned}\t${ms}`
		);
	}

	process.exit(0);
}

main();
