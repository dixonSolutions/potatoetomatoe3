import http from 'node:http';
import type { Connect, Plugin } from 'vite';

/**
 * SvelteKit can claim `/api/*` before Vite `server.proxy` runs.
 * Pre-middleware proxy for puller HTTP APIs (including POST download).
 */
export function pullerApiProxyPlugin(pullerTarget: string): Plugin {
	const target = new URL(pullerTarget.replace(/\/$/, ''));
	const prefixes = ['/api/offline', '/api/unity-play', '/api/game-live'];

	function matches(url: string): boolean {
		return prefixes.some((p) => url === p || url.startsWith(`${p}/`) || url.startsWith(`${p}?`));
	}

	function mount(middlewares: Connect.Server) {
		middlewares.use((req, res, next) => {
			const url = req.url ?? '';
			if (!matches(url)) {
				next();
				return;
			}

			const headers = { ...req.headers, host: target.host };
			delete headers['connection'];

			const proxyReq = http.request(
				{
					protocol: target.protocol,
					hostname: target.hostname,
					port: target.port || (target.protocol === 'https:' ? 443 : 80),
					path: url,
					method: req.method,
					headers
				},
				(proxyRes) => {
					res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
					proxyRes.pipe(res);
				}
			);
			proxyReq.on('error', () => {
				if (!res.headersSent) {
					res.statusCode = 502;
					res.end('Puller proxy unavailable');
				}
			});
			req.pipe(proxyReq);
		});
	}

	return {
		name: 'puller-api-proxy',
		enforce: 'pre',
		configureServer(server) {
			mount(server.middlewares);
		},
		configurePreviewServer(server) {
			mount(server.middlewares);
		}
	};
}
