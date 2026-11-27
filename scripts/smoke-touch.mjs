#!/usr/bin/env node
/**
 * Playwright touch-emulation check of the touch controls (asks A7–A11):
 *
 *  A7   controls appear only after the game says it is ready: screenshot at the loader
 *       (no controls) and once ready (controls).
 *  A8   no "Console enabled / waiting / blocked" box anywhere.
 *  A9   the joystick delivers arrow/WASD keys into the game frame.
 *  A10  a real key press hides the controls at once; the next touch brings them back.
 *  A11  hide button and drag-to-edge dock the controls behind a side tab; a tap or an
 *       inward swipe on the tab brings them back.
 *
 * The first game is a same-origin lab written to static/games/_touch-lab (removed after):
 * a 3 s "Loading…" screen, then a full-size canvas. Catalog games follow; one whose frame
 * the console cannot reach at all (cross-origin, no bridge) is reported as skipped.
 *
 * Touches are trusted (CDP Input.dispatchTouchEvent / locator.tap), so the page sees touch
 * pointers; Playwright's mouse would switch the input mode to keyboard.
 *
 * Usage: node scripts/smoke-touch.mjs [--url http://127.0.0.1:5173] [--out dir]
 *          [--games _touch-lab,002,slope]
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
const LAB = '_touch-lab';
const GAMES = (arg('--games') ?? `${LAB},002,slope`).split(',').filter(Boolean);
let BASE = arg('--url');
let server;

const LAB_DIR = path.join(ROOT, 'static/games', LAB);
const LAB_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Touch Lab</title>
<style>html,body{margin:0;height:100%;background:#123;color:#fff;font:20px sans-serif}
#load{display:grid;place-items:center;height:100%}canvas{display:block;width:100vw;height:100vh}</style>
</head><body><div id="load">Loading…</div>
<script>
  window.labKeys = [];
  addEventListener('keydown', function (e) { window.labKeys.push(e.code); });
  setTimeout(function () {
    document.getElementById('load').remove();
    var c = document.createElement('canvas');
    c.width = 800; c.height = 400; c.tabIndex = 0;
    document.body.appendChild(c);
    var g = c.getContext('2d'); g.fillStyle = '#2a6'; g.fillRect(0, 0, 800, 400);
    g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText('Lab game running', 230, 210);
  }, 3000);
</script></body></html>`;

function writeLab() {
	fs.mkdirSync(path.join(LAB_DIR, 'online'), { recursive: true });
	fs.writeFileSync(
		path.join(LAB_DIR, 'online/metadata.json'),
		JSON.stringify({
			id: LAB,
			name: 'Touch Lab',
			author: 'Test',
			description: 'Fixture for scripts/smoke-touch.mjs. Arrow keys move, Space jumps.',
			thumbnail: '',
			category: 'Test'
		})
	);
	fs.writeFileSync(path.join(LAB_DIR, 'online/index.html'), LAB_HTML);
}

async function startServer() {
	const port = 5198;
	server = spawn(
		path.join(ROOT, 'node_modules/.bin/vite'),
		['dev', '--port', String(port), '--strictPort', '--host', '127.0.0.1'],
		{ cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }
	);
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('Vite did not start in 120s')), 120000);
		let stderr = '';
		server.stderr.on('data', (d) => (stderr = (stderr + d).slice(-2000)));
		server.stdout.on('data', (d) => {
			if (String(d).includes('Local:')) {
				clearTimeout(timer);
				resolve();
			}
		});
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

/** Runs in every frame: frames record keys; the top records ready messages and timings. */
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

/** Keys every child frame has seen (cross-origin frames included: Playwright can read them). */
async function frameKeys(page) {
	const out = [];
	for (const f of page.frames()) {
		if (f === page.mainFrame()) continue;
		out.push(...(await f.evaluate(() => window.__ptKeys ?? []).catch(() => [])));
	}
	return out;
}

async function clearFrameKeys(page) {
	for (const f of page.frames()) {
		if (f !== page.mainFrame()) await f.evaluate(() => (window.__ptKeys = [])).catch(() => {});
	}
}

