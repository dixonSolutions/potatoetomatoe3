#!/usr/bin/env node
/**
 * Static audit of static/games/<id>/offline/: zero-byte files, obvious broken refs in index.html.
 * Does not prove games "work" — use playwright-smoke-games.mjs against a running preview server.
 *
 * Usage: node scripts/audit-offline-mirrors.mjs [--json]
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';

/**
 * Root-absolute paths (`src="/UnityLoader.js"`) resolve against the site root, not the game folder.
 * If the file exists under offline/, the HTML should use a relative path (download-games-offline --deep-only rewrites this).
 */
function rootAbsoluteWhereFileExistsOffline(html, offlineDir) {
	const bad = [];
	const re = /(?:^|[\s>])(?:src|href)=(["'])\/([^"']+)\1/gi;
	let m;
	while ((m = re.exec(html)) !== null) {
		const relPath = m[2].trim();
		if (!relPath || relPath.startsWith('games/')) continue;
		const segments = relPath.split('/').filter(Boolean);
		if (segments.length === 0) continue;
		const localPath = join(offlineDir, ...segments);
		try {
			if (existsSync(localPath) && statSync(localPath).size > 0) {
				bad.push(relPath);
			}
		} catch {
			/* */
		}
	}
	return bad;
}
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = join(__dirname, '../static/games');

function walkFiles(dir, out = []) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const e of entries) {
		const p = join(dir, e.name);
		if (e.isDirectory()) walkFiles(p, out);
		else if (e.isFile()) out.push(p);
	}
	return out;
}

function localRefsFromHtml(html, baseDir) {
	const refs = [];
	/** Match real `src=` / `href=` attributes only — not `data-src`, `ng-src`, etc. */
	const re = /(?:^|[\s>])(?:src|href)=["']([^"']+)["']/gi;
	let m;
	while ((m = re.exec(html)) !== null) {
		const u = m[1].trim();
		if (!u || u.startsWith('data:') || u.startsWith('http') || u.startsWith('//')) continue;
		/** Site-root paths resolve against the server, not the offline folder */
		if (u.startsWith('/')) continue;
		if (u.startsWith('javascript:') || u === 'void(0)') continue;
		let clean = u.split('#')[0];
		const qi = clean.indexOf('?');
		if (qi >= 0) clean = clean.slice(0, qi);
		try {
			clean = decodeURIComponent(clean);
		} catch {
			/* keep */
		}
		if (!clean || clean.includes('://')) continue;
		refs.push(join(baseDir, clean));
	}
	return refs;
}

function auditGame(gameId) {
	const offlineDir = join(GAMES_ROOT, gameId, 'offline');
	const indexPath = join(offlineDir, 'index.html');
	const issues = { zeroByte: [], missingRef: [], rootAbsoluteFixable: [] };

	if (!existsSync(indexPath)) {
		return { gameId, skipped: true, reason: 'no offline/index.html' };
	}

	const files = walkFiles(offlineDir);
	for (const fp of files) {
		try {
			const st = statSync(fp);
			if (st.size === 0) issues.zeroByte.push(fp.replace(GAMES_ROOT + '/', 'static/games/'));
		} catch {
			/* */
		}
	}

	try {
		const html = readFileSync(indexPath, 'utf-8');
		for (const refAbs of localRefsFromHtml(html, offlineDir)) {
			if (!existsSync(refAbs)) {
				issues.missingRef.push(refAbs.replace(GAMES_ROOT + '/', 'static/games/'));
			}
		}
		issues.rootAbsoluteFixable = rootAbsoluteWhereFileExistsOffline(html, offlineDir);
	} catch {
		/* */
	}

	const bad =
		issues.zeroByte.length +
		issues.missingRef.length +
		issues.rootAbsoluteFixable.length;
	return { gameId, ok: bad === 0, issues };
}

function main() {
	const jsonOut = process.argv.includes('--json');
	const ids = readdirSync(GAMES_ROOT, { withFileTypes: true })
		.filter((d) => d.isDirectory() && !d.name.startsWith('_'))
		.map((d) => d.name);

	const results = [];
	let ok = 0;
	let problems = 0;

	for (const id of ids) {
		const r = auditGame(id);
		results.push(r);
		if (r.skipped) continue;
		if (r.ok) ok++;
		else problems++;
	}

	const report = {
		generatedAt: new Date().toISOString(),
		total: ids.length,
		withOfflineIndex: results.filter((r) => !r.skipped).length,
		clean: ok,
		withIssues: problems,
		results: results.filter((r) => !r.skipped && !r.ok)
	};

	if (jsonOut) {
		console.log(JSON.stringify(report, null, 2));
	} else {
		console.log(`Offline mirror audit (${report.withOfflineIndex} bundles)\n`);
		console.log(`  Clean: ${ok}`);
		console.log(`  With issues: ${problems}\n`);
		if (report.results.length) {
			for (const r of report.results.slice(0, 50)) {
				console.log(`❌ ${r.gameId}`);
				if (r.issues?.zeroByte?.length) console.log(`   0-byte: ${r.issues.zeroByte.slice(0, 5).join(', ')}${r.issues.zeroByte.length > 5 ? '…' : ''}`);
				if (r.issues?.missingRef?.length) console.log(`   missing: ${r.issues.missingRef.slice(0, 5).join(', ')}`);
				if (r.issues?.rootAbsoluteFixable?.length) {
					console.log(
						`   root /path but file offline (run pnpm run games:deep-all): ${r.issues.rootAbsoluteFixable.slice(0, 5).join(', ')}${r.issues.rootAbsoluteFixable.length > 5 ? '…' : ''}`
					);
				}
			}
			if (report.results.length > 50) console.log(`\n… and ${report.results.length - 50} more (use --json)`);
		}
	}

	process.exit(problems > 0 ? 2 : 0);
}

main();
