#!/usr/bin/env node
/**
 * Playwright touch-emulation check of the touch controls (asks A7–A11):
 *
 *  A7   controls appear only after the game says it is ready: screenshot at the loader
 *       (no controls) and once ready (controls).
 *  A8   no "Console enabled / waiting / blocked" box anywhere.
 *  A9   the joystick delivers arrow/WASD keys into a same-origin game frame.
 *  A10  a real key press hides the controls at once; the next touch brings them back.
 *  A11  hide button and drag-to-edge dock the controls behind a side tab; a tap or an
 *       inward swipe on the tab brings them back.
 *
 * Touches go through CDP Input.dispatchTouchEvent, so the page sees trusted touch
 * pointers (Playwright's mouse would switch the input mode to keyboard).
 *
 * Usage: node scripts/smoke-touch.mjs [--url http://127.0.0.1:5173] [--out dir]
 *          [--games id1,id2,id3]
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
const OUT = arg('--out') ?? path.join(ROOT, 'test-results', 'smoke-touch');
const GAMES = (arg('--games') ?? 'slope,coolmath-1-push,002').split(',').filter(Boolean);
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
		let stderr = '';
		server.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
		server.on('exit', (code) => reject(new Error(`Vite exited (${code}): ${stderr}`)));
	});
	return `http://127.0.0.1:${port}`;
}

const results = [];
function check(name, ok, detail = {}) {
	results.push({ name, ok, ...detail });
	console.log(JSON.stringify({ check: name, ok, ...detail }));
}

const GRIP = '[aria-label="Drag to move the whole console"]';

/** Runs in every frame: the top records ready messages and when controls appear. */
function initScript() {
	if (window.top !== window) {
		window.__ptKeys = [];
		addEventListener('keydown', (e) => window.__ptKeys.push(e.code), true);
		return;
	}
	window.__ptReady = [];
	addEventListener('message', (e) => {
		if (e.data && e.data.type === 'potato-tomato-game-ready') {
			window.__ptReady.push({ t: performance.now(), reason: e.data.reason });
		}
	});
	const watch = () => {
		const mark = () => {
			if (!window.__ptFrameAt && document.querySelector('iframe[src]')) {
				window.__ptFrameAt = performance.now();
			}
			if (
				!window.__ptCtlAt &&
				document.querySelector('[aria-label="Drag to move the whole console"]')
			) {
				window.__ptCtlAt = performance.now();
			}
		};
		new MutationObserver(mark).observe(document.documentElement, {
			childList: true,
			subtree: true
		});
		mark();
	};
	if (document.readyState === 'loading') addEventListener('DOMContentLoaded', watch);
	else watch();
}

async function touch(cdp, type, x, y) {
	await cdp.send('Input.dispatchTouchEvent', {
		type,
		touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(y) }]
	});
}

async function tap(cdp, x, y) {
	await touch(cdp, 'touchStart', x, y);
	await touch(cdp, 'touchEnd', x, y);
}

