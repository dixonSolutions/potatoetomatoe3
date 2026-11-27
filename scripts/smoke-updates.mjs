#!/usr/bin/env node
/**
 * M13 evidence: the update badge and Updates section per platform and state.
 *
 * Screens /dev/update-preview (dev only) at phone size: badge on Android only and only with
 * an update to act on; tapping it targets Settings → App → Updates; every section state
 * (up to date, available, downloading with progress and Cancel, staged, error); web and
 * Flatpak show no badge and no update controls. Plus the real web Home: no badge.
 *
 * Usage: node scripts/smoke-updates.mjs [--out dir] [--url http://...]
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
const OUT = arg('--out') ?? path.join(ROOT, 'test-results', 'smoke-updates');
let BASE = arg('--url');
let server;

async function startServer() {
	const port = 5196;
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

const CASES = [
	{
		platform: 'android-apk',
		phase: 'up-to-date',
		badge: false,
		text: /Up to date/,
		button: 'update-check'
	},
	{
		platform: 'android-apk',
		phase: 'available',
		badge: true,
		text: /0\.0\.103 available/,
		button: 'update-download'
	},
	{
		platform: 'android-apk',
		phase: 'downloading',
		badge: true,
		text: /Downloading 0\.0\.103 · 42%/,
		button: 'update-cancel',
		progress: true
	},
	{
		platform: 'android-apk',
		phase: 'staged',
		badge: true,
		text: /ready · installs on next start/,
		button: 'update-apply'
	},
	{ platform: 'android-apk', phase: 'error', badge: false, text: /403/, button: 'update-check' },
	{
		platform: 'android-live',
		phase: 'available',
		badge: true,
		text: /available/,
		button: 'update-download'
	},
	{ platform: 'desktop', phase: 'available', badge: false, text: /Flatpak remote/, button: null },
	{ platform: 'web', phase: 'available', badge: false, text: null, button: null }
];

try {
	if (!BASE) BASE = await startServer();
	fs.mkdirSync(OUT, { recursive: true });
	const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
	try {
		const context = await browser.newContext({
			viewport: { width: 390, height: 844 },
			hasTouch: true,
			isMobile: true
		});
		const page = await context.newPage();
		let n = 1;
		for (const c of CASES) {
			await page.goto(`${BASE}/dev/update-preview?platform=${c.platform}&phase=${c.phase}`, {
				waitUntil: 'networkidle',
				timeout: 180000
			});
			await page.getByTestId('preview-topbar').waitFor({ timeout: 30000 });
			const badges = await page.getByTestId('app-update-badge').count();
			const text = await page.locator('body').innerText();
			const button = c.button
				? await page
						.getByTestId(c.button)
						.isVisible()
						.catch(() => false)
				: true;
			const anyControls = await page.locator('[data-testid^="update-"]').count();
			const progress = c.progress
				? await page.locator('[aria-label="Update download progress"]').isVisible()
				: true;
			await page.screenshot({
				path: path.join(OUT, `${n++}-${c.platform}-${c.phase}.png`),
				fullPage: true
			});
			let opens = null;
			if (c.badge && badges) {
				await page.getByTestId('app-update-badge').first().tap();
				opens = await page.getByTestId('preview-opened').innerText();
			}
			check(
				`${c.platform} ${c.phase}`,
				badges > 0 === c.badge &&
					(!c.text || c.text.test(text)) &&
					button &&
					progress &&
					(c.button !== null || anyControls === 0) &&
					(!c.badge || /opens app → settings-section-updates/.test(opens ?? '')),
				{
					badges,
					button,
					progress,
					controls: anyControls,
					opens
				}
			);
		}
		/* The real web Home: no badge, no update UI. */
		await page.goto(`${BASE}/home`, { waitUntil: 'domcontentloaded', timeout: 180000 });
		await page.waitForTimeout(3000);
		await page.screenshot({ path: path.join(OUT, `${n++}-web-home-topbar.png`) });
		check('web home: no update badge', (await page.getByTestId('app-update-badge').count()) === 0);
		await context.close();
	} finally {
		await browser.close();
	}
} finally {
	server?.kill();
}
const passed = results.filter((r) => r.ok).length;
console.log(`SMOKE-UPDATES ${passed}/${results.length} passed`);
