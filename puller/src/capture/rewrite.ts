import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Map a remote asset URL to a path under the offline output directory.
 * Same-origin (relative to baseUrl) keeps the mirror layout; cross-origin → `_external/<host>/…`.
 */
export function localPathForUrl(baseUrl: string, assetUrl: string, outDir: string): string {
	const base = new URL(baseUrl);
	const abs = new URL(assetUrl, base);
	const absPathParts = abs.pathname.split('/').filter(Boolean);

	if (abs.origin !== base.origin) {
		return path.join(outDir, '_external', abs.hostname, ...absPathParts);
	}

	const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
	if (!abs.pathname.startsWith(basePath)) {
		return path.join(outDir, ...absPathParts);
	}

	const baseParts = base.pathname.split('/').filter(Boolean);
	const relParts = absPathParts.slice(baseParts.length);
	if (relParts.length === 0) return path.join(outDir, 'index.html');
	return path.join(outDir, ...relParts);
}

/** Relative path from outDir for use in offline-manifest / HTML rewrites. */
export function relativePathForUrl(baseUrl: string, assetUrl: string, outDir: string): string {
	const full = localPathForUrl(baseUrl, assetUrl, outDir);
	return path.relative(outDir, full).split(path.sep).join('/');
}

/** Skip blob/data/about and non-http(s) schemes. */
export function isCapturableUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
}

/**
 * Absolute http(s) URL → `_external/<host>/<path>` when that file was vaulted
 * during capture. Host-agnostic (any CDN), only rewrites when the mirror file exists.
 */
export function rewriteAbsoluteUrlsToMirroredExternal(
	html: string,
	mirrorRoot: string
): string {
	return html.replace(/https?:\/\/[^\s"'<>\\]+/gi, (absolute) => {
		let parsed: URL;
		try {
			parsed = new URL(absolute);
		} catch {
			return absolute;
		}
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return absolute;
		const pathParts = parsed.pathname.split('/').filter(Boolean);
		const local = path.join(mirrorRoot, '_external', parsed.hostname, ...pathParts);
		if (!existsSync(local)) return absolute;
		const rel = ['_external', parsed.hostname, ...pathParts].join('/');
		return `${rel}${parsed.search}${parsed.hash}`;
	});
}
