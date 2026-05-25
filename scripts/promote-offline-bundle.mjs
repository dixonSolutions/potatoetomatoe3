#!/usr/bin/env node
/**
 * Kept for `pnpm run games:promote-offline`. Mirrored games live under static/games/<id>/offline/
 * (from download-games-offline.js). There is no copy step into online/ anymore — this regenerates
 * static/games/game-entries.json so the player points at offline/index.html when that file exists.
 *
 * Optional args: game IDs are ignored (entries are rebuilt for the whole catalog).
 */

import { execFileSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

execFileSync(process.execPath, [join(root, 'scripts', 'generate-games-list.js')], {
	cwd: root,
	stdio: 'inherit'
});
