#!/usr/bin/env node

/**
 * Verify that catalog games actually launch, not merely that their host answers.
 *
 * An HTTP 200 from the puller relay says nothing about whether a game renders —
 * portals happily return 200 for splash pages, ad gates and Flash stubs. This
 * driver loads each game the way a user does (real browser, click Play, wait for
 * the frame to paint) and classifies the outcome.
 *
 * Requires the dev server and puller to be running:
 *   pnpm dev --port 5178
 *
 * Usage:
 *   node scripts/verify-game-launches.mjs --sample 15
 *   node scripts/verify-game-launches.mjs --ids slope,crazygames-mine-clone
 *   node scripts/verify-game-launches.mjs --portal crazygames --sample 40
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = join(__dirname, '..', 'static', 'games');
const REPORT_PATH = join(__dirname, 'data', 'launch-verification.json');

/**
 * A game gets this long to paint something playable before we call it failed.
 * Software WebGL is slow — heavy titles legitimately need 40s+, so a short
 * timeout reports working games as broken.
 */
const DEFAULT_LAUNCH_TIMEOUT_MS = 45_000;
/** Concurrent browser contexts. WebGL games are heavy; keep this low. */
const DEFAULT_CONCURRENCY = 4;

function parseArgv() {
	const args = process.argv.slice(2);
	const value = (flag, fallback) => {
		const index = args.indexOf(flag);
		return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
	};
	return {
		baseUrl: value('--base', 'http://localhost:5178'),
		perPortal: Number(value('--sample', '15')),
		portal: value('--portal', null),
		ids: value('--ids', null)?.split(',').filter(Boolean) || null,
		headed: args.includes('--headed'),
		browserPath: value('--browser', process.env.LAUNCH_VERIFY_BROWSER || null),
		launchTimeoutMs: Number(value('--timeout', String(DEFAULT_LAUNCH_TIMEOUT_MS))),
		concurrency: Number(value('--concurrency', String(DEFAULT_CONCURRENCY))),
		ignoreNetworkCheck: args.includes('--ignore-network-check')
	};
}

/**
 * Filtered networks (school/corporate proxies) intercept TLS and serve a block page
 * with HTTP 200/403. Every game then "fails" for a reason that has nothing to do with
 * the catalog, which is how a filtered run gets mistaken for widespread breakage.
 *
 * @returns {Promise<string | null>} Name of the interceptor, or null when the network is clean.
 */
async function detectInterceptingProxy() {
	/* A host the catalog depends on, chosen because portals are common filter targets. */
	const probeUrl = 'https://games.crazygames.com/en_US/mine-clone/index.html';
	try {
		const response = await fetch(probeUrl, {
			headers: { 'User-Agent': 'Mozilla/5.0' },
			signal: AbortSignal.timeout(15_000)
		});
		const body = (await response.text()).slice(0, 4000);
		const blockPage = body.match(/<title>([^<]*(?:Secure Internet|Blocked|Filter)[^<]*)<\/title>/i);
		if (blockPage) return blockPage[1].trim();
		if (!response.ok) return `HTTP ${response.status} from ${new URL(probeUrl).hostname}`;
		return null;
	} catch (error) {
		/* A TLS failure here is itself the signature of an untrusted intercepting CA. */
		return `cannot reach ${new URL(probeUrl).hostname} (${String(error).slice(0, 80)})`;
	}
}

function loadCatalog() {
	const path = join(GAMES_ROOT, 'games-metadata.json');
	if (!existsSync(path)) throw new Error(`Missing catalog: ${path}`);
	return JSON.parse(readFileSync(path, 'utf-8'));
}

/** Deterministic sample so repeated runs compare like for like. */
function pickSample(catalog, opts) {
	if (opts.ids) {
		const wanted = new Set(opts.ids);
		return catalog.filter((game) => wanted.has(game.id));
	}

	const byPortal = new Map();
	for (const game of catalog) {
		const portal = game.sourcePortal || 'local';
		if (opts.portal && portal !== opts.portal) continue;
		if (!byPortal.has(portal)) byPortal.set(portal, []);
		byPortal.get(portal).push(game);
	}

	/* Even stride across each sorted portal, so a sample spans the whole portal. */
	const picked = [];
	for (const games of byPortal.values()) {
		const sorted = [...games].sort((a, b) => a.id.localeCompare(b.id));
		const stride = Math.max(1, Math.floor(sorted.length / opts.perPortal));
		const fromPortal = [];
		for (let i = 0; i < sorted.length && fromPortal.length < opts.perPortal; i += stride) {
			fromPortal.push(sorted[i]);
		}
		picked.push(...fromPortal);
	}
	return picked;
}

/**
 * Walk the frame tree looking for evidence that a game is running: a sized
 * canvas, or a WebGL context. Portals nest the real game several frames deep.
 */
