#!/usr/bin/env node
/**
 * Headless smoke: open each /games/<id> page, wait for iframe or canvas, collect console errors.
 * Requires a running server: `pnpm run build && pnpm exec vite preview --port 4173`
 *   then: PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 node scripts/playwright-smoke-games.mjs [--limit N] [gameId …]
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const BASE = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4173';
const NAV_TIMEOUT = 45_000;
const AFTER_MS = 12_000;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const limitArg = argv.findIndex((a) => a === '--limit');
let limit = Infinity;
if (limitArg >= 0 && argv[limitArg + 1]) {
	limit = parseInt(argv[limitArg + 1], 10);
	argv.splice(limitArg, 2);
}
const idFilter = argv.filter((a) => a !== '--limit');

const listPath = join(root, 'static/games/games-list.json');
let ids = JSON.parse(readFileSync(listPath, 'utf-8'));
if (idFilter.length) ids = ids.filter((id) => idFilter.includes(id));
ids = ids.slice(0, limit);

async function smokeOne(context, gameId) {
	const page = await context.newPage();
	const consoleErrors = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') consoleErrors.push(msg.text());
	});
	page.on('pageerror', (e) => consoleErrors.push(String(e.message)));

	const url = `${BASE}/games/${encodeURIComponent(gameId)}`;
	try {
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
		await delay(AFTER_MS);
		const iframe = await page.locator('iframe').count();
		const canvas = await page.locator('canvas').count();
		const hasShell = iframe > 0 || canvas > 0;
		const bad = consoleErrors.filter(
			(t) => /404|failed to load|net::ERR/i.test(t) && !/favicon|analytics/i.test(t)
		);
		await page.close();
		return { gameId, ok: hasShell && bad.length === 0, iframe, canvas, errors: bad.slice(0, 8) };
	} catch (e) {
		await page.close().catch(() => {});
		return { gameId, ok: false, error: String(e.message).slice(0, 200) };
	}
}

async function main() {
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

	const failed = [];
	let passed = 0;

	console.log(`Smoke ${ids.length} game(s) at ${BASE}\n`);

	for (let i = 0; i < ids.length; i++) {
		const id = ids[i];
		const r = await smokeOne(context, id);
		if (r.ok) {
			passed++;
			process.stdout.write(`\r✓ ${i + 1}/${ids.length} ${id}`.padEnd(80));
		} else {
			failed.push(r);
			console.log(`\n❌ ${id}`, r.error || r.errors || 'no iframe/canvas');
		}
	}

	await browser.close();

	console.log(`\n\nDone: ${passed} passed, ${failed.length} failed / ${ids.length} total`);
	if (failed.length) process.exit(2);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
