#!/usr/bin/env node
/**
 * Orchestrate catalog quality purge + multi-portal full scrapes.
 *
 * Order:
 *   1) purge low-quality Unity Play
 *   2) update shrek-escape → Playhop online URL
 *   3) import Coolmath, CrazyGames, AddictingGames, Playhop, Y8
 *   4) regenerate games-list.json
 *
 * Usage:
 *   node scripts/import-all-portals.mjs
 *   node scripts/import-all-portals.mjs --skip-purge --limit 20
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function parseArgv() {
	const a = process.argv.slice(2);
	const num = (flag, fallback) => {
		const i = a.indexOf(flag);
		return i >= 0 && a[i + 1] ? parseInt(a[i + 1], 10) : fallback;
	};
	return {
		skipPurge: a.includes('--skip-purge'),
		skipShrek: a.includes('--skip-shrek'),
		discoverOnly: a.includes('--discover-only'),
		limit: num('--limit', 0),
		concurrency: num('--concurrency', 0),
		help: a.includes('--help') || a.includes('-h')
	};
}

function runNode(script, extraArgs = []) {
	return new Promise((resolve, reject) => {
		console.log(`\n======== ${script} ${extraArgs.join(' ')} ========`);
		const child = spawn(process.execPath, [join(__dirname, script), ...extraArgs], {
			cwd: ROOT,
			stdio: 'inherit'
		});
		child.on('exit', (code) => {
			if (code === 0) resolve();
			else reject(new Error(`${script} exited ${code}`));
		});
	});
}

async function main() {
	const opts = parseArgv();
	if (opts.help) {
		console.log(`Usage: node scripts/import-all-portals.mjs [--skip-purge] [--skip-shrek] [--limit N] [--discover-only]`);
		process.exit(0);
	}

	const common = [];
	if (opts.discoverOnly) common.push('--discover-only');
	if (opts.limit > 0) common.push('--limit', String(opts.limit));
	if (opts.concurrency > 0) common.push('--concurrency', String(opts.concurrency));
	common.push('--skip-existing');

	if (!opts.skipPurge) {
		await runNode('purge-low-quality-unity.mjs', ['--min-plays', '100']);
	}
	if (!opts.skipShrek) {
		await runNode('update-shrek-playhop.mjs');
	}

	const portals = [
		'import-coolmath-catalog.mjs',
		'import-crazygames-catalog.mjs',
		'import-addictinggames-catalog.mjs',
		'import-playhop-catalog.mjs',
		'import-y8-catalog.mjs'
	];

	for (const script of portals) {
		await runNode(script, common);
	}

	await runNode('generate-games-list.js');
	console.log('\nAll portal imports finished.');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
