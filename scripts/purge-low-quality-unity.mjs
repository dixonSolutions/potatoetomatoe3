#!/usr/bin/env node
/**
 * Purge low-quality Unity Play catalog entries from static/games/.
 *
 * Uses scripts/data/unity-play-catalog.json plays/likes + title heuristics.
 * Keeps shrek-* and non-unity-play games.
 *
 * Usage:
 *   node scripts/purge-low-quality-unity.mjs --dry-run
 *   node scripts/purge-low-quality-unity.mjs
 *   node scripts/purge-low-quality-unity.mjs --min-plays 100 --quarantine
 */

import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	mkdirSync,
	renameSync,
	writeFileSync
} from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { assessUnityPlayQuality, KEEP_IDS } from './lib/catalog-quality.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const GAMES_ROOT = join(ROOT, 'static/games');
const DATA_DIR = join(__dirname, 'data');
const MANIFEST_PATH = join(DATA_DIR, 'unity-play-catalog.json');
const QUARANTINE_ROOT = join(GAMES_ROOT, '_purged-unity-low-quality');
const REPORT_PATH = join(DATA_DIR, 'unity-quality-purge-report.json');

function parseArgv() {
	const a = process.argv.slice(2);
	const num = (flag, fallback) => {
		const i = a.indexOf(flag);
		return i >= 0 && a[i + 1] ? parseInt(a[i + 1], 10) : fallback;
	};
	return {
		dryRun: a.includes('--dry-run'),
		quarantine: a.includes('--quarantine'),
		minPlays: num('--min-plays', 100),
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

function listGameDirs() {
	if (!existsSync(GAMES_ROOT)) return [];
	return readdirSync(GAMES_ROOT, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith('_'))
		.map((d) => d.name);
}

function loadManifestIndex() {
	const man = readJson(MANIFEST_PATH);
	const byId = new Map();
	const bySlug = new Map();
	for (const g of man?.games || []) {
		byId.set(String(g.id).toLowerCase(), g);
		if (g.slug) bySlug.set(String(g.slug).toLowerCase(), g);
	}
	return { byId, bySlug, count: man?.games?.length || 0 };
}

function isUnityPlayGame(gameId) {
	const metaPaths = [
		join(GAMES_ROOT, gameId, 'online', 'metadata.json'),
		join(GAMES_ROOT, gameId, 'shared', 'metadata.json')
	];
	for (const p of metaPaths) {
		const meta = readJson(p);
		if (!meta) continue;
		if (String(meta.sourcePortal || '').toLowerCase() === 'unity-play') return meta;
		if (meta.unityPlayGameId) return meta;
		if (String(meta.engine || '').toLowerCase() === 'unity' && meta.onlineEmbedUrl?.includes('play.unity.com')) {
			return meta;
		}
	}
	return null;
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
  node scripts/purge-low-quality-unity.mjs [--dry-run] [--quarantine] [--min-plays N]
`);
		process.exit(0);
	}

	if (!existsSync(MANIFEST_PATH)) {
		console.error(`Missing ${MANIFEST_PATH}. Run: pnpm games:import-unity-play -- --discover-only`);
		process.exit(1);
	}

	const { byId, bySlug, count } = loadManifestIndex();
	console.log(`Loaded Unity Play manifest (${count} games). minPlays=${opts.minPlays}`);

	const matches = [];
	const reasonCounts = {};

	for (const id of listGameDirs()) {
		if (KEEP_IDS.has(id)) continue;
		const meta = isUnityPlayGame(id);
		if (!meta) continue;

		const unityId = String(meta.unityPlayGameId || '').toLowerCase();
		const man =
			(unityId && byId.get(unityId)) ||
			bySlug.get(id.toLowerCase()) ||
			bySlug.get(String(meta.id || '').toLowerCase());

		const probe = {
			name: man?.name || meta.name || id,
			description: man?.description || meta.description || '',
			plays: man?.plays ?? 0,
			titleKey: man?.titleKey
		};

		// If not in manifest, treat missing plays as low quality unless name looks fine and we keep unknowns.
		const assessment = man
			? assessUnityPlayQuality(probe, { minPlays: opts.minPlays })
			: assessUnityPlayQuality({ ...probe, plays: 0 }, { minPlays: opts.minPlays });

		if (!assessment.ok) {
			reasonCounts[assessment.reason] = (reasonCounts[assessment.reason] || 0) + 1;
			matches.push({
				id,
				reason: assessment.reason,
				plays: probe.plays,
				name: probe.name,
				unityPlayGameId: man?.id || meta.unityPlayGameId || null
			});
		}
	}

	console.log(`Found ${matches.length} low-quality Unity Play entries to remove.`);
	console.log('Reasons:', reasonCounts);
	if (opts.dryRun) console.log('(dry-run — no files will be changed)');

	const results = [];
	for (const m of matches) {
		const action = removeOrQuarantine(m.id, opts);
		results.push({ ...m, ...action });
		if (!opts.dryRun) process.stdout.write(`\r  ${action.action}: ${m.id}`.padEnd(80));
	}
	if (!opts.dryRun) console.log('');

	mkdirSync(DATA_DIR, { recursive: true });
	writeFileSync(
		REPORT_PATH,
		`${JSON.stringify(
			{
				at: new Date().toISOString(),
				minPlays: opts.minPlays,
				dryRun: opts.dryRun,
				quarantine: opts.quarantine,
				reasonCounts,
				count: matches.length,
				results
			},
			null,
			2
		)}\n`,
		'utf-8'
	);
	console.log(`Wrote ${REPORT_PATH}`);
}

main();
