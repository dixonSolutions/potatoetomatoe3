/**
 * GitHub Pages helpers for SPA deep links:
 * - 404.html → SPA shell for unknown routes
 * - games/{id}/index.html + games/{id}.html → game player routes beside static asset folders
 *
 * Skip per-game fallbacks for Tauri / Android builds (APK ZIP32 max 65535 entries).
 * Set SKIP_PAGES_GAME_FALLBACKS=1 or TAURI_ENV_PLATFORM to only write 404 + browse shell.
 */
import fs from 'node:fs';
import path from 'node:path';

const buildDir = path.join(import.meta.dirname, '..', 'build');
const indexPath = path.join(buildDir, 'index.html');

if (!fs.existsSync(indexPath)) {
	console.warn('[prepare-github-pages] build/index.html missing — skip');
	process.exit(0);
}

const indexHtml = fs.readFileSync(indexPath, 'utf-8');

fs.writeFileSync(path.join(buildDir, '404.html'), indexHtml);
console.log('[prepare-github-pages] wrote build/404.html');

const gamesBrowseIndex = path.join(buildDir, 'games', 'index.html');
if (fs.existsSync(path.join(buildDir, 'games'))) {
	fs.writeFileSync(gamesBrowseIndex, indexHtml);
	console.log('[prepare-github-pages] wrote build/games/index.html (browse route)');
}

const skipPerGame =
	process.env.SKIP_PAGES_GAME_FALLBACKS === '1' ||
	process.env.SKIP_PAGES_GAME_FALLBACKS === 'true' ||
	Boolean(process.env.TAURI_ENV_PLATFORM);

if (skipPerGame) {
	console.log(
		'[prepare-github-pages] skipping per-game SPA fallbacks (Tauri/Android ZIP entry budget)'
	);
	process.exit(0);
}

const listPath = path.join(buildDir, 'games', 'games-list.json');
const layoutDataPath = path.join(buildDir, 'games', '__data.json');
const layoutData = fs.existsSync(layoutDataPath)
	? fs.readFileSync(layoutDataPath, 'utf-8')
	: null;

if (!fs.existsSync(listPath)) {
	console.warn('[prepare-github-pages] games-list.json missing — skip game fallbacks');
	process.exit(0);
}

if (!layoutData) {
	console.warn('[prepare-github-pages] games/__data.json missing — game deep links may 404 on cold load');
}

const ids = JSON.parse(fs.readFileSync(listPath, 'utf-8'));
let count = 0;
for (const id of ids) {
	if (typeof id !== 'string' || !id) continue;
	const gameDir = path.join(buildDir, 'games', id);
	if (!fs.existsSync(gameDir)) continue;
	fs.writeFileSync(path.join(gameDir, 'index.html'), indexHtml);
	fs.writeFileSync(path.join(buildDir, 'games', `${id}.html`), indexHtml);
	if (layoutData) {
		fs.writeFileSync(path.join(gameDir, '__data.json'), layoutData);
	}
	count++;
}
console.log(`[prepare-github-pages] wrote SPA fallbacks for ${count} game routes`);
