#!/usr/bin/env node
/**
 * Local-only pipeline: does **not** import new games from external sites (use `pull-from-sites` / `pull` for that).
 *
 * Fast scan → optional parallel **download** + **Unity fix** (two-column live view; when one
 * finishes, the other uses the **full** terminal width) → seed → deep pass → Unity (full) → rewrite →
 * game-entries.json.
 *
 * Pieces:
 * - **Detectors** (read-only): missing offline, incomplete-asset heuristic, Unity fix candidates — see `lib/local-game-scan.ts`.
 * - **Patches / fixes**: Unity URL fixes (`fix-unity-offline-assets`), offline URL rewrite.
 *
 * Options:
 *   --keep-broken          Passed through to `download-games-offline.js`
 *   --skip-deep-pass       Skip `download-games-offline.js --deep-only` for all games
 *   --skip-unity-fix       Skip Unity fix passes entirely
 *   --skip-offline-rewrite Skip cache-bust / %3F path normalization
 *   --no-parallel          Run download batches first, then Unity fix (no overlap)
 *   --no-split-log         No two-column TTY UI; interleaved `download |` / `Unity fix |` lines (or plain if quiet)
 *   --quiet                Counts + summary only
 */
import { join } from 'node:path';
import {
	listGameIdsWithOfflineMirror,
	summarizeGameEntriesLocalVsLegacy
} from '../lib/catalog.js';
import { scanLocalPipelineState } from '../lib/local-game-scan.js';
import {
	runSplitParallelLanes,
	spawnGamesAssemblyTsxLines,
	spawnNodeScriptLines
} from '../lib/split-terminal-lanes.js';
import {
	DOWNLOAD_OFFLINE_SCRIPT,
	GAMES_ASSEMBLY_DIR,
	GENERATE_GAMES_LIST_SCRIPT,
	REPO_ROOT,
	SEED_OFFLINE_FROM_ONLINE_SCRIPT
} from '../paths.js';
import { runGamesAssemblyTsxInherited } from '../lib/run-prefixed.js';
import { runRepoNodeScript } from '../utils/run-repo-script.js';
import { runUnityOfflineFixes } from '../lib/fix-unity-offline-assets.js';
import { rewriteAllOfflineMirrorsUnder } from '../lib/offline-asset-url-rewrite.js';
import { GAMES_ROOT } from '../paths.js';

const BATCH = 25;
const RULE = '─'.repeat(62);

function printPhase(title: string, subtitle?: string): void {
	console.log(`\n${RULE}`);
	console.log(`  ${title}`);
	if (subtitle) console.log(`  ${subtitle}`);
	console.log(`${RULE}\n`);
}

function printScanReport(quiet: boolean): ReturnType<typeof scanLocalPipelineState> {
	const scan = scanLocalPipelineState();
	if (quiet) return scan;

	console.log(
		'\n╔══════════════════════════════════════════════════════════════╗\n' +
			'║  local-transform  (local mirrors only — not site import)      ║\n' +
			'║  scan → download ∥ Unity fix → seed → deep → Unity → rewrite ║\n' +
			'╚══════════════════════════════════════════════════════════════╝'
	);
	console.log(
		`\n[local-transform] Catalog: ${scan.catalogIds.length} game(s) with metadata · ` +
			`${scan.needFresh.length + scan.needForce.length} need download · ` +
			`${scan.withValidOffline.length} already mirrored`
	);
	console.log(`  • No offline/: ${scan.needFresh.length}  ·  Broken/offline invalid: ${scan.needForce.length}`);
	console.log(
		`  • Detectors — likely incomplete assets (Unity, no Build/): ${scan.likelyIncompleteAssets.length} · ` +
			`Unity fix needed: ${scan.unityFixNeeded.length}`
	);

	printPhase(
		'1 · INVENTORY (fast scan)',
		'○ = need download · ✓ = mirrored · detectors: incomplete / Unity'
	);
	const fresh = new Set(scan.needFresh);
	const force = new Set(scan.needForce);
	const sorted = [...scan.catalogIds].sort((a, b) => a.localeCompare(b));
	for (const id of sorted) {
		if (fresh.has(id)) {
			console.log(`  ○  ${id}  →  no usable offline/  ·  action: download`);
		} else if (force.has(id)) {
			console.log(`  ○  ${id}  →  offline/ invalid  ·  action: re-download (--force)`);
		} else {
			const inc = scan.likelyIncompleteAssets.includes(id) ? ' · incomplete?' : '';
			const u = scan.unityFixNeeded.includes(id) ? ' · Unity fix' : '';
			console.log(`  ✓  ${id}  →  mirrored${inc}${u}`);
		}
	}
	const nDown = scan.needFresh.length + scan.needForce.length;
	const nOk = sorted.length - nDown;
	console.log(
		`\n  ── Summary: ${nOk} mirrored · ${nDown} need download (${scan.needFresh.length} new, ${scan.needForce.length} force) ──\n`
	);
	return scan;
}

