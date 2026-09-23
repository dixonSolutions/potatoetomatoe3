#!/usr/bin/env node
/**
 * End-to-end test of the in-game bridge, driven in real Chromium against the real app.
 *
 * Covers what unit tests cannot, because it all happens inside a game frame:
 *   - virtual storage: per-game localStorage / cookies isolated from the app origin,
 *     saved to the profile, restored on relaunch, on a fresh origin (synchronously from
 *     the preloaded profile) and over the postMessage pull (one reload);
 *   - IndexedDB records keep their types (Uint8Array, Date) through the profile;
 *   - live key detection: declared keys listed, keys the game handles promoted to "in use";
 *   - the console: one keydown per press (no duplicate dispatch), holds never turn into
 *     layout edits, joystick hysteresis, explicit edit mode;
 *   - the Controls menu (purposes, search, grouping), console buttons added from detection,
 *     and shortcut / typing classification;
 *   - the toolbar no longer carries a separate "Game menu" button.
 *
 * It writes a tiny fixture game to static/games/_bridge-lab (gitignored; the leading
 * underscore keeps it out of the catalog) and removes it afterwards.
 *
 * Usage:
 *   pnpm bridge-test                      # starts its own Vite dev server
 *   pnpm bridge-test -- --url http://localhost:5173   # reuse a running one
 *   pnpm bridge-test -- --out /tmp/shots  # also save screenshots of each stage
 *   CHROMIUM_PATH=/path/to/chrome pnpm bridge-test
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAME = '_bridge-lab';
const FIXTURE_DIR = path.join(ROOT, 'static/games', GAME);

function arg(name) {
	const i = process.argv.indexOf(name);
	return i === -1 ? undefined : process.argv[i + 1];
}
const OUT = arg('--out');
let BASE = arg('--url');
let server = null;

const FIXTURE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Console Lab</title>
<script>
  /* Boot-time reads: this is what games do before anything async can land. */
  window.bootCount = Number(localStorage.getItem('lab-count') || '0') + 1;
  localStorage.setItem('lab-count', String(window.bootCount));
  window.bootCookie = document.cookie;
  document.cookie = 'lab-cookie=' + window.bootCount + '; max-age=86400; path=/';
  window.keysSeen = [];
</script>
<script type="application/json" id="cg">{"controls":{"text":"<h3>Controls</h3>Arrow keys = move, Press J to jump, Space = dash"}}</script>
<style>body{margin:0;background:#123;color:#fff;font:14px sans-serif}canvas{display:block;width:100%;height:60vh;background:#246}</style>
</head><body>
<canvas id="c" tabindex="0"></canvas>
<input id="name" placeholder="Your name" style="font-size:16px">
<pre id="out"></pre>
<script>
  var out = document.getElementById('out');
  function render(extra) {
    out.textContent = 'boot=' + window.bootCount + ' bootCookie=[' + window.bootCookie + '] idb=' + (window.idbState||'-') + '\\nkeys=' + window.keysSeen.join(',') + (extra||'');
  }
  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.code === 'KeyS') { e.preventDefault(); window.saved = true; return; }
    window.keysSeen.push(e.code);
    if (e.code === 'KeyJ' || e.code.indexOf('Arrow') === 0) e.preventDefault();
    render();
  });
  var req = indexedDB.open('lab-db', 2);
  req.onupgradeneeded = function () { var db = req.result; if (!db.objectStoreNames.contains('files')) db.createObjectStore('files'); if (!db.objectStoreNames.contains('rows')) db.createObjectStore('rows', { keyPath: 'id' }); };
  req.onsuccess = function () {
    var db = req.result;
    var tx = db.transaction(['files','rows'], 'readonly');
    var g = tx.objectStore('files').get('/idbfs/save.dat');
    var r = tx.objectStore('rows').get(1);
    tx.oncomplete = function () {
      var f = g.result; var row = r.result;
      window.idbState = (f ? (f.contents instanceof Uint8Array ? 'u8:' + Array.from(f.contents).join('.') : 'BAD:' + typeof f.contents) + (f.timestamp instanceof Date ? ':date' : ':nodate') : 'none') + '|' + (row ? 'row' + row.n : 'norow');
      render();
      var w = db.transaction(['files','rows'], 'readwrite');
      w.objectStore('files').put({ timestamp: new Date(), mode: 33206, contents: new Uint8Array([1, 2, window.bootCount]) }, '/idbfs/save.dat');
      w.objectStore('rows').put({ id: 1, n: window.bootCount });
    };
  };
  render();
