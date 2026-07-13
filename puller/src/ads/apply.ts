import fs from 'node:fs/promises';
import path from 'node:path';
import {
	buildGenericAdStubScript,
	buildPokiOfflineStubScript,
	buildYandexOfflineStubScript
} from './stubs.js';

/** Hosts commonly used for ad iframes / trackers — strip from offline HTML. */
const AD_IFRAME_HOST =
	/(?:doubleclick\.net|googlesyndication\.com|googleadservices\.com|adnxs\.com|adservice\.google|facebook\.com\/tr|amazon-adsystem\.com|scorecardresearch\.com)/i;

const SITE_ROOT_SCRIPT = /\bsrc=["'](?:\.\.\/)+([^"']+)["']/gi;

export function indexHtmlReferencesPokiSdk(html: string): boolean {
	return /poki-sdk|PokiSDK/i.test(html);
}

export function indexHtmlReferencesYandexSdk(html: string): boolean {
	return /YaGames|yandex\.ru\/games|yandex-sdk|ysdk/i.test(html);
}

/** Point script tags at a local offline stub beside index.html. */
export function patchPokiSdkScriptTags(html: string): string {
	return html.replace(
		/<script\b[^>]*\bsrc=["'][^"']*poki-sdk[^"']*["'][^>]*>\s*<\/script>/gi,
		'<script src="poki-sdk.js"></script>'
	);
}

export function patchYandexSdkScriptTags(html: string): string {
	return html.replace(
		/<script\b[^>]*\bsrc=["'][^"']*(?:yandex|ysdk)[^"']*["'][^>]*>\s*<\/script>/gi,
		'<script src="yandex-sdk-offline.js"></script>'
	);
}

/** Remove iframe tags that point at known ad networks. */
export function stripAdIframes(html: string): string {
	return html.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, (tag) => {
		if (AD_IFRAME_HOST.test(tag)) return '<!-- ad iframe removed for offline -->';
		return tag;
	});
}

function injectHeadScript(html: string, src: string): string {
	const tag = `<script src="${src}"></script>`;
	if (html.includes(src)) return html;
	if (html.includes('</head>')) return html.replace('</head>', `${tag}\n</head>`);
	return `${tag}\n${html}`;
}

/**
 * Rewrite ../../portal.js style tags to sit beside index.html and ensure local stubs exist.
 */
async function patchSiteRootScriptTags(outDir: string, html: string): Promise<string> {
	const needed = new Set<string>();
	let out = html;

	out = out.replace(SITE_ROOT_SCRIPT, (tag, fileName: string) => {
		if (typeof fileName !== 'string' || !fileName.trim()) return tag;
		needed.add(fileName);
		return tag.replace(/(?:\.\.\/)+[^"']+/, fileName);
	});

	for (const fileName of needed) {
		const dest = path.join(outDir, fileName);
		if (fileName === 'poki-sdk.js' || fileName === 'yandex-sdk-offline.js') continue;
		try {
			const stat = await fs.stat(dest);
			if (stat.isFile() && stat.size > 0) continue;
		} catch {
			// missing
		}
		await fs.writeFile(dest, '// offline noop\n', 'utf-8');
	}

	return out;
}

export interface ApplyAdsOptions {
	outDir: string;
	entryRel?: string;
}

/**
 * Strip ad iframes and inject offline SDK stubs into the mirrored entry HTML.
 */
export async function applyOfflineAdStripping(options: ApplyAdsOptions): Promise<void> {
	const entryRel = options.entryRel ?? 'index.html';
	const entryPath = path.join(options.outDir, entryRel);
	let html = await fs.readFile(entryPath, 'utf-8');

	html = stripAdIframes(html);
	html = await patchSiteRootScriptTags(options.outDir, html);

	if (indexHtmlReferencesPokiSdk(html)) {
		await fs.writeFile(
			path.join(options.outDir, 'poki-sdk.js'),
			buildPokiOfflineStubScript(),
			'utf-8'
		);
		html = patchPokiSdkScriptTags(html);
		html = injectHeadScript(html, 'poki-sdk.js');
	}

	if (indexHtmlReferencesYandexSdk(html)) {
		await fs.writeFile(
			path.join(options.outDir, 'yandex-sdk-offline.js'),
			buildYandexOfflineStubScript(),
			'utf-8'
		);
		html = patchYandexSdkScriptTags(html);
		html = injectHeadScript(html, 'yandex-sdk-offline.js');
	}

	// Always inject a tiny generic guard so commercialBreak no-ops if SDKs load late
	await fs.writeFile(
		path.join(options.outDir, 'pt-adfree.js'),
		buildGenericAdStubScript(),
		'utf-8'
	);
	html = injectHeadScript(html, 'pt-adfree.js');

	await fs.writeFile(entryPath, html, 'utf-8');
}
