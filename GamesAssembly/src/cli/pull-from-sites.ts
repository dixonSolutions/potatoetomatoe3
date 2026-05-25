#!/usr/bin/env node
/**
 * Import / discover games **from external sites only** (Y8, play-games, etc.).
 * Does **not** run the local offline mirror pipeline — for that use `pnpm run local-transform`.
 *
 * Forwards argv to the selected site script (same as `pull`, but only `y8` and `external` are allowed).
 *
 *   pnpm run pull-from-sites -- y8 --all --limit 20
 *   pnpm run pull-from-sites -- external --discover play-games --max-urls 50
 *   pnpm run pull-from-sites -- --help
 */
import { formatPullSiteList, getPullSiteById, PULL_SITES } from '../pull/registry.js';
import { runRepoNodeScript } from '../utils/run-repo-script.js';

const ALLOWED_SITE_IDS = new Set(['y8', 'external']);

function printHelp(): void {
	console.log(
		`pull-from-sites — external discovery / import only (no local-transform).\n` +
			`Allowed site ids: ${[...ALLOWED_SITE_IDS].join(', ')}\n` +
			`Use pnpm run local-transform for offline mirrors, deep pass, Unity fixes, and game-entries.\n\n` +
			`${formatPullSiteList()}`
	);
	console.log(
		`Usage:\n` +
			`  pnpm run pull-from-sites -- <site> [args...]\n` +
			`  PULL_SITE=<id> pnpm run pull-from-sites -- [args...]\n\n` +
			`Examples:\n` +
			`  pnpm run pull-from-sites -- y8 --all --limit 10 --skip-existing\n` +
			`  pnpm run pull-from-sites -- external --discover play-games --max-urls 50\n`
	);
}

function parseArgv(): { siteId: string | undefined; forward: string[] } {
	const raw = process.argv.slice(2);
	const forward: string[] = [];
	let siteId: string | undefined = process.env.PULL_SITE?.trim() || undefined;

	let i = 0;
	while (i < raw.length) {
		const a = raw[i];
		if (a === '--site' && raw[i + 1]) {
			siteId = raw[i + 1]!;
			i += 2;
			continue;
		}
		forward.push(a!);
		i++;
	}

	if (!siteId && forward.length > 0) {
		const first = forward[0]!;
		if (!first.startsWith('-')) {
			const hit = getPullSiteById(first);
			if (hit) {
				siteId = hit.id;
				forward.shift();
			}
		}
	}

	return { siteId, forward };
}

async function main() {
	const raw = process.argv.slice(2);
	if (raw.includes('--help') || raw.includes('-h')) {
		printHelp();
		process.exit(0);
	}

	const { siteId, forward } = parseArgv();

	if (!siteId) {
		console.error('Missing site id. Use --site <id> or pass y8 | external as the first argument.\n');
		printHelp();
		process.exit(1);
	}

	const n = siteId.trim().toLowerCase();
	if (!ALLOWED_SITE_IDS.has(n)) {
		console.error(
			`pull-from-sites only supports external importers: ${[...ALLOWED_SITE_IDS].join(', ')}.\n` +
				`For offline bundle orchestration use: pnpm run pull -- offline …\n` +
				`For local mirrors use: pnpm run local-transform\n`
		);
		process.exit(1);
	}

	const site = PULL_SITES.find((s) => s.id === n);
	if (!site) {
		console.error(`Unknown site: ${siteId}\n`);
		process.exit(1);
	}

	console.log(`\n━━ pull-from-sites [${site.id}] ${site.label} ━━\n→ node ${site.scriptPath}\n`);
	const code = await runRepoNodeScript(site.scriptPath, forward);
	process.exit(code);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
