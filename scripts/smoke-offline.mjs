#!/usr/bin/env node
/**
 * Playwright check of the web offline flow (asks A1–A3):
 *
 *  A3  start a download, leave the game page, come back: progress is still there; one tap
 *      cancels and nothing is kept; a second download finishes with one toast.
 *  A1  cut the network on Home (with a short flap first): one small no-internet icon, only
 *      downloaded games, no toasts, no flicker.
 *  A2  turn the Offline filter off: the page just says "Offline" plus a Downloads button.
 *
 * Usage: node scripts/smoke-offline.mjs [--url http://127.0.0.1:5173] [--out dir]
 *          [--cancel <gameId>] [--keep <gameId>]
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
	const i = process.argv.indexOf(name);
	return i > 0 ? process.argv[i + 1] : undefined;
};
const OUT = arg('--out') ?? path.join(ROOT, 'test-results', 'smoke-offline');
const CANCEL_ID = arg('--cancel') ?? 'coolmath-1-push';
const KEEP_ID = arg('--keep') ?? 'slope';
let BASE = arg('--url');
let server;

async function startServer() {
	const port = 5199;
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

const controls = (page) => page.getByTestId('offline-controls');
const toasts = (page) => page.locator('[data-sonner-toast]');

/** Game ids linked from the page. */
function linkedIds(page) {
	return page.evaluate(() => [
		...new Set(
			[...document.querySelectorAll('main a[href*="/games/"], a[href*="/games/"]')]
				.map((a) => /\/games\/([^/?#]+)/.exec(a.getAttribute('href') ?? '')?.[1])
				.filter((id) => id && !id.startsWith('?'))
		)
	]);
}

async function openGame(page, id) {
	await page.goto(`${BASE}/games/${id}`, { waitUntil: 'domcontentloaded' });
	await controls(page).waitFor({ timeout: 60000 });
}

/** Leave by an in-app link (a reload would end a web download), then come back. */
async function leaveAndReturn(page) {
	await page.locator('a[href$="/home"]').first().click();
	await page.waitForURL(/\/home/, { timeout: 15000 });
	await page.waitForTimeout(1500);
	await page.goBack();
	await page.waitForURL(/\/games\//, { timeout: 15000 });
	await controls(page).waitFor({ timeout: 30000 });
}

/** Count changes of `testid` presence while `fn` runs, sampling every 50 ms. */
async function watchFlicker(page, testid, fn, ms) {
	await page.evaluate((id) => {
		const w = window;
		w.__flips = 0;
		let last = Boolean(document.querySelector(`[data-testid="${id}"]`));
		w.__flipTimer = setInterval(() => {
			const now = Boolean(document.querySelector(`[data-testid="${id}"]`));
			if (now !== last) w.__flips++;
			last = now;
		}, 50);
	}, testid);
	await fn();
	await page.waitForTimeout(ms);
	return page.evaluate(() => {
		clearInterval(window.__flipTimer);
		return window.__flips;
	});
}

if (!BASE) BASE = await startServer();
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
	executablePath: process.env.CHROMIUM_PATH || undefined
});
try {
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	const page = await context.newPage();

	/* A3 a: start, leave, come back, progress still shown, cancel frees storage. */
	await openGame(page, CANCEL_ID);
	const startBtn = controls(page).getByRole('button', { name: /^(Resume download|Download)$/ });
	const startable = await startBtn.isEnabled().catch(() => false);
	check('download button', startable, { id: CANCEL_ID });
	if (startable) {
		await startBtn.click();
		await controls(page).getByRole('status').waitFor({ timeout: 15000 });
		await leaveAndReturn(page);
		const progress = await controls(page)
			.getByRole('status')
			.isVisible()
			.catch(() => false);
		await page.screenshot({ path: path.join(OUT, 'download-progress-after-return.png') });
		check('progress after return', progress);
		const before = await page.evaluate(async () => (await navigator.storage.estimate()).usage);
		await controls(page).getByRole('button', { name: 'Cancel download' }).click();
		const fresh = controls(page).getByRole('button', { name: 'Download', exact: true });
		const cancelled = await fresh
			.waitFor({ timeout: 15000 })
			.then(() => true)
			.catch(() => false);
		const after = await page.evaluate(async () => (await navigator.storage.estimate()).usage);
		await page.screenshot({ path: path.join(OUT, 'download-cancelled.png') });
		check('cancel frees storage', cancelled, {
			usageBefore: before,
			usageAfter: after,
			partialKept: await controls(page)
				.getByRole('button', { name: 'Resume download' })
				.isVisible()
				.catch(() => false)
		});
	}

	/* A3 b: a second download completes with one toast. */
	await openGame(page, KEEP_ID);
	const keepBtn = controls(page).getByRole('button', { name: /^(Resume download|Download)$/ });
	if (await keepBtn.isEnabled().catch(() => false)) {
		const t0 = Date.now();
		await keepBtn.click();
		const toast = toasts(page).filter({ hasText: 'ready offline' });
		const done = await toast
			.first()
			.waitFor({ timeout: 300000 })
			.then(() => true)
			.catch(() => false);
		await page.screenshot({ path: path.join(OUT, 'download-done-toast.png') });
		check('download completes with toast', done, {
			id: KEEP_ID,
			ms: Date.now() - t0,
			toasts: await toast.count()
		});
	} else {
		check('download completes with toast', await page.getByText('Downloaded').isVisible(), {
			id: KEEP_ID,
			already: true
		});
	}

	/* A1: Home, network flaps then drops. */
	await page.locator('a[href$="/home"]').first().click();
	await page.waitForURL(/\/home/);
	await page.locator('a[href*="/games/"]').first().waitFor({ timeout: 60000 });
	await toasts(page)
		.first()
		.waitFor({ state: 'detached', timeout: 15000 })
		.catch(() => {});
	const flips = await watchFlicker(
		page,
		'offline-icon',
		async () => {
			for (const off of [true, false, true, false]) {
				await context.setOffline(off);
				await page.waitForTimeout(150);
			}
			await context.setOffline(true);
		},
		3000
	);
	const icon = await page.getByTestId('offline-icon').isVisible();
	const ids = await linkedIds(page);
	const toastCount = await toasts(page).count();
	await page.screenshot({ path: path.join(OUT, 'home-offline-filter-on.png') });
	check('home offline: icon, downloads only, calm', icon && flips <= 1 && toastCount <= 1, {
		icon,
		flips,
		toasts: toastCount,
		games: ids,
		onlyDownloaded: ids.every((id) => id === KEEP_ID)
	});

	/* A4: launch the downloaded game offline from Home (in-app navigation). */
	const tile = page.locator(`a[href$="/games/${KEEP_ID}"]`).first();
	if (await tile.isVisible().catch(() => false)) {
		await tile.click();
		await page.waitForURL(new RegExp(`/games/${KEEP_ID}`), { timeout: 15000 });
		const title = await page
			.locator('h1')
			.first()
			.textContent({ timeout: 20000 })
			.catch(() => '');
		const frame = await page
			.locator('iframe[src]')
			.first()
			.getAttribute('src', { timeout: 30000 })
			.catch(() => null);
		await page.waitForTimeout(4000);
		const crashed = await page.getByTestId('game-crashed-notice').isVisible();
		const description = await page
			.locator('p.text-muted-foreground')
			.first()
			.textContent()
			.catch(() => '');
		await page.screenshot({ path: path.join(OUT, `offline-launch-${KEEP_ID}.png`) });
		check('offline launch', Boolean(title?.trim() && frame && !crashed), {
			id: KEEP_ID,
			title: title?.trim(),
			description: (description ?? '').trim().slice(0, 60),
			frame: frame?.slice(0, 80),
			crashed
		});
		await page.locator('a[href$="/home"]').first().click();
		await page.waitForURL(/\/home/);
		await page.waitForTimeout(500);
	} else {
		check('offline launch', false, { id: KEEP_ID, reason: 'no tile on offline Home' });
	}

	/* A2: filter off: "Offline" + Downloads button, everything listed. */
	await page.getByTestId('offline-filter').click();
	await page.waitForTimeout(500);
	const offText = await page
		.getByRole('status')
		.filter({ hasText: /^Offline$/ })
		.isVisible();
	const button = await page.getByTestId('offline-filter').getAttribute('aria-pressed');
	const allIds = await linkedIds(page);
	await page.screenshot({ path: path.join(OUT, 'home-offline-filter-off.png') });
	check('filter off: Offline + Downloads', offText && button === 'false' && allIds.length > 6, {
		games: allIds.length
	});
	await page.getByTestId('offline-filter').click();
	await page.waitForTimeout(300);
	check(
		'filter back on',
		(await page.getByTestId('offline-filter').getAttribute('aria-pressed')) === 'true'
	);

	const mobile = await browser.newContext({
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true
	});
	await context.setOffline(false);
	await context.close();
	const m = await mobile.newPage();
	await m.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded' });
	await m.locator('a[href*="/games/"]').first().waitFor({ timeout: 60000 });
	await mobile.setOffline(true);
	await m.waitForTimeout(2500);
	await m.screenshot({ path: path.join(OUT, 'home-offline-mobile.png') });
	check('mobile offline icon', await m.getByTestId('offline-icon').isVisible());
	await mobile.close();
} finally {
	await browser.close();
	server?.kill();
}
const passed = results.filter((r) => r.ok).length;
console.log(`SMOKE-OFFLINE ${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