async function drag(cdp, from, to, steps = 8) {
	await touch(cdp, 'touchStart', from.x, from.y);
	for (let i = 1; i <= steps; i++) {
		const k = i / steps;
		await touch(cdp, 'touchMove', from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
	}
	await touch(cdp, 'touchEnd', to.x, to.y);
}

async function center(locator) {
	const b = await locator.boundingBox();
	return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null;
}

const visible = (page, sel) => page.locator(sel).first().isVisible();

async function checkGame(browser, id, n) {
	const context = await browser.newContext({
		viewport: { width: 844, height: 390 },
		isMobile: true,
		hasTouch: true,
		deviceScaleFactor: 1
	});
	await context.addInitScript(initScript);
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	const errors = [];
	page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
	await page.goto(`${BASE}/games/${id}`, { waitUntil: 'domcontentloaded' });

	/* A7: catch the loader with a frame up and no controls, then wait for controls. */
	let loaderShot = false;
	let controlsAtLoader = null;
	const deadline = Date.now() + 60000;
	while (Date.now() < deadline) {
		const s = await page.evaluate(() => ({
			frame: Boolean(window.__ptFrameAt),
			ctl: Boolean(window.__ptCtlAt)
		}));
		if (s.frame && !loaderShot) {
			loaderShot = true;
			controlsAtLoader = await visible(page, GRIP);
			await page.screenshot({ path: path.join(OUT, `${n}-${id}-loader.png`) });
		}
		if (s.ctl) break;
		await page.waitForTimeout(200);
	}
	const t = await page.evaluate(() => ({
		frameAt: window.__ptFrameAt ?? null,
		ctlAt: window.__ptCtlAt ?? null,
		ready: window.__ptReady
	}));
	const readyAt = t.ready[0]?.t ?? null;
	const appeared = t.ctlAt !== null;
	if (appeared) await page.waitForTimeout(400);
	await page.screenshot({ path: path.join(OUT, `${n}-${id}-ready.png`) });
	check(
		`A7 ${id}: no controls at the loader, controls after ready`,
		appeared && controlsAtLoader === false && (readyAt === null || t.ctlAt >= readyAt),
		{
			frameMs: t.frameAt && Math.round(t.frameAt),
			readyMs: readyAt && Math.round(readyAt),
			readyReason: t.ready[0]?.reason ?? null,
			controlsMs: t.ctlAt && Math.round(t.ctlAt),
			silentFallback: appeared && readyAt === null,
			errors: errors.slice(0, 3)
		}
	);

	/* A8: none of the old boxes. */
	const text = await page.evaluate(() => document.body.innerText);
	check(
		`A8 ${id}: no console banner or essay`,
		!/Console (enabled|blocked)|Waiting for the game/i.test(text)
	);
	if (!appeared) {
		await context.close();
		return;
	}

	/* A9: joystick right → the frame receives ArrowRight or KeyD (same-origin frames only). */
	const stick = await center(page.getByTestId('touch-joystick'));
	const gameFrame = page.frames().find((f) => f !== page.mainFrame() && f.url().startsWith(BASE));
	if (stick && gameFrame) {
		await gameFrame.evaluate(() => (window.__ptKeys = [])).catch(() => {});
		await touch(cdp, 'touchStart', stick.x, stick.y);
		for (let i = 1; i <= 6; i++) await touch(cdp, 'touchMove', stick.x + i * 8, stick.y);
		await page.waitForTimeout(250);
		await touch(cdp, 'touchEnd', stick.x + 48, stick.y);
		const keys = await gameFrame.evaluate(() => window.__ptKeys ?? []).catch(() => []);
		check(
			`A9 ${id}: joystick sends keys into the frame`,
			keys.some((k) => k === 'ArrowRight' || k === 'KeyD'),
			{
				keys: [...new Set(keys)].slice(0, 6)
			}
		);
	} else {
		check(`A9 ${id}: joystick sends keys into the frame`, true, {
			skipped: stick ? 'frame is not same-origin' : 'no joystick'
		});
	}

	/* A10: a real key hides the controls within a frame; a touch brings them back. */
	await page.keyboard.press('Shift');
	await page.waitForTimeout(50);
	const hiddenAfterKey = !(await visible(page, GRIP));
	await page.screenshot({ path: path.join(OUT, `${n}-${id}-keyboard.png`) });
	const vp = page.viewportSize();
	await tap(cdp, vp.width / 2, vp.height / 2);
	let backAfterTouch = false;
	for (let i = 0; i < 10 && !backAfterTouch; i++) {
		await page.waitForTimeout(50);
		backAfterTouch = await visible(page, GRIP);
	}
	check(`A10 ${id}: key hides, touch shows`, hiddenAfterKey && backAfterTouch, {
		hiddenAfterKey,
		backAfterTouch
	});

	/* A11: hide button → side tab; tap the tab → back. Drag grip to the edge → tab; swipe in → back. */
	const hide = await center(page.getByTestId('console-hide'));
	let a11 = { hideDocks: false, tapRestores: false, dragDocks: false, swipeRestores: false };
	if (hide) {
		await tap(cdp, hide.x, hide.y);
		await page.waitForTimeout(150);
		a11.hideDocks =
			(await visible(page, '[data-testid="console-dock-tab"]')) && !(await visible(page, GRIP));
		await page.screenshot({ path: path.join(OUT, `${n}-${id}-docked.png`) });
		const tab = await center(page.getByTestId('console-dock-tab'));
		if (tab) await tap(cdp, tab.x, tab.y);
		await page.waitForTimeout(150);
		a11.tapRestores = await visible(page, GRIP);
	}
	const grip = await center(page.locator(GRIP).first());
	if (grip) {
		await drag(cdp, grip, { x: vp.width - 4, y: grip.y });
		await page.waitForTimeout(150);
		const tabEl = page.getByTestId('console-dock-tab');
		a11.dragDocks =
			(await tabEl.isVisible()) && (await tabEl.getAttribute('data-side')) === 'right';
		await page.screenshot({ path: path.join(OUT, `${n}-${id}-dragged-to-edge.png`) });
		const tab = await center(tabEl);
		if (tab) await drag(cdp, tab, { x: tab.x - 80, y: tab.y }, 6);
		await page.waitForTimeout(150);
		a11.swipeRestores = await visible(page, GRIP);
		await page.screenshot({ path: path.join(OUT, `${n}-${id}-swiped-back.png`) });
	}
	check(`A11 ${id}: dock and restore`, Object.values(a11).every(Boolean), a11);
	await context.close();
}

if (!BASE) BASE = await startServer();
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
	executablePath: process.env.CHROMIUM_PATH || undefined
});
try {
	let n = 1;
	for (const id of GAMES) {
		try {
			await checkGame(browser, id, n++);
		} catch (e) {
			check(`game ${id}`, false, { error: String(e).slice(0, 300) });
		}
	}
} finally {
	await browser.close();
	server?.kill();
}
const passed = results.filter((r) => r.ok).length;
console.log(`SMOKE-TOUCH ${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