/** A point in the app's own document (not over a game frame or a control) to touch. */
function appPoint(page) {
	return page.evaluate(() => {
		for (let y = 8; y < innerHeight; y += 16) {
			for (let x = 8; x < innerWidth; x += 16) {
				const el = document.elementFromPoint(x, y);
				if (!el || el.closest('iframe, a, button, input, [role="button"]')) continue;
				return { x, y };
			}
		}
		return null;
	});
}

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
	let surface = {};
	const deadline = Date.now() + 45000;
	while (Date.now() < deadline) {
		const s = await page.evaluate(() => {
			const el = document.querySelector('[data-testid="touch-console-surface"]');
			return {
				frame: Boolean(window.__ptFrameAt),
				ctl: Boolean(window.__ptCtlAt),
				injectable: el?.getAttribute('data-injectable') ?? null,
				gameReady: el?.getAttribute('data-game-ready') ?? null
			};
		});
		surface = s;
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
	const timing = {
		frameMs: t.frameAt && Math.round(t.frameAt),
		readyMs: readyAt && Math.round(readyAt),
		readyReason: t.ready[0]?.reason ?? null,
		controlsMs: t.ctlAt && Math.round(t.ctlAt),
		injectable: surface.injectable,
		errors: errors.slice(0, 2)
	};
	if (!appeared && surface.injectable !== 'true') {
		check(`A7 ${id}: controls wait for the game`, id !== LAB, {
			...timing,
			skipped: 'the console cannot reach this game frame (cross-origin, no bridge)'
		});
		await context.close();
		return;
	}
	const waitedForReady = readyAt !== null ? t.ctlAt >= readyAt : t.ctlAt - (t.frameAt ?? 0) >= 5500;
	/* The lab must signal ready itself (bridge 'surface'), after its 3 s loader. */
	const labOk = id !== LAB || (readyAt !== null && t.ready[0].reason === 'surface');
	check(
		`A7 ${id}: no controls at the loader, controls after ready`,
		appeared && controlsAtLoader === false && waitedForReady && labOk,
		{ ...timing, fallback: readyAt === null ? 'silent frame (6 s)' : undefined }
	);

	/* A8: none of the old boxes. */
	const text = await page.evaluate(() => document.body.innerText);
	check(
		`A8 ${id}: no console banner or essay`,
		!/Console (enabled|blocked)|Waiting for the game/i.test(text)
	);

	/* A9: joystick right → some game frame receives ArrowRight or KeyD. */
	const stick = await center(page.getByTestId('touch-joystick'));
	if (stick) {
		await clearFrameKeys(page);
		await touch(cdp, 'touchStart', stick.x, stick.y);
		for (let i = 1; i <= 6; i++) await touch(cdp, 'touchMove', stick.x + i * 8, stick.y);
		await page.waitForTimeout(300);
		await touch(cdp, 'touchEnd', stick.x + 48, stick.y);
		await page.waitForTimeout(200);
		const keys = await frameKeys(page);
		check(
			`A9 ${id}: joystick sends keys into the game`,
			keys.some((k) => k === 'ArrowRight' || k === 'KeyD'),
			{ keys: [...new Set(keys)].slice(0, 6) }
		);
	} else {
		check(`A9 ${id}: joystick sends keys into the game`, false, { error: 'no joystick' });
	}

	/*
	 * A10: a real key hides the controls within a frame; a touch brings them back. The lab
	 * frame is same-origin, so the key goes into the game. A cross-origin game frame is
	 * invisible to the app, so the key is pressed in the app window instead.
	 */
	if (id !== LAB) await page.evaluate(() => document.activeElement?.blur?.());
	await page.keyboard.press('Shift');
	await page.waitForTimeout(50);
	const hiddenAfterKey = !(await visible(page, GRIP));
	await page.screenshot({ path: path.join(OUT, `${n}-${id}-keyboard.png`) });
	const vp = page.viewportSize();
	const spot = id === LAB ? { x: vp.width / 2, y: vp.height / 2 } : await appPoint(page);
	if (spot) await tap(cdp, spot.x, spot.y);
	let backAfterTouch = false;
	for (let i = 0; i < 10 && !backAfterTouch; i++) {
		await page.waitForTimeout(50);
		backAfterTouch = await visible(page, GRIP);
	}
	check(`A10 ${id}: key hides, touch shows`, hiddenAfterKey && backAfterTouch, {
		hiddenAfterKey,
		backAfterTouch,
		keyIn: id === LAB ? 'game frame' : 'app window',
		touchAt: spot
	});

	/* A11: hide button → side tab; tap the tab → back. Drag grip to the edge → tab; swipe in → back. */
	const a11 = { hideDocks: false, tapRestores: false, dragDocks: false, swipeRestores: false };
	const tabEl = page.getByTestId('console-dock-tab');
	try {
		await page.getByTestId('console-hide').tap({ timeout: 5000 });
		await page.waitForTimeout(150);
		a11.hideDocks = (await tabEl.isVisible()) && !(await visible(page, GRIP));
		await page.screenshot({ path: path.join(OUT, `${n}-${id}-docked.png`) });
		await tabEl.tap({ timeout: 5000 });
		await page.waitForTimeout(150);
		a11.tapRestores = await visible(page, GRIP);
		const grip = await center(page.locator(GRIP).first());
		if (grip) {
			await drag(cdp, grip, { x: vp.width - 4, y: grip.y });
			await page.waitForTimeout(150);
			a11.dragDocks =
				(await tabEl.isVisible()) && (await tabEl.getAttribute('data-side')) === 'right';
			await page.screenshot({ path: path.join(OUT, `${n}-${id}-dragged-to-edge.png`) });
			const tab = await center(tabEl);
			if (tab) await drag(cdp, tab, { x: tab.x - 80, y: tab.y }, 6);
			await page.waitForTimeout(150);
			a11.swipeRestores = await visible(page, GRIP);
			await page.screenshot({ path: path.join(OUT, `${n}-${id}-swiped-back.png`) });
		}
	} catch (e) {
		a11.error = String(e).split('\n').slice(0, 6).join(' | ').slice(0, 400);
	}
	check(
		`A11 ${id}: dock and restore`,
		a11.hideDocks && a11.tapRestores && a11.dragDocks && a11.swipeRestores,
		a11
	);
	await context.close();
}

writeLab();
try {
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
	}
} finally {
	server?.kill();
	fs.rmSync(LAB_DIR, { recursive: true, force: true });
}
const passed = results.filter((r) => r.ok).length;
console.log(`SMOKE-TOUCH ${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
