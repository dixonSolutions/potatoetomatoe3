/**
 * Slim build/ for Android APK packaging.
 *
 * APK/ZIP32 allows at most 65535 entries. The full catalog + GitHub Pages
 * per-game SPA fallbacks exceed that. Android has no puller, so drop:
 *   - .gitkeep placeholders
 *   - non-bundled offline mirrors (keep shrek-escape etc.)
 *   - Pages-only deep-link shells (games/<id>.html, game/<id>/index.html SPA copies,
 *     game/<id>/__data.json) when present
 *
 * Usage (after pnpm build):
 *   node scripts/slim-android-assets.mjs
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const BUILD = path.join(ROOT, 'build');
const GAMES = path.join(BUILD, 'games');
const ZIP_SOFT_MAX = 60_000;

function rm(p) {
	try {
		fs.rmSync(p, { recursive: true, force: true });
		return true;
	} catch {
		return false;
	}
}

function readBundledIds() {
	const bundled = new Set(['shrek-escape']);
	if (!fs.existsSync(GAMES)) return bundled;
	for (const id of fs.readdirSync(GAMES)) {
		const metaPath = path.join(GAMES, id, 'online', 'metadata.json');
		if (!fs.existsSync(metaPath)) continue;
		try {
			const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
			if (meta?.bundledOffline) bundled.add(id);
		} catch {
			/* ignore */
		}
	}
	return bundled;
}

function walkFiles(dir, out = []) {
	if (!fs.existsSync(dir)) return out;
	for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, ent.name);
		if (ent.isDirectory()) walkFiles(p, out);
		else out.push(p);
	}
	return out;
}

function main() {
	if (!fs.existsSync(BUILD)) {
		console.error('[slim-android] build/ missing — run pnpm build first');
		process.exit(1);
	}

	const bundled = readBundledIds();
	let removed = 0;

	for (const file of walkFiles(BUILD)) {
		const base = path.basename(file);
		const rel = path.relative(BUILD, file).replace(/\\/g, '/');

		if (base === '.gitkeep') {
			if (rm(file)) removed++;
			continue;
		}

		/* Pages deep-link shells are not needed for Tauri WebView SPA fallback. */
		if (/^games\/[^/]+\.html$/.test(rel)) {
			if (rm(file)) removed++;
			continue;
		}
		if (/^games\/[^/]+\/index\.html$/.test(rel)) {
			/* Keep only if it's the browse route — already handled separately; per-game SPA copies go. */
			const id = rel.split('/')[1];
			if (id && id !== 'games-index' && fs.existsSync(path.join(GAMES, id, 'online'))) {
				if (rm(file)) removed++;
			}
			continue;
		}
		if (/^games\/[^/]+\/__data\.json$/.test(rel)) {
			if (rm(file)) removed++;
			continue;
		}

		const offlineMatch = rel.match(/^games\/([^/]+)\/offline(\/|$)/);
		if (offlineMatch && !bundled.has(offlineMatch[1])) {
			if (rm(file)) removed++;
		}
	}

	/* Drop emptied non-bundled offline directories. */
	if (fs.existsSync(GAMES)) {
		for (const id of fs.readdirSync(GAMES)) {
			if (bundled.has(id)) continue;
			const offline = path.join(GAMES, id, 'offline');
			if (fs.existsSync(offline)) rm(offline);
		}
	}

	const remaining = walkFiles(BUILD).length;
	console.log(
		`[slim-android] removed ${removed} files; build/ now has ${remaining} files (soft max ${ZIP_SOFT_MAX})`
	);
	if (remaining >= ZIP_SOFT_MAX) {
		console.error(
			`[slim-android] still too many files for APK ZIP32 (max 65535). Remaining=${remaining}`
		);
		process.exit(1);
	}
}

main();
