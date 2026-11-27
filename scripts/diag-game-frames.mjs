#!/usr/bin/env node
/**
 * Debug aid: open game pages in a mobile touch context and print, every 3 s, each frame's
 * URL, whether the app can reach it, whether the storage bridge / Unity hook run there,
 * the biggest canvas, and every potato-tomato-* message the app window received.
 *
 * Usage: node scripts/diag-game-frames.mjs [--url http://127.0.0.1:5173] [--games a,b]
 *          [--seconds 30]
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => {
	const i = process.argv.indexOf(name);
	return i > 0 ? process.argv[i + 1] : undefined;
};
const GAMES = (arg('--games') ?? 'slope,coolmath-1-push,002').split(',').filter(Boolean);
const SECONDS = Number(arg('--seconds') ?? 30);
let BASE = arg('--url');
let server;

async function startServer() {
	const port = 5197;
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

function initScript() {
	if (window.top !== window) return;
	window.__ptMsgs = [];
	addEventListener('message', (e) => {
		const d = e.data;
		if (
			d &&
			typeof d === 'object' &&
			typeof d.type === 'string' &&
			d.type.startsWith('potato-tomato-')
		) {
			window.__ptMsgs.push(
				`${Math.round(performance.now())}ms ${d.type}${d.reason ? ':' + d.reason : ''}${d.mode ? ':' + d.mode : ''}`
			);
		}
	});
}

function frameProbe() {
	let best = null;
	for (const c of document.querySelectorAll('canvas, video')) {
		const r = c.getBoundingClientRect();
		if (!best || r.width * r.height > best.w * best.h)
			best = { tag: c.tagName, w: Math.round(r.width), h: Math.round(r.height) };
	}
	return {
		ready: document.readyState,
		bridge: Boolean(window.__ptReadyWatch),
		gameReadyFn: typeof window.__ptGameReady,
		engineLoading: window.__ptEngineLoading,
		unity: typeof window.createUnityInstance,
		gameId: window.__ptGameId,
		best,
		iframes: document.querySelectorAll('iframe').length
	};
}

if (!BASE) BASE = await startServer();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
	for (const id of GAMES) {
		const context = await browser.newContext({
			viewport: { width: 844, height: 390 },
			isMobile: true,
			hasTouch: true
		});
		await context.addInitScript(initScript);
		const page = await context.newPage();
		const errors = [];
		page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
		await page.goto(`${BASE}/games/${id}`, { waitUntil: 'domcontentloaded' });
		console.log(`=== ${id}`);
		for (let t = 3; t <= SECONDS; t += 3) {
			await page.waitForTimeout(3000);
			const frames = [];
			for (const f of page.frames()) {
				if (f === page.mainFrame()) continue;
				const info = await f
					.evaluate(frameProbe)
					.catch((e) => ({ unreachable: String(e).slice(0, 80) }));
				frames.push({ url: f.url().slice(0, 110), ...info });
			}
			const top = await page.evaluate(() => ({
				msgs: window.__ptMsgs.slice(-8),
				grip: Boolean(document.querySelector('[aria-label="Drag to move the whole console"]')),
				consoleBtn: [...document.querySelectorAll('button')]
					.filter((b) => /console/i.test(b.getAttribute('aria-label') ?? ''))
					.map((b) => `${b.getAttribute('aria-label')}=${b.getAttribute('aria-pressed')}`),
				touch: navigator.maxTouchPoints,
				coarse: matchMedia('(pointer: coarse)').matches,
				hover: matchMedia('(hover: hover)').matches
			}));
			console.log(JSON.stringify({ t, top, frames }));
		}
		if (errors.length) console.log(JSON.stringify({ errors: errors.slice(0, 4) }));
		await context.close();
	}
} finally {
	await browser.close();
	server?.kill();
}