async function runAllDownloadsInherited(
	needFresh: string[],
	needForce: string[],
	extraArgs: string[]
): Promise<number> {
	for (let i = 0; i < needFresh.length; i += BATCH) {
		const batch = needFresh.slice(i, i + BATCH);
		const argv = [...extraArgs, ...batch];
		const code = await runRepoNodeScript(DOWNLOAD_OFFLINE_SCRIPT, argv);
		if (code !== 0) return code;
	}
	for (let i = 0; i < needForce.length; i += BATCH) {
		const batch = needForce.slice(i, i + BATCH);
		const argv = [...extraArgs, '--force', ...batch];
		const code = await runRepoNodeScript(DOWNLOAD_OFFLINE_SCRIPT, argv);
		if (code !== 0) return code;
	}
	return 0;
}

async function runAllDownloadsEmit(
	needFresh: string[],
	needForce: string[],
	extraArgs: string[],
	emit: (line: string) => void
): Promise<number> {
	for (let i = 0; i < needFresh.length; i += BATCH) {
		const batch = needFresh.slice(i, i + BATCH);
		const argv = [...extraArgs, ...batch];
		const code = await spawnNodeScriptLines(
			process.execPath,
			DOWNLOAD_OFFLINE_SCRIPT,
			argv,
			REPO_ROOT,
			process.env,
			emit
		);
		if (code !== 0) return code;
	}
	for (let i = 0; i < needForce.length; i += BATCH) {
		const batch = needForce.slice(i, i + BATCH);
		const argv = [...extraArgs, '--force', ...batch];
		const code = await spawnNodeScriptLines(
			process.execPath,
			DOWNLOAD_OFFLINE_SCRIPT,
			argv,
			REPO_ROOT,
			process.env,
			emit
		);
		if (code !== 0) return code;
	}
	return 0;
}

/** `download-games-offline.js --deep-only` in batches. */
async function runDeepOnlyBatches(gameIds: string[], extraArgs: string[]): Promise<number> {
	if (gameIds.length === 0) return 0;
	for (let i = 0; i < gameIds.length; i += BATCH) {
		const batch = gameIds.slice(i, i + BATCH);
		const argv = ['--deep-only', ...extraArgs, ...batch];
		const code = await runRepoNodeScript(DOWNLOAD_OFFLINE_SCRIPT, argv);
		if (code !== 0) return code;
	}
	return 0;
}

