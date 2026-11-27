#!/usr/bin/env node
/**
 * M14 evidence (A18–A22): a fresh profile opens straight to Home (no privacy gate), every
 * Settings section on desktop and phone with no checkboxes and short copy, the game page's
 * More menu (Switch, not a checkbox), and long animation frames while Home scrolls.
 *
 * Usage: node scripts/smoke-screens.mjs [--out dir] [--url http://...] [--game id]
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
const OUT = arg('--out') ?? path.join(ROOT, 'test-results', 'smoke-screens');
const GAME = arg('--game') ?? 'weasels';
let BASE = arg('--url');
let server;

async function startServer() {
	const port = 5195;
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

/** Text of every leaf-ish element in the open settings dialog, longest first. */
async function longestCopy(page) {
	return page.evaluate(() => {
		const dlg = document.querySelector('[role="dialog"]');
		if (!dlg) return { len: 0, text: '' };
		let best = '';
		for (const el of dlg.querySelectorAll('p, span, label, small, div')) {
			if (el.children.length > 0) continue;
			const t = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
			if (t.length > best.length) best = t;
		}
		return { len: best.length, text: best.slice(0, 160) };
	});
}

const VIEWPORTS = [
	{ label: 'desktop', viewport: { width: 1280, height: 800 } },
	{ label: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
];

try {
	if (!BASE) BASE = await startServer();
	fs.mkdirSync(OUT, { recursive: true });
	const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
	try {
		for (const vp of VIEWPORTS) {
			/* A brand-new context is a fresh profile: no storage, no cookies. */
			const context = await browser.newContext(vp);
			const page = await context.newPage();
			await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 180000 });
			await page.waitForURL(/\/home/, { timeout: 60000 });
			await page.waitForTimeout(2500);
			const gate = await page
				.locator('#privacy-gate-remember, [data-testid="privacy-gate"]')
				.count();
			await page.screenshot({ path: path.join(OUT, `${vp.label}-1-fresh-home.png`) });
			check(`${vp.label}: fresh profile opens Home, no privacy gate`, gate === 0, {
				url: page.url()
			});

			/* Long animation frames while Home scrolls (glass must not cost frames). */
			const frames = await page.evaluate(async () => {
				const long = [];
				let obs;
				try {
					obs = new PerformanceObserver((l) => {
						for (const e of l.getEntries()) long.push(Math.round(e.duration));
					});
					obs.observe({ type: 'long-animation-frame', buffered: false });
				} catch {
					return { supported: false };
				}
				for (let i = 0; i < 20; i++) {
					window.scrollBy(0, 300);
					await new Promise((r) => setTimeout(r, 120));
				}
				window.scrollTo(0, 0);
				await new Promise((r) => setTimeout(r, 300));
				obs.disconnect();
				return { supported: true, count: long.length, worst: Math.max(0, ...long) };
			});
			check(`${vp.label}: long frames while scrolling Home (dev build)`, true, frames);

			/* Settings: every section. */
			await page.getByRole('button', { name: 'Settings' }).first().click();
			await page.getByRole('dialog').waitFor({ timeout: 15000 });
			await page.waitForTimeout(500);
			await page.screenshot({ path: path.join(OUT, `${vp.label}-2-settings.png`) });
			const names = await page
				.locator('nav[aria-label="Settings sections"] button')
				.evaluateAll((els) =>
					els.map((e) => e.querySelector('.font-medium')?.textContent?.trim() ?? '')
				);
			let worst = { len: 0, text: '', section: '' };
			let checkboxes = 0;
			let switches = 0;
			let n = 3;
			for (const name of names) {
				const nav = page.locator('nav[aria-label="Settings sections"] button', { hasText: name });
				if (
					!(await nav
						.first()
						.isVisible()
						.catch(() => false))
				) {
					const back = page.getByRole('button', { name: 'Back to settings' });
					if (await back.isVisible().catch(() => false)) await back.click();
				}
				await nav.first().click();
				await page.waitForTimeout(600);
				checkboxes += await page
					.locator('[role="dialog"] input[type="checkbox"], [role="dialog"] [role="checkbox"]')
					.count();
				switches += await page.locator('[role="dialog"] [role="switch"]').count();
				const c = await longestCopy(page);
				if (c.len > worst.len) worst = { ...c, section: name };
				await page.screenshot({
					path: path.join(
						OUT,
						`${vp.label}-${n++}-settings-${name.toLowerCase().replace(/\s+/g, '-')}.png`
					)
				});
			}
			check(`${vp.label}: settings use switches, no checkboxes`, checkboxes === 0 && switches > 0, {
				sections: names,
				checkboxes,
				switches
			});
			check(`${vp.label}: longest settings copy`, worst.len <= 140, worst);
			await page.keyboard.press('Escape');
			await page.waitForTimeout(400);

			/* Game page: toolbar and the More menu. */
			await page.goto(`${BASE}/games/${GAME}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
			await page.getByTestId('game-more-menu').waitFor({ timeout: 60000 });
			await page.waitForTimeout(2000);
			await page.screenshot({ path: path.join(OUT, `${vp.label}-${n++}-game.png`) });
			await page.getByTestId('game-more-menu').click();
			const item = page.getByTestId('play-options-toggle');
			await item.waitFor({ timeout: 10000 });
			const sw = await item.locator('[role="switch"], [data-slot="switch"]').count();
			const cb = await page
				.locator(
					'[role="menuitemcheckbox"] [role="checkbox"], [data-slot="dropdown-menu-checkbox-item"]'
				)
				.count();
			await page.screenshot({ path: path.join(OUT, `${vp.label}-${n++}-game-more-menu.png`) });
			check(`${vp.label}: More menu uses a Switch`, sw === 1 && cb === 0, { sw, cb });
			await context.close();
		}
	} finally {
		await browser.close();
	}
} finally {
	server?.kill();
}
const passed = results.filter((r) => r.ok).length;
console.log(`SMOKE-SCREENS ${passed}/${results.length} passed`);
