#!/usr/bin/env node

/**
 * Verify that catalog games actually launch, not merely that their host answers.
 *
 * An HTTP 200 says nothing about whether a game renders — portals happily return 200 for
 * splash pages, ad gates and Flash stubs. This driver loads each game the way a user does
 * (the app's game page, click Play, wait for the frame to paint) and classifies the outcome.
 *
 * "Painted" means both: a sized canvas (or video) somewhere in the frame tree, and a
 * screenshot of the game surface that is not a flat colour. A Unity build creates its
 * canvas before it has loaded anything, so the canvas alone reported loading screens as
 * launches.
 *
 * Requires the dev server (the puller is optional; without it the app launches direct,
 * which is what the web and Android builds do):
 *   npx vite dev --port 5176 --host 127.0.0.1
 *
 * Usage:
 *   node scripts/verify-game-launches.mjs --base http://127.0.0.1:5176 --gpu --sample 15
 *   node scripts/verify-game-launches.mjs --ids slope,crazygames-mine-clone
 *   node scripts/verify-game-launches.mjs --portal crazygames --sample 40 --random --seed 7
 *   node scripts/verify-game-launches.mjs --ids-file ids.txt --record --skip-recorded
 *   node scripts/verify-game-launches.mjs --retry-failed --timeout 150000 --patient --record
 *
 * --recheck lets a new result replace an earlier launch (for re-testing doubtful passes).
 * --direct frames the game's own URL from a bare page instead of going through the app (see
 * openHarness). --patient disables the early give-up on a blank, network-silent game.
 *
 * --record merges results into scripts/data/catalog-audit/launch.json (keyed by game id,
 * with a short attempt history), which the quality classifier reads. Without it the run
 * only writes scripts/data/launch-verification.json as before.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { decodePng } from './lib/png-stats.mjs';
import {
	AUDIT_DIR,
	JsonCache,
	loadCatalog,
	portalOf,
	stratifiedSample
} from './catalog-quality/lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = join(__dirname, 'data', 'launch-verification.json');
const LAUNCH_CACHE_PATH = join(AUDIT_DIR, 'launch.json');

/**
 * A game gets this long to paint something playable before we call it failed.
 * Software WebGL is slow — heavy titles legitimately need 40s+, so a short
 * timeout reports working games as broken. With --gpu most titles paint in under 15s.
 */
const DEFAULT_LAUNCH_TIMEOUT_MS = 45_000;
/** After the first painted frame, how long to wait for the screen to settle. */
const SETTLE_MS = 15_000;
/** Give up on a blank game once this long has passed with no network activity at all. */
const STALL_MIN_MS = 45_000;
const STALL_QUIET_MS = 25_000;
/** Concurrent browser contexts. WebGL games are heavy; keep this low. */
const DEFAULT_CONCURRENCY = 4;

