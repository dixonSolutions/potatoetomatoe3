#!/usr/bin/env node
/**
 * Desktop field test: does the Linux app launch, follow and resize in the desktop's colours?
 *
 * Drives a real build of the Tauri app on the live GNOME/Wayland session and measures
 * what the compositor actually shows, because the bugs this exists for are all things
 * the page cannot see about itself: a white window under a dark desktop before the
 * page paints, a second "ghost" window, the old scheme showing through while the
 * window is being resized, and a desktop light/dark switch the page never hears about.
 *
 * What it does, per scheme (dark, then light):
 *   1. sets the desktop scheme with gsettings and screenshots the empty desktop
 *   2. launches the app and captures frames as fast as the daemon allows until the
 *      page reports itself loaded — every frame is diffed against the empty desktop
 *      to find the window, classified light/dark, and counted for extra windows
 *   3. asks the page (over WebKit's remote inspector) what `prefers-color-scheme`,
 *      the `.dark` class and the resolved background are
 *   4. flips the desktop scheme while the app runs and times how long the page takes
 *      to follow, then flips it back
 *   5. maximizes, restores and keyboard-resizes the window, capturing frames the
 *      whole time and measuring how much of the window is painted in the wrong scheme
 *   6. closes the app and checks nothing of it is left on screen
 *
 * Needs: a GNOME/Wayland session with the `gdr` desktop daemon (`gdr-mcp` on PATH),
 * `gsettings`, and a debug build of the app. The desktop scheme is restored on exit.
 *
 * Usage:
 *   node scripts/verify-desktop-theme.mjs --binary src-tauri/target/debug/potato-tomato
 *   node scripts/verify-desktop-theme.mjs --binary ... --dev-server     # `tauri dev`-style, loads Vite
 *   node scripts/verify-desktop-theme.mjs --binary ... --out docs/field-tests/desktop-theme-2026-09-16
 *   node scripts/verify-desktop-theme.mjs --binary ... --keep-frames    # keep every captured PNG
 */

import { spawn, execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	decodePng,
	encodePng,
	crop,
	halve,
	diffBlobs,
	rectStats,
	mismatchRegion
} from './lib/png-stats.mjs';
import { GdrMcpClient } from './lib/gdr-mcp-client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

/** GNOME's top bar: its clock ticks, so it is excluded from every frame diff. */
const TOP_BAR_PX = 40;
/** The window's own header bar (CSD) — excluded when classifying the page area. */
const HEADER_BAR_PX = 48;
/** A changed region at least this big is treated as a window. */
const WINDOW_MIN = { width: 320, height: 200 };
const INSPECTOR_PORT = 9223;
const DEV_URL = 'http://127.0.0.1:5173/home';

