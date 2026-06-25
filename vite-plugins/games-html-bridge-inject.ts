import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

const BRIDGE_TAG = '<script src="/game-storage-bridge.child.js"></script>';

function injectBridgeIntoHtml(html: string): string {
	if (html.includes('game-storage-bridge.child.js')) return html;
	if (html.includes('</head>')) {
		return html.replace('</head>', BRIDGE_TAG + '</head>');
	}
	if (html.includes('<body')) {
		return html.replace(/<body([^>]*)>/i, `<body$1>${BRIDGE_TAG}`);
	}
	return BRIDGE_TAG + html;
}

/** Inject game storage bridge into same-origin game HTML shells in dev/preview. */
export function gamesHtmlBridgeInjectPlugin(): Plugin {
	const gamesRoot = path.resolve('static/games');

	return {
		name: 'games-html-bridge-inject',
		enforce: 'pre',
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const url = (req.url ?? '').split('?')[0];
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
					next();
					return;
				}

				const absPath = path.join(gamesRoot, match[1], match[2], fileRel);
				try {
					const raw = readFileSync(absPath, 'utf-8');
					const html = injectBridgeIntoHtml(raw);
					res.statusCode = 200;
					res.setHeader('Content-Type', 'text/html; charset=utf-8');
					res.end(html);
				} catch {
					next();
				}
			});
		},
		configurePreviewServer(server) {
			server.middlewares.use((req, res, next) => {
				const url = (req.url ?? '').split('?')[0];
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
					next();
					return;
				}

				const absPath = path.join(gamesRoot, match[1], match[2], fileRel);
				try {
					const raw = readFileSync(absPath, 'utf-8');
					const html = injectBridgeIntoHtml(raw);
					res.statusCode = 200;
					res.setHeader('Content-Type', 'text/html; charset=utf-8');
					res.end(html);
				} catch {
					next();
				}
			});
		}
	};
}

export { injectBridgeIntoHtml };
