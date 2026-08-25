#!/usr/bin/env node

/**
 * Repair embed URLs already written into the catalog.
 *
 * Portal importers historically built absolute URLs by string concatenation, which
 * produced three classes of unlaunchable embeds:
 *
 *   - doubled hosts   `https://www.addictinggames.com//cdn2.addictinggames.com/…`
 *   - mixed content   `http://cdn2.addictinggames.com/…` (blocked inside an https app)
 *   - dead hosts      `https://prod.addictinggames.comundefined`
 *
 * `normalizeEmbedUrl` is the same helper the importers now use, so a repaired
 * catalog and a freshly imported one converge on identical URLs.
 *
 * Usage:
 *   node scripts/repair-catalog-embed-urls.mjs            # report only
 *   node scripts/repair-catalog-embed-urls.mjs --write     # rewrite metadata + shells
 *   node scripts/repair-catalog-embed-urls.mjs --write --prune-unrecoverable
 */

import { readdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { normalizeEmbedUrl } from './lib/game-shell.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = join(__dirname, '..', 'static', 'games');

/** Embed fields that feed the iframe src, in the order the app prefers them. */
const EMBED_FIELDS = ['onlineEmbedUrl', 'remotePlayUrl'];

function parseArgv() {
	const args = process.argv.slice(2);
	return {
		write: args.includes('--write'),
		pruneUnrecoverable: args.includes('--prune-unrecoverable')
	};
}

function metadataPathFor(gameId) {
	const candidates = [
		join(GAMES_ROOT, gameId, 'online', 'metadata.json'),
		join(GAMES_ROOT, gameId, 'shared', 'metadata.json'),
		join(GAMES_ROOT, gameId, 'metadata.json')
	];
	return candidates.find((candidate) => existsSync(candidate)) || null;
}

/**
 * Recover the real target from a URL the importer glued onto a portal origin.
 *
 * Two concatenation shapes appear in the catalog, both hiding a working CDN URL
 * behind the portal origin:
 *   `https://portal//cdn.host/path`        (protocol-relative embed)
 *   `https://portal/ https://cdn.host/…`   (embed with leading whitespace)
 *
 * @param {string} rawUrl
 * @returns {string} The inner target URL when one is present, else the input.
 */
function extractEmbeddedTargetUrl(rawUrl) {
	/* A second absolute URL anywhere in the string is always the intended target. */
	const absoluteMatches = rawUrl.match(/https?:\/\/[^\s"']+/gi);
	if (absoluteMatches && absoluteMatches.length > 1) {
		return absoluteMatches[absoluteMatches.length - 1];
	}

	const doubledHost = rawUrl.match(/^https?:\/\/[^/]+\/\/((?:[a-z0-9-]+\.)+[a-z]{2,}\/.*)$/i);
	return doubledHost ? `https://${doubledHost[1]}` : rawUrl;
}

function repairGame(gameId, opts) {
	const metaPath = metadataPathFor(gameId);
	if (!metaPath) return null;

	let metadata;
	try {
		metadata = JSON.parse(readFileSync(metaPath, 'utf-8'));
	} catch {
		return { gameId, status: 'unreadable' };
	}

	const changes = [];
	let unrecoverable = false;

	for (const field of EMBED_FIELDS) {
		const original = metadata[field];
		if (typeof original !== 'string' || !original.trim()) continue;

		const normalized = normalizeEmbedUrl(extractEmbeddedTargetUrl(original.trim()));
		if (!normalized) {
			unrecoverable = true;
			changes.push({ field, from: original, to: null });
			continue;
		}
		if (normalized !== original) {
			metadata[field] = normalized;
			changes.push({ field, from: original, to: normalized });
		}
	}

	if (!changes.length) return null;

	if (unrecoverable) {
		if (opts.write && opts.pruneUnrecoverable) {
			rmSync(join(GAMES_ROOT, gameId), { recursive: true, force: true });
		}
		return { gameId, status: 'unrecoverable', changes };
	}

	if (opts.write) {
		writeFileSync(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');

		/* The online shell iframes the same URL, so it must move in lockstep. */
		const shellPath = join(GAMES_ROOT, gameId, 'online', 'index.html');
		if (existsSync(shellPath) && metadata.onlineEmbedUrl) {
			const shell = readFileSync(shellPath, 'utf-8');
			for (const { from, to } of changes) {
				if (to && shell.includes(from)) {
					writeFileSync(shellPath, shell.split(from).join(to), 'utf-8');
					break;
				}
			}
		}
	}

	return { gameId, status: 'repaired', changes };
}

function main() {
	const opts = parseArgv();
	if (!existsSync(GAMES_ROOT)) {
		console.error(`Catalog not found: ${GAMES_ROOT}`);
		process.exit(1);
	}

	const gameIds = readdirSync(GAMES_ROOT, { withFileTypes: true })
		.filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith('_'))
		.map((dirent) => dirent.name);

	const repaired = [];
	const unrecoverable = [];

	for (const gameId of gameIds) {
		const result = repairGame(gameId, opts);
		if (!result) continue;
		if (result.status === 'repaired') repaired.push(result);
		else if (result.status === 'unrecoverable') unrecoverable.push(result);
	}

	const mode = opts.write ? 'WRITE' : 'DRY RUN';
	console.log(`[${mode}] scanned ${gameIds.length} catalog directories`);
	console.log(`  repaired:      ${repaired.length}`);
	console.log(`  unrecoverable: ${unrecoverable.length}`);

	for (const entry of repaired.slice(0, 5)) {
		const change = entry.changes[0];
		console.log(`    ${entry.gameId}\n      ${change.from}\n   -> ${change.to}`);
	}
	for (const entry of unrecoverable) {
		const verb = opts.write && opts.pruneUnrecoverable ? 'removed' : 'needs removal';
		console.log(`    ${entry.gameId} (${verb}): ${entry.changes[0].from}`);
	}

	if (!opts.write) {
		console.log('\nRe-run with --write to apply, then regenerate the catalog.');
	}
}

main();
