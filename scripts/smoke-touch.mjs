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
 * a 3 s "Loading…" screen, then a full-size canvas (plus a 2-player copy for A12). Catalog games follow; one whose frame
 * the console cannot reach at all (cross-origin, no bridge) is reported as skipped.
 *
 * Touches are trusted (CDP Input.dispatchTouchEvent / locator.tap), so the page sees touch
 * pointers; Playwright's mouse would switch the input mode to keyboard.
 *
 * Usage: node scripts/smoke-touch.mjs [--url http://127.0.0.1:5173] [--out dir]
 *          [--games _touch-lab,002,slope]   (002, playhop-…, addicting-100-arrows: shell route)
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
const LAB_2P = '_touch-lab-2p';
const isLab = (id) => id === LAB || id === LAB_2P;
const GAMES = (
	arg('--games') ??
	`${LAB},${LAB_2P},weasels,002,playhop-1-jump-on-the-keyboard-540983,addicting-100-arrows,slope`
)
	.split(',')
	.filter(Boolean);
/** Cross-origin games whose host allows CORS reads: on the web they play in a bridge shell. */
const SHELL_IDS = new Set(['002', 'playhop-1-jump-on-the-keyboard-540983', 'addicting-100-arrows']);
let BASE = arg('--url');
let server;

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

const LABS = {
	[LAB]: {
		name: 'Touch Lab',
		description: 'Fixture for scripts/smoke-touch.mjs. Arrow keys move, Space jumps.'
	},
	/* M11: a same-keyboard two-player game, named as such in its description. */
	[LAB_2P]: {
		name: 'Touch Lab 2P',
		description:
			'Fixture for scripts/smoke-touch.mjs. A 2 player game: player 1 uses WASD and F, player 2 uses the arrow keys and Enter.'
	}
};
const labDir = (id) => path.join(ROOT, 'static/games', id);

function writeLab() {
	for (const [id, meta] of Object.entries(LABS)) {
		fs.mkdirSync(path.join(labDir(id), 'online'), { recursive: true });
		fs.writeFileSync(
			path.join(labDir(id), 'online/metadata.json'),
			JSON.stringify({ id, author: 'Test', thumbnail: '', category: 'Test', ...meta })
		);
		fs.writeFileSync(path.join(labDir(id), 'online/index.html'), LAB_HTML);
	}
}

/* Control rects on screen: both sticks and the pad buttons (not the extras strip). */
async function controlRects(page) {
	return page.evaluate(() =>
		[...document.querySelectorAll('[data-testid="touch-joystick"], .pt-touch-btn')]
			.filter((el) => !el.closest('[data-testid="console-extras"]'))
			.map((el) => {
				const r = el.getBoundingClientRect();
				return {
					id: el.getAttribute('aria-label') || el.dataset.testid,
					x: r.x,
					y: r.y,
					w: r.width,
					h: r.height
				};
			})
			.filter((r) => r.w > 0 && r.h > 0)
	);
}

function overlaps(rects) {
	const out = [];
	for (let i = 0; i < rects.length; i++)
		for (let j = i + 1; j < rects.length; j++) {
			const a = rects[i];
			const b = rects[j];
			const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
			const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
			if (ox > 1 && oy > 1) out.push([a.id, b.id]);
		}
	return out;
}

async function stickRight(page, cdp, locator) {
	const stick = await center(locator);
	if (!stick) return null;
	await clearFrameKeys(page);
	await touch(cdp, 'touchStart', stick.x, stick.y);
	for (let i = 1; i <= 6; i++) await touch(cdp, 'touchMove', stick.x + i * 8, stick.y);
	await page.waitForTimeout(300);
	await touch(cdp, 'touchEnd', stick.x + 48, stick.y);
	await page.waitForTimeout(200);
	return [...new Set(await frameKeys(page))];
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
		addEventListener(
			'keydown',
			(e) => {
				/* One record per event, however many recorders are armed. */
				if (e.__ptRec) return;
				e.__ptRec = true;
				window.__ptKeys.push(e.code);
			},
			true
		);
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
	/* A phone in landscape shows the game below the fold: touches outside the viewport hit nothing. */
	await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
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

/** The console's own view of things, for a failing check's detail. */
function consoleState(page) {
	return page.evaluate(() => {
		const el = document.querySelector('[data-testid="touch-console-surface"]');
		const sticks = [...document.querySelectorAll('[data-testid="touch-joystick"]')];
		return {
			input: el?.getAttribute('data-input-mode'),
			overlay: el?.getAttribute('data-overlay'),
			dispatch: el?.getAttribute('data-dispatch'),
			twoPlayer: el?.getAttribute('data-two-player'),
			sticks: sticks.map((s) => s.getAttribute('data-active')).join(',')
		};
	});
}

async function clearFrameKeys(page) {
	for (const f of page.frames()) {
		if (f === page.mainFrame()) continue;
		/*
		 * A shell's loader writes the game document over its own, which erases the window
		 * listeners the init script added; arm the recorder again for the current document.
		 */
		await f
			.evaluate(() => {
				window.__ptKeys = [];
				if (window.__ptKeyDoc === document.documentElement) return;
				window.__ptKeyDoc = document.documentElement;
				addEventListener(
					'keydown',
					(e) => {
						/* One record per event, however many recorders are armed. */
						if (e.__ptRec) return;
						e.__ptRec = true;
						window.__ptKeys.push(e.code);
					},
					true
				);
			})
			.catch(() => {});
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

/** The app's stored save profile for a game (IndexedDB), as size and a few facts. */
function storedProfile(page, id) {
	return page.evaluate(
		(gameId) =>
			new Promise((resolve) => {
				const req = indexedDB.open('potatotomato-browser-data-v1');
				req.onerror = () => resolve({ error: 'open failed' });
				req.onsuccess = () => {
					const db = req.result;
					if (!db.objectStoreNames.contains('browserProfiles')) return resolve({ none: true });
					const get = db.transaction('browserProfiles').objectStore('browserProfiles').get(gameId);
					get.onsuccess = () => {
						const v = get.result;
						if (!v) return resolve({ none: true });
						const json = JSON.stringify(v);
						resolve({ bytes: json.length, probe: json.includes('pt-smoke-save') });
					};
					get.onerror = () => resolve({ error: 'get failed' });
				};
			}),
		id
	);
}

/** Every child frame's view of one localStorage key (the bridge's virtual storage). */
async function frameSaves(page) {
	const out = [];
	for (const fr of page.frames()) {
		if (fr === page.mainFrame()) continue;
		out.push(await fr.evaluate(() => localStorage.getItem('pt-smoke-save')).catch(() => null));
	}
	return out.filter(Boolean);
}

/**
 * S1/S2: a save made inside a shell game reaches the app's own store (shared with the
 * offline copy, which reads the same per-game profile), stays light, and is there again
 * after a reload.
 */
async function checkSaves(page, id, n) {
	const stamp = `v${Date.now()}`;
	let wrote = 0;
	for (const fr of page.frames()) {
		if (fr === page.mainFrame()) continue;
		const ok = await fr
			.evaluate((s) => {
				localStorage.setItem('pt-smoke-save', s);
				return true;
			}, stamp)
			.catch(() => false);
		if (ok) wrote++;
	}
	let stored = {};
	for (let i = 0; i < 20; i++) {
		await page.waitForTimeout(500);
		stored = await storedProfile(page, id);
		if (stored.probe) break;
	}
	check(
		`S1 ${id}: a save in the game frame reaches the app store, light`,
		Boolean(stored.probe) && stored.bytes < 2_000_000,
		{
			wrote,
			...stored
		}
	);
	await page.reload({ waitUntil: 'domcontentloaded' });
	let seen = [];
	for (let i = 0; i < 40 && !seen.includes(stamp); i++) {
		await page.waitForTimeout(500);
		seen = await frameSaves(page);
	}
	check(`S2 ${id}: the save is back after a reload`, seen.includes(stamp), {
		seen: seen.slice(0, 3)
	});
	await page.screenshot({ path: path.join(OUT, `${n}-${id}-after-reload.png`) });
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
	/* The first page compiles the whole app on a cold Vite server. */
	await page.goto(`${BASE}/games/${id}`, { waitUntil: 'domcontentloaded', timeout: 120000 });

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
	/* W1: a CORS-readable cross-origin game plays in an app-made shell with the bridge inside. */
	if (SHELL_IDS.has(id)) {
		const route = await page.evaluate(() => {
			const f = document.querySelector('iframe[data-testid="game-frame"], iframe[title]');
			return {
				src: f?.hasAttribute('srcdoc') ? 'srcdoc' : (f?.getAttribute('src') ?? '').slice(0, 24),
				sandbox: f?.getAttribute('sandbox') ?? null,
				dispatch: document
					.querySelector('[data-testid="touch-console-surface"]')
					?.getAttribute('data-dispatch')
			};
		});
		/* A srcdoc shell is a secure context (crypto.subtle, gamepads); a data: one is not. */
		const shellFrame = page.frames().find((fr) => fr.url() === 'about:srcdoc');
		const secure = shellFrame
			? await shellFrame.evaluate(() => isSecureContext).catch(() => null)
			: null;
		check(
			`W1 ${id}: plays in a secure bridge shell on the web`,
			route.src === 'srcdoc' &&
				secure === true &&
				!/allow-same-origin/.test(route.sandbox ?? '') &&
				surface.injectable === 'true' &&
				route.dispatch === 'bridge',
			{ ...route, secure, injectable: surface.injectable, errors: errors.slice(0, 2) }
		);
	}
	if (!appeared && surface.injectable !== 'true') {
		check(`A7 ${id}: controls wait for the game`, !isLab(id) && !SHELL_IDS.has(id), {
			...timing,
			skipped: 'the console cannot reach this game frame (cross-origin, no bridge)'
		});
		await context.close();
		return;
	}
	const waitedForReady = readyAt !== null ? t.ctlAt >= readyAt : t.ctlAt - (t.frameAt ?? 0) >= 5500;
	/* The lab must signal ready itself (bridge 'surface'), after its 3 s loader. */
	const labOk = !isLab(id) || (readyAt !== null && t.ready[0].reason === 'surface');
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

	/*
	 * P1: nothing that stays on screen over the running game blurs it. Backdrop blur
	 * re-samples the game canvas every frame, which costs frame rate on phones.
	 */
	const blurred = await page.evaluate(() => {
		const surface = document.querySelector('[data-testid="touch-console-surface"]');
		if (!surface) return null;
		return [...surface.querySelectorAll('*')]
			.filter((el) => {
				const cs = getComputedStyle(el);
				const f = cs.backdropFilter || cs.webkitBackdropFilter || 'none';
				return f !== 'none' && el.getClientRects().length > 0;
			})
			.map((el) => el.className.toString().slice(0, 60));
	});
	check(
		`P1 ${id}: on-screen controls do not blur the game`,
		Array.isArray(blurred) && blurred.length === 0,
		{
			blurred
		}
	);

	/* A9: joystick right → some game frame receives ArrowRight or KeyD. */
	const stick = await center(page.getByTestId('touch-joystick').first());
	if (stick) {
		await clearFrameKeys(page);
		await touch(cdp, 'touchStart', stick.x, stick.y);
		for (let i = 1; i <= 6; i++) await touch(cdp, 'touchMove', stick.x + i * 8, stick.y);
		await page.waitForTimeout(300);
		const during = await consoleState(page);
		const hit = await page.evaluate(({ x, y }) => {
			const el = document.elementFromPoint(x, y);
			return el
				? `${el.tagName.toLowerCase()}${el.dataset.testid ? '#' + el.dataset.testid : ''}`
				: null;
		}, stick);
		await touch(cdp, 'touchEnd', stick.x + 48, stick.y);
		await page.waitForTimeout(200);
		const keys = await frameKeys(page);
		check(
			`A9 ${id}: joystick sends keys into the game`,
			keys.some((k) => k === 'ArrowRight' || k === 'KeyD'),
			{ keys: [...new Set(keys)].slice(0, 6), during, hit, frames: page.frames().length }
		);
	} else {
		check(`A9 ${id}: joystick sends keys into the game`, false, { error: 'no joystick' });
	}

	/* A12 / M11: no two controls overlap. */
	const rects = await controlRects(page);
	check(`A12 ${id}: controls never overlap`, rects.length > 0 && overlaps(rects).length === 0, {
		controls: rects.length,
		overlapping: overlaps(rects).slice(0, 4)
	});

	/* A12 / M11: a two-player game gets a stick per player, each on its own keys. */
	const twoSticks = (await page.getByTestId('touch-joystick-2').count()) > 0;
	if (id === LAB_2P) {
		await page.screenshot({ path: path.join(OUT, `${n}-${id}-two-players.png`) });
		const p1 = twoSticks
			? await stickRight(page, cdp, page.getByTestId('touch-joystick').first())
			: null;
		const p2 = twoSticks
			? await stickRight(
					page,
					cdp,
					page.getByTestId('touch-joystick-2').getByTestId('touch-joystick')
				)
			: null;
		check(
			`A12 ${id}: two players split, P1 on WASD, P2 on arrows`,
			twoSticks &&
				(p1 ?? []).includes('KeyD') &&
				!(p1 ?? []).includes('ArrowRight') &&
				(p2 ?? []).includes('ArrowRight') &&
				!(p2 ?? []).includes('KeyD'),
			{ twoSticks, p1, p2 }
		);
	} else {
		check(`A12 ${id}: single-player game keeps one stick`, !twoSticks, { twoSticks });
	}

	/*
	 * A10: a real key hides the controls within a frame; a touch brings them back. The lab
	 * frame is same-origin, so the key goes into the game. A cross-origin game frame is
	 * invisible to the app, so the key is pressed in the app window instead.
	 */
	/* Keys go to the focused frame: take focus back to the app document first. */
	if (!isLab(id))
		await page.evaluate(() => {
			document.activeElement?.blur?.();
			window.focus();
			const h = document.querySelector('h1');
			if (h) {
				h.tabIndex = -1;
				h.focus();
			}
		});
	const beforeKey = await consoleState(page);
	await page.keyboard.press('Shift');
	await page.waitForTimeout(50);
	const hiddenAfterKey = !(await visible(page, GRIP));
	const afterKey = await consoleState(page);
	await page.screenshot({ path: path.join(OUT, `${n}-${id}-keyboard.png`) });
	const vp = page.viewportSize();
	const spot = isLab(id) ? { x: vp.width / 2, y: vp.height / 2 } : await appPoint(page);
	if (spot) await tap(cdp, spot.x, spot.y);
	let backAfterTouch = false;
	for (let i = 0; i < 10 && !backAfterTouch; i++) {
		await page.waitForTimeout(50);
		backAfterTouch = await visible(page, GRIP);
	}
	check(`A10 ${id}: key hides, touch shows`, hiddenAfterKey && backAfterTouch, {
		hiddenAfterKey,
		backAfterTouch,
		keyIn: isLab(id) ? 'game frame' : 'app window',
		touchAt: spot,
		beforeKey,
		afterKey
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
	if (SHELL_IDS.has(id))
		await checkSaves(page, id, n).catch((e) =>
			check(`S1 ${id}`, false, { error: String(e).slice(0, 300) })
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
	for (const id of Object.keys(LABS)) fs.rmSync(labDir(id), { recursive: true, force: true });
}
const passed = results.filter((r) => r.ok).length;
console.log(`SMOKE-TOUCH ${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