</script>
</body></html>
`;

function writeFixture() {
	mkdirSync(path.join(FIXTURE_DIR, 'online'), { recursive: true });
	writeFileSync(
		path.join(FIXTURE_DIR, 'online/metadata.json'),
		JSON.stringify({
			id: GAME,
			name: 'Console Lab',
			author: 'Test',
			description: 'Fixture for pnpm bridge-test.',
			thumbnail: '',
			category: 'Test'
		})
	);
	writeFileSync(path.join(FIXTURE_DIR, 'online/index.html'), FIXTURE_HTML);
}

async function cleanup() {
	rmSync(FIXTURE_DIR, { recursive: true, force: true });
	if (server) server.kill('SIGTERM');
}

async function startServer() {
	const port = 5199;
	server = spawn(
		path.join(ROOT, 'node_modules/.bin/vite'),
		['dev', '--port', String(port), '--strictPort'],
		{
			cwd: ROOT,
			stdio: ['ignore', 'pipe', 'pipe']
		}
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
	return `http://localhost:${port}`;
}

async function shot(target, name) {
	if (!OUT) return;
	mkdirSync(OUT, { recursive: true });
	await target.screenshot({ path: path.join(OUT, name) });
}

writeFixture();
process.on('SIGINT', () => void cleanup().then(() => process.exit(130)));
if (!BASE) BASE = await startServer();

