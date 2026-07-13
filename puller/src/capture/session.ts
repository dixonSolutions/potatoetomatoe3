import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { throwIfCancelled, DownloadCancelledError } from '../cancel-registry.js';
import {
	extractIframeSrc,
	findEmbedFileUrl,
	listNestedIframeSrcs,
	waitForGameShell
} from './frames.js';
import { createNetworkVault, type NetworkVault } from './network-vault.js';
import { localPathForUrl, relativePathForUrl } from './rewrite.js';

export const CAPTURE_PAGE_TIMEOUT_MS = 60_000;
export const CAPTURE_BOOT_WAIT_MS = 12_000;

export interface CaptureResult {
	baseUrl: string;
	/** Relative entry HTML under outDir (usually index.html after promote). */
	entryRel: string;
	/** Absolute URLs captured in the vault. */
	capturedUrls: string[];
	/** True when Playwright capture succeeded. */
	ok: boolean;
	/** Non-fatal notes (e.g. nested iframes still remote). */
	notes: string[];
}

export interface CaptureOptions {
	outDir: string;
	/** Game host URL (iframe src). */
	gameUrl: string;
	signal?: AbortSignal;
	onProgress?: (progress: number, message: string) => void;
	bootWaitMs?: number;
	pageTimeoutMs?: number;
}

function normalizeGameBaseUrl(iframeSrc: string): string {
	const parsed = new URL(iframeSrc);
	if (!parsed.pathname.endsWith('/') && !/\.[a-z0-9]+$/i.test(parsed.pathname)) {
		parsed.pathname = `${parsed.pathname}/`;
	}
	return parsed.href;
}

async function ensureEntryHtml(
	outDir: string,
	baseUrl: string,
	vault: NetworkVault,
	page: Page
): Promise<string> {
	const entryDest = localPathForUrl(baseUrl, new URL('index.html', baseUrl).href, outDir);
	const indexCandidate = path.join(outDir, 'index.html');

	// Prefer the document HTML for the navigated URL
	let html = '';
	try {
		html = await page.content();
	} catch {
		html = '';
	}

	if (!html || html.length < 64) {
		const fromVault = vault.entries.get(baseUrl) ?? vault.entries.get(baseUrl.replace(/\/$/, ''));
		if (fromVault) {
			html = fromVault.body.toString('utf-8');
		}
	}

	if (!html || html.length < 64) {
		// Fall back to any HTML-like vault entry under the same origin
		for (const entry of vault.entries.values()) {
			try {
				if (new URL(entry.url).origin !== new URL(baseUrl).origin) continue;
			} catch {
				continue;
			}
			const ct = entry.contentType.toLowerCase();
			const looksHtml =
				ct.includes('text/html') ||
				/\.html?$/i.test(entry.url) ||
				entry.body.subarray(0, 32).toString('utf8').includes('<');
			if (looksHtml && entry.body.length >= 64) {
				html = entry.body.toString('utf-8');
				break;
			}
		}
	}

	if (!html || html.length < 64) {
		throw new Error('Playwright capture finished but no HTML entry was captured');
	}

	await fs.mkdir(path.dirname(entryDest), { recursive: true });
	await fs.writeFile(entryDest, html, 'utf-8');

	// Also place a root index.html when the mirror nests under host path
	if (path.resolve(entryDest) !== path.resolve(indexCandidate)) {
		await fs.mkdir(outDir, { recursive: true });
		await fs.writeFile(indexCandidate, html, 'utf-8');
		return 'index.html';
	}

	return relativePathForUrl(baseUrl, new URL('index.html', baseUrl).href, outDir) || 'index.html';
}

/**
 * Full-scrape a game URL with Playwright: network vault + nested frame discovery.
 * Writes captured bodies into outDir. Caller may still run BFS fill-in + ad strip.
 */