function parseArgs() {
	const args = process.argv.slice(2);
	const value = (flag, fallback) => {
		const i = args.indexOf(flag);
		return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
	};
	const date = new Date().toISOString().slice(0, 10);
	return {
		binary: value('--binary', null),
		devServer: args.includes('--dev-server'),
		out: resolve(value('--out', join(repoRoot, 'docs', 'field-tests', `desktop-theme-${date}`))),
		keepFrames: args.includes('--keep-frames'),
		skipResize: args.includes('--skip-resize'),
		skipSwitch: args.includes('--skip-switch'),
		cold: args.includes('--cold'),
		scale: value('--scale', null) ? Number(value('--scale', null)) : null,
		schemes: value('--schemes', 'dark,light').split(',').filter(Boolean),
		loadTimeoutMs: Number(value('--load-timeout', '45000'))
	};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();
const execFileAsync = promisify(execFile);

function gsettingsGet(key) {
	return execFileSync('gsettings', ['get', 'org.gnome.desktop.interface', key], {
		encoding: 'utf8'
	}).trim();
}
function gsettingsSet(key, value) {
	execFileSync('gsettings', ['set', 'org.gnome.desktop.interface', key, value]);
}
function schemeValue(scheme) {
	return scheme === 'dark' ? 'prefer-dark' : 'default';
}

/* ------------------------------------------------------------------ capture */

class Capture {
	constructor(outDir, keepFrames) {
		this.framesDir = join(outDir, 'frames');
		this.keepFrames = keepFrames;
		this.count = 0;
		mkdirSync(this.framesDir, { recursive: true });
	}
	/**
	 * One full-desktop frame, decoded, tagged with when it was taken. Asynchronous on
	 * purpose: the capture loops run for seconds, and the app's log pipe, the inspector
	 * socket and the timers all need the event loop between frames.
	 */
	async take(tag) {
		const file = join(this.framesDir, `${String(this.count++).padStart(4, '0')}-${tag}.png`);
		const t = now();
		await execFileAsync('gdr', ['screenshot', '-o', file]);
		const img = decodePng(readFileSync(file));
		this.lastSize = { width: img.width, height: img.height };
		return { file, t, img };
	}
}

/** Bounding box of the app window in `frame`, from what changed against `baseline`. */
function findWindows(baseline, frame) {
	const { blobs } = diffBlobs(baseline.img, frame.img, { ignoreTop: TOP_BAR_PX });
	return blobs.filter((b) => b.width >= WINDOW_MIN.width && b.height >= WINDOW_MIN.height);
}

/** Mutter moves a window this far per arrow press in a keyboard move (Alt+F7). */
const KEYBOARD_MOVE_STEP_PX = 10;

/**
 * What the window says about itself, through Tauri's own IPC from inside the page:
 * whether it is maximized, and its outer size in physical pixels. Wayland gives an
 * app no way to know *where* it is, so position still has to come from the screen.
 */
const WINDOW_STATE_PROBE = `(function(){
	var t = window.__TAURI_INTERNALS__;
	if (!t) return { unavailable: true };
	if (!window.__fieldWindow) window.__fieldWindow = {};
	var w = window.__fieldWindow;
	w.pending = Promise.all([
		t.invoke('plugin:window|is_maximized', { label: 'main' }),
		t.invoke('plugin:window|outer_size', { label: 'main' }),
		t.invoke('plugin:window|scale_factor', { label: 'main' })
	]).then(function (r) { w.result = { maximized: r[0], outer: r[1], scale: r[2] }; }).catch(function (e) { w.result = { error: String(e) }; });
	return w.result || { pending: true };
})()`;

async function windowState(inspector) {
	if (!inspector?.ws) return null;
	try {
		await inspector.evalJson(WINDOW_STATE_PROBE);
		await sleep(80);
		const state = await inspector.evalJson('window.__fieldWindow && window.__fieldWindow.result');
		return state && !state.error && !state.unavailable ? state : null;
	} catch {
		return null;
	}
}

/**
 * Where the app window is right now.
 *
 * A diff against the empty desktop only works until the desktop changes under the
 * window — and flipping the scheme re-themes every other window on screen at once.
 * So the window is asked for its size and whether it is maximized (Tauri IPC), and
 * its position is found by nudging it a known distance with a keyboard move and
 * diffing before/after: the changed region starts where the window was. A maximized
 * window cannot be nudged, and does not need to be — it fills the work area.
 */
async function locateWindow(ctx, tag, session) {
	const { capture, mcp } = ctx;
	const state = session ? await windowState(session.inspector) : null;
	const screen = capture.lastSize;
	if (state?.maximized && screen) {
		return {
			x: 0,
			y: TOP_BAR_PX,
			width: screen.width,
			height: screen.height - TOP_BAR_PX,
			maximized: true
		};
	}
	const presses = 4;
	const shift = presses * KEYBOARD_MOVE_STEP_PX;
	const before = await capture.take(`locate-${tag}-a`);
	await mcp.call('gdr_act', {
		steps: [
			{ hotkey: 'Alt+F7' },
			{ delay_ms: 150 },
			...Array(presses).fill({ tap: 'Right' }),
			{ tap: 'Return' }
		],
		screenshot: false
	});
	await sleep(350);
	const after = await capture.take(`locate-${tag}-b`);
	await mcp.call('gdr_act', {
		steps: [
			{ hotkey: 'Alt+F7' },
			{ delay_ms: 150 },
			...Array(presses).fill({ tap: 'Left' }),
			{ tap: 'Return' }
		],
		screenshot: false
	});
	await sleep(350);
	const { blobs } = diffBlobs(before.img, after.img, { ignoreTop: TOP_BAR_PX, cell: 8 });
	const blob = blobs.find((b) => b.width >= WINDOW_MIN.width && b.height >= WINDOW_MIN.height);
	if (!blob) return null;
	// Size from the window itself when it will say (physical pixels: outer size is
	// logical, so multiply by its scale); the nudge only has to supply the origin.
	const width = state?.outer
		? Math.round(state.outer.width * (state.scale ?? 1))
		: Math.max(WINDOW_MIN.width, blob.width - shift);
	const height = state?.outer ? Math.round(state.outer.height * (state.scale ?? 1)) : blob.height;
	return { x: blob.x, y: blob.y, width, height, maximized: false };
}

/** The page area of a window rectangle: below its header bar. */
function pageArea(rect) {
	return {
		x: rect.x + 8,
		y: rect.y + HEADER_BAR_PX,
		width: rect.width - 16,
		height: rect.height - HEADER_BAR_PX - 8
	};
}

function classify(stats) {
	if (stats.luminance >= 0.6 || stats.lightFraction > 0.6) return 'light';
	if (stats.luminance <= 0.35 || stats.darkFraction > 0.6) return 'dark';
	return 'mixed';
}

/* ---------------------------------------------------------------- inspector */

/**
 * WebKitGTK's remote inspector, over its HTTP server.
 *
 * The socket the inspector page uses speaks the `Target` domain: the page's own
 * protocol is tunnelled inside `Target.sendMessageToTarget` and comes back as
 * `Target.dispatchMessageFromTarget` events, so this client keeps two id spaces —
 * one for the tunnel, one for the page — and unwraps the inner reply. Anything
 * asynchronous in the page is parked on `window.__fieldProbe` and read back on the
 * next call, since the inner protocol has no `awaitPromise` here.
 */
class Inspector {
	constructor(port) {
		this.port = port;
		this.ws = null;
		this.nextId = 1;
		this.pending = new Map();
		this.pageTarget = null;
	}

	async connect(timeoutMs = 20_000) {
		const deadline = now() + timeoutMs;
		let lastError = null;
		while (now() < deadline) {
			try {
				const html = await (await fetch(`http://127.0.0.1:${this.port}/`)).text();
				const match = html.match(/socket\/(\d+)\/(\d+)\/(\w+)/);
				if (!match) throw new Error('no inspector target listed yet');
				await this.#open(`ws://127.0.0.1:${this.port}/${match[0]}`);
				const targetDeadline = now() + 5000;
				while (!this.pageTarget && now() < targetDeadline) await sleep(50);
				if (!this.pageTarget) throw new Error('inspector listed no page target');
				return match[0];
			} catch (e) {
				lastError = e;
				this.ws?.close();
				await sleep(250);
			}
		}
		throw new Error(`inspector not reachable: ${lastError?.message}`);
	}

	#open(url) {
		return new Promise((resolve, reject) => {
			const ws = new WebSocket(url);
			ws.addEventListener('open', () => {
				this.ws = ws;
				resolve();
			});
			ws.addEventListener('error', () => reject(new Error('inspector websocket error')));
			ws.addEventListener('message', (event) => {
				let msg;
				try {
					msg = JSON.parse(event.data);
				} catch {
					return;
				}
				if (msg.method === 'Target.targetCreated' && msg.params?.targetInfo?.type === 'page') {
					this.pageTarget = msg.params.targetInfo.targetId;
					return;
				}
				if (msg.method === 'Target.targetDestroyed' && msg.params?.targetId === this.pageTarget) {
					this.pageTarget = null;
					return;
				}
				if (msg.method === 'Target.dispatchMessageFromTarget') {
					let inner;
					try {
						inner = JSON.parse(msg.params.message);
					} catch {
						return;
					}
					this.#settle(inner);
					return;
				}
				if (msg.id !== undefined && msg.error) this.#settle(msg);
			});
			ws.addEventListener('close', () => {
				for (const { reject: fail } of this.pending.values()) fail(new Error('inspector closed'));
				this.pending.clear();
				this.ws = null;
			});
		});
	}

	#settle(msg) {
		if (msg.id === undefined || !this.pending.has(msg.id)) return;
		const { resolve: ok, reject: fail } = this.pending.get(msg.id);
		this.pending.delete(msg.id);
		if (msg.error) fail(new Error(msg.error.message ?? JSON.stringify(msg.error)));
		else ok(msg.result);
	}

	/** Send one page-domain message through the target tunnel. */
	send(method, params = {}) {
		if (!this.ws || !this.pageTarget) return Promise.reject(new Error('inspector not connected'));
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${method} timed out`));
			}, 10_000);
			this.pending.set(id, {
				resolve: (v) => {
					clearTimeout(timer);
					resolve(v);
				},
				reject: (e) => {
					clearTimeout(timer);
					reject(e);
				}
			});
			// The tunnel message gets its own id, offset so it can never collide with a page id.
			this.ws.send(
				JSON.stringify({
					id: id + 1_000_000,
					method: 'Target.sendMessageToTarget',
					params: { targetId: this.pageTarget, message: JSON.stringify({ id, method, params }) }
				})
			);
		});
	}

	/** Evaluate an expression that yields JSON text; returns the parsed value. */
	async evalJson(expression) {
		const result = await this.send('Runtime.evaluate', {
			expression: `(function(){ try { return JSON.stringify(${expression}); } catch (e) { return JSON.stringify({ __error: String(e) }); } })()`,
			returnByValue: true
		});
		const value = result?.result?.value;
		if (typeof value !== 'string')
			throw new Error(`unexpected evaluate result: ${JSON.stringify(result).slice(0, 200)}`);
		return JSON.parse(value);
	}

	close() {
		this.ws?.close();
	}
}

/**
 * Installed once per page: timestamps the two things a scheme switch has to reach —
 * the media query's own `change` event and the `.dark` class on <html> — so a slow
 * follow can be blamed on the platform (event late) or the frontend (class late).
 */
const INSTALL_EVENT_PROBE = `(function(){
	if (window.__fieldEvents) return 'present';
	var events = window.__fieldEvents = [];
	var mq = matchMedia('(prefers-color-scheme: dark)');
	mq.addEventListener('change', function (e) { events.push({ t: performance.now(), what: 'media-change', dark: e.matches }); });
	new MutationObserver(function () {
		events.push({ t: performance.now(), what: 'html-class', dark: document.documentElement.classList.contains('dark') });
	}).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
	// A 50ms heartbeat: any gap well beyond that is the main thread being busy, which
	// is the difference between "the event came late" and "the page could not react".
	var last = performance.now();
	setInterval(function () {
		var t = performance.now();
		if (t - last > 300) events.push({ t: last, what: 'main-thread-busy', untilT: t, ms: Math.round(t - last) });
		last = t;
	}, 50);
	return 'installed';
})()`;

const PAGE_PROBE = `({
	readyState: document.readyState,
	url: location.href,
	mediaDark: matchMedia('(prefers-color-scheme: dark)').matches,
	mediaLight: matchMedia('(prefers-color-scheme: light)').matches,
	htmlDark: document.documentElement.classList.contains('dark'),
	colorScheme: getComputedStyle(document.documentElement).colorScheme,
	inlineColorScheme: document.documentElement.style.colorScheme,
	rootBg: getComputedStyle(document.documentElement).backgroundColor,
	bodyBg: document.body ? getComputedStyle(document.body).backgroundColor : null,
	shellBg: (function(){ var el = document.querySelector('.min-h-screen.bg-background'); return el ? getComputedStyle(el).backgroundColor : null; })(),
	background: getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
	primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
	primaryResolved: (function(){ var el = document.createElement('div'); el.style.color = 'var(--primary)'; document.documentElement.appendChild(el); var c = getComputedStyle(el).color; el.remove(); return c; })(),
	devicePixelRatio: devicePixelRatio,
	inner: [innerWidth, innerHeight],
	hasTauri: typeof window.__TAURI_INTERNALS__ !== 'undefined',
	shellRendered: !!document.querySelector('.min-h-screen.bg-background')
})`;

/* --------------------------------------------------------------------- app */

class App {
	constructor(binary, logFile, extraEnv = {}) {
		this.binary = binary;
		this.logFile = logFile;
		this.extraEnv = extraEnv;
		this.child = null;
		this.log = [];
	}
	start() {
		const env = {
			...process.env,
			WEBKIT_INSPECTOR_HTTP_SERVER: `127.0.0.1:${INSPECTOR_PORT}`,
			POTATO_TOMATO_NO_CLOSE_TO_TRAY: '1',
			RUST_LOG: process.env.RUST_LOG ?? 'info',
			...this.extraEnv
		};
		this.startedAt = now();
		this.child = spawn(this.binary, [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
		const onLine = (stream) => (chunk) => {
			const text = chunk.toString();
			this.log.push({ t: now() - this.startedAt, stream, text });
			writeFileSync(this.logFile, `[+${now() - this.startedAt}ms ${stream}] ${text}`, {
				flag: 'a'
			});
		};
		this.child.stdout.on('data', onLine('out'));
		this.child.stderr.on('data', onLine('err'));
		this.child.on('exit', (code, signal) => {
			this.exit = { code, signal, t: now() - this.startedAt };
		});
	}
	get pid() {
		return this.child?.pid;
	}
	async stop() {
		if (!this.child || this.exit) return;
		this.child.kill('SIGTERM');
		const deadline = now() + 5000;
		while (!this.exit && now() < deadline) await sleep(100);
		if (!this.exit) this.child.kill('SIGKILL');
		while (!this.exit) await sleep(50);
	}
	/** Log lines mentioning the theme bridge, with their timestamps. */
	themeLines() {
		return this.log
			.flatMap(({ t, text }) => text.split('\n').map((line) => ({ t, line })))
			.filter(({ line }) =>
				/colour|color|scheme|theme|portal|dark|light|toplevel|background/i.test(line)
			)
			.map(({ t, line }) => `+${t}ms ${line.trim()}`);
	}
}

/* -------------------------------------------------------------- dev server */

function portOpen(port) {
	return new Promise((resolve) => {
		const socket = createConnection({ host: '127.0.0.1', port });
		socket.once('connect', () => {
			socket.destroy();
			resolve(true);
		});
		socket.once('error', () => resolve(false));
	});
}

async function ensureDevServer(outDir, warm = true) {
	if (await portOpen(5173)) return null;
	const logFile = join(outDir, 'vite-dev.log');
	const child = spawn('pnpm', ['exec', 'vite', 'dev', '--port', '5173', '--strictPort'], {
		cwd: repoRoot,
		env: { ...process.env, PUBLIC_OFFLINE_DEPLOYMENT: 'local-app' },
		stdio: ['ignore', 'pipe', 'pipe'],
		detached: true
	});
	child.stdout.on('data', (c) => writeFileSync(logFile, c, { flag: 'a' }));
	child.stderr.on('data', (c) => writeFileSync(logFile, c, { flag: 'a' }));
	const deadline = now() + 60_000;
	while (now() < deadline) {
		if (await portOpen(5173)) {
			// Warm the route so a launch measures the app, not Vite's cold transform — unless
			// the cold transform is the point (`--cold` reproduces a fresh `tauri dev`).
			if (warm) {
				try {
					await fetch(DEV_URL);
				} catch {
					/* ignore */
				}
			}
			return child;
		}
		await sleep(250);
	}
	throw new Error('vite dev did not open port 5173');
}

/* ----------------------------------------------------------- monitor scale */

/**
 * The primary monitor's scale, via Mutter's DisplayConfig. Applied as a temporary
 * configuration (method 1), so a crash or Ctrl-C leaves the desktop's saved layout
 * untouched and the old scale is put back explicitly on exit.
 */
const DISPLAY_CONFIG = [
	'--session',
	'--dest',
	'org.gnome.Mutter.DisplayConfig',
	'--object-path',
	'/org/gnome/Mutter/DisplayConfig'
];

function currentMonitor() {
	const state = execFileSync(
		'gdbus',
		['call', ...DISPLAY_CONFIG, '--method', 'org.gnome.Mutter.DisplayConfig.GetCurrentState'],
		{ encoding: 'utf8' }
	);
	const serial = Number(state.match(/^\(uint32 (\d+)/)?.[1]);
	const connector = state.match(/\[\(\('([^']+)'/)?.[1];
	const mode = state.match(
		/\('([0-9]+x[0-9]+@[0-9.]+)', \d+, \d+, [0-9.]+, [0-9.]+, \[[0-9., ]+\], \{[^}]*'is-current': <true>/
	)?.[1];
	const scale = Number(
		state.match(/\], \[\((-?\d+), (-?\d+), ([0-9.]+), uint32 (\d+), (true|false)/)?.[3]
	);
	if (!serial || !connector || !mode || !scale)
		throw new Error('could not parse DisplayConfig state');
	return { serial, connector, mode, scale };
}

/**
 * The desktop daemon's screen stream does not survive a monitor reconfiguration: it
 * keeps delivering the last frame from before the change. Restart it and wait for it
 * to answer, then hand back a fresh MCP client, since the old one was talking to the
 * old daemon.
 */
async function restartDesktopCapture(ctx) {
	try {
		execFileSync('systemctl', ['--user', 'restart', 'gdr.service'], { stdio: 'ignore' });
	} catch {
		execFileSync('gdr', ['service', 'restart'], { stdio: 'ignore' });
	}
	const deadline = now() + 15_000;
	let up = false;
	while (now() < deadline && !up) {
		await sleep(500);
		try {
			execFileSync('gdr', ['ping'], { stdio: 'ignore' });
			up = true;
		} catch {
			/* still starting */
		}
	}
	if (!up) throw new Error('desktop daemon did not come back after restart');
	if (ctx?.mcp) {
		await ctx.mcp.close();
		ctx.mcp = new GdrMcpClient();
		await ctx.mcp.start();
	}
	await sleep(1500);
}

function applyMonitorScale(scale) {
	const { serial, connector, mode } = currentMonitor();
	const logical = `[(0, 0, ${Number(scale).toFixed(4)}, 0, true, [('${connector}', '${mode}', {})])]`;
	execFileSync(
		'gdbus',
		[
			'call',
			...DISPLAY_CONFIG,
			'--method',
			'org.gnome.Mutter.DisplayConfig.ApplyMonitorsConfig',
			String(serial),
			'1',
			logical,
			'{}'
		],
		{ stdio: 'ignore' }
	);
}

/* ------------------------------------------------------------------ phases */

/**
 * Launch under `scheme`, capturing every frame until the page is up. Returns the
 * running app and inspector alongside what was seen.
 */
async function launchPhase(ctx, scheme) {
	const { capture, opts, report } = ctx;
	gsettingsSet('color-scheme', schemeValue(scheme));
	await sleep(1200);
	const baseline = await capture.take(`baseline-${scheme}`);
	const app = new App(opts.binary, join(opts.out, `app-${scheme}.log`));
	app.start();
	const inspector = new Inspector(INSPECTOR_PORT);
	const frames = [];
	let connected = false;
	let loaded = false;
	let probe = null;
	const deadline = now() + opts.loadTimeoutMs;
	inspector
		.connect(opts.loadTimeoutMs)
		.then(() => (connected = true))
		.catch(() => {});
	while (now() < deadline && !loaded) {
		const frame = await capture.take(`launch-${scheme}`);
		const windows = findWindows(baseline, frame);
		const main = windows[0] ?? null;
		const stats = main ? rectStats(frame.img, pageArea(main)) : null;
		frames.push({
			file: frame.file,
			t: frame.t - app.startedAt,
			windows: windows.map(({ x, y, width, height }) => ({ x, y, width, height })),
			stats,
			class: stats ? classify(stats) : null
		});
		if (connected) {
			try {
				probe = await inspector.evalJson(PAGE_PROBE);
				frames[frames.length - 1].page = {
					readyState: probe.readyState,
					mediaDark: probe.mediaDark,
					htmlDark: probe.htmlDark,
					colorScheme: probe.colorScheme,
					shellBg: probe.shellBg,
					url: probe.url
				};
				if (probe.readyState === 'complete' && probe.shellRendered) loaded = true;
			} catch {
				/* page still booting */
			}
		}
		if (app.exit) break;
	}
	// Two settled frames after load, so the "final" launch state is not a half-painted one.
	await sleep(800);
	const settled = await capture.take(`settled-${scheme}`);
	const settledWindows = findWindows(baseline, settled);
	const settledStats = settledWindows[0]
		? rectStats(settled.img, pageArea(settledWindows[0]))
		: null;

	const firstWithWindow = frames.find((f) => f.windows.length);
	const wrongFrames = frames.filter((f) => f.class && f.class !== scheme && f.class !== 'mixed');
	const extraWindowFrames = frames.filter((f) => f.windows.length > 1);
	const result = {
		scheme,
		appExit: app.exit ?? null,
		inspectorConnected: connected,
		loaded,
		framesCaptured: frames.length,
		firstWindowAtMs: firstWithWindow?.t ?? null,
		firstWindowClass: firstWithWindow?.class ?? null,
		firstWindowStats: firstWithWindow?.stats ?? null,
		wrongSchemeFrames: wrongFrames.length,
		wrongSchemeMs: wrongFrames.length
			? wrongFrames[wrongFrames.length - 1].t - wrongFrames[0].t
			: 0,
		wrongSchemeFirstFrame: wrongFrames[0]?.file ?? null,
		extraWindowFrames: extraWindowFrames.length,
		extraWindowExample: extraWindowFrames[0]
			? { file: extraWindowFrames[0].file, windows: extraWindowFrames[0].windows }
			: null,
		settled: {
			file: settled.file,
			windows: settledWindows.map(({ x, y, width, height }) => ({ x, y, width, height })),
			stats: settledStats,
			class: settledStats ? classify(settledStats) : null
		},
		page: probe,
		screen: capture.lastSize,
		frames
	};
	report.launch[scheme] = result;
	return { app, inspector, baseline, windowRect: settledWindows[0] ?? null, settledFrame: settled };
}

/** Flip the desktop scheme under a running app and time the page's reaction. */
async function switchPhase(ctx, session, from, to) {
	const { capture, report } = ctx;
	const { app, inspector } = session;
	const logBefore = app.log.length;
	let eventsBefore = 0;
	try {
		await inspector.evalJson(INSTALL_EVENT_PROBE);
		eventsBefore = (await inspector.evalJson('window.__fieldEvents')).length;
	} catch {
		/* no inspector: timings come from polling alone */
	}
	const flippedAt = now();
	gsettingsSet('color-scheme', schemeValue(to));
	let followedAt = null;
	let mediaAt = null;
	let htmlAt = null;
	let lastProbe = null;
	const deadline = now() + 8000;
	while (now() < deadline) {
		try {
			lastProbe = await inspector.evalJson(PAGE_PROBE);
			if (mediaAt === null && lastProbe.mediaDark === (to === 'dark')) mediaAt = now();
			if (htmlAt === null && lastProbe.htmlDark === (to === 'dark')) htmlAt = now();
			if (mediaAt !== null && htmlAt !== null) {
				followedAt = Math.max(mediaAt, htmlAt);
				break;
			}
		} catch (e) {
			lastProbe = { __error: String(e) };
		}
		await sleep(100);
	}
	await sleep(700);
	let pageEvents = [];
	try {
		const all = await inspector.evalJson('window.__fieldEvents');
		const origin = await inspector.evalJson('performance.timeOrigin');
		pageEvents = all
			.slice(eventsBefore)
			.map((e) => ({ ...e, sinceFlipMs: Math.round(origin + e.t - flippedAt) }));
	} catch {
		/* ignore */
	}
	const frame = await capture.take(`switched-${from}-to-${to}`);
	const rect =
		(await locateWindow(ctx, `switched-${from}-to-${to}`, session)) ?? session.windowRect;
	if (rect) session.windowRect = rect;
	const stats = rect ? rectStats(frame.img, pageArea(rect)) : null;
	const result = {
		from,
		to,
		pageFollowedMs: followedAt ? followedAt - flippedAt : null,
		mediaQueryMs: mediaAt ? mediaAt - flippedAt : null,
		htmlClassMs: htmlAt ? htmlAt - flippedAt : null,
		pageEvents,
		page: lastProbe,
		screen: { file: frame.file, rect, stats, class: stats ? classify(stats) : null },
		appLog: app.log
			.slice(logBefore)
			.flatMap((e) => e.text.split('\n'))
			.filter(Boolean)
			.map((l) => l.trim())
	};
	report.switch.push(result);
	return result;
}

/**
 * Resize the window three ways — maximize, restore, keyboard resize — capturing
 * frames through each and measuring the largest wrongly-coloured area seen.
 */
async function resizePhase(ctx, session, scheme, label) {
	const { capture, report, mcp } = ctx;
	const { app } = session;
	const expectDark = scheme === 'dark';

	/**
	 * Capture for `durationMs`, then judge every frame against where the window ended
	 * up: how much of that area was painted in the wrong scheme beyond what the settled
	 * page legitimately shows (thumbnails are light on a dark page), and how long the
	 * area kept changing before it matched the final frame.
	 */
	async function burst(tag, durationMs) {
		const raw = [];
		const start = now();
		while (now() - start < durationMs) {
			const frame = await capture.take(tag);
			raw.push({ file: frame.file, t: frame.t - start, img: frame.img });
		}
		const rect = (await locateWindow(ctx, tag, session)) ?? session.windowRect;
		const area = pageArea(rect);
		const last = raw[raw.length - 1];
		const finalMismatch = mismatchRegion(last.img, area, expectDark).fraction;
		const frames = raw.map((f) => {
			const mismatch = mismatchRegion(f.img, area, expectDark);
			const { changedCells } = diffBlobs(f.img, last.img, { cell: 8, threshold: 40 });
			const cells = Math.ceil(area.width / 8) * Math.ceil(area.height / 8);
			return {
				file: f.file,
				t: f.t,
				mismatch: mismatch.fraction,
				excess: Number(Math.max(0, mismatch.fraction - finalMismatch).toFixed(4)),
				box: mismatch.box,
				unsettled: Number(Math.min(1, changedCells / cells).toFixed(4))
			};
		});
		const worst = frames.reduce((a, b) => (!a || b.excess > a.excess ? b : a), null);
		const lastUnsettled = [...frames].reverse().find((f) => f.unsettled > 0.02);
		return {
			frames: frames.length,
			rect,
			worstExcess: worst?.excess ?? 0,
			worstFrame: worst?.file ?? null,
			worstBox: worst?.box ?? null,
			settledAfterMs: lastUnsettled ? lastUnsettled.t : 0,
			finalMismatch,
			series: frames.map(({ t, mismatch, excess, unsettled }) => ({
				t,
				mismatch,
				excess,
				unsettled
			}))
		};
	}

	const steps = [];
	const logBefore = app.log.length;
	await mcp.hotkey('Super+Up');
	steps.push({ action: 'maximize (Super+Up)', ...(await burst(`maximize-${label}`, 2500)) });
	await mcp.hotkey('Super+Down');
	steps.push({ action: 'restore (Super+Down)', ...(await burst(`restore-${label}`, 2500)) });
	// Keyboard resize: Alt+F8 grabs the window edge, arrows grow it, Enter commits.
	await mcp.call('gdr_act', {
		steps: [
			{ hotkey: 'Alt+F8' },
			{ delay_ms: 200 },
			...Array(12).fill({ tap: 'Right' }),
			...Array(8).fill({ tap: 'Down' })
		],
		screenshot: false
	});
	const during = await burst(`keyresize-${label}`, 1200);
	await mcp.call('gdr_act', { steps: [{ tap: 'Enter' }], screenshot: false });
	const after = await burst(`keyresize-done-${label}`, 1500);
	steps.push({ action: 'keyboard resize (Alt+F8, arrows)', during, after });
	report.resize.push({
		scheme,
		label,
		steps,
		appLog: app.log
			.slice(logBefore)
			.flatMap((e) => e.text.split('\n'))
			.filter(Boolean)
			.map((l) => l.trim())
	});
}

/** Close the app and make sure the desktop is back to how it was. */
async function closePhase(ctx, session, scheme) {
	const { capture, report } = ctx;
	const { app, inspector, baseline } = session;
	inspector.close();
	await app.stop();
	await sleep(800);
	const frame = await capture.take(`closed-${scheme}`);
	const leftovers = findWindows(baseline, frame);
	report.close[scheme] = {
		exit: app.exit,
		leftoverWindows: leftovers.map(({ x, y, width, height }) => ({ x, y, width, height })),
		file: frame.file,
		themeLog: app.themeLines()
	};
}

/* ------------------------------------------------------------------ report */

function verdicts(report) {
	const out = [];
	const check = (ok, name, detail) => out.push({ ok, name, detail });
	for (const scheme of Object.keys(report.launch)) {
		const l = report.launch[scheme];
		check(
			l.loaded,
			`${scheme}: page loaded`,
			l.loaded
				? `in ${l.frames[l.frames.length - 1]?.t}ms`
				: `not loaded (exit ${JSON.stringify(l.appExit)})`
		);
		check(
			l.firstWindowClass === scheme || l.firstWindowClass === 'mixed',
			`${scheme}: first visible frame is ${scheme}`,
			`first frame at +${l.firstWindowAtMs}ms classified ${l.firstWindowClass} (lum ${l.firstWindowStats?.luminance}, light ${l.firstWindowStats?.lightFraction})`
		);
		check(
			l.wrongSchemeFrames === 0,
			`${scheme}: no wrong-scheme frames during launch`,
			`${l.wrongSchemeFrames} frame(s) over ${l.wrongSchemeMs}ms${l.wrongSchemeFirstFrame ? ` — first ${l.wrongSchemeFirstFrame}` : ''}`
		);
		check(
			l.extraWindowFrames === 0,
			`${scheme}: exactly one window during launch`,
			l.extraWindowFrames
				? `${l.extraWindowFrames} frame(s) with extra windows, e.g. ${JSON.stringify(l.extraWindowExample?.windows)}`
				: 'one window throughout'
		);
		check(
			l.settled.class === scheme,
			`${scheme}: settled page is ${scheme}`,
			`classified ${l.settled.class} (lum ${l.settled.stats?.luminance})`
		);
		// Config asks for 1280×720 logical; a screen smaller than that (2× on 1080p is
		// 960×540 logical) can only give the window the screen, so expect the lesser.
		const inner = l.page?.inner;
		const dpr = l.page?.devicePixelRatio || 1;
		const screenLogical = l.screen
			? [l.screen.width / dpr, l.screen.height / dpr]
			: [Infinity, Infinity];
		const expectW = Math.min(1200, screenLogical[0] - 40);
		const expectH = Math.min(600, screenLogical[1] - 120);
		check(
			!!inner && inner[0] >= expectW && inner[1] >= expectH,
			`${scheme}: window opened at its configured size`,
			`page inner ${inner?.join('×')} css px (expected ≥ ${Math.round(expectW)}×${Math.round(expectH)}), devicePixelRatio ${dpr}, on screen ${l.settled.windows[0] ? `${l.settled.windows[0].width}×${l.settled.windows[0].height}` : '?'} px`
		);
		check(
			l.page?.mediaDark === (scheme === 'dark'),
			`${scheme}: prefers-color-scheme matches desktop`,
			`mediaDark=${l.page?.mediaDark} htmlDark=${l.page?.htmlDark} colorScheme=${l.page?.colorScheme}`
		);
		const c = report.close[scheme];
		if (c)
			check(
				c.leftoverWindows.length === 0,
				`${scheme}: nothing left on screen after close`,
				c.leftoverWindows.length
					? `regions still differing from the pre-launch desktop ${JSON.stringify(c.leftoverWindows)} — check the frame: another window repainting underneath looks the same to this diff`
					: 'desktop matches pre-launch'
			);
	}
	for (const s of report.switch) {
		check(
			s.pageFollowedMs !== null,
			`live switch ${s.from}→${s.to}: page followed`,
			s.pageFollowedMs !== null
				? `in ${s.pageFollowedMs}ms (media query ${s.mediaQueryMs}ms, .dark class ${s.htmlClassMs}ms)`
				: `page did not follow within 8s (mediaDark=${s.page?.mediaDark} htmlDark=${s.page?.htmlDark}${s.page?.__error ? `, probe error: ${s.page.__error}` : ''})`
		);
		check(
			s.screen.class === s.to,
			`live switch ${s.from}→${s.to}: screen shows ${s.to}`,
			`classified ${s.screen.class} (lum ${s.screen.stats?.luminance})`
		);
	}
	for (const r of report.resize) {
		for (const step of r.steps) {
			const bursts = step.during ? [step.during, step.after] : [step];
			const worst = Math.max(...bursts.map((b) => b.worstExcess));
			const settled = Math.max(...bursts.map((b) => b.settledAfterMs));
			check(
				worst <= 0.05,
				`${r.label}: ${step.action} — no stale-scheme area`,
				`worst ${(worst * 100).toFixed(1)}% of the page painted in the old scheme beyond the settled page`
			);
			// GNOME's own size-change animation runs ~250ms; after that the page re-flows
			// and lazy thumbnails load, which is content settling, not a stale frame. The
			// bound only exists to catch a frame that never gets repainted at all.
			check(
				settled <= 2000,
				`${r.label}: ${step.action} — settled promptly`,
				`still changing ${settled}ms after the action (content re-flow and thumbnail loads included)`
			);
		}
	}
	return out;
}

function writeReport(opts, report) {
	report.verdicts = verdicts(report);
	// Paths in the report are relative to the report directory, so it reads the same
	// from any checkout.
	const portable = JSON.parse(JSON.stringify(report).replaceAll(opts.out + '/', ''));
	writeFileSync(join(opts.out, 'report.json'), JSON.stringify(portable, null, 2));
	const lines = [];
	lines.push(`# Desktop theme field test — ${report.startedAt.slice(0, 19).replace('T', ' ')}`);
	lines.push('');
	lines.push(`Binary: \`${report.binary}\` (${report.mode})  `);
	lines.push(
		`Desktop: ${report.env.desktop}, GNOME Shell ${report.env.gnomeShell}, GTK theme ${report.env.gtkTheme}, accent ${report.env.accent}, scheme at start ${report.env.schemeAtStart}, monitor ${report.env.monitor.mode} at scale ${report.env.monitor.scaleUnderTest}`
	);
	lines.push('');
	lines.push(
		'Frames referenced below are cropped to the app window and stored at half size (`frames/`).'
	);
	lines.push('');
	lines.push('| Check | Result | Detail |');
	lines.push('|---|---|---|');
	for (const v of report.verdicts)
		lines.push(`| ${v.name} | ${v.ok ? '✅ pass' : '❌ FAIL'} | ${v.detail} |`);
	lines.push('');
	for (const scheme of Object.keys(report.launch)) {
		const l = report.launch[scheme];
		lines.push(`## Launch (${scheme})`);
		lines.push('');
		lines.push(
			'| t (ms) | windows | screen | luminance | light % | page mediaDark | html.dark | readyState | file |'
		);
		lines.push('|---|---|---|---|---|---|---|---|---|');
		for (const f of l.frames)
			lines.push(
				`| ${f.t} | ${f.windows.length} | ${f.class ?? '-'} | ${f.stats?.luminance ?? '-'} | ${f.stats ? (f.stats.lightFraction * 100).toFixed(1) : '-'} | ${f.page?.mediaDark ?? '-'} | ${f.page?.htmlDark ?? '-'} | ${f.page?.readyState ?? '-'} | ${f.file.split('/').pop()} |`
			);
		lines.push('');
		lines.push('Page probe after load:');
		lines.push('```json');
		lines.push(JSON.stringify(l.page, null, 2));
		lines.push('```');
		if (report.close[scheme]?.themeLog?.length) {
			lines.push('App log (theme lines):');
			lines.push('```');
			lines.push(...report.close[scheme].themeLog);
			lines.push('```');
		}
		lines.push('');
	}
	if (report.switch.length) {
		lines.push('## Live scheme switch');
		lines.push('');
		for (const s of report.switch) {
			lines.push(
				`- ${s.from} → ${s.to}: page followed in ${s.pageFollowedMs ?? 'never'} ms (media query ${s.mediaQueryMs ?? 'never'} ms, .dark class ${s.htmlClassMs ?? 'never'} ms); screen ${s.screen.class} (lum ${s.screen.stats?.luminance}); mediaDark=${s.page?.mediaDark} htmlDark=${s.page?.htmlDark} shellBg=${s.page?.shellBg}`
			);
			if (s.pageEvents?.length)
				lines.push(
					`  page events: ${s.pageEvents.map((e) => (e.what === 'main-thread-busy' ? `main-thread-busy ${e.ms}ms from @${e.sinceFlipMs}ms` : `${e.what}${e.dark ? '(dark)' : '(light)'} @${e.sinceFlipMs}ms`)).join(', ')}`
				);
			if (s.appLog.length) {
				lines.push('  ```');
				lines.push(...s.appLog.map((l) => '  ' + l));
				lines.push('  ```');
			}
		}
		lines.push('');
	}
	if (report.resize.length) {
		lines.push('## Resize');
		lines.push('');
		for (const r of report.resize) {
			lines.push(`### ${r.label}`);
			for (const step of r.steps) {
				const bursts = step.during
					? [
							['during', step.during],
							['after', step.after]
						]
					: [['', step]];
				for (const [phase, b] of bursts) {
					lines.push(
						`- ${step.action}${phase ? ` (${phase})` : ''}: ${b.frames} frames; window ${b.rect ? `${b.rect.width}×${b.rect.height} at ${b.rect.x},${b.rect.y}` : '?'}; stale-scheme excess worst ${(b.worstExcess * 100).toFixed(1)}% (${b.worstFrame?.split('/').pop()}); settled after ${b.settledAfterMs}ms; page light-on-dark content ${(b.finalMismatch * 100).toFixed(1)}%`
					);
					lines.push(
						'  ' +
							b.series
								.map(
									(f) =>
										`${f.t}ms:${(f.unsettled * 100).toFixed(0)}%/${(f.excess * 100).toFixed(0)}%`
								)
								.join(' ')
					);
				}
			}
			lines.push('');
		}
	}
	writeFileSync(
		join(opts.out, 'REPORT.md'),
		(lines.join('\n') + '\n').replaceAll(opts.out + '/', '')
	);
}

