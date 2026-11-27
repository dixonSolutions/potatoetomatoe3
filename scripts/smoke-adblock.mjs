#!/usr/bin/env node
/**
 * M12 evidence: ad and tracker requests per game, with and without the frame blocker.
 *
 * Each game loads three times on a Vite dev server:
 *   off        blocker disabled (window.__ptAdBlock preset before the bridge runs);
 *   web        as shipped on the web: the bridge (and its blocker) runs in same-origin
 *              game frames only;
 *   all-frames the blocker in every frame, as the Tauri app's native frame script runs it.
 * For each run: ad/tracker requests that reached the network, and what the blocker counted.
 *
 * Usage: node scripts/smoke-adblock.mjs [--games a,b] [--wait 15000] [--url http://...]
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
const GAMES = (
	arg('--games') ??
	'uptoplay-playonline,addicting-echolocation-shooter,addicting-merge-combo,addicting-zombeat-io,addicting-fight-to-the-end'
).split(',');
const WAIT = Number(arg('--wait') ?? 15000);
let BASE = arg('--url');
let server;

const hostsSrc = fs.readFileSync(path.join(ROOT, 'src/lib/utils/ad-hosts.ts'), 'utf8');
const AD_HOSTS = [...hostsSrc.match(/AD_HOSTS[^=]*= \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map(
	(m) => m[1]
);
const isAd = (url) => {
	try {
		const h = new URL(url).hostname;
		return AD_HOSTS.some((d) => h === d || h.endsWith('.' + d));
	} catch {
		return false;
	}
};

/* The blocker block of the bridge, to run in every frame like the native frame script. */
const bridge = fs.readFileSync(path.join(ROOT, 'static/game-storage-bridge.child.js'), 'utf8');
const bStart = bridge.indexOf('(function () {\n\tif (window.top === window || window.__ptAdBlock)');
const BLOCKER = bridge.slice(bStart, bridge.indexOf('\n})();', bStart) + 6);

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

async function run(browser, id, mode) {
	const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	if (mode === 'off') {
		await context.addInitScript(() => {
			if (window.top !== window) window.__ptAdBlock = { blocked: 0, hosts: {}, disabled: true };
		});
	} else if (mode === 'all-frames') {
		await context.addInitScript({ content: BLOCKER });
	}
	const page = await context.newPage();
	const reached = {};
	page.on('requestfinished', (r) => {
		if (!isAd(r.url())) return;
		const h = new URL(r.url()).hostname;
		reached[h] = (reached[h] ?? 0) + 1;
	});
	await page.goto(`${BASE}/games/${encodeURIComponent(id)}`, {
		waitUntil: 'domcontentloaded',
		timeout: 120000
	});
	await page.waitForTimeout(WAIT);
	let blocked = 0;
	for (const f of page.frames()) {
		blocked += await f
			.evaluate(() =>
				window.__ptAdBlock && !window.__ptAdBlock.disabled ? window.__ptAdBlock.blocked : 0
			)
			.catch(() => 0);
	}
	const crashed = await page
		.getByTestId('game-crashed-notice')
		.isVisible()
		.catch(() => false);
	await context.close();
	const total = Object.values(reached).reduce((a, b) => a + b, 0);
	return {
		reached: total,
		blocked,
		topHosts: Object.entries(reached)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3),
		crashed
	};
}

const rows = [];
try {
	if (!BASE) BASE = await startServer();
	const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
	try {
		/* Warm the dev server so the first game is not timed against a cold compile. */
		const warm = await browser.newPage();
		await warm
			.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded', timeout: 180000 })
			.catch(() => {});
		await warm.close();
		for (const id of GAMES) {
			const row = { id };
			for (const mode of ['off', 'web', 'all-frames']) {
				try {
					row[mode] = await run(browser, id, mode);
				} catch (e) {
					row[mode] = { error: String(e).slice(0, 200) };
				}
			}
			rows.push(row);
			console.log(JSON.stringify(row));
		}
	} finally {
		await browser.close();
	}
} finally {
	server?.kill();
}

console.log(
	'\n| game | ad requests, blocker off | web: reached / blocked | all frames (Tauri): reached / blocked |'
);
console.log('|---|---|---|---|');
for (const r of rows) {
	const c = (m) => (r[m]?.error ? 'error' : `${r[m].reached} / ${r[m].blocked}`);
	console.log(`| ${r.id} | ${r.off?.reached ?? 'error'} | ${c('web')} | ${c('all-frames')} |`);
}
const allFramesCut = rows.every(
	(r) => !r['all-frames']?.error && r['all-frames'].reached <= (r.off?.reached ?? 0)
);
console.log(`SMOKE-ADBLOCK ${rows.length} games, all-frames never worse than off: ${allFramesCut}`);