const DETECT_PLAYABLE = `(() => {
  const canvases = [...document.querySelectorAll('canvas')];
  const painted = canvases.find((c) => c.width > 200 && c.height > 150);
  if (painted) return { playable: true, how: 'canvas', w: painted.width, h: painted.height };
  const video = document.querySelector('video');
  if (video && video.videoWidth > 200) return { playable: true, how: 'video' };
  return { playable: false, canvases: canvases.length };
})()`;

async function probePlayable(page) {
	for (const frame of page.frames()) {
		try {
			const result = await frame.evaluate(DETECT_PLAYABLE);
			if (result?.playable) return { ...result, frame: frame.url().slice(0, 120) };
		} catch {
			/* Frame detached or cross-origin mid-walk; other frames still count. */
		}
	}
	return null;
}

async function verifyGame(context, game, opts) {
	const page = await context.newPage();
	const consoleErrors = [];
	const failedRequests = [];

	page.on('console', (msg) => {
		if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 160));
	});
	page.on('requestfailed', (req) => {
		failedRequests.push(`${req.failure()?.errorText || 'failed'} ${req.url().slice(0, 110)}`);
	});

	const started = Date.now();
	try {
		await page.goto(`${opts.baseUrl}/games/${game.id}`, {
			waitUntil: 'domcontentloaded',
			timeout: 30_000
		});

		/* The player defers the iframe until the user asks for it. */
		const playButton = page.getByRole('button', { name: /^Load and play/ });
		await playButton.waitFor({ timeout: 20_000 });
		await playButton.click();

		const deadline = Date.now() + opts.launchTimeoutMs;
		while (Date.now() < deadline) {
			const playable = await probePlayable(page);
			if (playable) {
				return {
					id: game.id,
					portal: game.sourcePortal || 'local',
					status: 'LAUNCHED',
					ms: Date.now() - started,
					how: playable.how,
					frame: playable.frame
				};
			}
			await page.waitForTimeout(1500);
		}

		const frames = page.frames().map((f) => f.url().slice(0, 110));
		return {
			id: game.id,
			portal: game.sourcePortal || 'local',
			status: 'NO_RENDER',
			ms: Date.now() - started,
			frames: frames.slice(0, 6),
			consoleErrors: consoleErrors.slice(0, 4),
			failedRequests: failedRequests.slice(0, 4)
		};
	} catch (error) {
		return {
			id: game.id,
			portal: game.sourcePortal || 'local',
			status: 'ERROR',
			ms: Date.now() - started,
			error: String(error).slice(0, 200),
			consoleErrors: consoleErrors.slice(0, 4)
		};
	} finally {
		await page.close().catch(() => {});
	}
}

async function main() {
	const opts = parseArgv();
	const catalog = loadCatalog();
	const sample = pickSample(catalog, opts);

	if (!sample.length) {
		console.error('No games matched the selection.');
		process.exit(1);
	}

	const interceptor = await detectInterceptingProxy();
	if (interceptor && !opts.ignoreNetworkCheck) {
		console.error(`Network appears filtered: ${interceptor}`);
		console.error(
			'Results would measure the proxy, not the catalog. Move to an unfiltered\n' +
				'network, or pass --ignore-network-check to run anyway.'
		);
		process.exit(2);
	}

	console.log(`Verifying ${sample.length} games against ${opts.baseUrl}\n`);

	const browser = await chromium.launch({
		headless: !opts.headed,
		/* Playwright ships no Chromium build for every distro; fall back to the system one. */
		...(opts.browserPath ? { executablePath: opts.browserPath } : {}),
		args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio']
	});

	const results = [];
	const queue = [...sample];

	const workers = Array.from({ length: opts.concurrency }, async () => {
		const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		while (queue.length) {
			const game = queue.shift();
			if (!game) break;
			const result = await verifyGame(context, game, opts);
			results.push(result);
			const mark = result.status === 'LAUNCHED' ? 'ok  ' : 'FAIL';
			console.log(
				`  [${mark}] ${result.portal.padEnd(15)} ${result.id.slice(0, 46).padEnd(48)} ${result.status} ${result.ms}ms`
			);
		}
		await context.close();
	});

	await Promise.all(workers);
	await browser.close();

	const byPortal = new Map();
	for (const result of results) {
		if (!byPortal.has(result.portal)) byPortal.set(result.portal, { launched: 0, total: 0 });
		const bucket = byPortal.get(result.portal);
		bucket.total += 1;
		if (result.status === 'LAUNCHED') bucket.launched += 1;
	}

	console.log('\n=== launch rate by portal ===');
	for (const [portal, bucket] of [...byPortal].sort((a, b) => b[1].total - a[1].total)) {
		const pct = Math.round((bucket.launched / bucket.total) * 100);
		console.log(
			`  ${portal.padEnd(16)} ${String(bucket.launched).padStart(3)}/${String(bucket.total).padEnd(3)}  ${pct}%`
		);
	}

	const launched = results.filter((r) => r.status === 'LAUNCHED').length;
	console.log(`\noverall: ${launched}/${results.length} launched`);

	writeFileSync(
		REPORT_PATH,
		`${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`
	);
	console.log(`report: ${REPORT_PATH}`);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