function parseArgv() {
	const args = process.argv.slice(2);
	const value = (flag, fallback) => {
		const index = args.indexOf(flag);
		return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
	};
	const idsFile = value('--ids-file', null);
	const fromFile = idsFile
		? readFileSync(idsFile, 'utf8')
				.split(/\s+/)
				.map((s) => s.trim())
				.filter(Boolean)
		: null;
	return {
		baseUrl: value('--base', 'http://localhost:5178'),
		perPortal: Number(value('--sample', '15')),
		portal: value('--portal', null),
		ids: value('--ids', null)?.split(',').filter(Boolean) || fromFile,
		random: args.includes('--random'),
		seed: Number(value('--seed', '1')),
		headed: args.includes('--headed'),
		gpu: args.includes('--gpu'),
		browserPath: value('--browser', process.env.LAUNCH_VERIFY_BROWSER || null),
		launchTimeoutMs: Number(value('--timeout', String(DEFAULT_LAUNCH_TIMEOUT_MS))),
		concurrency: Number(value('--concurrency', String(DEFAULT_CONCURRENCY))),
		ignoreNetworkCheck: args.includes('--ignore-network-check'),
		record: args.includes('--record'),
		skipRecorded: args.includes('--skip-recorded'),
		retryFailed: args.includes('--retry-failed'),
		shotsDir: value('--shots', null),
		direct: args.includes('--direct'),
		patient: args.includes('--patient'),
		recheck: args.includes('--recheck')
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

/** Deterministic sample so repeated runs compare like for like. */
function pickSample(catalog, opts, recorded) {
	if (opts.ids) {
		const wanted = new Set(opts.ids);
		return catalog.filter((game) => wanted.has(game.id));
	}
	if (opts.retryFailed) {
		return catalog.filter((game) => {
			const entry = recorded?.get(game.id);
			/* A refused frame is refused every time; everything else gets a patient retry. */
			if (!entry || ['LAUNCHED', 'FRAME_ERROR', 'PORTAL_REFUSED'].includes(entry.status)) {
				return false;
			}
			const said = [entry.gate || '', ...(entry.text || [])];
			return !said.some((t) => REFUSED_TEXT_RE.test(t) || PORTAL_REFUSAL_RE.test(t));
		});
	}

	const byPortal = new Map();
	for (const game of catalog) {
		const portal = portalOf(game);
		if (opts.portal && portal !== opts.portal) continue;
		if (!byPortal.has(portal)) byPortal.set(portal, []);
		byPortal.get(portal).push(game);
	}

	const picked = opts.random
		? /* Stratified random: a seeded shuffle per portal, first N (shared with the classifier). */
			stratifiedSample(catalog, { perPortal: opts.perPortal, seed: opts.seed, portal: opts.portal })
		: [];
	for (const games of opts.random ? [] : byPortal.values()) {
		const sorted = [...games].sort((a, b) => a.id.localeCompare(b.id));
		/* Even stride across each sorted portal, so a sample spans the whole portal. */
		const stride = Math.max(1, Math.floor(sorted.length / opts.perPortal));
		const fromPortal = [];
		for (let i = 0; i < sorted.length && fromPortal.length < opts.perPortal; i += stride) {
			fromPortal.push(sorted[i]);
		}
		picked.push(...fromPortal);
	}
	/* Interleave portals so parallel workers mix heavy Unity builds with light HTML5 pages. */
	const queues = new Map();
	for (const game of picked) {
		const portal = portalOf(game);
		if (!queues.has(portal)) queues.set(portal, []);
		queues.get(portal).push(game);
	}
	const interleaved = [];
	for (let i = 0; interleaved.length < picked.length; i++) {
		for (const list of queues.values()) if (i < list.length) interleaved.push(list[i]);
	}
	return interleaved;
}

/**
 * Walk the frame tree looking for evidence that a game is running: a sized
 * canvas, or a WebGL context. Portals nest the real game several frames deep.
 */
const DETECT_PLAYABLE = `(() => {
  const visible = (el) => el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
  /* Unity templates show these until the build has loaded; the canvas exists long before. */
  const loader = ['#unity-loading-bar', '#unity-progress-bar-full', '.webgl-content .progress', '#loadingBlock']
    .map((sel) => document.querySelector(sel)).find(visible);
  const canvases = [...document.querySelectorAll('canvas')];
  const painted = canvases.find((c) => c.width > 200 && c.height > 150 && c.getBoundingClientRect().width > 100);
  if (painted && !loader) return { playable: true, how: 'canvas', w: painted.width, h: painted.height };
  const video = document.querySelector('video');
  if (video && video.videoWidth > 200 && !video.paused) return { playable: true, how: 'video' };
  return { playable: false, canvases: canvases.length, loading: Boolean(loader) };
})()`;

/** Visible text of a frame, for spotting portal gates ("Rotate your screen", SDK errors). */
const FRAME_TEXT = `(() => (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').trim().slice(0, 240))()`;

const GATE_TEXT_RE =
	/rotate your (?:screen|device)|not available in your (?:country|region)|disable (?:your )?ad ?block|adblock detected|sdk initiali[sz]ation failed|failed to load|access denied|this game is (?:not|no longer) available|game not found|browser is not supported|webgl is not supported|flash player|enable javascript|refused to connect|took too long to respond|404/i;

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

/** Portal shells and FNF mirrors stop on a start button; a user would press it. */
const START_BUTTON_RE =
	/^\s*(?:play|play now|play game|start|start game|tap to (?:play|start)|click to (?:play|start)|continue|ok)\s*!?\s*$/i;

async function pressStartButton(page) {
	for (const frame of page.frames()) {
		if (frame === page.mainFrame()) continue;
		try {
			const button = frame
				.locator('button, a, [role="button"], div[class*="play" i], div[class*="start" i]')
				.filter({ hasText: START_BUTTON_RE })
				.first();
			if ((await button.count()) && (await button.isVisible())) {
				await button.click({ timeout: 3000 });
				return true;
			}
		} catch {
			/* Cross-origin frame navigated away mid-query; try the next one. */
		}
	}
	return false;
}

/** Chrome's own error page inside a frame: the load failed and will not recover. */
const REFUSED_TEXT_RE = /refused to connect|took too long to respond|ERR_[A-Z_]+/;

/**
 * The portal itself says no: CrazyGames' "This version of … can be played only on
 * CrazyGames.com" site-lock, or a "Gone / no longer available" page.
 */
const PORTAL_REFUSAL_RE =
	/can be played (?:only|exclusively) on|can only be played on|only playable on|is no longer available|this game has been removed/i;

/** Visible loader text ("10% (8 / 79 MB)", "Loading...") means the game is still arriving. */
const LOADING_TEXT_RE = /\b\d{1,3}\s?%|\bloading\b/i;

async function collectFrameText(page) {
	const texts = [];
	for (const frame of page.frames()) {
		if (frame === page.mainFrame()) continue;
		try {
			const text = await frame.evaluate(FRAME_TEXT);
			if (text) texts.push(text);
		} catch {
			/* ignore */
		}
	}
	return texts;
}

/**
 * Screenshot the game surface and summarise it: how many distinct colours (on a coarse
 * grid) and how much of the surface the most common colour covers. A loading screen or
 * a black frame is one colour; a game title screen is many.
 */
async function surfacePaint(page, shotPath) {
	const frame = page.locator('iframe').first();
	if (!(await frame.count())) return null;
	let png;
	try {
		png = await frame.screenshot({ type: 'png', timeout: 10_000 });
	} catch {
		return null;
	}
	if (shotPath) {
		await frame
			.screenshot({ type: 'jpeg', quality: 55, path: shotPath, timeout: 10_000 })
			.catch(() => {});
	}
	const img = decodePng(png);
	const counts = new Map();
	const step = Math.max(1, Math.floor(Math.min(img.width, img.height) / 48));
	/* The coarse grid itself, to tell a settled screen from a loader that is still moving. */
	const grid = [];
	for (let y = 0; y < img.height; y += step) {
		for (let x = 0; x < img.width; x += step) {
			const i = (y * img.width + x) * 3;
			const key = ((img.rgb[i] >> 4) << 8) | ((img.rgb[i + 1] >> 4) << 4) | (img.rgb[i + 2] >> 4);
			counts.set(key, (counts.get(key) || 0) + 1);
			grid.push(key);
		}
	}
	const dominant = Math.max(...counts.values()) / Math.max(1, grid.length);
	const summary = { colours: counts.size, dominant: Math.round(dominant * 1000) / 1000 };
	Object.defineProperty(summary, 'grid', { value: grid, enumerable: false });
	return summary;
}

/** Share of grid cells that changed colour between two samples of the surface. */
function surfaceChange(before, after) {
	if (!before?.grid || !after?.grid || before.grid.length !== after.grid.length) return 1;
	let changed = 0;
	for (let i = 0; i < before.grid.length; i++) if (before.grid[i] !== after.grid[i]) changed++;
	return changed / before.grid.length;
}

/**
 * A logo on a flat background: portal splash screens (AddictingGames, Ninja Kiwi, Max
 * Games) look like this for a few seconds before the game replaces them.
 */
function looksLikeSplash(paint) {
	return paint.colours < 25 && paint.dominant >= 0.7;
}

/*
 * Thresholds from screenshots of real outcomes: loaders (Y8, Playhop, Unity) come out at
 * 1-8 colours with 96-100 % of the surface one colour; Slope's black-and-green menu is 36
 * colours at 90 % black; 100 Arrows is two colours at 89 % white.
 */
function isPainted(paint) {
	if (!paint) return false;
	return paint.colours >= 16 || (paint.colours >= 2 && paint.dominant < 0.9);
}

/** The iframe `allow` list LazyGameFrame gives every game. */
const APP_IFRAME_ALLOW = 'fullscreen; autoplay; gamepad; microphone; camera';

/**
 * --direct: frame the game's own URL from a bare page on the app's origin, the way the web
 * and Android builds launch it (no puller relay, no dev-server compile, no app retries).
 * This measures the catalog entry itself. The harness page is served by request
 * interception, so nothing is added to the app or static/.
 */
async function openHarness(page, game, opts) {
	const src = game.onlineEmbedUrl || `/games/${encodeURIComponent(game.id)}/online/index.html`;
	const harnessUrl = `${opts.baseUrl}/__launch-harness__/${encodeURIComponent(game.id)}`;
	await page.route(harnessUrl, (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#111}iframe{display:block;width:1152px;height:648px;border:0;background:#000}</style></head><body><iframe src="${src.replace(/"/g, '&quot;')}" allow="${APP_IFRAME_ALLOW}" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe></body></html>`
		})
	);
	await page.goto(harnessUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
	/* Games gate audio and often the start screen on a user gesture; give them one. */
	await page.mouse.click(576, 324).catch(() => {});
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
	/* Last time any frame's network moved: a game still downloading is not a stalled game. */
	let lastNetworkAt = Date.now();
	const markNetwork = () => {
		lastNetworkAt = Date.now();
	};
	page.on('request', markNetwork);
	page.on('requestfinished', markNetwork);

	const shotPath = opts.shotsDir ? join(opts.shotsDir, `${game.id}.jpg`) : null;
	const base = { id: game.id, portal: portalOf(game), timeout: opts.launchTimeoutMs };
	const started = Date.now();
	try {
		if (opts.direct) {
			await openHarness(page, game, opts);
		} else {
			await page.goto(`${opts.baseUrl}/games/${game.id}`, {
				waitUntil: 'domcontentloaded',
				timeout: 60_000
			});

			/* The player defers the iframe until the user asks for it. */
			const playButton = page.getByRole('button', { name: /^Load and play/ });
			await playButton.waitFor({ timeout: 30_000 });
			await playButton.click();
		}
		const clicked = Date.now();

		const deadline = clicked + opts.launchTimeoutMs;
		let lastCanvas = null;
		let lastPaint = null;
		let nextRefusalCheck = 0;
		let pressed = 0;
		let nextPress = clicked + 8_000;
		while (Date.now() < deadline) {
			/*
			 * Many games hold on a start screen until clicked. Press a visible Play/Start
			 * button when there is one (FNF mirrors, portal shells), at most three times.
			 */
			if (pressed < 3 && Date.now() >= nextPress) {
				nextPress = Date.now() + 12_000;
				if (await pressStartButton(page)) pressed += 1;
			}
			/*
			 * A frame the browser refused to load (X-Frame-Options, CSP, DNS, TLS) shows
			 * Chrome's error page and never recovers; waiting out the timeout only costs
			 * bandwidth other games need.
			 */
			if (Date.now() - clicked > 8_000 && Date.now() >= nextRefusalCheck) {
				nextRefusalCheck = Date.now() + 6_000;
				if (page.frames().some((f) => f.url().startsWith('chrome-error://'))) break;
				const texts = await collectFrameText(page);
				if (texts.some((t) => REFUSED_TEXT_RE.test(t) || PORTAL_REFUSAL_RE.test(t))) break;
			}
			/*
			 * Nothing painted and no request for a while: the game is stuck (a script error,
			 * a dead SDK handshake), not slow. Give up early unless --patient, which the
			 * 150 s retry pass uses so a slow game gets every chance.
			 */
			if (
				!opts.patient &&
				Date.now() - clicked > STALL_MIN_MS &&
				Date.now() - lastNetworkAt > STALL_QUIET_MS
			) {
				break;
			}
			const playable = await probePlayable(page);
			if (playable) {
				lastCanvas = playable;
				lastPaint = await surfacePaint(page, null);
				if (isPainted(lastPaint)) {
					/*
					 * Wait for the picture to settle: a splash logo or a moving loading bar
					 * paints too. Accept once two samples 3 s apart match (and it is not a
					 * bare splash), or when the settle window runs out with something still
					 * painted — an animated title screen never holds still.
					 */
					const settleUntil = Math.min(deadline, Date.now() + SETTLE_MS);
					let previous = lastPaint;
					let settled = false;
					while (Date.now() < settleUntil) {
						await page.waitForTimeout(3000);
						const current = await surfacePaint(page, null);
						if (!current) break;
						if (
							isPainted(current) &&
							!looksLikeSplash(current) &&
							surfaceChange(previous, current) <= 0.15
						) {
							settled = true;
							break;
						}
						previous = current;
					}
					const paint = (await surfacePaint(page, shotPath)) || lastPaint;
					if (!isPainted(paint)) continue;
					const texts = await collectFrameText(page);
					return {
						...base,
						status: 'LAUNCHED',
						settled,
						pressed,
						ms: Date.now() - clicked,
						how: playable.how,
						w: playable.w,
						h: playable.h,
						paint,
						frame: playable.frame,
						gate: texts.find((t) => GATE_TEXT_RE.test(t))?.slice(0, 160)
					};
				}
			}
			await page.waitForTimeout(1500);
		}

		const paint = await surfacePaint(page, shotPath);
		const texts = await collectFrameText(page);
		const frames = page.frames().map((f) => f.url().slice(0, 110));
		const frameError =
			frames.some((url) => url.startsWith('chrome-error://')) ||
			texts.some((t) => REFUSED_TEXT_RE.test(t));
		/*
		 * No canvas, but the surface shows a real page: DOM-rendered games (and some
		 * menus) never create a canvas. Kept distinct so the classifier can weigh it.
		 */
		/*
		 * Portal loaders paint blurred cover art over the whole surface, so "painted, no
		 * canvas" is only a DOM game when nothing on screen still reads as loading.
		 */
		const loadingText = texts.find((t) => LOADING_TEXT_RE.test(t));
		const portalRefused = texts.some((t) => PORTAL_REFUSAL_RE.test(t));
		const status = frameError
			? 'FRAME_ERROR'
			: portalRefused
				? 'PORTAL_REFUSED'
				: loadingText
					? 'STILL_LOADING'
					: lastCanvas
						? 'BLANK_CANVAS'
						: isPainted(paint)
							? 'PAINTED_DOM'
							: 'NO_RENDER';
		return {
			...base,
			status,
			ms: Date.now() - clicked,
			paint,
			text: texts.slice(0, 3).map((t) => t.slice(0, 160)),
			gate: texts.find((t) => GATE_TEXT_RE.test(t))?.slice(0, 160),
			frames: frames.slice(0, 6),
			consoleErrors: consoleErrors.slice(0, 4),
			failedRequests: failedRequests.slice(0, 4)
		};
	} catch (error) {
		return {
			...base,
			status: 'ERROR',
			ms: Date.now() - started,
			error: String(error).slice(0, 200),
			consoleErrors: consoleErrors.slice(0, 4)
		};
	} finally {
		await page.close().catch(() => {});
	}
}

const STATUS_CODE = {
	LAUNCHED: 'L',
	PAINTED_DOM: 'D',
	BLANK_CANVAS: 'C',
	STILL_LOADING: 'S',
	FRAME_ERROR: 'F',
	PORTAL_REFUSED: 'R',
	NO_RENDER: 'N',
	ERROR: 'E'
};

/** Keep the latest full result plus a compact history of every attempt's outcome. */
function recordResult(cache, result, { recheck = false } = {}) {
	const previous = cache.get(result.id);
	const hist = `${previous?.hist || ''}${STATUS_CODE[result.status] || '?'}`.slice(-8);
	const compact = {
		status: result.status,
		ms: result.ms,
		timeout: result.timeout,
		how: result.how,
		settled: result.settled,
		w: result.w,
		h: result.h,
		paint: result.paint,
		gate: result.gate,
		text: result.status === 'LAUNCHED' ? undefined : result.text,
		frames: result.status === 'LAUNCHED' ? undefined : result.frames?.slice(1, 4),
		error: result.error,
		frame: result.frame,
		at: new Date().toISOString().slice(0, 10),
		hist
	};
	/* A launch is the strongest evidence; later flaky failures must not erase it. */
	if (!recheck && previous?.status === 'LAUNCHED' && result.status !== 'LAUNCHED') {
		cache.set(result.id, { ...previous, hist });
		return;
	}
	cache.set(result.id, JSON.parse(JSON.stringify(compact)));
}

async function main() {
	const opts = parseArgv();
	const catalog = loadCatalog();
	const cache = opts.record || opts.retryFailed ? new JsonCache(LAUNCH_CACHE_PATH) : null;
	const recorded = cache ? new Map(Object.entries(cache.results)) : null;
	let sample = pickSample(catalog, opts, recorded);
	if (opts.skipRecorded && recorded) sample = sample.filter((game) => !recorded.has(game.id));

	if (!sample.length) {
		console.error('No games matched the selection.');
		process.exit(opts.skipRecorded ? 0 : 1);
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
	if (opts.shotsDir) mkdirSync(opts.shotsDir, { recursive: true });

	console.log(`Verifying ${sample.length} games against ${opts.baseUrl}\n`);

	const browser = await chromium.launch({
		headless: !opts.headed,
		/* Playwright ships no Chromium build for every distro; fall back to the system one. */
		...(opts.browserPath ? { executablePath: opts.browserPath } : {}),
		args: [
			...(opts.gpu
				? /* Real GPU through ANGLE/GL — works headless on Mesa; games paint in seconds. */
					['--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist']
				: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']),
			'--mute-audio',
			'--autoplay-policy=no-user-gesture-required'
		]
	});

	const results = [];
	const queue = [...sample];

	const workers = Array.from({ length: opts.concurrency }, async () => {
		let context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
		let used = 0;
		while (queue.length) {
			const game = queue.shift();
			if (!game) break;
			/* Fresh context now and then, so one game's service worker or storage cannot leak. */
			if (++used % 10 === 0) {
				await context.close().catch(() => {});
				context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
			}
			const result = await verifyGame(context, game, opts);
			results.push(result);
			if (cache) recordResult(cache, result, { recheck: opts.recheck });
			const mark = result.status === 'LAUNCHED' ? 'ok  ' : 'FAIL';
			const paint = result.paint ? ` c${result.paint.colours}/d${result.paint.dominant}` : '';
			console.log(
				`  [${mark}] ${result.portal.padEnd(15)} ${result.id.slice(0, 46).padEnd(48)} ${result.status} ${result.ms}ms${paint}${result.gate ? ` gate="${result.gate.slice(0, 40)}"` : ''}`
			);
		}
		await context.close().catch(() => {});
	});

	await Promise.all(workers);
	await browser.close();
	cache?.flush();

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

	if (!existsSync(dirname(REPORT_PATH))) mkdirSync(dirname(REPORT_PATH), { recursive: true });
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
