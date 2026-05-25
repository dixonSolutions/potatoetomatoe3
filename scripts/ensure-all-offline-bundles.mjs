#!/usr/bin/env node
/**
 * Ensure every catalog game has static/games/<id>/offline/index.html:
 * wget mirrors where an iframe URL exists, then copy online/ → offline/ for any remainder.
 *
 *   pnpm run games:ensure-all-offline-bundles
 *   node scripts/ensure-all-offline-bundles.mjs
 */

import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

execFileSync(process.execPath, [join(root, 'scripts', 'ensure-all-local.mjs'), ...process.argv.slice(2)], {
	cwd: root,
	stdio: 'inherit'
});
