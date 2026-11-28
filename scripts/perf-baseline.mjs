#!/usr/bin/env node
/**
 * Cold-cache web baseline: serves ./build (SPA fallback) and loads /games and /home in
 * headless Chromium with a fresh context (empty HTTP cache, no service worker, no storage).
 * Prints JSON: first paint, first contentful paint, DOM cards, first image decoded, all
 * visible images decoded, request count and transferred bytes.
 *
 *   node scripts/perf-baseline.mjs [route ...]     (default: /games /home) -- needs `pnpm build` first
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = path.resolve('build');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
	'.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
	const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
	for (const f of [url, url + '.html', url + '/index.html', '/index.html']) {
		const p = path.join(root, f);
		if (!p.startsWith(root)) continue;
		try {
			if ((await stat(p)).isFile()) {
				res.setHeader('content-type', types[path.extname(p)] ?? 'application/octet-stream');
				return res.end(await readFile(p));
			}
		} catch {}
	}
	res.statusCode = 404; res.end();
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
const routes = process.argv.slice(2).length ? process.argv.slice(2) : ['/games', '/home'];
const browser = await chromium.launch();
const out = {};
for (const route of routes) {
	const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 800 } });
	const page = await ctx.newPage();
	let reqs = 0, bytes = 0;
	page.on('response', async (r) => { reqs++; try { bytes += (await r.body()).length; } catch {} });
	const t0 = Date.now();
	await page.goto(base + route, { waitUntil: 'commit' });
	const card = 'a[href*="/games/"] img';
	await page.waitForSelector(card, { timeout: 60000 }).catch(() => {});
	const firstImgMs = Date.now() - t0;
	/* On screen in both directions: Home rows scroll sideways, and lazy covers past the right edge never load. */
	const onScreen = (sel) => [...document.querySelectorAll(sel)].filter((x) => { const r = x.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && r.width > 0; });
	await page.waitForFunction(({ sel, fn }) => {
		const i = new Function('return ' + fn)()(sel);
		return i.length > 0 && i.every((x) => x.complete);
	}, { sel: card, fn: onScreen.toString() }, { timeout: 60000 }).catch(() => {});
	const allImgMs = Date.now() - t0;
	const m = await page.evaluate(() => {
		const paint = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]));
		const imgs = [...document.querySelectorAll('a[href*="/games/"] img')];
			const cards = document.querySelectorAll('a[href*="/games/"]').length;
		const visible = imgs.filter((x) => { const r = x.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && r.width > 0; });
		const stuck = visible.filter((x) => !x.complete).map((x) => x.currentSrc || x.src).slice(0, 5);
		return { paint, cardLinks: cards, domImages: imgs.length, imagesComplete: imgs.filter((x) => x.complete && x.naturalWidth).length,
			onScreenImages: visible.length, onScreenIncomplete: stuck,
			domNodes: document.getElementsByTagName('*').length };
	});
	out[route] = { finalUrl: page.url(), title: (await page.locator('body').innerText()).slice(0,80).replace(/\s+/g,' '), ...m, firstCardImgInDomMs: firstImgMs, viewportCardImagesCompleteMs: allImgMs, requests: reqs, bytes };
	await ctx.close();
}
await browser.close(); server.close();
console.log(JSON.stringify(out, null, 2));
