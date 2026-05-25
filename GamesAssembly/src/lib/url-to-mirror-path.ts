import { join, dirname } from 'node:path';

/**
 * Map absolute http(s) URL to a deterministic path under the offline mirror root
 * (same layout as scripts/lib/poki-playwright-capture.mjs).
 * Query strings are ignored so `file.js?v=1` and `file.js?v=2` map to the same path; use
 * `offline-asset-url-rewrite.ts` after capture so HTML/JS requests plain `file.js`.
 */
export function urlToMirrorPath(targetDir: string, urlStr: string): string | null {
	let u: URL;
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
