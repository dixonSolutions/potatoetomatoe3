#!/usr/bin/env node
/**
 * Time game launches through the app's real play path, in Chromium or in the Tauri
 * desktop webview, and report from inside the game frames.
 *
 * The launcher is the dev route `/dev/play-path-check`: it resolves each game with
 * `getGamePlayerUrl`, frames it like the game page does, and forwards what the frame
 * probe (`scripts/play-path/frame-probe.js`) reports from every frame — `load`, the first
 * game-sized canvas, and whether the storage bridge is installed there — to the collector
 * this script runs. Nothing depends on a screenshot, which the Tauri window cannot give.
 *
 * Needs a Vite dev server for the local app (`PUBLIC_OFFLINE_DEPLOYMENT=local-app`).
 *
 *   node scripts/play-path-bench.mjs --mode chromium --label after
 *   node scripts/play-path-bench.mjs --mode tauri --label after      # runs `pnpm tauri dev`
 *   node scripts/play-path-bench.mjs --ids slope,coolmath-1-push --mode chromium
 *
 * Options: --app http://127.0.0.1:5177  --port 18795 (collector)  --timeout 60000
 *          --settle 1500  --out <file.json>  --browser <chrome path>  --per-portal 2
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROBE = path.join(root, 'scripts/play-path/frame-probe.js');

function parseArgs() {
	const args = process.argv.slice(2);
	const value = (flag, fallback) => {
		const i = args.indexOf(flag);
		return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
	};
	return {
		mode: value('--mode', 'chromium'),
		label: value('--label', 'run'),
		app: value('--app', 'http://127.0.0.1:5177').replace(/\/$/, ''),
		port: Number(value('--port', '18795')),
		timeoutMs: Number(value('--timeout', '60000')),
		stallMs: Number(value('--stall', '25000')),
		settleMs: Number(value('--settle', '1500')),
		perPortal: Number(value('--per-portal', '2')),
		ids: value('--ids', '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean),
		out: value('--out', ''),
		browser:
			value('--browser', '') ||
			process.env.PLAY_PATH_BROWSER ||
			path.join(process.env.HOME ?? '', '.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'),
		headed: args.includes('--headed')
	};
}

/**
 * Deterministic cross-portal sample, so a before/after pair launches the same games.
 * Buckets are the launch classes that behave differently, not just the portals.
 */
function sampleIds(perPortal) {
	const all = JSON.parse(readFileSync(path.join(root, 'static/games/games-metadata.json'), 'utf8'));
	const host = (g) => {
		try {
			return new URL(g.onlineEmbedUrl).hostname;
		} catch {
			return '';
		}
	};
	const buckets = {
		'unity-play': (g) => g.sourcePortal === 'unity-play',
		crazygames: (g) => g.sourcePortal === 'crazygames',
		playhop: (g) => g.sourcePortal === 'playhop',
		'addicting-html5': (g) => host(g) === 'cdn2.addictinggames.com',
		'addicting-flash': (g) => host(g) === 'prod.addictinggames.com',
		coolmath: (g) => g.sourcePortal === 'coolmath',
		'fnf-games': (g) => g.sourcePortal === 'fnf-games',
		'drive-jsdelivr': (g) => host(g) === 'cdn.jsdelivr.net',
		'drive-sites': (g) => host(g) === 'sites.google.com',
		'local-shell': (g) => !g.onlineEmbedUrl && !g.sourcePortal
	};
	const picked = [];
	for (const [bucket, test] of Object.entries(buckets)) {
		const rows = all.filter(test).sort((a, b) => a.id.localeCompare(b.id));
		/* Even stride through the sorted bucket: stable, and not all from one letter. */
		const stride = Math.max(1, Math.floor(rows.length / (perPortal + 1)));
		for (let k = 1; k <= perPortal && k * stride < rows.length; k++) {
			picked.push({ id: rows[k * stride].id, bucket });
		}
	}
	return picked;
}

function startCollector(opts, state, onResult) {
	const cors = {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Headers': '*',
		'Access-Control-Allow-Private-Network': 'true'
	};
	const server = createServer((req, res) => {
		if (req.method === 'OPTIONS') {
			res.writeHead(204, cors);
			res.end();
			return;
		}
		if (req.method === 'GET' && req.url?.startsWith('/config')) {
			/* A relaunched launcher picks up where the last one stopped. */
			res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ ...state.config, ids: state.remaining() }));
			return;
		}
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			res.writeHead(204, cors);
			res.end();
			let data = null;
			try {
				data = JSON.parse(body || 'null');
			} catch {
				return;
			}
			state.lastActivity = Date.now();
			if (req.url === '/hello') console.log(`[bench] launcher up: ${data?.userAgent}`);
			if (req.url === '/start') state.current = data?.id ?? null;
			if (req.url === '/result') onResult(data);
		});
	});
	server.listen(opts.port, '127.0.0.1');
	return server;
}

function fmt(ms) {
	return ms == null ? '   –  ' : `${String(ms).padStart(6)}`;
}

function median(values) {
	const v = values.filter((x) => typeof x === 'number').sort((a, b) => a - b);
	if (!v.length) return null;
	const mid = Math.floor(v.length / 2);
	return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
}