/**
 * Keep only the frames the report points at, unless asked to keep everything — and
 * crop those to the app window, since a full-desktop capture also shows whatever else
 * the tester had open, which has no place in a report that gets committed.
 */
function pruneFrames(opts, report) {
	const keep = new Map();
	const remember = (file, rect) => {
		if (typeof file !== 'string' || !file.endsWith('.png')) return;
		if (!keep.has(file) || (rect && !keep.get(file)))
			keep.set(file, rect ?? keep.get(file) ?? null);
	};
	for (const l of Object.values(report.launch)) {
		const first = l.frames.find((f) => f.windows.length);
		if (first) remember(first.file, first.windows[0]);
		remember(l.settled.file, l.settled.windows[0]);
		if (l.wrongSchemeFirstFrame)
			remember(
				l.wrongSchemeFirstFrame,
				l.frames.find((f) => f.file === l.wrongSchemeFirstFrame)?.windows[0]
			);
		if (l.extraWindowExample) remember(l.extraWindowExample.file, null);
	}
	for (const s of report.switch) remember(s.screen.file, s.screen.rect);
	// Resize frames only earn their place when they show something wrong; a clean
	// resize is fully described by its numbers.
	for (const r of report.resize) {
		for (const step of r.steps) {
			for (const b of step.during ? [step.during, step.after] : [step]) {
				if (b.worstExcess > 0.05) remember(b.worstFrame, b.rect);
			}
		}
	}
	for (const c of Object.values(report.close)) if (c.leftoverWindows.length) remember(c.file, null);
	const framesDir = join(opts.out, 'frames');
	for (const entry of execFileSync('ls', [framesDir], { encoding: 'utf8' })
		.split('\n')
		.filter(Boolean)) {
		const file = join(framesDir, entry);
		if (!keep.has(file)) {
			if (!opts.keepFrames) rmSync(file);
			continue;
		}
		const rect = keep.get(file);
		if (!rect) continue;
		const img = decodePng(readFileSync(file));
		const margin = 24;
		const window = crop(img, {
			x: rect.x - margin,
			y: rect.y - margin,
			width: rect.width + 2 * margin,
			height: rect.height + 2 * margin
		});
		writeFileSync(file, encodePng(halve(window)));
	}
}

