import type { Browser, BrowserContext, Page } from 'playwright';
import { PAGE_TIMEOUT_MS } from './config.js';
import { isDownloadableMediaUrl } from './scan-assets.js';

export interface EmbedDiscovery {
	embedPageUrl: string;
	/** FILE_URL from the Google Sites embed launcher script. */
	fileUrl: string;
	/** Full game wrapper HTML fetched via FILE_URL. */
	gameHtml: string;
	/** Asset URLs observed while the embedded game bootstraps. */
	networkAssetUrls: string[];
}

const FILE_URL_REGEX = /const\s+FILE_URL\s*=\s*['"]([^'"]+)['"]/;

const GAME_ASSET_PATTERN =
	/(?:Shrek2|background\.jpg|logo\.png|style\.css|\.data\.br|\.wasm\.br|framework\.js|loader\.js)/i;

function isGameAssetUrl(url: string): boolean {
	if (url.startsWith('blob:') || url.startsWith('data:')) return false;
	if (!url.includes('777kze777/shreh') && !url.includes('Shrek2')) return false;
	return GAME_ASSET_PATTERN.test(url);
}

/**
 * Parse FILE_URL from the Google Sites embed launcher markup.
 */
export function parseEmbedFileUrl(html: string): string | null {
	const match = html.match(FILE_URL_REGEX);
	return match?.[1] ?? null;
}

/**
 * Search the main document and all frames for the embed launcher FILE_URL.
 */
async function findEmbedFileUrl(page: Page): Promise<string | null> {
	const candidates: string[] = [await page.content()];

	for (const frame of page.frames()) {
		try {
			candidates.push(await frame.content());
		} catch {
			// Cross-origin frames may block content access.
		}
	}

	for (const html of candidates) {
		const url = parseEmbedFileUrl(html);
		if (url) return url;
	}

	return null;
}

/**
 * Bootstrap the game exactly like the embed launcher's PlayTo():
 * fetch FILE_URL and document.write into an iframe.
 */
async function bootstrapGameLikeEmbed(
	page: Page,
	gameHtml: string,
	networkAssetUrls: Set<string>
): Promise<void> {
	page.on('response', (response) => {
		const url = response.url();
		if (isGameAssetUrl(url)) {
			networkAssetUrls.add(url);
		} else if (isDownloadableMediaUrl(url) && response.ok()) {
			networkAssetUrls.add(url);
		}
	});

	await page.goto('about:blank');
	await page.setContent(`
    <!DOCTYPE html>
    <html><head><title>Embed bootstrap</title></head>
    <body style="margin:0">
      <iframe id="fr" style="width:100vw;height:100vh;border:none"></iframe>
    </body></html>
  `);

	await page.evaluate((html) => {
		const iframe = document.getElementById('fr') as HTMLIFrameElement;
		iframe.contentDocument?.open();
		iframe.contentDocument?.write(html);
		iframe.contentDocument?.close();
	}, gameHtml);

	await page.waitForFunction(
		() => {
			const iframe = document.getElementById('fr') as HTMLIFrameElement | null;
			const doc = iframe?.contentDocument;
			const inner = doc?.documentElement?.innerHTML ?? '';
			return inner.includes('createUnityInstance') || inner.includes('DATA_PARTS');
		},
		{ timeout: PAGE_TIMEOUT_MS }
	);

	// Allow Unity loader network requests to complete
	await page.waitForTimeout(8000);
}

/**
 * Discover game source from the embedded Google Sites launcher:
 * 1. Load the embed page and extract FILE_URL from embed markup
 * 2. Fetch the game wrapper (1.xml) via that URL — same as PlayTo()
 * 3. Bootstrap the game in a clean page and capture network assets
 */
export async function discoverFromEmbeddedGame(
	browser: Browser,
	embedPageUrl: string
): Promise<EmbedDiscovery> {
	const networkAssetUrls = new Set<string>();
	const embedContext = await browser.newContext();
	const embedPage = await embedContext.newPage();

	console.log(`[embed] Loading ${embedPageUrl}`);
	await embedPage.goto(embedPageUrl, {
		waitUntil: 'domcontentloaded',
		timeout: PAGE_TIMEOUT_MS
	});
	await embedPage.waitForTimeout(3000);

	const fileUrl = await findEmbedFileUrl(embedPage);
	await embedContext.close();

	if (!fileUrl) {
		throw new Error(
			'Could not find FILE_URL in Google Sites embed launcher. ' +
				'The page structure may have changed.'
		);
	}

	console.log(`[embed] Found launcher FILE_URL: ${fileUrl}`);

	// Fetch game wrapper via the same URL the embed launcher uses
	const fetchContext = await browser.newContext();
	const fetchPage = await fetchContext.newPage();
	const gameHtml = await fetchPage.evaluate(async (url) => {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`FILE_URL fetch failed: HTTP ${response.status}`);
		}
		return response.text();
	}, fileUrl);
	await fetchContext.close();

	console.log(`[embed] Fetched game wrapper (${(gameHtml.length / 1024).toFixed(1)} KB)`);

	const { extractHtmlFromWrapper } = await import('./extract.js');
	const playableHtml = extractHtmlFromWrapper(gameHtml);

	// Bootstrap like PlayTo() and capture Unity asset requests
	const bootContext = await browser.newContext();
	const bootPage = await bootContext.newPage();
	await bootstrapGameLikeEmbed(bootPage, playableHtml, networkAssetUrls);
	await bootContext.close();

	console.log(`[embed] Captured ${networkAssetUrls.size} asset URL(s) during game bootstrap`);

	return {
		embedPageUrl,
		fileUrl,
		gameHtml,
		networkAssetUrls: [...networkAssetUrls]
	};
}
