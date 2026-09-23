#!/usr/bin/env node
/**
 * End-to-end test of the in-game bridge, driven in real Chromium against the real app.
 *
 * Covers what unit tests cannot, because it all happens inside a game frame:
 *   - virtual storage: per-game localStorage / cookies isolated from the app origin,
 *     saved to the profile, restored on relaunch, on a fresh origin (synchronously from
 *     the preloaded profile) and over the postMessage pull (one reload);
 *   - IndexedDB records keep their types (Uint8Array, Date) through the profile;
 *   - saves survive a same-origin shell nesting the game (one set of stores per game), a
 *     profile store slower than the pull used to wait for, a forged `hydrate`, and a store
 *     whose reads fail (not "no saves": nothing is written over them, and the game gets
 *     them once the store reads again);
 *   - a game's saves are read and written only from the frame hosting that game: a frame
 *     inside it asking for another game's saves, and a frame in the app page outside it,
 *     are ignored;
 *   - live key detection: declared keys listed, keys the game handles promoted to "in use";
 *   - the console: one keydown per press (no duplicate dispatch), a canvas that listens
 *     itself gets the key even inside a listening wrapper, holds never turn into layout
 *     edits, joystick hysteresis, explicit edit mode;
 *   - the Controls menu (purposes, search, grouping), console buttons added from detection,
 *     and shortcut / typing classification;
 *   - the toolbar no longer carries a separate "Game menu" button.
 *
 * It writes tiny fixture games to static/games/_bridge-* (gitignored; the leading
 * underscore keeps them out of the catalog) and removes them afterwards.
 *
 * Usage:
 *   pnpm bridge-test                      # starts its own Vite dev server
 *   pnpm bridge-test -- --url http://localhost:5173   # reuse a running one
 *   pnpm bridge-test -- --out /tmp/shots  # also save screenshots of each stage
 *   CHROMIUM_PATH=/path/to/chrome pnpm bridge-test
 */
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

/*
 * A portal shell nesting the game in a same-origin frame (what relayed pages and offline
 * mirrors look like): both documents get the bridge with the same game id. The shell
 * writes its own key after the game saved, the way a portal SDK does.
 */
const NEST_GAME = '_bridge-nest';
const NEST_SHELL_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Nest Lab</title></head><body>
<iframe id="inner" src="inner.html" style="width:600px;height:400px"></iframe>
<script>window.shellWrite = function () { localStorage.setItem('sdk-seen', String(Date.now())); };</script>
</body></html>`;
const NEST_INNER_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Nest inner</title>
<script>
  window.bootCount = Number(localStorage.getItem('save') || '0') + 1;
  localStorage.setItem('save', String(window.bootCount));
  var req = indexedDB.open('nest-db', 1);
  req.onupgradeneeded = function () { req.result.createObjectStore('s'); };
  req.onsuccess = function () {
    var db = req.result;
    var g = db.transaction('s').objectStore('s').get('k');
    g.onsuccess = function () {
      window.idbBoot = g.result || 0;
      db.transaction('s', 'readwrite').objectStore('s').put(window.idbBoot + 1, 'k');
    };
  };
</script></head><body>inner</body></html>`;

/* Saves in localStorage only, nothing else to restore. */
const PLAIN_GAME = '_bridge-plain';
const PLAIN_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Plain Lab</title>
<script>
  window.bootCount = Number(localStorage.getItem('save') || '0') + 1;
  localStorage.setItem('save', String(window.bootCount));
</script></head><body>plain</body></html>`;

/* A canvas that listens for keys itself, inside a wrapper that listens too. */
const WRAP_GAME = '_bridge-wrap';
const WRAP_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Wrap Lab</title></head><body>
<div id="wrap"><canvas id="c" width="300" height="200" tabindex="0"></canvas></div>
<script>
  window.wrapKeys = []; window.canvasKeys = [];
  document.getElementById('wrap').addEventListener('keydown', function (e) { window.wrapKeys.push(e.code); });
  document.getElementById('c').addEventListener('keydown', function (e) { window.canvasKeys.push(e.code); e.preventDefault(); });
</script></body></html>`;

/*
 * Third-party HTML the app plays from a document it makes itself (an app-made shell):
 * a Drive U 7 style `online/embed.html` (the `local` route) and a page on a host that
 * labels HTML `text/plain` (the `shell` route; jsDelivr, answered here by the test). The
 * game saves the way Unity does — IDBFS: a `FILE_DATA` store with a `timestamp` index,
 * walked with a key cursor — and reports what it can reach of the app around it.
 */
const SHELL_GAME = '_bridge-shell';
const SHELL_BASE = 'https://cdn.jsdelivr.net/gh/pt-bridge-test/shell@1/';
const REMOTE_GAME = '_bridge-remote';
const REMOTE_PAGE = 'https://cdn.jsdelivr.net/gh/pt-bridge-test/remote@1/index.html';
const SHELL_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Shell Lab</title>
<script src="asset.js"></script>
<script>
  window.bootCount = Number(localStorage.getItem('save') || '0') + 1;
  localStorage.setItem('save', String(window.bootCount));
  window.bootCookie = document.cookie;
  document.cookie = 'shell-cookie=' + window.bootCount + '; max-age=86400; path=/';
  window.tryEscape = function () {
    function probe(read) {
      try { read(); return 'reached'; } catch (e) { return 'blocked:' + e.name; }
    }
    return {
      origin: self.origin,
      parentDocument: probe(function () { return parent.document.title; }),
      topDocument: probe(function () { return top.document.title; }),
      tauri: probe(function () { if (!parent.__TAURI_INTERNALS__) throw new Error('absent'); }),
      appStorage: probe(function () { return parent.localStorage.length; }),
      appSaves: probe(function () { return parent.__ptGameProfiles; }),
      unityCache: probe(function () { indexedDB.open('UnityCache', 1); })
    };
  };
  var req = indexedDB.open('/idbfs', 21);
  req.onupgradeneeded = function (e) {
    var db = e.target.result;
    var tx = e.target.transaction;
    var store = db.objectStoreNames.contains('FILE_DATA') ? tx.objectStore('FILE_DATA') : db.createObjectStore('FILE_DATA');
    if (!store.indexNames.contains('timestamp')) store.createIndex('timestamp', 'timestamp', { unique: false });
  };
  req.onsuccess = function () {
    var db = req.result;
    var tx = db.transaction(['FILE_DATA'], 'readonly');
    var entries = 0;
    tx.objectStore('FILE_DATA').index('timestamp').openKeyCursor().onsuccess = function (ev) {
      var cursor = ev.target.result;
      if (!cursor) return;
      if (cursor.key instanceof Date && typeof cursor.primaryKey === 'string') entries++;
      cursor.continue();
    };
    var g = tx.objectStore('FILE_DATA').get('/idbfs/save.dat');
    tx.oncomplete = function () {
      var f = g.result;
      window.idbState = (f ? 'u8:' + Array.from(f.contents).join('.') + (f.timestamp instanceof Date ? ':date' : ':nodate') : 'none') + '|' + entries;
      var w = db.transaction(['FILE_DATA'], 'readwrite');
      w.objectStore('FILE_DATA').put({ timestamp: new Date(), mode: 33206, contents: new Uint8Array([1, 2, window.bootCount]) }, '/idbfs/save.dat');
    };
  };
