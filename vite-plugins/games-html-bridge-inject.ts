import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

const BRIDGE_TAG = '<script src="/game-storage-bridge.child.js"></script>';
const UNITY_INJECT_TAG = '<script src="/unity/inject.js"></script>';

/** Same junk patterns as puller stripUnityPortalBloat — keep Vite + puller in sync. */
const BLOAT_SCRIPT =
	/(?:poki-sdk|master-loader|y8-afp|y8\.sdk|id\.net|idnet|gameapi|adsbygoogle|googlesyndication|cloak\.js|main\.min\.js|cdn-cgi|cloudflare)/i;

const ASSET_EXT_RE =
	/\.(?:js|mjs|cjs|wasm|unityweb|data|css|json|mem|map|png|jpe?g|gif|webp|svg|ico|woff2?|mp3|ogg|br)(?:\?|$)/i;

function isUnityShellHtml(html: string): boolean {
	return /UnityLoader|createUnityInstance|master-loader\.js|unityWebglLoaderUrl|Build\/.*\.json/i.test(
		html
	);
}

function stripPortalBloat(html: string): string {
	let out = html;
	out = out.replace(/<script\b[^>]*\bsrc=["'][^"']*["'][^>]*>\s*<\/script>/gi, (tag) =>
		BLOAT_SCRIPT.test(tag) ? '' : tag
	);
	out = out.replace(/<script\b[^>]*>\s*[\s\S]*?<\/script>/gi, (tag) => {
		if (BLOAT_SCRIPT.test(tag) && !/createUnityInstance|UnityLoader/.test(tag)) return '';
		return tag;
	});
	return out;
}

function injectBridgeIntoHtml(html: string): string {
	if (html.includes('game-storage-bridge.child.js')) return html;
	if (html.includes('<head')) {
		return html.replace(/<head([^>]*)>/i, `<head$1>${BRIDGE_TAG}`);
	}
	if (html.includes('<body')) {
		return html.replace(/<body([^>]*)>/i, `<body$1>${BRIDGE_TAG}`);
	}
	return BRIDGE_TAG + html;
}

function injectUnityIntoHtml(html: string): string {
	let out = stripPortalBloat(html);
	if (!isUnityShellHtml(out)) return out;
	if (out.includes('/unity/inject.js') || out.includes('__ptUnityInjectInstalled')) return out;
	if (out.includes('<head')) {
		return out.replace(/<head([^>]*)>/i, `<head$1>${UNITY_INJECT_TAG}`);
	}
	if (out.includes('<body')) {
		return out.replace(/<body([^>]*)>/i, `<body$1>${UNITY_INJECT_TAG}`);
	}
	return UNITY_INJECT_TAG + out;
}

function resolveStaticAsset(urlPath: string, gamesRoot: string, staticRoot: string): string | null {
	const clean = decodeURIComponent(urlPath.split('?')[0]);
	if (clean.includes('\0') || clean.includes('..')) return null;

	const gamesMatch = clean.match(/^\/games\/([^/]+)\/(online|offline)\/(.+)$/);
	if (gamesMatch) {
		return path.join(gamesRoot, gamesMatch[1], gamesMatch[2], gamesMatch[3]);
	}

	/* Root /games/cloak.js and similar portal leftovers */
	if (clean.startsWith('/games/')) {
		return path.join(gamesRoot, clean.slice('/games/'.length));
	}

	if (clean.startsWith('/')) {
		return path.join(staticRoot, clean.slice(1));
	}
	return null;
}

/** True only for a regular file — directories named like `pixi.js` must not be streamed. */
function isRegularFile(absPath: string): boolean {
	try {
		return statSync(absPath).isFile();
	} catch {
		return false;
	}
}

function sendPlain404(
	res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b?: string) => void },
	url: string
) {
	res.statusCode = 404;
	res.setHeader('Content-Type', 'text/plain; charset=utf-8');
	res.end(`Asset not found: ${url}`);
}

function attachGamesMiddleware(
	server: { middlewares: { use: (fn: any) => any } },
	gamesRoot: string,
	staticRoot: string
) {
	server.middlewares.use(
		(
			req: { url?: string },
			res: {
				statusCode: number;
				setHeader: (k: string, v: string) => void;
				end: (b?: string) => void;
			},
			next: () => void
		) => {
			const url = (req.url ?? '').split('?')[0];

			/*
			 * Never let SvelteKit SPA fallback return index.html for missing binary/script assets.
			 * Also block directories that look like packages (e.g. node_modules/pixi.js) — sirv
			 * would otherwise createReadStream(dir) and crash the process with EISDIR.
			 */
			if (ASSET_EXT_RE.test(url)) {
				const abs = resolveStaticAsset(url, gamesRoot, staticRoot);
				if (!abs || !isRegularFile(abs)) {
					sendPlain404(res, url);
					return;
				}
				next();
				return;
			}

			const match = url.match(/^\/games\/([^/]+)\/(online|offline)\/(.*)$/);
			if (!match) {
				next();
				return;
			}

			let fileRel = match[3];
			if (!fileRel || fileRel.endsWith('/')) {
				fileRel = fileRel + 'index.html';
			}
			if (!/\.html?$/i.test(fileRel)) {
				/* Non-HTML under games — if it is a directory or missing, 404 instead of EISDIR. */
				const absPath = path.join(gamesRoot, match[1], match[2], fileRel);
				if (!isRegularFile(absPath)) {
					sendPlain404(res, url);
					return;
				}
				next();
				return;
			}

			const absPath = path.join(gamesRoot, match[1], match[2], fileRel);
			if (!isRegularFile(absPath)) {
				sendPlain404(res, url);
				return;
			}
			try {
				const raw = readFileSync(absPath, 'utf-8');
				let html = injectUnityIntoHtml(raw);
				html = injectBridgeIntoHtml(html);
				res.statusCode = 200;
				res.setHeader('Content-Type', 'text/html; charset=utf-8');
				res.end(html);
			} catch {
				sendPlain404(res, url);
			}
		}
	);
}

/** Inject game storage bridge into same-origin game HTML shells in dev/preview. */
export function gamesHtmlBridgeInjectPlugin(): Plugin {
	const gamesRoot = path.resolve('static/games');
	const staticRoot = path.resolve('static');

	return {
		name: 'games-html-bridge-inject',
		enforce: 'pre',
		configureServer(server) {
			attachGamesMiddleware(server, gamesRoot, staticRoot);
		},
		configurePreviewServer(server) {
			attachGamesMiddleware(server, gamesRoot, staticRoot);
		}
	};
}

export { injectBridgeIntoHtml };