const results = [];
function check(name, ok, detail = '') {
	results.push({ name, ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch(
	process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}
);
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

async function gameFrame() {
	for (let i = 0; i < 100; i++) {
		const f = page.frames().find((fr) => fr.url().includes(`/games/${GAME}/online/`));
		if (f) {
			try {
				await f.waitForFunction(() => typeof window.bootCount === 'number', null, {
					timeout: 5000
				});
				return f;
			} catch {
				/* reloading */
			}
		}
		await sleep(100);
	}
	throw new Error('game frame not found');
}

async function play() {
	const btn = page.getByRole('button', { name: /play/i }).first();
	await btn.click();
	return gameFrame();
}

async function relaunch() {
	await page.getByRole('button', { name: 'Relaunch', exact: true }).first().click();
	await sleep(300);
	return play();
}

async function storedProfile() {
	return page.evaluate(
		(game) =>
			new Promise((resolve) => {
				const req = indexedDB.open('potatotomato-browser-data-v1');
				req.onsuccess = () => {
					const db = req.result;
					if (!db.objectStoreNames.contains('browserProfiles')) return resolve(null);
					const g = db.transaction('browserProfiles').objectStore('browserProfiles').get(game);
					g.onsuccess = () => resolve(g.result ?? null);
				};
				req.onerror = () => resolve(null);
			}),
		GAME
	);
}

await page.goto(`${BASE}/games/${GAME}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.getByRole('heading', { name: 'Console Lab' }).waitFor({ timeout: 180000 });
await shot(page, '01-game-page.png');

check(
	'Game menu toolbar button is gone',
	(await page.locator('[data-testid="game-menu-key"]').count()) === 0
);
check('No "Game menu" text on the page', (await page.getByText('Game menu').count()) === 0);

/* ---------- virtual storage ---------- */
let frame = await play();
await sleep(400);
check(
	'Bridge installed virtual storage',
	await frame.evaluate(() => Boolean(window.__ptStorageBridge?.virtual))
);
check('First boot count is 1', (await frame.evaluate(() => window.bootCount)) === 1);
check(
	'Game writes stay out of the app origin localStorage',
	(await page.evaluate(() => localStorage.getItem('lab-count'))) === null
);
check(
	'Game cookie is not an app-origin cookie',
	!(await page.evaluate(() => document.cookie)).includes('lab-cookie')
);
await sleep(2500);
let prof = await storedProfile();
const bucket = prof && Object.values(prof.profile.Default.localStorage)[0];
check(
	'Profile saved to IndexedDB with game key',
	bucket?.['lab-count'] === '1',
	JSON.stringify(bucket)
);
check(
	'Profile has typed IDB record',
	Boolean(
		prof?.profile.Default.indexedDB
			.find((d) => d.name === 'lab-db')
			?.records.some((r) => r.value.startsWith('__pt2:'))
	)
);
check(
	'Cookie captured in profile',
	Boolean(prof?.profile.Default.cookies.find((c) => c.name === 'lab-cookie'))
);

frame = await relaunch();
await frame.waitForFunction(() => window.idbState, null, { timeout: 5000 });
check('Relaunch sees saved localStorage', (await frame.evaluate(() => window.bootCount)) === 2);
check(
	'Relaunch sees saved cookie',
	(await frame.evaluate(() => window.bootCookie)).includes('lab-cookie=1')
);
check(
	'IDB Uint8Array/Date survive',
	(await frame.evaluate(() => window.idbState)) === 'u8:1.2.1:date|row1',
	await frame.evaluate(() => window.idbState)
);
await sleep(2000);

/* Fresh origin (like a new puller port): wipe this origin's copies, boot from the preloaded profile. */
await page.evaluate(async () => {
	for (const k of Object.keys(localStorage))
		if (k.startsWith('__pt_vs:')) localStorage.removeItem(k);
	for (const k of Object.keys(sessionStorage))
		if (k.startsWith('__pt_vs:')) sessionStorage.removeItem(k);
	await new Promise((r) => {
		const d = indexedDB.deleteDatabase('lab-db');
		d.onsuccess = d.onerror = d.onblocked = () => r();
	});
});
frame = await relaunch();
await frame.waitForFunction(() => window.idbState, null, { timeout: 5000 });
check(
	'Fresh origin boots from preloaded profile (sync)',
	(await frame.evaluate(() => window.bootCount)) === 3
);
check(
	'Fresh origin IDB restored from profile',
	(await frame.evaluate(() => window.idbState)) === 'u8:1.2.2:date|row2',
	await frame.evaluate(() => window.idbState)
);
await sleep(2000);

/* Async path: no preloaded profile (cross-origin frame) → pull → reload once. */
await page.evaluate(async (game) => {
	delete window.__ptGameProfiles[game];
	for (const k of Object.keys(localStorage))
		if (k.startsWith('__pt_vs:')) localStorage.removeItem(k);
	for (const k of Object.keys(sessionStorage))
		if (k.startsWith('__pt_vs:')) sessionStorage.removeItem(k);
}, GAME);
await page.getByRole('button', { name: 'Relaunch', exact: true }).first().click();
await sleep(300);
await page.evaluate(() => {
	/* Hide the bag from the frame so it must use postMessage. */
	const bag = window.__ptGameProfiles;
	Object.defineProperty(window, '__ptGameProfiles', {
		configurable: true,
		get: () => undefined,
		set: () => {}
	});
	window.__restoreBag = () =>
		Object.defineProperty(window, '__ptGameProfiles', {
			configurable: true,
			writable: true,
			value: bag
		});
});
await page.getByRole('button', { name: /play/i }).first().click();
await sleep(3500);
frame = await gameFrame();
await frame.waitForFunction(() => window.idbState, null, { timeout: 5000 });
check(
	'Async pull restores saves (reloaded once)',
	(await frame.evaluate(() => window.bootCount)) === 4,
	`bootCount=${await frame.evaluate(() => window.bootCount)}`
);
check(
	'Async pull: saved IDB replaces what the empty boot wrote',
	(await frame.evaluate(() => window.idbState)) === 'u8:1.2.3:date|row3',
	await frame.evaluate(() => window.idbState)
);
await page.evaluate(() => window.__restoreBag());
await shot(page, '02-game-running.png');

/* ---------- console ---------- */
await page.locator('[data-testid="touch-console-toggle"]').click();
await page.locator('[data-testid="touch-joystick"]').waitFor({ timeout: 8000 });
await sleep(600);
await shot(page, '03-console.png');

await frame.evaluate(() => (window.keysSeen.length = 0));
const aBtn = page.getByRole('button', { name: 'Action Space' });
await aBtn.hover();
await page.mouse.down();
await sleep(2600);
const heldLong = await frame.evaluate(() => window.keysSeen.slice());
check(
	'Unused A/B/X/Esc buttons hidden by detection',
	(await page.getByRole('button', { name: 'Action A' }).count()) === 0
);
check(
	'Holding Space for 2.6s keeps it a key press (no edit mode)',
	heldLong.join(',') === 'Space',
	heldLong.join(',')
);
check(
	'No edit outline after long hold',
	(await page.locator('.pt-touch-btn--editing').count()) === 0
);
await page.mouse.up();

await frame.evaluate(() => (window.keysSeen.length = 0));
const joy = await page.locator('[data-testid="touch-joystick"]').boundingBox();
const cx = joy.x + joy.width / 2;
const cy = joy.y + joy.height / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 1; i <= 10; i++) await page.mouse.move(cx - i * 5, cy);
/* Wobble near the release edge: hysteresis must keep one continuous hold. */
for (let i = 0; i < 6; i++) await page.mouse.move(cx - (i % 2 ? 20 : 14), cy);
await page.mouse.up();
const joyKeys = await frame.evaluate(() => window.keysSeen.slice());
check(
	'Joystick left → exactly one ArrowLeft keydown',
	joyKeys.join(',') === 'ArrowLeft',
	joyKeys.join(',')
);

/* ---------- controls menu + live detection ---------- */
check(
	'No keyboard slab over the game',
	(await page.locator('[data-testid="onscreen-keyboard"]').count()) === 0
);
const extras = page.locator('[data-testid="console-extras"]');
check(
	'Console grew a J button from detection, captioned with its purpose',
	(await extras.getByRole('button', { name: 'Action J' }).count()) === 1 &&
		(await extras.innerText()).includes('Jump'),
	await extras.innerText().catch(() => '(none)')
);
check(
	'Space button captioned with what it does',
	(await page.getByRole('button', { name: 'Action Space' }).innerText()).includes('Dash')
);
await shot(page, '04-console-dynamic.png');

await page.locator('[data-testid="controls-menu-toggle"]').click();
const menu = page.locator('[data-testid="controls-menu"]');
await menu.waitFor();
await sleep(600);
await shot(page, '05-controls-menu.png');
const rows = await menu
	.locator('[data-section="gameplay"] li')
	.evaluateAll((els) => els.map((e) => `${e.dataset.codes}|${e.innerText.replace(/\s+/g, ' ')}`));
check(
	'Menu lists J with its purpose',
	rows.some((r) => r.startsWith('KeyJ|') && r.includes('Jump')),
	rows.join(' ; ')
);
check(
	'Menu lists arrows as Move and Space as Dash',
	rows.some((r) => /ArrowUp/.test(r.split('|')[0]) && r.includes('Move')) &&
		rows.some((r) => r.startsWith('Space|') && r.includes('Dash'))
);
check(
	'ArrowLeft marked in use (seen handled live)',
	rows.some((r) => /ArrowLeft/.test(r.split('|')[0]) && /in use/i.test(r))
);
check(
	'Keys that do the same thing share one row',
	rows.some((r) => r.split('|')[0].split(' ').length === 4 && r.includes('Move')),
	rows.join(' ; ')
);
const listBox = await menu.locator('[data-testid="controls-list"]').boundingBox();
check(
	'List is compact (about five rows, then scrolls)',
	listBox.height <= 240,
	`h=${listBox.height}`
);

await menu.getByRole('searchbox').fill('jump');
await sleep(150);
const found = await menu
	.locator('[data-section="gameplay"] li')
	.evaluateAll((els) => els.map((e) => e.dataset.codes));
check('Search by purpose finds J only', found.join(',') === 'KeyJ', found.join(','));
await shot(page, '06-controls-search.png');

await frame.evaluate(() => (window.keysSeen.length = 0));
const jCap = menu.locator('button[data-code="KeyJ"]');
await jCap.hover();
await page.mouse.down();
await sleep(120);
await page.mouse.up();
check(
	'Pressing J in the menu reaches the game once',
	(await frame.evaluate(() => window.keysSeen.join(','))) === 'KeyJ'
);
await sleep(1200);
check(
	'J promoted to "in use" after the game handled it',
	(await menu.locator('li[data-code="KeyJ"] [data-evidence]').getAttribute('data-evidence')) ===
		'used'
);
await menu.getByRole('searchbox').fill('');

await menu.getByRole('tab', { name: 'All keys' }).click();
await sleep(200);
await shot(page, '07-controls-all-keys.png');
await frame.evaluate(() => (window.keysSeen.length = 0));
await menu.locator('[data-testid="controls-keyboard"] [data-code="KeyQ"]').click();
check(
	'All keys board sends an undetected key',
	(await frame.evaluate(() => window.keysSeen.join(','))) === 'KeyQ'
);
await menu.getByRole('tab', { name: /Controls detected/ }).click();
await menu.getByRole('button', { name: 'Close controls' }).click();

/* Shortcut and typing classification, from real keyboard use inside the game. */
await frame.locator('#c').click();
await page.keyboard.press('Control+s');
await frame.locator('#name').click();
await page.keyboard.type('ab');
await sleep(1500);
await page.locator('[data-testid="controls-menu-toggle"]').click();
await menu.waitFor();
await sleep(300);
check(
	'Ctrl+S classified as a shortcut, not a game key',
	(await menu.locator('[data-section="shortcut"] button[data-code="KeyS"]').count()) === 1 &&
		(await menu.locator('[data-section="gameplay"] button[data-code="KeyS"]').count()) === 0
);
check(
	'Typing into the text box is not counted as game keys',
	(await menu.locator('[data-section="gameplay"] button[data-code="KeyA"]').count()) === 0 &&
		(await menu.locator('[data-section="typing"]').count()) === 1
);
await shot(page, '08-controls-typing.png');
await frame.evaluate(() => document.activeElement && document.activeElement.blur());
await menu.locator('[data-testid="type-with-device"]').click();
await sleep(300);
check(
	'"Type" puts the caret in the game\'s text box',
	(await frame.evaluate(() => document.activeElement && document.activeElement.id)) === 'name'
);

/* ---------- edit mode ---------- */
await page.locator('[data-testid="console-edit-toggle"]').click();
await sleep(200);
await shot(page, '09-edit-mode.png');
await frame.evaluate(() => (window.keysSeen.length = 0));
await aBtn.scrollIntoViewIfNeeded();
const before = await aBtn.boundingBox();
await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
await page.mouse.down();
await page.mouse.move(before.x + before.width / 2 - 60, before.y + before.height / 2 - 40, {
	steps: 5
});
await page.mouse.up();
const after = await aBtn.boundingBox();
check(
	'Edit mode drags the button',
	Math.round(before.x - after.x) > 40,
	`dx=${Math.round(before.x - after.x)}`
);
check('Edit mode sends no keys', (await frame.evaluate(() => window.keysSeen.length)) === 0);
await page.locator('[data-testid="console-edit-toggle"]').click();
await shot(page, '10-after-edit.png');

/* ---------- mobile landscape ---------- */
const mobile = await browser.newContext({
	viewport: { width: 915, height: 412 },
	hasTouch: true,
	isMobile: true,
	deviceScaleFactor: 2
});
const mp = await mobile.newPage();
await mp.goto(`${BASE}/games/${GAME}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
await mp.getByRole('heading', { name: 'Console Lab' }).waitFor();
await mp.getByRole('button', { name: /play/i }).first().click();
await sleep(1500);
const toggle = mp.locator('[data-testid="touch-console-toggle"]');
if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
await mp
	.getByRole('button', { name: 'Fullscreen' })
	.click()
	.catch(() => {});
await sleep(1200);
await shot(mp, '11-mobile-console.png');
const fsControls = mp.locator('[data-testid="controls-menu-toggle-fs"]');
await fsControls.waitFor({ timeout: 8000 });
await fsControls.click();
await sleep(800);
check(
	'Controls menu opens from the fullscreen toolbar on a phone',
	(await mp.locator('[data-testid="controls-menu"]').count()) === 1
);
await shot(mp, '12-mobile-controls.png');

await browser.close();
await cleanup();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
