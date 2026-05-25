#!/usr/bin/env node
/**
 * Remove duplicate game folders that point at the SAME remote game (identical iframe src URL).
 *
 * We do NOT merge games based on similar titles — only on a normalized iframe URL match.
 * A separate report lists identical normalized names with different iframe URLs (manual review).
 *
 * Usage:
 *   node scripts/dedupe-games.mjs              # dry-run (default)
 *   node scripts/dedupe-games.mjs --apply      # move duplicates to quarantine + regenerate list
 */

import { execSync } from 'child_process';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = join(__dirname, '..', 'static', 'games');
const QUARANTINE = join(__dirname, '..', 'static', 'games', '_quarantine_duplicates');

function parseArgs(argv) {
	return { apply: argv.includes('--apply') };
}

/** Same game URL regardless of trailing slash on path (hash stripped). */
function normalizeIframeUrl(src) {
	if (!src || typeof src !== 'string') return null;
	const s = src.trim();
	if (!/^https?:\/\//i.test(s)) return null;
	try {
		const u = new URL(s);
		u.hash = '';
		let path = u.pathname;
		if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
		u.pathname = path || '/';
		return u.toString();
	} catch {
		return null;
	}
}

function extractIframeSrc(indexHtml) {
	const m = indexHtml.match(/<iframe[^>]*\ssrc=["']([^"']+)["'][^>]*>/i);
	return m?.[1] ?? null;
}

function hasMetadata(id) {
	return existsSync(join(GAMES_ROOT, id, 'online', 'metadata.json'));
}

function keeperScore(id) {
	let s = 0;
	if (existsSync(join(GAMES_ROOT, id, 'offline', 'index.html'))) s += 1000;
	if (existsSync(join(GAMES_ROOT, id, 'offline', 'index.html'))) s += 100;
	s -= id.length * 0.01;
	return s;
}

function pickKeeper(ids) {
	return [...ids].sort((a, b) => {
		const ds = keeperScore(b) - keeperScore(a);
		if (ds !== 0) return ds;
		return a.localeCompare(b);
	})[0];
}

function normalizeGameName(name) {
	if (!name || typeof name !== 'string') return '';
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function loadMetadataName(id) {
	try {
		const raw = readFileSync(join(GAMES_ROOT, id, 'online', 'metadata.json'), 'utf-8');
		const j = JSON.parse(raw);
		return typeof j.name === 'string' ? j.name : id;
	} catch {
		return id;
	}
}

function main() {
	const { apply } = parseArgs(process.argv.slice(2));

	const allDirs = readdirSync(GAMES_ROOT, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith('_'))
		.map((d) => d.name);

	const gameIds = allDirs.filter((id) => hasMetadata(id));

	const byUrl = new Map();
	const noIframe = [];

	for (const id of gameIds) {
		const indexPath = join(GAMES_ROOT, id, 'online', 'index.html');
		if (!existsSync(indexPath)) {
			noIframe.push({ id, reason: 'no index.html' });
			continue;
		}
		const html = readFileSync(indexPath, 'utf-8');
		const raw = extractIframeSrc(html);
		const key = normalizeIframeUrl(raw);
		if (!key) {
			noIframe.push({ id, reason: raw ? `non-http iframe: ${raw.slice(0, 80)}` : 'no iframe src' });
			continue;
		}
		if (!byUrl.has(key)) byUrl.set(key, []);
		byUrl.get(key).push(id);
	}

	const duplicateGroups = [...byUrl.entries()].filter(([, ids]) => ids.length > 1);

	console.log(`Games with metadata: ${gameIds.length}`);
	console.log(`Unique iframe targets: ${byUrl.size}`);
	console.log(`Duplicate groups (same iframe URL): ${duplicateGroups.length}\n`);

	if (duplicateGroups.length === 0) {
		console.log('No URL-based duplicates to remove.');
	} else {
		for (const [url, ids] of duplicateGroups.sort((a, b) => a[0].localeCompare(b[0]))) {
			const keeper = pickKeeper(ids);
			const remove = ids.filter((x) => x !== keeper);
			console.log(`URL: ${url}`);
			console.log(`  KEEP:   ${keeper}`);
			console.log(`  REMOVE: ${remove.join(', ')}`);
			console.log('');

			if (apply) {
				const stamp = new Date().toISOString().replace(/[:.]/g, '-');
				const qdir = join(QUARANTINE, stamp);
				mkdirSync(qdir, { recursive: true });
				for (const id of remove) {
					const gameRoot = join(GAMES_ROOT, id);
					if (existsSync(gameRoot)) {
						const dest = join(qdir, id);
						renameSync(gameRoot, dest);
						console.log(`  Moved ${gameRoot} -> ${dest}`);
					}
				}
			}
		}
	}

	// Name collision report (manual review only — different games can share a title)
	const byName = new Map();
	for (const id of gameIds) {
		const n = normalizeGameName(loadMetadataName(id));
		if (!n) continue;
		if (!byName.has(n)) byName.set(n, []);
		byName.get(n).push(id);
	}
	const nameDupes = [...byName.entries()].filter(([, ids]) => ids.length > 1);

	console.log('\n--- Name similarity report (NOT auto-removed) ---');
	let review = 0;
	for (const [n, ids] of nameDupes.sort((a, b) => a[0].localeCompare(b[0]))) {
		const urls = ids.map((id) => {
			const p = join(GAMES_ROOT, id, 'online', 'index.html');
			if (!existsSync(p)) return { id, key: null };
			const raw = extractIframeSrc(readFileSync(p, 'utf-8'));
			return { id, key: normalizeIframeUrl(raw) };
		});
		const uniqueKeys = new Set(urls.map((u) => u.key).filter(Boolean));
		if (uniqueKeys.size > 1) {
			review++;
			console.log(`\nREVIEW: normalized name "${n}"`);
			for (const { id, key } of urls) {
				console.log(`  - ${id}: ${key ?? '(no http iframe)'}`);
			}
		}
	}
	if (review === 0) {
		console.log('No conflicting same-name / different-URL pairs found.');
	} else {
		console.log(`\n${review} name group(s) need human review (different URLs).`);
	}

	if (!apply && duplicateGroups.length > 0) {
		console.log('\nDry-run only. Re-run with --apply to quarantine duplicate folders.');
	} else if (apply && duplicateGroups.length > 0) {
		const gen = join(__dirname, 'generate-games-list.js');
		if (existsSync(gen)) {
			console.log('\nRegenerating games list...');
			execSync(`node "${gen}"`, { stdio: 'inherit', cwd: join(__dirname, '..') });
		}
	}

	if (apply && duplicateGroups.length > 0) {
		console.log(`\nQuarantine root: ${QUARANTINE}`);
	}
}

try {
	main();
} catch (e) {
	console.error(e);
	process.exit(1);
}
