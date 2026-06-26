import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAssetRedirectScript } from '../unity-embed/asset-redirect.js';

const INJECT_PATH = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../static/unity/inject.js'
);

let cachedInjectSource: string | null = null;

export function loadUnityInjectSource(): string {
	if (cachedInjectSource) return cachedInjectSource;
	cachedInjectSource = readFileSync(INJECT_PATH, 'utf-8');
	return cachedInjectSource;
}

export function buildUnityInjectScriptTag(): string {
	return `<script>${loadUnityInjectSource()}</script>`;
}

/** Portal bloat — strip before Unity loader runs. */
const BLOAT_SCRIPT =
	/(?:poki-sdk|master-loader|y8-afp|y8\.sdk|id\.net|idnet|gameapi|adsbygoogle|googlesyndication)/i;

const BLOAT_LINK = /(?:poki|y8|id\.net|doubleclick)/i;

/**
 * Strip portal SDK scripts, play-gate overlays, and duplicate loaders from mirrored HTML.
 */
export function stripUnityPortalBloat(html: string): string {
	let out = html;

	// Remove script tags that load portal SDKs / ad wrappers
	out = out.replace(/<script\b[^>]*\bsrc=["'][^"']*["'][^>]*>\s*<\/script>/gi, (tag) =>
		BLOAT_SCRIPT.test(tag) ? '' : tag
	);
	out = out.replace(/<script\b[^>]*>\s*[\s\S]*?<\/script>/gi, (tag) => {
		if (BLOAT_SCRIPT.test(tag) && !/createUnityInstance|UnityLoader/.test(tag)) return '';
		return tag;
	});

	out = out.replace(/<link\b[^>]*>/gi, (tag) => (BLOAT_LINK.test(tag) ? '' : tag));

	// Remove common play-cover / loading gate blocks
	out = out.replace(/<div\b[^>]*\bid=["']play-cover["'][^>]*>[\s\S]*?<\/div>/gi, '');
	out = out.replace(/<div\b[^>]*\bid=["']loading-cover["'][^>]*>[\s\S]*?<\/div>/gi, '');

	return out;
}

/**
 * Inject Unity patches + optional asset redirect map into HTML (before </head>).
 */
export function injectUnityPatches(
	html: string,
	assetRoutes: Record<string, string> = {}
): string {
	let out = stripUnityPortalBloat(html);
	const inject = buildUnityInjectScriptTag();
	const redirect =
		Object.keys(assetRoutes).length > 0 ? buildAssetRedirectScript(assetRoutes) : '';

	const bundle = `${inject}\n${redirect}`;

	if (out.includes('__ptUnityInjectInstalled')) return out;

	if (out.includes('</head>')) {
		return out.replace('</head>', `${bundle}\n</head>`);
	}
	if (out.includes('<body')) {
		return out.replace(/<body([^>]*)>/i, `<body$1>${bundle}`);
	}
	return bundle + out;
}

export function isUnityGameHtml(html: string): boolean {
	return /UnityLoader|createUnityInstance|master-loader\.js|unityWebglLoaderUrl|Build\/.*\.json/i.test(
		html
	);
}
