/**
 * GitHub Pages helpers for SPA deep links:
 * - 404.html → SPA shell for unknown routes
 * - games/{id}/index.html + games/{id}.html → game player routes beside static asset folders
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

const listPath = path.join(buildDir, 'games', 'games-list.json');
if (!fs.existsSync(listPath)) {
	console.warn('[prepare-github-pages] games-list.json missing — skip game fallbacks');
	process.exit(0);
}

const ids = JSON.parse(fs.readFileSync(listPath, 'utf-8'));
let count = 0;
for (const id of ids) {
	if (typeof id !== 'string' || !id) continue;
	const gameDir = path.join(buildDir, 'games', id);
	if (!fs.existsSync(gameDir)) continue;
	fs.writeFileSync(path.join(gameDir, 'index.html'), indexHtml);
	fs.writeFileSync(path.join(buildDir, 'games', `${id}.html`), indexHtml);
	count++;
}
console.log(`[prepare-github-pages] wrote SPA fallbacks for ${count} game routes`);
