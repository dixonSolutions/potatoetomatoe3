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
