#!/usr/bin/env node
/**
 * Remove Poki-sourced catalog entries from static/games/.
 *
 * Matches:
 *   - author: "Poki" (or sourcePortal: "poki") in online/shared metadata
 *   - online shells pointing at games.poki.com / poki SDK
 *   - id / folder `poki-home`
 *
 * Usage:
 *   node scripts/purge-poki-catalog.mjs --dry-run
 *   node scripts/purge-poki-catalog.mjs
 *   node scripts/purge-poki-catalog.mjs --quarantine   # move to static/games/_purged-poki/ instead of delete
 */

import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	mkdirSync,
	renameSync,
	writeFileSync,
	statSync
} from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const GAMES_ROOT = join(ROOT, 'static/games');
const DATA_DIR = join(__dirname, 'data');
const QUARANTINE_ROOT = join(GAMES_ROOT, '_purged-poki');
const REPORT_PATH = join(DATA_DIR, 'poki-purge-report.json');

function parseArgv() {
	const a = process.argv.slice(2);
	return {
		dryRun: a.includes('--dry-run'),
		quarantine: a.includes('--quarantine'),
		help: a.includes('--help') || a.includes('-h')
	};
}

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, 'utf-8'));
	} catch {
		return null;
	}
}

function readText(path) {
	try {
		return readFileSync(path, 'utf-8');
	} catch {
		return '';
	}
}

function isPokiGame(gameId) {
	const reasons = [];
	if (gameId === 'poki-home') reasons.push('id:poki-home');

	const metaPaths = [
		join(GAMES_ROOT, gameId, 'online', 'metadata.json'),
		join(GAMES_ROOT, gameId, 'shared', 'metadata.json'),
		join(GAMES_ROOT, gameId, 'metadata.json')
	];
	for (const p of metaPaths) {
		if (!existsSync(p)) continue;
		const meta = readJson(p);
		if (!meta) continue;
		if (String(meta.author || '').trim().toLowerCase() === 'poki') {
			reasons.push(`author:Poki (${p.slice(GAMES_ROOT.length + 1)})`);
		}
		if (String(meta.sourcePortal || '').trim().toLowerCase() === 'poki') {
			reasons.push(`sourcePortal:poki (${p.slice(GAMES_ROOT.length + 1)})`);
		}
		const embed = String(meta.onlineEmbedUrl || '');
		if (/games\.poki\.com/i.test(embed)) reasons.push('onlineEmbedUrl:games.poki.com');
	}

	const htmlPaths = [
		join(GAMES_ROOT, gameId, 'online', 'index.html'),
		join(GAMES_ROOT, gameId, 'offline', 'index.html')
	];
	for (const p of htmlPaths) {
		if (!existsSync(p)) continue;
		const html = readText(p);
		if (/games\.poki\.com/i.test(html)) reasons.push(`shell:games.poki.com (${p.slice(GAMES_ROOT.length + 1)})`);
		if (/poki-sdk/i.test(html) && /poki\.com/i.test(html)) {
			reasons.push(`shell:poki-sdk (${p.slice(GAMES_ROOT.length + 1)})`);
		}
	}

	return reasons.length ? [...new Set(reasons)] : null;
}

function listGameDirs() {
	if (!existsSync(GAMES_ROOT)) return [];
	return readdirSync(GAMES_ROOT, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith('_'))
		.map((d) => d.name);
}

function archiveManifest(opts) {
	const src = join(DATA_DIR, 'poki-catalog.json');
	if (!existsSync(src)) return null;
	const dest = join(DATA_DIR, 'poki-catalog.json.deprecated');
	if (opts.dryRun) return { action: 'would-rename', from: src, to: dest };
	if (existsSync(dest)) {
		rmSync(dest, { force: true });
	}
	renameSync(src, dest);
	return { action: 'renamed', from: src, to: dest };
}

function removeOrQuarantine(gameId, opts) {
	const from = join(GAMES_ROOT, gameId);
	if (!existsSync(from)) return { action: 'missing' };
	if (opts.dryRun) return { action: opts.quarantine ? 'would-quarantine' : 'would-delete' };

	if (opts.quarantine) {
		mkdirSync(QUARANTINE_ROOT, { recursive: true });
		const to = join(QUARANTINE_ROOT, gameId);
		if (existsSync(to)) rmSync(to, { recursive: true, force: true });
		renameSync(from, to);
		return { action: 'quarantined', to };
	}

	rmSync(from, { recursive: true, force: true });
	return { action: 'deleted' };
}

function main() {
	const opts = parseArgv();
	if (opts.help) {
		console.log(`Usage:
  node scripts/purge-poki-catalog.mjs [--dry-run] [--quarantine]

Removes Poki catalog folders under static/games/ and archives
scripts/data/poki-catalog.json → poki-catalog.json.deprecated.
`);
		process.exit(0);
	}

	mkdirSync(DATA_DIR, { recursive: true });

	const matches = [];
	for (const id of listGameDirs()) {
		const reasons = isPokiGame(id);
		if (reasons) matches.push({ id, reasons });
	}

	console.log(`Found ${matches.length} Poki catalog entries.`);
	if (opts.dryRun) console.log('(dry-run — no files will be changed)');

	const results = [];
	for (const m of matches) {
		const op = removeOrQuarantine(m.id, opts);
		results.push({ ...m, ...op });
		if (results.length <= 10 || results.length % 100 === 0) {
			console.log(`   ${op.action}: ${m.id}`);
		}
	}

	const manifest = archiveManifest(opts);
	if (manifest) console.log(`Manifest: ${manifest.action} → ${manifest.to || ''}`);

	const report = {
		at: new Date().toISOString(),
		dryRun: opts.dryRun,
		quarantine: opts.quarantine,
		removed: results.length,
		manifest,
		games: results
	};
	writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
	console.log(`Wrote ${REPORT_PATH}`);
	console.log(`\nSummary: ${results.length} Poki games ${opts.dryRun ? 'would be removed' : 'removed'}.`);
	console.log('Next: node scripts/generate-games-list.js');
}

main();
