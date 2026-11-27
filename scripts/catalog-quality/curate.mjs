#!/usr/bin/env node
/**
 * Act on the quality verdicts: replace broken/test games that have a working copy of the
 * same game from a better source, remove the rest (see scripts/lib/catalog-curation.mjs).
 *
 * Reads scripts/data/games-metadata.json and scripts/data/catalog-quality.json. Always writes
 * the report (scripts/data/catalog-curation-report.md, or --report path); with --apply it also
 * writes scripts/data/catalog-curation.json, which generate-games-list.js / reindex leave out
 * of the index (and emit aliases.json from) and the importers skip.
 *
 * Usage:
 *   node scripts/catalog-quality/curate.mjs                # dry run + report
 *   node scripts/catalog-quality/curate.mjs --apply        # write the denylist + aliases
 *   node scripts/catalog-quality/curate.mjs --report out.md --max-share 0.2
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { curateCatalog, toCurationFile } from '../lib/catalog-curation.mjs';
import { CURATION_PATH, KEEP_IDS } from '../lib/catalog-quality.mjs';
import { DATA_DIR, QUALITY_PATH, loadCatalog, portalOf } from './lib.mjs';

const arg = (name, fallback) => {
	const i = process.argv.indexOf(name);
	return i > 0 ? process.argv[i + 1] : fallback;
};
const APPLY = process.argv.includes('--apply');
const REPORT = arg('--report', join(DATA_DIR, 'catalog-curation-report.md'));
const MAX_SHARE = Number(arg('--max-share', '0.2'));

const games = loadCatalog();
const quality = JSON.parse(readFileSync(QUALITY_PATH, 'utf8'));
const plan = curateCatalog(games, quality.games, { keepIds: KEEP_IDS, maxRemoveShare: MAX_SHARE });
const byId = new Map(games.map((g) => [g.id, g]));
const label = (id) => {
	const g = byId.get(id);
	return `${(g?.name ?? id).replace(/\|/g, '/')} (\`${id}\`, ${portalOf(g ?? {})})`;
};
const count = (list, key) =>
	Object.entries(list.reduce((m, r) => ((m[key(r)] = (m[key(r)] ?? 0) + 1), m), {})).sort(
		(a, b) => b[1] - a[1]
	);
const previous = existsSync(CURATION_PATH) ? JSON.parse(readFileSync(CURATION_PATH, 'utf8')) : null;
const prevIds = new Set(Object.keys(previous?.removed ?? {}));
const nextIds = new Set([...plan.remove, ...plan.replace].map((r) => r.id));
const added = [...nextIds].filter((id) => !prevIds.has(id));
const restored = [...prevIds].filter((id) => !nextIds.has(id));

const lines = [
	'# Catalog curation report',
	'',
	`Generated ${new Date().toISOString()} from catalog-quality.json of ${quality.generatedAt}. ${APPLY && !plan.aborted ? 'Applied.' : 'Dry run.'}`,
	'',
	'| | games |',
	'|---|---:|',
	`| catalog | ${games.length} |`,
	`| kept | ${plan.keep} |`,
	`| replaced by a working copy | ${plan.replace.length} |`,
	`| removed (no working copy) | ${plan.remove.length} |`,
	`| newly dropped vs last curation | ${added.length} |`,
	`| restored vs last curation | ${restored.length} |`,
	'',
	plan.aborted ? `**Aborted:** ${plan.aborted}. Nothing written.\n` : '',
	'## By reason',
	'',
	'| reason | replaced | removed |',
	'|---|---:|---:|',
	...[...new Set([...plan.replace, ...plan.remove].map((r) => r.reason))].map(
		(reason) =>
			`| ${reason} | ${plan.replace.filter((r) => r.reason === reason).length} | ${plan.remove.filter((r) => r.reason === reason).length} |`
	),
	'',
	'## Removed by portal',
	'',
	...count(plan.remove, (r) => portalOf(byId.get(r.id) ?? {})).map(([p, n]) => `- ${p}: ${n}`),
	'',
	'## Replacements (first 40)',
	'',
	...plan.replace.slice(0, 40).map((r) => `- ${label(r.id)} → ${label(r.by)} — ${r.reason}`),
	'',
	'## Removals (every 25th)',
	'',
	...plan.remove.filter((_, i) => i % 25 === 0).map((r) => `- ${label(r.id)} — ${r.reason}`),
	'',
	'## Diff vs last curation',
	'',
	`Dropped now: ${added.slice(0, 60).join(', ') || 'none'}${added.length > 60 ? ` … (+${added.length - 60})` : ''}`,
	'',
	`Restored: ${restored.slice(0, 60).join(', ') || 'none'}${restored.length > 60 ? ` … (+${restored.length - 60})` : ''}`,
	''
];
writeFileSync(REPORT, lines.join('\n'));
if (APPLY && !plan.aborted) {
	writeFileSync(CURATION_PATH, JSON.stringify(toCurationFile(plan), null, 1) + '\n');
}
console.log(
	JSON.stringify({
		catalog: games.length,
		keep: plan.keep,
		replace: plan.replace.length,
		remove: plan.remove.length,
		added: added.length,
		restored: restored.length,
		aborted: plan.aborted ?? null,
		applied: APPLY && !plan.aborted,
		report: REPORT
	})
);
if (plan.aborted) process.exitCode = 2;
