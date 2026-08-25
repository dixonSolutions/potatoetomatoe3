/**
 * GitHub Pages helpers for SPA deep links:
 * - 404.html → SPA shell for unknown routes
 * - games/{id}/index.html + games/{id}.html → game player routes beside static asset folders
 *
 * Tauri / Android builds get `__data.json` only (APK ZIP32 max 65535 entries).
 * Set SKIP_PAGES_GAME_FALLBACKS=1 or TAURI_ENV_PLATFORM to select that mode.
 *
 * The HTML shells are what blew the entry budget — three files per game across 13k games.
 * `__data.json` cannot be dropped with them: `+layout.server.ts` gives every route server
 * data, so the client fetches `/games/<id>/__data.json` on any cold load. Without the
 * file the request falls through to the SPA shell and returns `text/html`, the client
 * runs `JSON.parse('<!doctype html>')`, and the game page renders blank. Tauri's asset
 * handler already serves index.html for the route itself, so only the data file is
 * needed — 182 identical bytes per game, ~13k entries, still far under the cap.
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

/** Tauri/Android: write the route data, skip the HTML shells. */
const dataOnly =
	process.env.SKIP_PAGES_GAME_FALLBACKS === '1' ||
	process.env.SKIP_PAGES_GAME_FALLBACKS === 'true' ||
	Boolean(process.env.TAURI_ENV_PLATFORM);

const listPath = path.join(buildDir, 'games', 'games-list.json');
const layoutDataPath = path.join(buildDir, 'games', '__data.json');
const layoutData = fs.existsSync(layoutDataPath) ? fs.readFileSync(layoutDataPath, 'utf-8') : null;

if (!fs.existsSync(listPath)) {
	console.warn('[prepare-github-pages] games-list.json missing — skip game fallbacks');
	process.exit(0);
}

if (!layoutData) {
	console.warn(
		'[prepare-github-pages] games/__data.json missing — game deep links may 404 on cold load'
	);
}

const ids = JSON.parse(fs.readFileSync(listPath, 'utf-8'));
let count = 0;
for (const id of ids) {
	if (typeof id !== 'string' || !id) continue;
	const gameDir = path.join(buildDir, 'games', id);
	if (!fs.existsSync(gameDir)) continue;
	if (!dataOnly) {
		fs.writeFileSync(path.join(gameDir, 'index.html'), indexHtml);
		fs.writeFileSync(path.join(buildDir, 'games', `${id}.html`), indexHtml);
	}
	if (layoutData) {
		fs.writeFileSync(path.join(gameDir, '__data.json'), layoutData);
	}
	count++;
}
console.log(
	dataOnly
		? `[prepare-github-pages] wrote __data.json for ${count} game routes (Tauri: no HTML shells)`
		: `[prepare-github-pages] wrote SPA fallbacks for ${count} game routes`
);