async function chromiumRunner(opts, launcherUrl) {
	const require = createRequire(path.join(root, 'puller/package.json'));
	const { chromium } = require('playwright');
	const browser = await chromium.launch({
		executablePath: opts.browser,
		headless: !opts.headed,
		args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader']
	});
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	await context.addInitScript({ path: PROBE });
	let page = null;
	return {
		async start() {
			if (page) await page.close().catch(() => {});
			page = await context.newPage();
			await page.goto(launcherUrl);
		},
		async stop() {
			await browser.close();
		}
	};
}

function tauriRunner(opts, launcherUrl) {
	const config = JSON.stringify({ build: { devUrl: launcherUrl, beforeDevCommand: '' } });
	let child = null;
	const kill = () => {
		if (!child) return;
		try {
			process.kill(-child.pid, 'SIGTERM');
		} catch {
			/* already gone */
		}
		child = null;
	};
	return {
		async start() {
			kill();
			child = spawn('pnpm', ['tauri', 'dev', '--config', config], {
				cwd: root,
				stdio: ['ignore', 'inherit', 'inherit'],
				detached: true,
				env: {
					...process.env,
					POTATO_TOMATO_FRAME_PROBE: PROBE,
					PKG_CONFIG_PATH:
						process.env.PKG_CONFIG_PATH ??
						'/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/share/pkgconfig'
				}
			});
		},
		async stop() {
			kill();
		}
	};
}

async function main() {
	const opts = parseArgs();
	const sample = opts.ids.length
		? opts.ids.map((id) => ({ id, bucket: 'given' }))
		: sampleIds(opts.perPortal);
	const bucketOf = Object.fromEntries(sample.map((s) => [s.id, s.bucket]));
	const config = {
		ids: sample.map((s) => s.id),
		label: opts.label,
		timeoutMs: opts.timeoutMs,
		stallMs: opts.stallMs,
		settleMs: opts.settleMs
	};
	const results = [];
	const reported = new Set();
	const state = {
		config,
		current: null,
		lastActivity: Date.now(),
		remaining: () => config.ids.filter((id) => !reported.has(id))
	};
	const record = (r) => {
		if (!r?.id || reported.has(r.id)) return;
		r.bucket = bucketOf[r.id] ?? '';
		reported.add(r.id);
		results.push(r);
		const deepest = r.frames?.reduce((m, f) => Math.max(m, f.depth ?? 0), 0) ?? 0;
		const bridged = [...new Set((r.frames ?? []).filter((f) => f.bridge).map((f) => f.depth))];
		console.log(
			`${r.bucket.padEnd(16)} ${r.id.slice(0, 40).padEnd(40)} resolve${fmt(r.resolveMs)} load${fmt(r.loadMs)} canvas${fmt(r.canvasMs)} depth=${deepest} bridge@${bridged.join('/') || '-'} ${r.stalled ? 'STALLED ' : ''}${r.error} ${r.urls?.[r.urls.length - 1]?.slice(0, 90) ?? ''}`
		);
	};
	const server = startCollector(opts, state, record);
	const launcherUrl = `${opts.app}/dev/play-path-check?collector=${opts.port}`;
	console.log(`[bench] ${opts.mode} ${opts.label}: ${config.ids.length} games via ${launcherUrl}`);
	const runner =
		opts.mode === 'tauri'
			? tauriRunner(opts, launcherUrl)
			: await chromiumRunner(opts, launcherUrl);
	await runner.start();

	/*
	 * A game can wedge the whole launcher — WebKit runs cross-origin frames in the page's own
	 * process, so one that spins its main thread stops every frame — so a launch that goes
	 * silent is recorded as hung and the launcher restarted on the games still to go. The
	 * first `tauri dev` start may include a Rust build, hence the longer first grace.
	 */
	const hangMs = opts.timeoutMs + opts.stallMs + opts.settleMs + 30_000;
	let sawLauncher = false;
	await new Promise((resolve) => {
		const tick = setInterval(() => {
			if (state.remaining().length === 0) {
				clearInterval(tick);
				resolve();
				return;
			}
			if (state.current) sawLauncher = true;
			const limit = !sawLauncher && opts.mode === 'tauri' ? hangMs + 600_000 : hangMs;
			if (Date.now() - state.lastActivity < limit) return;
			const hung =
				state.current && !reported.has(state.current) ? state.current : state.remaining()[0];
			record({
				id: hung,
				label: opts.label,
				urls: [],
				resolveMs: null,
				loadMs: null,
				canvasMs: null,
				stalled: true,
				error: 'launcher hung',
				frames: []
			});
			state.current = null;
			state.lastActivity = Date.now();
			if (state.remaining().length) {
				console.log('[bench] restarting launcher');
				void runner.start();
			}
		}, 2000);
	});
	await runner.stop();
	server.close();

	const played = results.filter((r) => r.canvasMs != null);
	const summary = {
		label: opts.label,
		mode: opts.mode,
		games: results.length,
		loaded: results.filter((r) => r.loadMs != null).length,
		painted: played.length,
		medianResolveMs: median(results.map((r) => r.resolveMs)),
		medianLoadMs: median(results.map((r) => r.loadMs)),
		medianCanvasMs: median(played.map((r) => r.canvasMs))
	};
	console.log('[bench] summary', JSON.stringify(summary));
	const out = opts.out || path.join(tmpdir(), 'play-path-bench', `${opts.label}-${opts.mode}.json`);
	mkdirSync(path.dirname(out), { recursive: true });
	writeFileSync(out, JSON.stringify({ summary, results }, null, 2));
	console.log(`[bench] wrote ${out}`);
	process.exit(0);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
