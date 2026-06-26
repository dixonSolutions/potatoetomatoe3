import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { APIRequestContext, Page } from 'playwright';
import { DOWNLOAD_CONCURRENCY } from './config.js';
import { buildAssetUrls, urlToRelativePath, type ExtractedGameInfo } from './extract.js';
import { isDownloadableMediaUrl } from './scan-assets.js';

const execFileAsync = promisify(execFile);

/** 1×1 transparent PNG used when a remote asset is blocked or unavailable. */
const PLACEHOLDER_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
	'base64'
);

export interface DownloadResult {
	url: string;
	relativePath: string;
	size: number;
	sha256: string;
	/** True when the original host blocked the download and a stub PNG was written. */
	placeholder?: boolean;
}

/**
 * Auto-detect part count by probing until 404.
 */
export async function detectPartCount(
	request: APIRequestContext,
	baseUrl: string,
	hint: number
): Promise<number> {
	let count = 0;
	const maxProbe = Math.max(hint + 2, 16);

	for (let i = 0; i < maxProbe; i++) {
		const url = `${baseUrl}.part${i}`;
		const response = await request.head(url);
		if (!response.ok()) break;
		count = i + 1;
	}

	return count || hint;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isLikelyBinaryMedia(buffer: Buffer, url: string): boolean {
	if (buffer.length === 0) return false;
	const head = buffer.subarray(0, 16).toString('utf8');
	if (head.startsWith('<!DOCTYPE') || head.startsWith('<html') || head.startsWith('<HTML')) {
		return false;
	}
	if (/\.png/i.test(url)) return buffer[0] === 0x89 && buffer[1] === 0x50;
	if (/\.jpe?g/i.test(url)) return buffer[0] === 0xff && buffer[1] === 0xd8;
	if (/\.gif/i.test(url)) return buffer.subarray(0, 3).toString('ascii') === 'GIF';
	if (/\.webp/i.test(url)) return buffer.subarray(0, 4).toString('ascii') === 'RIFF';
	return buffer.length > 32;
}

/**
 * Download via curl when Playwright rejects weak TLS (some external game CDNs).
 */
async function downloadViaCurl(url: string, destPath: string): Promise<Buffer> {
	await execFileAsync('curl', [
		'-fsSLk',
		'--retry',
		'3',
		'-A',
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
		'-o',
		destPath,
		url
	]);
	return fs.readFile(destPath);
}

/**
 * Download via headless browser navigation (some hosts block curl/API clients).
 */
async function downloadViaBrowser(page: Page, url: string): Promise<Buffer | null> {
	try {
		const response = await page.goto(url, { waitUntil: 'commit', timeout: 20000 });
		if (!response?.ok()) return null;
		const buffer = await response.body();
		return isLikelyBinaryMedia(buffer, url) ? buffer : null;
	} catch {
		return null;
	}
}

async function writePlaceholder(relativePath: string, destPath: string): Promise<Buffer> {
	const ext = path.extname(relativePath).toLowerCase();
	const buffer = ext === '.png' ? PLACEHOLDER_PNG : PLACEHOLDER_PNG;
	await fs.mkdir(path.dirname(destPath), { recursive: true });
	await fs.writeFile(destPath, buffer);
	return buffer;
}

/**
 * Download a single asset to the output directory.
 */
async function downloadFile(
	request: APIRequestContext,
	url: string,
	outDir: string,
	cdnBase: string,
	browserPage?: Page,
	allowPlaceholder = false
): Promise<DownloadResult> {
	const relativePath = urlToRelativePath(url, cdnBase);
	if (!relativePath) {
		throw new Error(`Could not resolve relative path for: ${url}`);
	}

	const destPath = path.join(outDir, relativePath);
	await fs.mkdir(path.dirname(destPath), { recursive: true });

	let buffer: Buffer | null = null;
	let placeholder = false;

	try {
		const response = await request.get(url);
		if (response.ok()) {
			buffer = Buffer.from(await response.body());
			if (!isLikelyBinaryMedia(buffer, url)) buffer = null;
		}
	} catch {
		// Fall through to curl / browser / placeholder.
	}

	if (!buffer && isDownloadableMediaUrl(url)) {
		try {
			console.log(`  ↻ curl fallback for ${relativePath}`);
			buffer = await downloadViaCurl(url, destPath);
			if (!isLikelyBinaryMedia(buffer, url)) buffer = null;
		} catch {
			buffer = null;
		}
	}

	if (!buffer && browserPage && isDownloadableMediaUrl(url)) {
		console.log(`  ↻ browser fallback for ${relativePath}`);
		buffer = await downloadViaBrowser(browserPage, url);
	}

	if (!buffer && allowPlaceholder && isDownloadableMediaUrl(url)) {
		console.warn(`  ⚠ placeholder for ${relativePath} (${url} blocked or unavailable)`);
		buffer = await writePlaceholder(relativePath, destPath);
		placeholder = true;
	}

	if (!buffer) {
		throw new Error(`Download failed ${url}: all methods exhausted`);
	}

	if (!placeholder) {
		await fs.writeFile(destPath, buffer);
	}

	const sha256 = createHash('sha256').update(buffer).digest('hex');
	const tag = placeholder ? ' (placeholder)' : '';
	console.log(`  ✓ ${relativePath} (${formatBytes(buffer.length)})${tag}`);

	return { url, relativePath, size: buffer.length, sha256, placeholder: placeholder || undefined };
}

/**
 * Download only the given URL list (used for external media pass).
 */
export async function downloadUrlList(
	request: APIRequestContext,
	urls: string[],
	outDir: string,
	cdnBase: string,
	browserPage?: Page
): Promise<DownloadResult[]> {
	console.log(`[download] Fetching ${urls.length} external file(s)...`);
	const results: DownloadResult[] = [];
	for (const url of urls) {
		results.push(await downloadFile(request, url, outDir, cdnBase, browserPage, true));
	}
	return results;
}

/**
 * Download assets with bounded concurrency.
 */
export async function downloadAssets(
	request: APIRequestContext,
	info: ExtractedGameInfo,
	outDir: string
): Promise<DownloadResult[]> {
	const buildBase = `${info.cdnBase}/Build`;

	info.dataParts = await detectPartCount(request, `${buildBase}/Shrek2.data.br`, info.dataParts);
	info.wasmParts = await detectPartCount(request, `${buildBase}/Shrek2.wasm.br`, info.wasmParts);

	const urls = buildAssetUrls(info);
	console.log(`[download] Fetching ${urls.length} files from embedded game source …`);

	const results: DownloadResult[] = [];
	const queue = [...urls];

	async function worker(): Promise<void> {
		while (queue.length > 0) {
			const url = queue.shift();
			if (!url) break;
			results.push(await downloadFile(request, url, outDir, info.cdnBase));
		}
	}

	const workers = Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, urls.length) }, () =>
		worker()
	);
	await Promise.all(workers);

	return results;
}
