/**
 * GitHub Pages serves 404.html for unknown paths — copy SPA fallback so client routes work.
 */
import fs from 'node:fs';
import path from 'node:path';

const buildDir = path.join(import.meta.dirname, '..', 'build');
const indexPath = path.join(buildDir, 'index.html');
const notFoundPath = path.join(buildDir, '404.html');

if (!fs.existsSync(indexPath)) {
	console.warn('[copy-404-for-pages] build/index.html missing — skip');
	process.exit(0);
}

fs.copyFileSync(indexPath, notFoundPath);
console.log('[copy-404-for-pages] wrote build/404.html');
