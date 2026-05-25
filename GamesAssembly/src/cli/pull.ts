#!/usr/bin/env node
/**
 * Site-aware pull: forwards argv to the importer / pipeline registered in `src/pull/registry.ts`.
 * For **external import only** (y8 + external), prefer `pnpm run pull-from-sites` — it refuses `offline`.
 *
 *   pnpm run pull -- y8 --all --limit 20
 *   pnpm run pull -- external -- --include play-games poki --offline
 *   pnpm run pull -- offline --override
 *   pnpm run pull --offline              # same as site id `offline` (not forwarded to scripts)
 *   PULL_SITE=y8 pnpm run pull -- --skip-existing "https://www.y8.com/games/2048"
 *
 *   pnpm run pull -- --list
 *   pnpm run pull -- --help
 */
import { formatPullSiteList, getPullSiteById, PULL_SITES } from '../pull/registry.js';
import { runRepoNodeScript } from '../utils/run-repo-script.js';

function printHelp(): void {
	console.log(
		`${formatPullSiteList()}
Usage:
  pnpm run pull -- <site> [args...]     First argument is the site id (${PULL_SITES.map((s) => s.id).join(', ')})
  PULL_SITE=<id> pnpm run pull -- [args...]   Same without positional site
  pnpm run pull -- --site <id> [args...]
  pnpm run pull --offline [args...]       Shorthand for --site offline

Examples:
  pnpm run pull -- y8 --all --limit 10 --skip-existing
  pnpm run pull -- external --discover play-games --max-urls 50 --write-manifest ./tmp/m.json
  pnpm run pull -- offline --deep-only
`
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

	/** `pnpm run pull --offline` → offline bundles site (script does not use a `--offline` flag). */
	if (!siteId && forward[0] === '--offline') {
		siteId = 'offline';
		forward.shift();
	}

	return { siteId, forward };
}

async function main() {
	const raw = process.argv.slice(2);
	if (raw.includes('--help') || raw.includes('-h')) {
		printHelp();
		process.exit(0);
	}
	if (raw.includes('--list')) {
		console.log(formatPullSiteList());
		process.exit(0);
	}

	const { siteId, forward } = parseArgv();

	if (!siteId) {
		console.error('Missing site id. Use --site <id>, PULL_SITE, or pass <id> as the first argument.\n');
		printHelp();
		process.exit(1);
	}

	const site = getPullSiteById(siteId);
	if (!site) {
		console.error(`Unknown pull site: ${siteId}\n`);
		console.log(formatPullSiteList());
		process.exit(1);
	}

	console.log(`\n━━ Pull [${site.id}] ${site.label} ━━\n→ node ${site.scriptPath}\n`);
	const code = await runRepoNodeScript(site.scriptPath, forward);
	process.exit(code);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
