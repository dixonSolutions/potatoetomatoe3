/**
 * Capture real Poki game documents + assets in a browser context.
 * Plain wget to games.poki.com often returns only the "has moved" stub; Playwright loads
 * the same pages as users and records network bodies via CDP.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { chromium } from 'playwright';

const UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MAX_BODY_BYTES = 120 * 1024 * 1024;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** Map URL to safe path under targetDir: hostname/path-segments */
export function urlToMirrorPath(targetDir, urlStr) {
    let u;
    try {
        u = new URL(urlStr);
    } catch {
        return null;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname;
    let path = u.pathname || '/';
    if (path.endsWith('/')) path += 'index.html';
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) segments.push('index.html');
    const last = segments[segments.length - 1];
    if (!last.includes('.')) segments.push('index.html');
    return join(targetDir, host, ...segments);
}

function slugFromIframeOrGameId(iframeSrc, gameId) {
    try {
        const u = new URL(iframeSrc);
        const parts = u.pathname.split('/').filter(Boolean);
        return parts[parts.length - 1] || gameId;
    } catch {
        return gameId;
    }
}

function isMovedStub(html) {
    return typeof html === 'string' && /has moved/i.test(html) && /poki\.com\/en\/g\//i.test(html);
}

/**
 * @param {{ gameId: string, iframeSrc: string, targetDir: string, headless?: boolean, settleMs?: number }} opts
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function capturePokiGameOffline(opts) {
    const { gameId, iframeSrc, targetDir, headless = true, settleMs = 16_000 } = opts;
    const slug = slugFromIframeOrGameId(iframeSrc, gameId);
    const portalUrl = `https://poki.com/en/g/${encodeURIComponent(slug)}`;
    const seenUrls = new Set();

    const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    let browser;
    try {
        browser = await chromium.launch({
            headless,
            ...(chromiumPath ? { executablePath: chromiumPath } : {})
        });
    } catch (e) {
        const msg = e?.message || String(e);
        return {
            ok: false,
            reason: `Playwright could not launch Chromium (${msg.slice(0, 200)}). Install browsers: pnpm exec playwright install chromium`
        };
    }
    try {
        const context = await browser.newContext({
            userAgent: UA,
            viewport: { width: 1280, height: 720 },
            locale: 'en-US',
            extraHTTPHeaders: {
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });
        const page = await context.newPage();
        const session = await context.newCDPSession(page);
        await session.send('Network.enable', {
            maxResourceBufferSize: MAX_BODY_BYTES,
            maxTotalBufferSize: MAX_BODY_BYTES * 4
        });

        const idToUrl = new Map();
        const pendingWrites = [];

        session.on('Network.responseReceived', (e) => {
            idToUrl.set(e.requestId, e.response.url);
        });

        session.on('Network.loadingFinished', (e) => {
            const url = idToUrl.get(e.requestId);
            if (!url || url.startsWith('data:') || seenUrls.has(url)) return;

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
                        /* */
                    }
                })()
            );
        });

        await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        await delay(4000);

        try {
            await page.goto(iframeSrc, {
                waitUntil: 'domcontentloaded',
                timeout: 120_000,
                referer: portalUrl
            });
        } catch (e) {
            await context.close();
            return { ok: false, reason: `goto games.poki.com failed: ${String(e.message).slice(0, 120)}` };
        }

        try {
            await page.waitForLoadState('networkidle', { timeout: 90_000 });
        } catch {
            /* */
        }
        await delay(settleMs);

        let gameHtml = await page.content();

        if (isMovedStub(gameHtml)) {
            for (const frame of page.frames()) {
                const u = frame.url();
                if (u.includes('games.poki.com')) {
                    try {
                        const h = await frame.content();
                        if (h && !isMovedStub(h)) {
                            gameHtml = h;
                            break;
                        }
                    } catch {
                        /* */
                    }
                }
            }
        }

        for (let round = 0; round < 8; round++) {
            await Promise.allSettled(pendingWrites);
            await delay(1500);
        }

        if (isMovedStub(gameHtml)) {
            await context.close();
            return { ok: false, reason: 'poki-stub: games.poki.com returned "has moved" HTML' };
        }

        mkdirSync(targetDir, { recursive: true });
        writeFileSync(join(targetDir, 'index.html'), gameHtml, 'utf-8');

        await context.close();
        return { ok: true };
    } finally {
        await browser.close();
    }
}
