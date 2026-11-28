#!/usr/bin/env node
/**
 * Smoke test of the app shell in real Chromium: Home paints catalog cards, Games lists the
 * catalog, and a few game pages start their frame. Saves desktop and mobile screenshots so
 * UI milestones can be compared with the asks.
 *
 *   node scripts/smoke-home.mjs                       # starts its own Vite dev server
 *   node scripts/smoke-home.mjs --url http://127.0.0.1:5176 --out /tmp/shots
 *   node scripts/smoke-home.mjs --games slope,crazygames-fragen
 *
 * Prints one JSON line per check and exits non-zero when any check fails.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
	const i = process.argv.indexOf(name);
	return i > 0 ? process.argv[i + 1] : undefined;
};
const OUT = arg('--out') ?? path.join(ROOT, 'test-results', 'smoke-home');
const GAMES = (arg('--games') ?? '').split(',').filter(Boolean);
let BASE = arg('--url');
let server;

async function startServer() {
	const port = 5198;
	server = spawn(
		path.join(ROOT, 'node_modules/.bin/vite'),
		['dev', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
		{ cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
	);
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('Vite did not start in 120s')), 120000);
		server.stdout.on('data', (d) => {
			if (String(d).includes('Local:')) {
				clearTimeout(timer);
				resolve();
			}
		});
		server.on('exit', (code) => reject(new Error(`Vite exited (${code})`)));
	});
	return `http://127.0.0.1:${port}`;
}

const results = [];
function check(name, ok, detail = {}) {
	results.push({ name, ok, ...detail });
	console.log(JSON.stringify({ check: name, ok, ...detail }));
}

/** Links to game pages that show a loaded thumbnail. */
async function paintedCards(page) {
	return page.evaluate(() => {
		const links = [...document.querySelectorAll('a[href*="/games/"]')];
		const ids = new Set();
		let withImage = 0;
		for (const a of links) {
			const href = a.getAttribute('href') ?? '';
			const m = /\/games\/([^/?#]+)/.exec(href);
			if (!m) continue;
			ids.add(m[1]);
			const img = a.querySelector('img');
			if (img && img.complete && img.naturalWidth > 0) withImage++;
		}
		return { cards: ids.size, withImage };
	});
}

async function waitForCards(page, min, timeout) {
	const start = Date.now();
	let last = { cards: 0, withImage: 0 };
	while (Date.now() - start < timeout) {
		last = await paintedCards(page);
		if (last.cards >= min) return { ...last, ms: Date.now() - start };
		await page.waitForTimeout(100);
	}
	return { ...last, ms: -1 };
}

mkdirSync(OUT, { recursive: true });
if (!BASE) BASE = await startServer();
const browser = await chromium.launch({
	...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
	args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});

try {
	for (const [label, viewport, mobile] of [
		['desktop', { width: 1440, height: 900 }, false],
		['mobile', { width: 390, height: 844 }, true]
	]) {
		const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
		const page = await context.newPage();
		const errors = [];
		page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
		const t0 = Date.now();
		await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' });
		const home = await waitForCards(page, 6, 60000);
		await page.waitForTimeout(1500);
		const settled = await paintedCards(page);
		await page.screenshot({ path: path.join(OUT, `home-${label}.png`) });
		check(`home ${label}`, home.ms >= 0 && errors.length === 0, {
			firstCardsMs: home.ms,
			loadMs: Date.now() - t0,
			...settled,
			errors
		});

		/* Home search: looks like the Games box, opens Games with that box focused. */
		const search = page.getByTestId('home-search');
		const box = await search.boundingBox().catch(() => null);
		const header = await page
			.locator('header h1')
			.first()
			.boundingBox()
			.catch(() => null);
		await search.click();
		await page.waitForURL(/\/games\?focus=search/, { timeout: 15000 });
		const focused = await page
			.waitForFunction(
				() => document.activeElement?.getAttribute('data-testid') === 'games-search',
				null,
				{ timeout: 10000 }
			)
			.then(() => true)
			.catch(() => false);
		await page.keyboard.type('slope');
		const typed = await page.getByTestId('games-search').inputValue();
		await page.screenshot({ path: path.join(OUT, `search-focused-${label}.png`) });
		check(`home search ${label}`, Boolean(box) && focused && typed === 'slope', {
			box: box && { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width) },
			titleY: header && Math.round(header.y),
			focused,
			typed
		});

		await page.goto(`${BASE}/games`, { waitUntil: 'domcontentloaded' });
		const games = await waitForCards(page, 12, 60000);
		await page.waitForTimeout(1000);
		await page.screenshot({ path: path.join(OUT, `games-${label}.png`) });
		check(`games ${label}`, games.ms >= 0, { firstCardsMs: games.ms, cards: games.cards });
		await context.close();
	}

	/* Game pages: the frame must start and point somewhere real. */
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	let ids = GAMES;
	if (ids.length === 0) {
		const page = await context.newPage();
		await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' });
		await waitForCards(page, 6, 60000);
		ids = await page.evaluate(() =>
			[
				...new Set(
					[...document.querySelectorAll('a[href*="/games/"]')]
						.map((a) => /\/games\/([^/?#]+)/.exec(a.getAttribute('href') ?? '')?.[1])
						.filter(Boolean)
				)
			].slice(0, 3)
		);
		await page.close();
	}
	for (const id of ids) {
		const page = await context.newPage();
		const errors = [];
		page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
		const t0 = Date.now();
		await page.goto(`${BASE}/games/${id}`, { waitUntil: 'domcontentloaded' });
		let src = '';
		const deadline = Date.now() + 45000;
		while (Date.now() < deadline) {
			src = await page.evaluate(
				() => [...document.querySelectorAll('iframe')].map((f) => f.src).find(Boolean) ?? ''
			);
			if (src) break;
			await page.waitForTimeout(200);
		}
		const frameMs = src ? Date.now() - t0 : -1;
		await page.waitForTimeout(6000);
		await page.screenshot({ path: path.join(OUT, `game-${id}.png`) });
		check(`game ${id}`, Boolean(src), { frameMs, src: src.slice(0, 140), errors });
		await page.close();
	}
	await context.close();
} finally {
	await browser.close();
	if (server) server.kill('SIGTERM');
}

const failed = results.filter((r) => !r.ok);
console.log(
	`SMOKE ${results.length - failed.length}/${results.length} passed; screenshots in ${OUT}`
);
process.exit(failed.length ? 1 : 0);