export async function captureGameWithPlaywright(options: CaptureOptions): Promise<CaptureResult> {
	const {
		outDir,
		gameUrl,
		signal,
		onProgress,
		bootWaitMs = CAPTURE_BOOT_WAIT_MS,
		pageTimeoutMs = CAPTURE_PAGE_TIMEOUT_MS
	} = options;

	const notes: string[] = [];
	const baseUrl = normalizeGameBaseUrl(gameUrl);
	throwIfCancelled(signal);
	onProgress?.(20, `Launching browser for ${baseUrl}…`);

	let browser: Browser | null = null;
	const vault = createNetworkVault();

	try {
		browser = await chromium.launch({ headless: true });
		const context: BrowserContext = await browser.newContext({
			ignoreHTTPSErrors: true,
			userAgent:
				'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
		});
		const page: Page = await context.newPage();
		vault.attach(page);

		const onAbort = () => {
			void context.close().catch(() => {});
		};
		signal?.addEventListener('abort', onAbort, { once: true });

		throwIfCancelled(signal);
		onProgress?.(28, 'Loading game host…');

		await page.goto(baseUrl, {
			waitUntil: 'domcontentloaded',
			timeout: pageTimeoutMs
		});

		// Google Sites / launcher FILE_URL → fetch wrapper and navigate
		const fileUrl = await findEmbedFileUrl(page);
		if (fileUrl) {
			notes.push(`embed FILE_URL=${fileUrl}`);
			onProgress?.(32, 'Fetching embed FILE_URL wrapper…');
			const wrapperHtml = await page.evaluate(async (url) => {
				const res = await fetch(url);
				if (!res.ok) throw new Error(`FILE_URL fetch failed: HTTP ${res.status}`);
				return res.text();
			}, fileUrl);

			await page.goto('about:blank');
			await page.setContent(
				`<!DOCTYPE html><html><body style="margin:0"><iframe id="fr" style="width:100vw;height:100vh;border:none"></iframe></body></html>`
			);
			await page.evaluate((html) => {
				const iframe = document.getElementById('fr') as HTMLIFrameElement;
				iframe.contentDocument?.open();
				iframe.contentDocument?.write(html);
				iframe.contentDocument?.close();
			}, wrapperHtml);
		}

		onProgress?.(40, 'Waiting for game shell / network…');
		await waitForGameShell(page, Math.min(bootWaitMs, pageTimeoutMs));
		await page.waitForTimeout(Math.min(bootWaitMs, 8_000));

		const nested = await listNestedIframeSrcs(page);
		for (const src of nested) {
			if (src === baseUrl || src.startsWith(baseUrl)) continue;
			notes.push(`nested iframe ${src}`);
			try {
				throwIfCancelled(signal);
				onProgress?.(45, `Following nested iframe…`);
				const nestedPage = await context.newPage();
				vault.attach(nestedPage);
				await nestedPage.goto(src, {
					waitUntil: 'domcontentloaded',
					timeout: pageTimeoutMs
				});
				await waitForGameShell(nestedPage, Math.min(bootWaitMs, 10_000));
				await nestedPage.waitForTimeout(3_000);
				vault.detach(nestedPage);
				await nestedPage.close();
			} catch (err) {
				if (err instanceof DownloadCancelledError) throw err;
				notes.push(`nested iframe failed: ${src}`);
			}
		}

		throwIfCancelled(signal);
		onProgress?.(50, `Saving ${vault.entries.size} captured response(s)…`);
		await fs.mkdir(outDir, { recursive: true });
		await vault.flush(outDir, baseUrl);
		const entryRel = await ensureEntryHtml(outDir, baseUrl, vault, page);

		vault.detach(page);
		signal?.removeEventListener('abort', onAbort);
		await context.close();

		return {
			baseUrl,
			entryRel,
			capturedUrls: [...vault.entries.keys()],
			ok: true,
			notes
		};
	} finally {
		await browser?.close().catch(() => {});
	}
}

export { extractIframeSrc, localPathForUrl, relativePathForUrl };