/* -------------------------------------------------------------------- main */

async function main() {
	const opts = parseArgs();
	if (!opts.binary || !existsSync(opts.binary)) {
		console.error(
			'Usage: node scripts/verify-desktop-theme.mjs --binary <path to potato-tomato debug binary> [--dev-server] [--out dir]'
		);
		process.exit(2);
	}
	opts.binary = resolve(opts.binary);
	mkdirSync(opts.out, { recursive: true });
	rmSync(join(opts.out, 'frames'), { recursive: true, force: true });

	const schemeAtStart = gsettingsGet('color-scheme');
	const monitorAtStart = currentMonitor();
	if (opts.scale) {
		applyMonitorScale(opts.scale);
		await sleep(2500);
		await restartDesktopCapture(null);
	}
	const report = {
		startedAt: new Date().toISOString(),
		binary: opts.binary,
		mode: opts.devServer ? 'dev server (Vite)' : 'embedded build',
		env: {
			desktop: `${process.env.XDG_CURRENT_DESKTOP ?? '?'} / ${process.env.XDG_SESSION_TYPE ?? '?'}`,
			gnomeShell: (() => {
				try {
					return execFileSync('gnome-shell', ['--version'], { encoding: 'utf8' })
						.replace('GNOME Shell', '')
						.trim();
				} catch {
					return '?';
				}
			})(),
			gtkTheme: gsettingsGet('gtk-theme'),
			accent: gsettingsGet('accent-color'),
			schemeAtStart,
			monitor: { ...monitorAtStart, scaleUnderTest: opts.scale ?? monitorAtStart.scale }
		},
		launch: {},
		switch: [],
		resize: [],
		close: {}
	};

	const mcp = new GdrMcpClient();
	await mcp.start();
	await mcp.call('gdr_ping', {});
	const capture = new Capture(opts.out, opts.keepFrames);
	const ctx = { opts, report, capture, mcp };

	let devServer = null;
	let session = null;
	const cleanup = async () => {
		try {
			if (session) {
				session.inspector.close();
				await session.app.stop();
			}
		} catch {
			/* ignore */
		}
		try {
			gsettingsSet('color-scheme', schemeAtStart);
		} catch {
			/* ignore */
		}
		if (opts.scale && opts.scale !== monitorAtStart.scale) {
			try {
				applyMonitorScale(monitorAtStart.scale);
				await sleep(2000);
				await restartDesktopCapture(null);
			} catch {
				/* ignore */
			}
		}
		if (devServer) {
			try {
				process.kill(-devServer.pid, 'SIGTERM');
			} catch {
				/* ignore */
			}
		}
		await mcp.close();
	};
	process.on('SIGINT', async () => {
		await cleanup();
		process.exit(130);
	});

	try {
		if (opts.devServer) devServer = await ensureDevServer(opts.out, !opts.cold);

		for (const scheme of opts.schemes) {
			if (opts.cold && devServer) {
				// A fresh Vite for every launch, so each one pays the full cold transform.
				process.kill(-devServer.pid, 'SIGTERM');
				while (await portOpen(5173)) await sleep(200);
				devServer = await ensureDevServer(opts.out, false);
			}
			console.log(`[field-test] launch under ${scheme}`);
			session = await launchPhase(ctx, scheme);
			const l = report.launch[scheme];
			console.log(
				`[field-test]   loaded=${l.loaded} first window +${l.firstWindowAtMs}ms as ${l.firstWindowClass}; wrong frames ${l.wrongSchemeFrames}; extra windows ${l.extraWindowFrames}; page mediaDark=${l.page?.mediaDark}`
			);
			if (l.loaded && !opts.skipSwitch) {
				const other = scheme === 'dark' ? 'light' : 'dark';
				console.log(`[field-test] live switch ${scheme} → ${other} → ${scheme}`);
				const a = await switchPhase(ctx, session, scheme, other);
				console.log(
					`[field-test]   followed in ${a.pageFollowedMs ?? 'never'} ms, screen ${a.screen.class}`
				);
				if (!opts.skipResize) {
					console.log(`[field-test] resize while showing ${other} (launched ${scheme})`);
					await resizePhase(ctx, session, other, `launched-${scheme}-switched-${other}`);
				}
				const b = await switchPhase(ctx, session, other, scheme);
				console.log(
					`[field-test]   followed in ${b.pageFollowedMs ?? 'never'} ms, screen ${b.screen.class}`
				);
			}
			if (l.loaded && !opts.skipResize) {
				console.log(`[field-test] resize while showing ${scheme}`);
				await resizePhase(ctx, session, scheme, `launched-${scheme}`);
			}
			await closePhase(ctx, session, scheme);
			session = null;
		}
	} catch (e) {
		report.error = String(e?.stack ?? e);
		console.error('[field-test] error:', e);
	} finally {
		await cleanup();
	}

	writeReport(opts, report);
	pruneFrames(opts, report);
	const failed = report.verdicts.filter((v) => !v.ok);
	for (const v of report.verdicts)
		console.log(`${v.ok ? 'PASS' : 'FAIL'}  ${v.name} — ${v.detail}`);
	console.log(`[field-test] report: ${join(opts.out, 'REPORT.md')}`);
	process.exit(failed.length || report.error ? 1 : 0);
}

main();