</script></head><body>shell</body></html>`;
const REMOTE_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Remote Lab</title>
<script>
  window.bootCount = Number(localStorage.getItem('save') || '0') + 1;
  localStorage.setItem('save', String(window.bootCount));
  window.parentReach = (function () { try { return typeof parent.document; } catch (e) { return 'blocked:' + e.name; } })();
</script></head><body>remote</body></html>`;

function writeLabGame(id, name, files, extra = {}) {
	const dir = path.join(ROOT, 'static/games', id, 'online');
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		path.join(dir, 'metadata.json'),
		JSON.stringify({
			id,
			name,
			author: 'Test',
			description: 'Fixture for pnpm bridge-test.',
			thumbnail: '',
			category: 'Test',
			...extra
		})
	);
	for (const [file, body] of Object.entries(files)) writeFileSync(path.join(dir, file), body);
}

/** What the test's jsDelivr answers: the remote page as text/plain, and the shell's asset. */
async function routeShellHosts(ctx) {
	await ctx.route('https://cdn.jsdelivr.net/gh/pt-bridge-test/**', (route) => {
		const url = route.request().url();
		const cors = { 'access-control-allow-origin': '*' };
		if (url === REMOTE_PAGE) {
			return route.fulfill({
				status: 200,
				headers: { ...cors, 'content-type': 'text/plain; charset=utf-8' },
				body: REMOTE_HTML
			});
		}
		if (url === `${SHELL_BASE}asset.js`) {
			return route.fulfill({
				status: 200,
				headers: { ...cors, 'content-type': 'application/javascript' },
				body: 'window.assetLoaded = true;'
			});
		}
		return route.fulfill({ status: 404, headers: cors, body: '' });
	});
	return ctx;
}