async function main() {
	const argv = process.argv.slice(2);
	const keepBroken = argv.includes('--keep-broken');
	const quiet = argv.includes('--quiet');
	const skipDeepPass = argv.includes('--skip-deep-pass');
	const skipUnityFix = argv.includes('--skip-unity-fix');
	const skipOfflineRewrite = argv.includes('--skip-offline-rewrite');
	const noParallel = argv.includes('--no-parallel');
	const noSplitLog = argv.includes('--no-split-log');
	const extraDownloadArgs = keepBroken ? ['--keep-broken'] : [];

	const scan = printScanReport(quiet);
	const { needFresh, needForce, withValidOffline } = scan;

	const hasDownloadWork = needFresh.length > 0 || needForce.length > 0;
	const fixOnlyArgs =
		!skipUnityFix && withValidOffline.length > 0
			? ['--only', withValidOffline.join(',')]
			: null;

	if (hasDownloadWork) {
		if (!quiet) {
			printPhase(
				'2 · DOWNLOAD ∥ UNITY FIX (parallel)',
				'TTY: two columns while both run; first finisher hands the whole width to the other · --no-split-log / --no-parallel'
			);
		}
	}

	async function fixLane(): Promise<number> {
		if (skipUnityFix || !fixOnlyArgs) return 0;
		return runGamesAssemblyTsxInherited('fix-unity-offline.ts', fixOnlyArgs);
	}

	async function downloadLane(): Promise<number> {
		if (!hasDownloadWork) return 0;
		return runAllDownloadsInherited(needFresh, needForce, extraDownloadArgs);
	}

	let codeDown = 0;
	let codeFix = 0;

	const useSplitUi = !quiet && !noSplitLog;

	if (hasDownloadWork && fixOnlyArgs && !noParallel) {
		[codeDown, codeFix] = await runSplitParallelLanes({
			useSplitUi,
			left: 'download',
			right: 'Unity fix',
			runLeft: (emit) => runAllDownloadsEmit(needFresh, needForce, extraDownloadArgs, emit),
			runRight: (emit) =>
				spawnGamesAssemblyTsxLines(
					GAMES_ASSEMBLY_DIR,
					join('src', 'cli', 'fix-unity-offline.ts'),
					fixOnlyArgs,
					REPO_ROOT,
					process.env,
					emit
				)
		});
	} else {
		codeDown = await downloadLane();
		if (codeDown !== 0) process.exit(codeDown);
		codeFix = await fixLane();
	}

	if (codeDown !== 0) process.exit(codeDown);
	if (codeFix !== 0) process.exit(codeFix);

	if (!quiet && hasDownloadWork) {
		console.log('\n  ◆  Parallel phase finished (download + scoped Unity fix where applicable).\n');
	}

	if (!quiet) {
		printPhase(
			'3 · SEED offline/ from online/',
			'Shell games still without a bundle get a stub from online/index.html'
		);
	}
	{
		const c = await runRepoNodeScript(SEED_OFFLINE_FROM_ONLINE_SCRIPT, []);
		if (c !== 0) process.exit(c);
	}

	if (!skipDeepPass) {
		const deepIds = listGameIdsWithOfflineMirror();
		if (!quiet) {
			printPhase(
				`4 · VERIFY (deep asset pass) — ${deepIds.length} game(s) with offline/`,
				`wget scan + Unity manifests + helpers · batches of ${BATCH}`
			);
		} else {
			console.log(`[local-transform] Deep pass: ${deepIds.length} game(s)`);
		}
		const c = await runDeepOnlyBatches(deepIds, extraDownloadArgs);
		if (c !== 0) process.exit(c);
		if (!quiet) console.log(`\n  Deep pass finished for ${deepIds.length} game(s).\n`);
	} else if (!quiet) {
		console.log('\n[local-transform] Skipped deep verify (--skip-deep-pass).\n');
	}

	if (!skipUnityFix) {
		if (!quiet) {
			printPhase(
				'5 · UNITY FIXES (full pass)',
				'Includes games just mirrored — idempotent cleanup for JSON/HTML under offline/'
			);
		}
		const r = runUnityOfflineFixes(GAMES_ROOT);
		console.log(
			`  Updated ${r.filesModified} file(s) across ${r.gamesTouched} game(s) (scanned ${r.gamesScanned} with offline/).`
		);
		if (r.details.length && !quiet) {
			for (const d of r.details.slice(0, 25)) {
				console.log(`    • ${d.relativePath}`);
			}
			if (r.details.length > 25) console.log(`    … ${r.details.length - 25} more`);
		}
	} else if (!quiet) {
		console.log('\n[local-transform] Skipped Unity fixes (--skip-unity-fix).\n');
	}

	if (!skipOfflineRewrite) {
		if (!quiet) {
			printPhase(
				'6 · URL REWRITE (cache-bust cleanup)',
				'Strip ?query / %3F-in-path where the plain file exists on disk'
			);
		}
		let rewriteFilesRunning = 0;
		const rw = rewriteAllOfflineMirrorsUnder(GAMES_ROOT, {
			onGame: quiet
				? undefined
				: ({ gameId, index, total, result: res }) => {
						rewriteFilesRunning += res.filesModified;
						if (res.filesModified > 0) {
							console.log(
								`  ↻  ${gameId}  →  ${res.filesModified} file(s) rewritten (${res.filesScanned} scanned)`
							);
						} else if (index % 60 === 0 || index === total) {
							console.log(
								`  ·  progress ${index}/${total} mirrors · ${rewriteFilesRunning} file update(s) so far`
							);
						}
				  }
		});
		console.log(
			`  Totals: ${rw.filesModified} file(s) updated · ${rw.gamesWithOffline} mirror(s) · ${rw.filesScanned} text files scanned`
		);
	} else if (!quiet) {
		console.log('\n[local-transform] Skipped URL rewrite (--skip-offline-rewrite).\n');
	}

	if (!quiet) {
		printPhase('7 · GENERATE game-entries.json', 'scripts/generate-games-list.js');
	}
	{
		const c = await runRepoNodeScript(GENERATE_GAMES_LIST_SCRIPT, []);
		if (c !== 0) process.exit(c);
	}

	const { localCount, legacyCount, stillLegacy } = summarizeGameEntriesLocalVsLegacy();
	if (!quiet) printPhase('DONE — summary');
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

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
