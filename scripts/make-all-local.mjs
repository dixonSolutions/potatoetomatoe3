#!/usr/bin/env node
/**
 * Full pipeline: wget only games still missing offline/index.html, regenerate game-entries.json.
 *
 * See scripts/ensure-all-local.mjs for details.
 */

import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const argv = process.argv.slice(2);
execFileSync(process.execPath, [join(root, 'scripts/ensure-all-local.mjs'), ...argv], {
	cwd: root,
	stdio: 'inherit'
});
