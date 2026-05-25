#!/usr/bin/env node
/**
 * Safe offline mirror health check. Read-only by default.
 *
 * - Never deletes `offline/` or `online/`.
 * - Network / wget only with both `--repair` and `--yes`, plus an explicit `--limit` (capped).
 *
 * Usage:
 *   node scripts/safe-offline-health.mjs
 *   node scripts/safe-offline-health.mjs --json
 *   node scripts/safe-offline-health.mjs --repair-plan --limit 10
 *   node scripts/safe-offline-health.mjs --repair --limit 3 --yes [optional-extra-game-ids...]
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_SCRIPTS = __dirname;
const GAMES_ROOT = join(REPO_SCRIPTS, '../static/games');
const AUDIT_SCRIPT = join(REPO_SCRIPTS, 'audit-offline-mirrors.mjs');
const DEEP_SCRIPT = join(REPO_SCRIPTS, 'download-games-offline.js');

/** Hard cap: even with --limit 9999, never repair more than this many games in one invocation. */
const MAX_REPAIR_LIMIT = 40;

const SAFE_GAME_ID = /^[a-z0-9-]+$/;

function parseArgs(argv) {
	const out = {
		json: false,
		repairPlan: false,
		repair: false,
		yes: false,
		limit: null,
		extraIds: []
	};
	const rest = [];
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--json') out.json = true;
		else if (a === '--repair-plan') out.repairPlan = true;
		else if (a === '--repair') out.repair = true;
		else if (a === '--yes') out.yes = true;
		else if (a === '--limit') {
			const n = argv[++i];
			out.limit = n === undefined ? NaN : parseInt(n, 10);
		} else if (a.startsWith('--')) rest.push(a);
		else out.extraIds.push(a);
	}
	if (rest.length) {
		console.error(`Unknown option(s): ${rest.join(', ')}`);
		process.exit(1);
	}
	return out;
}

function assertSafeGameId(id) {
	if (!SAFE_GAME_ID.test(id)) {
		throw new Error(`refusing unsafe game id: ${JSON.stringify(id)}`);
	}
}

async function runAuditJson() {
	const opts = {
		maxBuffer: 32 * 1024 * 1024,
		cwd: join(REPO_SCRIPTS, '..'),
		encoding: 'utf8'
	};
	try {
		const { stdout, stderr } = await execFileAsync(process.execPath, [AUDIT_SCRIPT, '--json'], opts);
		if (stderr?.trim()) process.stderr.write(stderr);
		return JSON.parse(stdout);
	} catch (err) {
		/** `audit-offline-mirrors.mjs` exits 2 when issues exist; JSON is still printed. */
		if (err.stdout) {
			if (err.stderr?.trim()) process.stderr.write(err.stderr);
			return JSON.parse(String(err.stdout));
		}
		throw err;
	}
}

function scoreRow(r) {
	const z = r.issues?.zeroByte?.length ?? 0;
	const m = r.issues?.missingRef?.length ?? 0;
	return z * 2 + m;
}

function offlineIndexPath(gameId) {
	return join(GAMES_ROOT, gameId, 'offline', 'index.html');
}

function pickRepairTargets(report, limit, extraIds) {
	const rows = report.results ?? [];
	const ordered = [...rows].sort((a, b) => scoreRow(b) - scoreRow(a));
	const picked = [];
	const seen = new Set();

	for (const id of extraIds) {
		assertSafeGameId(id);
		if (!existsSync(offlineIndexPath(id))) {
			throw new Error(`no offline/index.html for game id: ${id}`);
		}
		if (seen.has(id)) continue;
		seen.add(id);
		picked.push(id);
		if (picked.length >= limit) return picked;
	}

	for (const r of ordered) {
		if (picked.length >= limit) break;
		if (seen.has(r.gameId)) continue;
		seen.add(r.gameId);
		picked.push(r.gameId);
	}

	return picked;
}

async function runDeepOnly(gameIds) {
	const args = [DEEP_SCRIPT, '--deep-only', ...gameIds];
	await execFileAsync(process.execPath, args, {
		maxBuffer: 64 * 1024 * 1024,
		cwd: join(REPO_SCRIPTS, '..'),
		stdio: 'inherit'
	});
}

async function main() {
	const args = parseArgs(process.argv.slice(2));

	if (args.repair && args.repairPlan) {
		console.error('Use either --repair-plan or --repair, not both.');
		process.exit(1);
	}

	if (args.repairPlan || args.repair) {
		if (args.limit === null || Number.isNaN(args.limit) || args.limit < 1) {
			console.error('--repair-plan and --repair require a positive integer: --limit N');
			process.exit(1);
		}
	}

	const cappedLimit = args.limit != null ? Math.min(args.limit, MAX_REPAIR_LIMIT) : null;
	if (args.limit != null && cappedLimit !== args.limit) {
		console.error(`Note: --limit clamped to ${MAX_REPAIR_LIMIT} (safety cap).`);
	}

	const report = await runAuditJson();

	if (args.json && !args.repairPlan && !args.repair) {
		console.log(JSON.stringify(report, null, 2));
		process.exit(report.withIssues > 0 ? 2 : 0);
	}

	if (!args.json && !args.repairPlan && !args.repair) {
		console.log(`Offline health (static/games/*/offline)\n`);
		console.log(`  Bundles with index: ${report.withOfflineIndex}`);
		console.log(`  Clean:              ${report.clean}`);
		console.log(`  With issues:        ${report.withIssues}`);
		console.log(`\nRead-only. For a repair plan: --repair-plan --limit 10`);
		console.log(`To run deep fetch (network): --repair --limit 3 --yes`);
		process.exit(report.withIssues > 0 ? 2 : 0);
	}

	if (args.repairPlan) {
		const targets = pickRepairTargets(report, cappedLimit, args.extraIds);
		console.log(`Repair plan (top ${targets.length} by issue weight; --limit ${cappedLimit}):\n`);
		for (const id of targets) {
			const r = report.results.find((x) => x.gameId === id);
			const z = r?.issues?.zeroByte?.length ?? 0;
			const m = r?.issues?.missingRef?.length ?? 0;
			console.log(`  - ${id}  (0-byte: ${z}, missing ref: ${m})`);
		}
		console.log(`\nDry-run only. To apply deep mirror pass:`);
		console.log(
			`  node scripts/safe-offline-health.mjs --repair --limit ${targets.length} --yes ${targets.join(' ')}`
		);
		process.exit(0);
	}

	if (args.repair) {
		if (!args.yes) {
			console.error('Refusing network work without explicit --yes (adds/fetches files under static/games/*/offline).');
			process.exit(1);
		}
		const targets = pickRepairTargets(report, cappedLimit, args.extraIds);
		if (targets.length === 0) {
			console.log('Nothing to repair (no failing games in audit).');
			process.exit(0);
		}
		console.log(`Running deep-only for ${targets.length} game(s): ${targets.join(', ')}`);
		await runDeepOnly(targets);
		const after = await runAuditJson();
		console.log(`\nAfter repair: clean=${after.clean}, withIssues=${after.withIssues}`);
		if (after.withIssues > 0) {
			console.log(
				`Note: catalog may still have other bundles with issues; re-run without --repair or use a larger --limit.`
			);
		}
		process.exit(0);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
