/**
 * Generic Chromium CDP capture: records network bodies into targetDir (hostname/path layout)
 * and writes the main-frame HTML to offline/index.html. Used heavily for Y8 (storage.y8.com, img.y8.com, …).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Browser } from 'playwright';
import { rewriteOfflineMirrorAssetUrls } from '../lib/offline-asset-url-rewrite.js';
import { urlToMirrorPath } from '../lib/url-to-mirror-path.js';
import { DEFAULT_PLAYWRIGHT_UA, launchChromium } from '../utils/playwright.js';

const MAX_BODY_BYTES = 120 * 1024 * 1024;

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type CdpCaptureOptions = {
	gameId: string;
	iframeSrc: string;
	targetDir: string;
	/** e.g. https://www.y8.com/games/my_game/ */
	referer?: string;
	headless?: boolean;
	settleMs?: number;
};

export type CdpCaptureResult = { ok: true } | { ok: false; reason: string };

export async function captureGameOfflineWithCdp(opts: CdpCaptureOptions): Promise<CdpCaptureResult> {
	const { iframeSrc, targetDir, referer, headless = true, settleMs = 20_000 } = opts;

	let browser: Browser | undefined;
	try {
		browser = await launchChromium({ headless });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return {
			ok: false,
			reason: `Playwright could not launch Chromium (${msg.slice(0, 200)}). Run: cd GamesAssembly && pnpm exec playwright install chromium`
		};
	}

	const seenUrls = new Set<string>();
	const pendingWrites: Promise<void>[] = [];

	try {
		const context = await browser.newContext({
			userAgent: DEFAULT_PLAYWRIGHT_UA,
			viewport: { width: 1280, height: 720 },
			locale: 'en-US',
			extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
		});
		const page = await context.newPage();
		const session = await context.newCDPSession(page);
		await session.send('Network.enable', {
			maxResourceBufferSize: MAX_BODY_BYTES,
			maxTotalBufferSize: MAX_BODY_BYTES * 4
		});

		const idToUrl = new Map<string, string>();

		session.on('Network.responseReceived', (e) => {
			idToUrl.set(e.requestId, e.response.url);
		});

		session.on('Network.loadingFinished', (e) => {
			const url = idToUrl.get(e.requestId);
			if (!url || url.startsWith('data:') || url.startsWith('blob:') || seenUrls.has(url)) return;

			pendingWrites.push(
				(async () => {
					try {
						const body = await session.send('Network.getResponseBody', { requestId: e.requestId });
						let buf = body.base64Encoded
							? Buffer.from(body.body, 'base64')
							: Buffer.from(body.body, 'utf-8');
						if (buf.length === 0 || buf.length > MAX_BODY_BYTES) return;
						seenUrls.add(url);
						const out = urlToMirrorPath(targetDir, url);
						if (!out) return;
						mkdirSync(dirname(out), { recursive: true });
						writeFileSync(out, buf);
					} catch {
						/* binary / opaque response */
					}
				})()
			);
		});

		await page.goto(iframeSrc, {
			waitUntil: 'domcontentloaded',
			timeout: 120_000,
			...(referer ? { referer } : {})
		});
		try {
			await page.waitForLoadState('networkidle', { timeout: 90_000 });
		} catch {
			/* non-fatal */
		}
		await delay(settleMs);

		for (let round = 0; round < 8; round++) {
			await Promise.allSettled(pendingWrites);
			await delay(1500);
		}

		const gameHtml = await page.content();
		mkdirSync(targetDir, { recursive: true });
		writeFileSync(join(targetDir, 'index.html'), gameHtml, 'utf-8');

		const rw = rewriteOfflineMirrorAssetUrls(targetDir);
		if (rw.filesModified > 0) {
			console.log(
				`   CDP: offline URL rewrite updated ${rw.filesModified} file(s) (before deep asset pass)`
			);
		}

		await context.close();
		return { ok: true };
	} finally {
		await browser.close();
	}
}
