#!/usr/bin/env node
/**
 * Apply Unity WebGL offline fixes under static/games (each game offline/ folder) only — no deep wget pass.
 * For the full pipeline (download → seed → deep assets → Unity fixes → URL rewrite → game-entries),
 * use `pnpm run local-transform` from the repo root.
 * See lib/fix-unity-offline-assets.ts.
 *
 * Options:
 *   --only <id1,id2,...>   Only touch these game ids (under static/games/<id>/offline/).
 */
import { runUnityOfflineFixes } from '../lib/fix-unity-offline-assets.js';
import { GAMES_ROOT } from '../paths.js';

function parseOnly(argv: string[]): ReadonlySet<string> | undefined {
	const i = argv.indexOf('--only');
	if (i < 0 || !argv[i + 1]) return undefined;
	const raw = argv[i + 1]!;
	const ids = raw
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	return ids.length ? new Set(ids) : undefined;
}

const argv = process.argv.slice(2);
const only = parseOnly(argv);

const report = runUnityOfflineFixes(GAMES_ROOT, only ? { onlyGameIds: only } : {});
const scope =
	only && only.size > 0
		? ` (--only ${only.size} id(s))`
		: '';
const msg =
	'[fix-unity-offline] Scanned ' +
	String(report.gamesScanned) +
	' game(s) that have offline/; updated ' +
	String(report.filesModified) +
	' file(s) in ' +
	String(report.gamesTouched) +
	' game(s).' +
	scope;
console.log(msg);
for (const d of report.details) {
	console.log('  - ' + d.relativePath + ' (' + d.kinds.join(', ') + ')');
}
if (report.filesModified > report.details.length) {
	console.log(
		'  (listed ' +
			String(report.details.length) +
			' paths; total files updated: ' +
			String(report.filesModified) +
			')'
	);
}