function writeFixture() {
	writeLabGame(NEST_GAME, 'Nest Lab', {
		'index.html': NEST_SHELL_HTML,
		'inner.html': NEST_INNER_HTML
	});
	writeLabGame(PLAIN_GAME, 'Plain Lab', { 'index.html': PLAIN_HTML });
	writeLabGame(WRAP_GAME, 'Wrap Lab', { 'index.html': WRAP_HTML });
	writeLabGame(
		SHELL_GAME,
		'Shell Lab',
		{ 'embed.html': SHELL_HTML },
		{ localEmbed: true, embedBaseUrl: SHELL_BASE }
	);
	writeLabGame(REMOTE_GAME, 'Remote Lab', {}, { onlineEmbedUrl: REMOTE_PAGE });
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

/*
 * Real engine builds, to check the bridge reads keys from the engines themselves — not
 * from imitations of their APIs. Fetched once with `npm pack` into node_modules/.cache;
 * without network these checks are reported as skipped, never as passes.
 */
const ENGINE_CACHE = path.join(ROOT, 'node_modules/.cache/pt-bridge-engines');
const ENGINES = [
	{
		id: '_bridge-phaser3',
		name: 'Phaser 3',
		pkg: 'phaser',
		ver: '3.80.1',
		file: 'dist/phaser.min.js',
		game: `new Phaser.Game({ type: Phaser.CANVAS, width: 320, height: 240, banner: false,
  scene: { create: function () {
    this.input.keyboard.addKeys({ jump: 'SPACE', dash: 'K', left: 'A', right: 'D' });
    this.input.keyboard.createCursorKeys();
    this.input.keyboard.on('keydown-P', function () {});
  } } });`,
		bound: ['Space', 'KeyK', 'KeyA', 'KeyD', 'ArrowUp', 'ShiftLeft', 'KeyP'],
		purposes: { Space: 'Jump', KeyK: 'Dash' },
		extra: { code: 'KeyK', caption: 'Dash' },
		hidden: ['Action B', 'Action Esc']
	},
	{
		id: '_bridge-phaserce',
		name: 'Phaser CE',
		pkg: 'phaser-ce',
		ver: '2.20.0',
		file: 'build/phaser.min.js',
		game: `new Phaser.Game(320, 240, Phaser.CANVAS, '', { create: function () {
    this.game.input.keyboard.addKeys({ fire: Phaser.Keyboard.F });
    this.game.input.keyboard.createCursorKeys();
  } });`,
		bound: ['KeyF', 'ArrowLeft', 'ArrowRight'],
		purposes: { KeyF: 'Fire' },
		extra: { code: 'KeyF', caption: 'Fire' },
		hidden: ['Action A', 'Action B']
	},
	{
		id: '_bridge-playcanvas',
		name: 'PlayCanvas',
		pkg: 'playcanvas',
		ver: '1.73.4',
		file: 'build/playcanvas.min.js',
		game: `var kb = new pc.Keyboard(window);
  (function loop() { kb.isPressed(pc.KEY_SPACE); kb.wasPressed(pc.KEY_E); kb.update(); requestAnimationFrame(loop); })();`,
		bound: ['Space', 'KeyE'],
		purposes: {},
		extra: { code: 'KeyE', caption: '' },
		hidden: ['Action A']
	},
	{
		id: '_bridge-kaplay',
		name: 'Kaplay',
		pkg: 'kaplay',
		ver: '3001.0.19',
		file: 'dist/kaplay.js',
		game: `kaplay({ global: true, width: 320, height: 240 });
  onKeyPress('space', function () {});
  onKeyDown('left', function () {});
  onUpdate(function () { isKeyDown('x'); });`,
		bound: ['Space', 'ArrowLeft', 'KeyX'],
		purposes: {},
		extra: null,
		hidden: ['Action B']
	}
];

function ensureEngine(engine) {
	const dir = path.join(ENGINE_CACHE, `${engine.pkg}-${engine.ver}`);
	const file = path.join(dir, 'package', engine.file);
	if (existsSync(file)) return file;
	try {
		mkdirSync(dir, { recursive: true });
		execFileSync(
			'npm',
			['pack', `${engine.pkg}@${engine.ver}`, '--silent', '--pack-destination', dir],
			{
				stdio: 'ignore'
			}
		);
		const tgz = readdirSync(dir).find((f) => f.endsWith('.tgz'));
		execFileSync('tar', ['xzf', path.join(dir, tgz), '-C', dir]);
		return existsSync(file) ? file : null;
	} catch {
		return null;
	}
}

function writeEngineFixtures() {
	for (const engine of ENGINES) {
		const lib = ensureEngine(engine);
		engine.available = Boolean(lib);
		if (!lib) continue;
		const dir = path.join(ROOT, 'static/games', engine.id, 'online');
		mkdirSync(dir, { recursive: true });
		copyFileSync(lib, path.join(dir, 'engine.js'));
		writeFileSync(
			path.join(dir, 'metadata.json'),
			JSON.stringify({
				id: engine.id,
				name: `${engine.name} Lab`,
				author: 'Test',
				description: 'Engine fixture for pnpm bridge-test.',
				thumbnail: '',
				category: 'Test'
			})
		);
		writeFileSync(
			path.join(dir, 'index.html'),
			`<!doctype html><html><head><meta charset="utf-8"><title>${engine.name}</title>` +
				`<style>body{margin:0;background:#111}</style><script src="engine.js"></script></head>` +
				`<body><script>\n${engine.game}\n</script></body></html>`
		);
	}
}

async function cleanup() {
	rmSync(FIXTURE_DIR, { recursive: true, force: true });
	for (const id of [NEST_GAME, PLAIN_GAME, WRAP_GAME, SHELL_GAME, REMOTE_GAME]) {
		rmSync(path.join(ROOT, 'static/games', id), { recursive: true, force: true });
	}
	for (const engine of ENGINES) {
		rmSync(path.join(ROOT, 'static/games', engine.id), { recursive: true, force: true });
	}
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
writeEngineFixtures();
process.on('SIGINT', () => void cleanup().then(() => process.exit(130)));
if (!BASE) BASE = await startServer();

const results = [];
function check(name, ok, detail = '') {
	results.push({ name, ok, detail });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
	...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
	/* Software WebGL, so engines that need a GL context boot headless too. */
	args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
});
/*
 * Profiles are read back from this browser's IndexedDB, so keep them there. A puller
 * running on this machine (another checkout's, say) would otherwise answer through the
 * dev proxy and take the reads, and the checks would pass or fail depending on it.
 */
const newContext = browser.newContext.bind(browser);
browser.newContext = async (options) => {
	const ctx = await newContext(options);
	await ctx.route('**/api/offline/health', (route) => route.abort());
	await ctx.route('**/api/browser-data/**', (route) => route.abort());
	return ctx;
};

/*
 * Games open fullscreen by default now; these checks drive the windowed toolbar, so the
 * desktop contexts turn that off (the phone context keeps it and uses the in-game menu).
 */
async function windowedPlayer(ctx) {
	await ctx.addInitScript(() => {
		/* Init scripts run in every frame; a sandboxed game frame has no storage to set. */
		if (window !== window.top) return;
		const key = 'potato-tomato-site-settings-v1';
		let saved = {};
		try {
			saved = JSON.parse(localStorage.getItem(key) || '{}') || {};
		} catch {
			saved = {};
		}
		saved.gamePlayer = { ...(saved.gamePlayer || {}), autoFullscreen: false };
		localStorage.setItem(key, JSON.stringify(saved));
	});
	return ctx;
}
const context = await windowedPlayer(
	await browser.newContext({ viewport: { width: 1280, height: 900 } })
);
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

/**
 * The frame of `game` once `ready` holds in it, riding out reloads (a reload destroys the
 * context mid-wait). Falls back to whatever frame is there when `ms` runs out, so the
 * check that follows reports what it found instead of a timeout.
 */
async function settledFrame(target, game, ready, ms, file = '', arg = undefined) {
	const deadline = Date.now() + ms;
	let last = null;
	while (Date.now() < deadline) {
		const f = target.frames().find((fr) => fr.url().includes(`/games/${game}/online/${file}`));
		if (f) {
			last = f;
			try {
				if (await f.evaluate(ready, arg)) return f;
			} catch {
				/* navigating */
			}
		}
		await sleep(150);
	}
	if (!last) throw new Error(`frame of ${game} not found`);
	return last;
}

/* Games start by themselves once the play URL resolves: just wait for the frame. */
async function play() {
	return gameFrame();
}

async function relaunch() {
	await relaunchLab(page);
	return play();
}

async function storedProfile(target = page, game = GAME) {
	return target.evaluate(
		(game) =>
			new Promise((resolve) => {
				const req = indexedDB.open('potatotomato-browser-data-v1');
				req.onsuccess = () => {
					const db = req.result;
					if (!db.objectStoreNames.contains('browserProfiles')) return resolve(null);
					const store = db.transaction('browserProfiles').objectStore('browserProfiles');
					/* The real read, even while `failProfileReads` makes the app's reads fail. */
					const get = IDBObjectStore.prototype.get.__real || IDBObjectStore.prototype.get;
					const g = get.call(store, game);
					g.onsuccess = () => resolve(g.result ?? null);
				};
				req.onerror = () => resolve(null);
			}),
		game
	);
}

/** Open a lab game in its own windowed context (it starts by itself) and hand back its page. */
async function openLab(game, name) {
	const ctx = await windowedPlayer(
		await browser.newContext({ viewport: { width: 1280, height: 900 } })
	);
	const p = await ctx.newPage();
	p.on('pageerror', (e) => console.log(`[pageerror ${game}]`, e.message));
	await p.goto(`${BASE}/games/${game}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
	await p.getByRole('heading', { name }).waitFor({ timeout: 180000 });
	return p;
}

/*
 * Restart the game, and wait for its old frame to go: the game first pushes its last save
 * (a moment), and a check that finds the old frame still there would read the old game.
 */
async function relaunchLab(p) {
	const old = p.frames().filter((f) => f !== p.mainFrame());
	await p.locator('[data-testid="relaunch-game"]').click();
	for (let i = 0; i < 100 && old.some((f) => !f.isDetached()); i++) await sleep(50);
}

/* A client-side navigation: the window, and whatever a check patched onto it, survives. */
async function spaNavigate(p, path) {
	await p.evaluate((path) => {
		const a = document.createElement('a');
		a.href = path;
		document.body.appendChild(a);
		a.click();
		a.remove();
	}, path);
}

/**
 * Relaunch used to leave a Play poster to set things up behind; Restart now brings the
 * game straight back. Leave for the catalog instead (the game page unmounts and flushes),
 * run `setup` with no game running, and come back to a game that starts by itself.
 */
async function reopenLab(p, game, setup) {
	await spaNavigate(p, '/home');
	await p.waitForURL(/\/home/);
	await sleep(500);
	await setup();
	await spaNavigate(p, `/games/${game}`);
}

/*
 * Make the app's profile store slow: every open of it waits `ms` first. Stands in for a
 * busy or cold puller, the case where the frame's pull goes unanswered for a while.
 */
async function slowProfileStore(p, ms) {
	await p.evaluate((ms) => {
		const realOpen = indexedDB.open.bind(indexedDB);
		indexedDB.open = function (name, version) {
			if (name !== 'potatotomato-browser-data-v1') return realOpen(name, version);
			const late = {
				onsuccess: null,
				onerror: null,
				onupgradeneeded: null,
				result: null,
				error: null
			};
			setTimeout(() => {
				const req = realOpen(name, version);
				req.onupgradeneeded = (e) => late.onupgradeneeded?.(e);
				req.onsuccess = () => {
					late.result = req.result;
					late.onsuccess?.();
				};
				req.onerror = () => {
					late.error = req.error;
					late.onerror?.();
				};
			}, ms);
			return late;
		};
		window.__fastProfileStore = () => delete indexedDB.open;
	}, ms);
}

/*
 * Make every read of the app's profile store fail, while writes still work: a puller that
 * answers 500, an IndexedDB error, the desktop app's saves command failing. `heal` undoes it.
 */
async function failProfileReads(p) {
	await p.evaluate(() => {
		const real = IDBObjectStore.prototype.get.__real || IDBObjectStore.prototype.get;
		const failing = function (key) {
			if (this.name !== 'browserProfiles') return real.call(this, key);
			const req = {
				result: undefined,
				error: new DOMException('Simulated read failure', 'UnknownError'),
				onsuccess: null,
				onerror: null
			};
			setTimeout(() => req.onerror?.(new Event('error')), 0);
			return req;
		};
		failing.__real = real;
		IDBObjectStore.prototype.get = failing;
		window.__healProfileReads = () => {
			IDBObjectStore.prototype.get = real;
		};
	});
}

/* The app page's own view of saves, as a same-origin frame reads it at boot. */
async function showProfileBag(p) {
	await p.evaluate(() => {
		Object.defineProperty(window, '__ptGameProfiles', {
			configurable: true,
			writable: true,
			value: Object.create(null)
		});
	});
}

/** The first localStorage bucket of a stored profile (a lab game saves on one origin). */
function savedBucket(profile) {
	return profile ? Object.values(profile.profile.Default.localStorage)[0] : undefined;
}

/* Cross-origin frames cannot read the preloaded profile: hide it so the frame must pull. */
async function hideProfileBag(p, game) {
	await p.evaluate((game) => {
		if (window.__ptGameProfiles) delete window.__ptGameProfiles[game];
		Object.defineProperty(window, '__ptGameProfiles', {
			configurable: true,
			get: () => undefined,
			set: () => {}
		});
	}, game);
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
await page.locator('[data-testid="relaunch-game"]').click();
/* The answer, the restore and the reload take a variable while on a busy dev server. */
frame = await settledFrame(page, GAME, () => window.bootCount >= 4 && window.idbState, 15000);
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

/* ---------- saves: nested frames, slow stores, forged answers ---------- */
{
	const np = await openLab(NEST_GAME, 'Nest Lab');
	const inner = () =>
		settledFrame(np, NEST_GAME, () => typeof window.idbBoot === 'number', 15000, 'inner.html');
	await inner();
	await sleep(2500);
	const shell = () =>
		np
			.frames()
			.find((f) => f.url().includes(`/games/${NEST_GAME}/online/`) && !f.url().includes('inner'));
	await shell().evaluate(() => window.shellWrite());
	await sleep(2500);
	await relaunchLab(np);
	let nf = await inner();
	check(
		'Nested frames: a shell write after the save does not roll the save back',
		(await nf.evaluate(() => window.bootCount)) === 2,
		`bootCount=${await nf.evaluate(() => window.bootCount)}`
	);
	await sleep(2500);
	await shell().evaluate(() => window.shellWrite());
	await sleep(2500);
	const nestDb = (await storedProfile(np, NEST_GAME))?.profile.Default.indexedDB.find(
		(d) => d.name === 'nest-db'
	);
	check(
		"Nested frames: the shell's push keeps the game's newer IndexedDB record",
		Boolean(nestDb?.records.some((r) => r.value === '__pt2:2')),
		JSON.stringify(nestDb?.records.map((r) => r.value))
	);
	/* Fresh origin, pulled: the frame that owns the stores reloads, the nested game reads the saves. */
	await reopenLab(np, NEST_GAME, async () => {
		await np.evaluate(async () => {
			for (const k of Object.keys(localStorage))
				if (k.startsWith('__pt_vs:')) localStorage.removeItem(k);
			for (const k of Object.keys(sessionStorage))
				if (k.startsWith('__pt_vs:')) sessionStorage.removeItem(k);
			await new Promise((r) => {
				const d = indexedDB.deleteDatabase('nest-db');
				d.onsuccess = d.onerror = d.onblocked = () => r();
			});
		});
		await hideProfileBag(np, NEST_GAME);
	});
	nf = await settledFrame(
		np,
		NEST_GAME,
		() => window.bootCount >= 3 && typeof window.idbBoot === 'number',
		15000,
		'inner.html'
	);
	const nested = await nf.evaluate(() => `${window.bootCount}/${window.idbBoot}`);
	check(
		'Nested frames, pulled on a fresh origin: saves restored (LS/IDB)',
		nested === '3/2',
		nested
	);
	await np.context().close();
}
{
	/*
	 * A store that answers after 6 s: the empty boot must not be pushed over the saves.
	 * The plain game keeps its saves in localStorage only; with a database to restore, the
	 * reload that restore triggers used to hide this case.
	 */
	const sp = await openLab(PLAIN_GAME, 'Plain Lab');
	await settledFrame(sp, PLAIN_GAME, () => window.bootCount === 1, 15000);
	await sleep(2500);
	await relaunchLab(sp);
	await settledFrame(sp, PLAIN_GAME, () => window.bootCount === 2, 15000);
	await sleep(2500);
	await reopenLab(sp, PLAIN_GAME, async () => {
		await sp.evaluate(() => {
			for (const k of Object.keys(localStorage))
				if (k.startsWith('__pt_vs:')) localStorage.removeItem(k);
		});
		await hideProfileBag(sp, PLAIN_GAME);
		await slowProfileStore(sp, 6000);
	});
	const slow = await settledFrame(sp, PLAIN_GAME, () => window.bootCount >= 3, 25000);
	check(
		'Slow profile store: the game still boots onto its saves',
		(await slow.evaluate(() => window.bootCount)) === 3,
		`bootCount=${await slow.evaluate(() => window.bootCount)}`
	);
	await sleep(2500);
	/* Before the app has answered, something else in the game frame forges the answer. */
	await relaunchLab(sp);
	const forged = await settledFrame(
		sp,
		PLAIN_GAME,
		() => typeof window.bootCount === 'number',
		15000
	);
	await forged.evaluate(() => {
		const evil = {
			schemaVersion: 1,
			updatedAt: Date.now(),
			profile: {
				Default: {
					localStorage: {
						[location.origin]: { save: '999', __pt_ts: String(Date.now() + 1e9) }
					},
					sessionStorage: {},
					cookies: [],
					indexedDB: []
				}
			}
		};
		const msg = { type: 'potato-tomato-game-storage', action: 'hydrate', data: evil };
		window.postMessage({ ...msg, gameId: window.__ptStorageBridge.gameId }, '*');
	});
	await sleep(3000);
	const after = await settledFrame(
		sp,
		PLAIN_GAME,
		() => typeof window.bootCount === 'number',
		15000
	);
	const stored = await after.evaluate(() => localStorage.getItem('save'));
	check('A hydrate that does not come from the app is ignored', stored === '4', `save=${stored}`);
	/* Back to a fast store, and let the last writes through the slow one land first. */
	await sp.evaluate(() => window.__fastProfileStore?.());
	for (let i = 0; i < 100; i++) {
		if (savedBucket(await storedProfile(sp, PLAIN_GAME))?.save === stored) break;
		await sleep(200);
	}

	/*
	 * A store whose reads fail. The app used to answer that with "no saves": the frame (here
	 * same-origin, booting from the page's preloaded profiles) started empty and its first
	 * push replaced the real saves. Now the app says nothing until it can read them.
	 */
	const savedBefore = savedBucket(await storedProfile(sp, PLAIN_GAME))?.save;
	await reopenLab(sp, PLAIN_GAME, async () => {
		await sp.evaluate(() => {
			for (const k of Object.keys(localStorage))
				if (k.startsWith('__pt_vs:')) localStorage.removeItem(k);
		});
		await showProfileBag(sp);
		await failProfileReads(sp);
	});
	await settledFrame(sp, PLAIN_GAME, () => typeof window.bootCount === 'number', 15000);
	await sleep(3000);
	const savedDuring = savedBucket(await storedProfile(sp, PLAIN_GAME))?.save;
	check(
		'Failing profile store: the empty boot is not written over the saves',
		Boolean(savedBefore) && savedDuring === savedBefore,
		`before=${savedBefore} during=${savedDuring}`
	);
	await sp.evaluate(() => window.__healProfileReads());
	const expected = Number(savedBefore) + 1;
	const healed = await settledFrame(
		sp,
		PLAIN_GAME,
		(n) => window.bootCount === n,
		25000,
		'',
		expected
	);
	const healedBoot = await healed.evaluate(() => window.bootCount);
	check(
		'Failing profile store: once it reads again, the game gets its saves back',
		healedBoot === expected,
		`bootCount=${healedBoot} expected=${expected}`
	);
	await sleep(2500);
	const savedAfter = savedBucket(await storedProfile(sp, PLAIN_GAME))?.save;
	check(
		'Failing profile store: saves continue from the real ones',
		savedAfter === String(expected),
		`save=${savedAfter}`
	);

	/*
	 * A game's saves belong to the frame hosting it. Any frame nested in the page used to
	 * be able to pull or push any game's profile by naming it.
	 */
	const hosted = await settledFrame(
		sp,
		PLAIN_GAME,
		() => typeof window.bootCount === 'number',
		15000
	);
	const evilProfile = (origin) => ({
		schemaVersion: 1,
		updatedAt: Date.now(),
		profile: {
			Default: {
				localStorage: { [origin]: { save: '999', __pt_ts: String(Date.now() + 1e9) } },
				sessionStorage: {},
				cookies: [],
				indexedDB: []
			}
		}
	});
	/* A frame inside this game (an ad, say) asks for and writes another game's saves. */
	await hosted.evaluate(
		({ other, evil }) => {
			const f = document.createElement('iframe');
			f.srcdoc = `<script>
				window.answers = [];
				addEventListener('message', (e) => {
					if (e.data && e.data.type === 'potato-tomato-game-storage') answers.push(e.data);
				});
				const msg = { type: 'potato-tomato-game-storage', gameId: ${JSON.stringify(other)} };
				top.postMessage({ ...msg, action: 'pull' }, '*');
				top.postMessage({ ...msg, action: 'push', data: ${JSON.stringify(evil)} }, '*');
			</script>`;
			f.id = 'foreign-in-game';
			document.body.appendChild(f);
		},
		{ other: NEST_GAME, evil: evilProfile('https://foreign.example') }
	);
	/* A frame in the app page, outside the game's frame, writes this game's saves. */
	await sp.evaluate(
		({ game, evil }) => {
			const f = document.createElement('iframe');
			f.srcdoc = `<script>
				window.answers = [];
				addEventListener('message', (e) => {
					if (e.data && e.data.type === 'potato-tomato-game-storage') answers.push(e.data);
				});
				const msg = { type: 'potato-tomato-game-storage', gameId: ${JSON.stringify(game)} };
				top.postMessage({ ...msg, action: 'pull' }, '*');
				top.postMessage({ ...msg, action: 'push', data: ${JSON.stringify(evil)} }, '*');
			</script>`;
			f.id = 'foreign-in-app';
			f.style.display = 'none';
			document.body.appendChild(f);
		},
		{ game: PLAIN_GAME, evil: evilProfile('https://foreign.example') }
	);
	await sleep(2500);
	const otherGame = await storedProfile(sp, NEST_GAME);
	const answersInGame = await hosted.evaluate(
		() => document.getElementById('foreign-in-game')?.contentWindow?.answers?.length ?? -1
	);
	check(
		"A frame inside one game cannot read or write another game's saves",
		otherGame === null && answersInGame === 0,
		`other game stored=${JSON.stringify(savedBucket(otherGame))} answers=${answersInGame}`
	);
	const plainNow = await storedProfile(sp, PLAIN_GAME);
	const answersInApp = await sp.evaluate(
		() => document.getElementById('foreign-in-app')?.contentWindow?.answers?.length ?? -1
	);
	check(
		"A frame outside the game's frame cannot read or write its saves",
		!plainNow?.profile.Default.localStorage['https://foreign.example'] && answersInApp === 0,
		`buckets=${Object.keys(plainNow?.profile.Default.localStorage ?? {}).join(',')} answers=${answersInApp}`
	);
	await sp.context().close();
}
{
	const wp = await openLab(WRAP_GAME, 'Wrap Lab');
	const wf = await settledFrame(wp, WRAP_GAME, () => Array.isArray(window.canvasKeys), 15000);
	/*
	 * The toolbar's Controls button only shows once a game has controls detected, and this
	 * bare lab has none, so press a console button instead: the same dispatch path.
	 */
	await wp.locator('[data-testid="touch-console-toggle"]').click();
	const spaceBtn = wp.getByRole('button', { name: 'Action Space' });
	await spaceBtn.waitFor({ timeout: 8000 });
	await spaceBtn.hover();
	await wp.mouse.down();
	await sleep(150);
	await wp.mouse.up();
	await sleep(200);
	const got = await wf.evaluate(
		() => `${window.canvasKeys.join(',')}|${window.wrapKeys.join(',')}`
	);
	check(
		'A listening canvas inside a listening wrapper gets console keys',
		got === 'Space|Space',
		got
	);
	await wp.context().close();
}

/* ---------- app-made shells: third-party HTML, sandboxed away from the app ---------- */

/**
 * The frame of an app-made shell playing `game`: a sandboxed srcdoc, known by its bridge
 * (Playwright reports its URL as `about:srcdoc`, or as nothing once the game is written in).
 */
async function shellFrame(target, game, ready, ms, arg = undefined) {
	const deadline = Date.now() + ms;
	let last = null;
	while (Date.now() < deadline) {
		for (const f of target.frames()) {
			if (f === target.mainFrame() || /^https?:/.test(f.url())) continue;
			try {
				if ((await f.evaluate(() => window.__ptStorageBridge?.gameId ?? '')) !== game) continue;
				last = f;
				if (await f.evaluate(ready, arg)) return f;
			} catch {
				/* writing the game in, or reloading */
			}
		}
		await sleep(150);
	}
	if (!last) throw new Error(`shell frame of ${game} not found`);
	return last;
}

async function openShellLab(game, name) {
	const ctx = await routeShellHosts(
		await windowedPlayer(await browser.newContext({ viewport: { width: 1280, height: 900 } }))
	);
	const p = await ctx.newPage();
	p.on('pageerror', (e) => console.log(`[pageerror ${game}]`, e.message));
	await p.goto(`${BASE}/games/${game}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
	await p.getByRole('heading', { name }).waitFor({ timeout: 180000 });
	return p;
}

{
	const hp = await openShellLab(SHELL_GAME, 'Shell Lab');
	/*
	 * `parent.__TAURI_INTERNALS__` is what the desktop app's page carries. Not defined here:
	 * the app would take this page for the desktop app. Reading any such property across the
	 * sandbox throws whether it exists or not, which is what the game sees in the app.
	 */
	let sf = await shellFrame(hp, SHELL_GAME, () => typeof window.idbState === 'string', 20000);
	const sandbox = await hp.evaluate(
		() => document.querySelector('iframe[sandbox]')?.getAttribute('sandbox') ?? null
	);
	check(
		'Shell frame is sandboxed without the app origin',
		Boolean(sandbox) && !sandbox.split(/\s+/).includes('allow-same-origin'),
		String(sandbox)
	);
	const escape = await sf.evaluate(() => window.tryEscape());
	check('Shell game runs with an opaque origin', escape.origin === 'null', escape.origin);
	check(
		'Shell game cannot reach parent.document or the top document',
		escape.parentDocument.startsWith('blocked:') && escape.topDocument.startsWith('blocked:'),
		`${escape.parentDocument} / ${escape.topDocument}`
	);
	check(
		'Shell game cannot reach parent.__TAURI_INTERNALS__',
		escape.tauri.startsWith('blocked:'),
		escape.tauri
	);
	check(
		"Shell game cannot reach the app's storage or its saves of other games",
		escape.appStorage.startsWith('blocked:') && escape.appSaves.startsWith('blocked:'),
		`${escape.appStorage} / ${escape.appSaves}`
	);
	check(
		'Shell game loads its assets from its own host (<base>)',
		await sf.evaluate(() => window.assetLoaded === true)
	);
	check(
		'Shell game: caches are refused, as the opaque origin itself would',
		escape.unityCache === 'blocked:SecurityError',
		escape.unityCache
	);
	const firstBoot = await sf.evaluate(
		() => `${window.bootCount}|${window.__ptStorageBridge?.virtual}|${window.idbState}`
	);
	check(
		'Shell first boot: virtual storage and an in-memory IndexedDB',
		firstBoot === '1|true|none|0',
		firstBoot
	);
	await sleep(2500);
	const shellProf = await storedProfile(hp, SHELL_GAME);
	check(
		'Shell saves reach the app: localStorage, cookie, IndexedDB',
		savedBucket(shellProf)?.save === '1' &&
			Boolean(shellProf?.profile.Default.cookies.find((c) => c.name === 'shell-cookie')) &&
			Boolean(
				shellProf?.profile.Default.indexedDB
					.find((d) => d.name === '/idbfs')
					?.records.some((r) => r.value.startsWith('__pt2:'))
			),
		JSON.stringify(savedBucket(shellProf))
	);
	await relaunchLab(hp);
	sf = await shellFrame(
		hp,
		SHELL_GAME,
		() => window.bootCount >= 2 && typeof window.idbState === 'string',
		20000
	);
	const restored = await sf.evaluate(
		() => `${window.bootCount}|${window.bootCookie}|${window.idbState}`
	);
	check(
		'Shell relaunch boots onto its saves, with no reload (LS, cookie, IDB)',
		restored === '2|shell-cookie=1|u8:1.2.1:date|1',
		restored
	);
	await sleep(2500);
	/* Games restart themselves with location.reload(); a sandboxed blob: could not. */
	await sf.evaluate(() => setTimeout(() => location.reload(), 0));
	sf = await shellFrame(
		hp,
		SHELL_GAME,
		() => window.bootCount >= 3 && typeof window.idbState === 'string',
		20000
	);
	const reloaded = await sf.evaluate(() => `${window.bootCount}|${window.idbState}`);
	check(
		'A shell game that reloads itself comes back on its saves',
		reloaded === '3|u8:1.2.2:date|1',
		reloaded
	);
	await sleep(2500);
	/* A store slower than the loader waits: the game starts, then reloads once onto the saves. */
	await reopenLab(hp, SHELL_GAME, async () => {
		await hp.evaluate((game) => {
			if (window.__ptGameProfiles) delete window.__ptGameProfiles[game];
		}, SHELL_GAME);
		await slowProfileStore(hp, 7000);
	});
	sf = await shellFrame(
		hp,
		SHELL_GAME,
		() => window.bootCount >= 4 && typeof window.idbState === 'string',
		30000
	);
	const late = await sf.evaluate(() => `${window.bootCount}|${window.idbState}`);
	check(
		'Shell, store slower than the loader waits: one reload onto the saves',
		late === '4|u8:1.2.3:date|1',
		late
	);
	await hp.evaluate(() => window.__fastProfileStore?.());
	await sleep(2500);
	/*
	 * Leave for another game straight after a write, inside the push interval: only the
	 * frame's last push, sent as it unloads, carries the write.
	 */
	await sf.evaluate(() => localStorage.setItem('last', 'final-push'));
	await spaNavigate(hp, `/games/${PLAIN_GAME}`);
	await settledFrame(hp, PLAIN_GAME, () => typeof window.bootCount === 'number', 20000);
	await sleep(1500);
	const afterSwitch = savedBucket(await storedProfile(hp, SHELL_GAME));
	check(
		"Switching games keeps the last game's final save push",
		afterSwitch?.last === 'final-push',
		JSON.stringify(afterSwitch)
	);
	await hp.context().close();
}
{
	const rp = await openShellLab(REMOTE_GAME, 'Remote Lab');
	let rf = await shellFrame(rp, REMOTE_GAME, () => typeof window.bootCount === 'number', 20000);
	const reach = await rf.evaluate(() => `${self.origin}|${window.parentReach}|${window.bootCount}`);
	check(
		'A text/plain host’s HTML plays sandboxed (shell route)',
		reach === 'null|blocked:SecurityError|1',
		reach
	);
	await sleep(2500);
	await relaunchLab(rp);
	rf = await shellFrame(rp, REMOTE_GAME, () => window.bootCount >= 2, 20000);
	check(
		'A text/plain host’s game keeps its saves across a relaunch',
		(await rf.evaluate(() => window.bootCount)) === 2,
		`bootCount=${await rf.evaluate(() => window.bootCount)}`
	);
	await rp.context().close();
}

/*
 * The privacy lock, turned on while a game is still loading. The frame used to be sent to
 * about:blank behind Svelte's back: the launch watchdog took the blank page for a failed
 * launch and moved the game to its next route, which Svelte then loaded — behind the lock
 * screen — and unlocking put back the URL from before the lock.
 */
{
	const PASSWORD = 'pt-test';
	const ctx = await routeShellHosts(
		await browser.newContext({ viewport: { width: 1280, height: 900 } })
	);
	await ctx.addInitScript((hash) => {
		if (window !== window.top) return;
		const key = 'potato-tomato-site-settings-v1';
		let saved = {};
		try {
			saved = JSON.parse(localStorage.getItem(key) || '{}') || {};
		} catch {
			saved = {};
		}
		saved.gamePlayer = { ...(saved.gamePlayer || {}), autoFullscreen: false };
		saved.privacyModeEnabled = true;
		saved.privacyPasswordHash = hash;
		saved.privacyLockShortcut = {
			code: 'F9',
			ctrlKey: false,
			shiftKey: false,
			altKey: false,
			metaKey: false
		};
		localStorage.setItem(key, JSON.stringify(saved));
		if (!sessionStorage.getItem('pt-test-privacy-started')) {
			sessionStorage.setItem('pt-test-privacy-started', '1');
			sessionStorage.setItem('potato-tomato-privacy-session-ok', '1');
		}
	}, 'ba298c117e13f864931c2a2648d391991640d3d745e04afab3252be449c654ff');
	const lp = await ctx.newPage();
	lp.on('pageerror', (e) => console.log('[pageerror privacy]', e.message));
	await lp.goto(`${BASE}/games/${REMOTE_GAME}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
	await lp.getByRole('heading', { name: 'Remote Lab' }).waitFor({ timeout: 180000 });
	let lf = await shellFrame(lp, REMOTE_GAME, () => typeof window.bootCount === 'number', 20000);
	const bootBefore = await lf.evaluate(() => window.bootCount);
	await sleep(2500);
	const gameFrameSrc = () =>
		lp.evaluate(() => document.querySelector('iframe[sandbox]')?.getAttribute('src') ?? null);
	/* Restart the game, and lock (the shortcut) while it is loading. */
	await relaunchLab(lp);
	await lp.evaluate(() =>
		window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F9', key: 'F9' }))
	);
	/* A network change asks for the play URL again; locked, nothing may come of it yet. */
	await lp.evaluate(() => window.dispatchEvent(new Event('online')));
	await sleep(4000);
	const whileLocked = {
		locked: await lp.evaluate(() => document.documentElement.hasAttribute('data-privacy-locked')),
		src: (await gameFrameSrc())?.slice(0, 22) ?? null,
		failedRoutes: await lp.evaluate(
			(game) => sessionStorage.getItem(`potato-tomato-play-route-failed:${game}`),
			REMOTE_GAME
		)
	};
	check(
		'Privacy lock holds the game on a blank page, and nothing relaunches it behind the lock',
		whileLocked.locked && whileLocked.src === 'about:blank' && whileLocked.failedRoutes === null,
		JSON.stringify(whileLocked)
	);
	await lp.locator('input[type="password"]').fill(PASSWORD);
	await lp.locator('input[type="password"]').press('Enter');
	lf = await shellFrame(lp, REMOTE_GAME, (n) => window.bootCount > n, 20000, bootBefore);
	const unlockedBoot = await lf.evaluate(() => window.bootCount);
	const unlockedSrc = (await gameFrameSrc()) ?? '';
	check(
		'Unlocking brings the game back on its current play URL, onto its saves',
		unlockedBoot > bootBefore && unlockedSrc.startsWith('data:text/html'),
		`bootCount=${bootBefore}→${unlockedBoot} src=${unlockedSrc.slice(0, 22)}`
	);
	await ctx.close();
}

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
	'Controls text alone hides nothing (A still on the console)',
	(await page.getByRole('button', { name: 'Action A' }).count()) === 1
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
	'Controls text alone adds nothing (no J button before the game uses J)',
	(await page.getByRole('button', { name: 'Action J' }).count()) === 0
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
const menuRows = (section) =>
	menu
		.locator(`[data-section="${section}"] li`)
		.evaluateAll((els) => els.map((e) => `${e.dataset.codes}|${e.innerText.replace(/\s+/g, ' ')}`));
const confirmed = await menuRows('gameplay');
const mentionedRows = await menuRows('mentioned');
const confirmedText = confirmed.join(' ; ');
check(
	'Confirmed controls: only what the game did — ArrowLeft handled, J in its key handler',
	confirmed.length === 2 &&
		confirmed.some((r) => /ArrowLeft/.test(r) && /in use/i.test(r)) &&
		confirmed.some((r) => r.startsWith('KeyJ|') && /likely/i.test(r) && r.includes('Jump')),
	confirmedText
);
check(
	'Text-only keys listed apart as unconfirmed, with their captions',
	mentionedRows.some((r) => r.startsWith('Space|') && r.includes('Dash')) &&
		!mentionedRows.some((r) => r.startsWith('KeyJ|')),
	mentionedRows.join(' ; ')
);
check(
	'Keys that do the same thing share one row',
	mentionedRows.some((r) => r.split('|')[0].split(' ').length === 3 && r.includes('Move')),
	mentionedRows.join(' ; ')
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
	.locator('li[data-codes]')
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
	'J confirmed ("in use") once the game handled it',
	(await menu
		.locator('[data-section="gameplay"] li[data-code="KeyJ"] [data-evidence]')
		.getAttribute('data-evidence')) === 'used'
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
await sleep(600);
check(
	'…and only then the console grows a J button, captioned "Jump"',
	(await extras.getByRole('button', { name: 'Action J' }).count()) === 1 &&
		(await extras.innerText()).includes('Jump'),
	await extras.innerText().catch(() => '(none)')
);
await shot(page, '04b-console-after-use.png');

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

/* ---------- real engines: keys read from the engine, not from text ---------- */
for (const engine of ENGINES) {
	if (!engine.available) {
		console.log(`SKIP  ${engine.name}: engine build not available (offline?)`);
		continue;
	}
	const ctx = await windowedPlayer(
		await browser.newContext({ viewport: { width: 1280, height: 900 } })
	);
	const ep = await ctx.newPage();
	const errors = [];
	ep.on('pageerror', (e) => errors.push(e.message));
	await ep.goto(`${BASE}/games/${engine.id}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
	await ep.getByRole('heading', { name: `${engine.name} Lab` }).waitFor({ timeout: 180000 });
	await ep.locator('[data-testid="touch-console-toggle"]').click();
	await ep.locator('[data-testid="touch-joystick"]').waitFor({ timeout: 15000 });
	/* Engines register keys during boot; the bridge reports within a second of that. */
	await sleep(3500);
	await ep.locator('[data-testid="controls-menu-toggle"]').click();
	const em = ep.locator('[data-testid="controls-menu"]');
	await em.waitFor();
	await sleep(400);
	const rows = await em.locator('li[data-codes]').evaluateAll((els) =>
		els.map((e) => ({
			codes: e.dataset.codes.split(' '),
			evidence: e.querySelector('[data-evidence]')?.getAttribute('data-evidence'),
			text: e.innerText.replace(/\s+/g, ' ')
		}))
	);
	const evidenceOf = (code) => rows.find((r) => r.codes.includes(code))?.evidence;
	const missing = engine.bound.filter((c) => evidenceOf(c) !== 'bound');
	check(
		`${engine.name}: keys read from the engine as "bound"`,
		missing.length === 0,
		missing.length
			? `missing ${missing.join(',')} — rows: ${rows.map((r) => r.codes.join('+') + ':' + r.evidence).join(' ')}`
			: engine.bound.join(',')
	);
	const wrongPurposes = Object.entries(engine.purposes).filter(
		([code, purpose]) => !rows.find((r) => r.codes.includes(code))?.text.includes(purpose)
	);
	if (Object.keys(engine.purposes).length) {
		check(
			`${engine.name}: purposes taken from the engine's own key names`,
			wrongPurposes.length === 0,
			wrongPurposes.map(([c, p]) => `${c}≠${p}`).join(' ')
		);
	}
	if (OUT && engine === ENGINES[0]) {
		/* The menu follows the system theme: capture it both ways. */
		await em.scrollIntoViewIfNeeded();
		await shot(ep, '21-menu-light.png');
		await ep.emulateMedia({ colorScheme: 'dark' });
		await sleep(400);
		await shot(ep, '22-menu-dark.png');
		await ep.emulateMedia({ colorScheme: 'light' });
	}
	await em.getByRole('button', { name: 'Close controls' }).click();
	await sleep(500);
	const stillShown = [];
	for (const name of engine.hidden) {
		if ((await ep.getByRole('button', { name, exact: true }).count()) > 0) stillShown.push(name);
	}
	check(
		`${engine.name}: console drops buttons the engine never bound`,
		stillShown.length === 0,
		stillShown.join(',')
	);
	if (engine.extra) {
		const ex = ep.locator('[data-testid="console-extras"]');
		const label = engine.extra.code.replace(/^Key|^Digit/, '');
		check(
			`${engine.name}: console adds the bound ${label} key${engine.extra.caption ? ` ("${engine.extra.caption}")` : ''}`,
			(await ex.getByRole('button', { name: `Action ${label}` }).count()) === 1 &&
				(!engine.extra.caption || (await ex.innerText()).includes(engine.extra.caption)),
			await ex.innerText().catch(() => '(none)')
		);
	}
	check(`${engine.name}: no page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
	await shot(ep, `20-${engine.id.replace('_bridge-', '')}.png`);
	await ctx.close();
}

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
await sleep(2500);
/* On a phone the game opens fullscreen; the in-game menu is the only chrome over it. */
const menuButton = mp.locator('[data-testid="in-game-menu-button"]');
await menuButton.waitFor({ timeout: 8000 });
if ((await mp.locator('[data-testid="touch-joystick"]').count()) === 0) {
	await menuButton.tap();
	await mp.locator('[data-testid="in-game-menu-console"]').tap();
	await sleep(1200);
}
await shot(mp, '11-mobile-console.png');
await menuButton.tap();
await mp.locator('[data-testid="in-game-menu-controls"]').tap();
await sleep(800);
check(
	'Controls menu opens from the in-game menu on a phone',
	(await mp.locator('[data-testid="controls-menu"]').count()) === 1
);
await shot(mp, '12-mobile-controls.png');

await browser.close();
await cleanup();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
