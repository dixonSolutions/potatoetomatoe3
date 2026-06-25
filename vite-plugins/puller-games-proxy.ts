import type { Plugin } from 'vite';

/** SvelteKit dev handles routes before Vite's server.proxy; proxy puller game assets in middleware. */
export function pullerGamesProxyPlugin(pullerTarget: string): Plugin {
	const target = pullerTarget.replace(/\/$/, '');

	return {
		name: 'puller-games-proxy',
		enforce: 'pre',
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				const url = req.url ?? '';
				if (!url.startsWith('/puller-games/')) {
					next();
					return;
				}

				const pullPath = url.replace(/^\/puller-games/, '/games');
				try {
					const response = await fetch(`${target}${pullPath}`, {
						headers: req.headers.host ? { host: new URL(target).host } : undefined
					});
					res.statusCode = response.status;
					response.headers.forEach((value, key) => {
						const lower = key.toLowerCase();
						if (lower === 'transfer-encoding' || lower === 'connection') return;
						res.setHeader(key, value);
					});
					const body = Buffer.from(await response.arrayBuffer());
					res.end(body);
				} catch {
					next();
				}
			});
		},
		configurePreviewServer(server) {
			server.middlewares.use(async (req, res, next) => {
				const url = req.url ?? '';
				if (!url.startsWith('/puller-games/')) {
					next();
					return;
				}

				const pullPath = url.replace(/^\/puller-games/, '/games');
				try {
					const response = await fetch(`${target}${pullPath}`);
					res.statusCode = response.status;
					response.headers.forEach((value, key) => {
						const lower = key.toLowerCase();
						if (lower === 'transfer-encoding' || lower === 'connection') return;
						res.setHeader(key, value);
					});
					const body = Buffer.from(await response.arrayBuffer());
					res.end(body);
				} catch {
					next();
				}
			});
		}
	};
}
