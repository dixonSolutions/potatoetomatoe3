import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { CORS_ORIGIN, CATALOG_DIR, GAMES_DATA_DIR, PORT } from './config.js';
import {
	getDownloadedGameStatuses,
	getGameStatusesForIds,
	getGameStatus,
	deleteOfflineGame,
	startDownload,
	cancelDownload
} from './download-manager.js';
import { getProgressJobForGame, listRecentJobs, listDownloadingGameIds } from './jobs.js';
import { liveSessionCount } from './live/session.js';
import {
	isValidGameId,
	isGameInCatalog,
	hasOfflineMirror,
	loadGameIds,
	resolveOfflineFilePath,
	resolveOfflineMirrorRoot,
	readGameMetadata
} from './catalog.js';
import { rewriteAbsoluteUrlsToMirroredExternal } from './capture/rewrite.js';
import { injectGameStorageBridge } from './game-storage-bridge-script.js';
import { isCrazyGamesShellHtml } from './unity/crazygames-unwrap.js';
import { injectUnityPatches, isUnityGameHtml } from './unity/inject-html.js';
import { fetchProxiedUnityHtml } from './unity/proxy-play.js';
import { fetchLiveAsset, startLiveGameHtml } from './live/proxy.js';
import {
	deleteGameBrowserProfile,
	readGameBrowserProfile,
	writeGameBrowserProfile
} from './browser-data.js';
import type { GameBrowserProfile } from './browser-data-profile.js';

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
	if (res.headersSent || res.writableEnded) {
		console.error('[puller] sendJson skipped — headers already sent', status, body);
		return;
	}
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		'Content-Type': 'application/json',
		'Access-Control-Allow-Origin': CORS_ORIGIN,
		'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, Access-Control-Request-Private-Network',
		'Access-Control-Allow-Private-Network': 'true'
	});
	res.end(payload);
}

function mimeFor(filePath: string): string {
	const base = path.basename(filePath).toLowerCase();
	/*
	 * Legacy Unity names framework JS as `*.wasm.framework.unityweb` (no .js).
	 * Serving it as octet-stream breaks some WebKit script/XHR paths used by
	 * Color Tunnel / similar offline mirrors — treat framework files as JS.
	 */
	if (base.includes('.framework.unityweb') || base.endsWith('.framework.js')) {
		return 'application/javascript';
	}
	const ext = path.extname(filePath).toLowerCase();
	const map: Record<string, string> = {
		'.html': 'text/html',
		'.js': 'application/javascript',
		'.css': 'text/css',
		'.json': 'application/json',
		'.png': 'image/png',
		'.jpg': 'image/jpeg',
		'.jpeg': 'image/jpeg',
		'.gif': 'image/gif',
		'.webp': 'image/webp',
		'.svg': 'image/svg+xml',
		'.wasm': 'application/wasm',
		'.unityweb': 'application/octet-stream',
		'.data': 'application/octet-stream',
		'.br': 'application/octet-stream',
		'.mp3': 'audio/mpeg',
		'.ogg': 'audio/ogg',
		'.woff': 'font/woff',
		'.woff2': 'font/woff2'
	};
	return map[ext] ?? 'application/octet-stream';
}

async function listFiles(root: string, current = root): Promise<string[]> {
	let entries;
	try {
		entries = await fs.readdir(current, { withFileTypes: true });
	} catch {
		return [];
	}
	const files: string[] = [];
	for (const entry of entries) {
		const absolute = path.join(current, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await listFiles(root, absolute)));
		} else if (entry.isFile()) {
			files.push(path.relative(root, absolute).split(path.sep).join('/'));
		}
	}
	return files;
}

async function serveStaticGames(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	urlPath: string
): Promise<boolean> {
	const prefix = '/games/';
	if (!urlPath.startsWith(prefix)) return false;

	const rel = decodeURIComponent(urlPath.slice(prefix.length));
	const parts = rel.split('/').filter(Boolean);
	if (parts.length === 0) {
		sendJson(res, 404, { error: 'Not found' });
		return true;
	}

	const gameId = parts[0];
	if (!isValidGameId(gameId)) {
		sendJson(res, 400, { error: 'Invalid game id' });
		return true;
	}

	if (!(await isGameInCatalog(gameId))) {
		sendJson(res, 404, { error: 'Game not in catalog' });
		return true;
	}

	const fileRel = parts.slice(1).join('/');
	if (!fileRel.startsWith('offline/')) {
		sendJson(res, 403, { error: 'Only offline files are served' });
		return true;
	}

	const offlineRel = fileRel.slice('offline/'.length);
	const absPath = resolveOfflineFilePath(gameId, offlineRel);
	if (!absPath) {
		sendJson(res, 403, { error: 'Forbidden' });
		return true;
	}

	if (!existsSync(absPath)) {
		sendJson(res, 404, { error: 'Not found' });
		return true;
	}

	let st;
	try {
		st = await fs.stat(absPath);
	} catch {
		sendJson(res, 404, { error: 'Not found' });
		return true;
	}
	if (!st.isFile()) {
		sendJson(res, 404, { error: 'Not found' });
		return true;
	}

	const isHtml = /\.html?$/i.test(absPath);

	if (isHtml) {
		/*
		 * Build the body before writeHead. A throw after headers (e.g. missing inject
		 * helpers in a bad bundle) used to hit the outer sendJson catch and kill the
		 * whole Node process with ERR_HTTP_HEADERS_SENT — breaking Offline play.
		 */
		let raw = await fs.readFile(absPath, 'utf-8');
		/*
		 * Host-agnostic: any absolute http(s) URL that was vaulted under
		 * `_external/<host>/…` during capture is rewritten to the local path.
		 * Do not unwrap CrazyGames shells into a synthetic Unity host.
		 */
		const mirrorRoot = await resolveOfflineMirrorRoot(gameId);
		if (mirrorRoot) {
			raw = rewriteAbsoluteUrlsToMirroredExternal(raw, mirrorRoot);
		}
		if (!isCrazyGamesShellHtml(raw) && isUnityGameHtml(raw)) {
			raw = injectUnityPatches(raw);
		}
		const body = injectGameStorageBridge(raw, gameId);
		res.writeHead(200, {
			'Content-Type': 'text/html; charset=utf-8',
			'Access-Control-Allow-Origin': CORS_ORIGIN,
			'Access-Control-Allow-Private-Network': 'true',
			'Cache-Control': 'public, max-age=3600'
		});
		res.end(body);
		return true;
	}

	res.writeHead(200, {
		'Content-Type': mimeFor(absPath),
		'Access-Control-Allow-Origin': CORS_ORIGIN,
		'Access-Control-Allow-Private-Network': 'true',
		'Cache-Control': 'public, max-age=3600'
	});

	const stream = createReadStream(absPath);
	stream.on('error', (err) => {
		console.error('[puller] read error', absPath, err.message);
		if (!res.headersSent) {
			sendJson(res, 500, { error: 'Read failed' });
		} else {
			res.destroy(err);
		}
	});
	stream.pipe(res);
	return true;
}

export function createServer(): http.Server {
	return http.createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
		const pathname = url.pathname;

		if (req.method === 'OPTIONS') {
			res.writeHead(204, {
				'Access-Control-Allow-Origin': CORS_ORIGIN,
				'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type, Access-Control-Request-Private-Network',
				'Access-Control-Allow-Private-Network': 'true'
			});
			res.end();
			return;
		}

		try {
			if (pathname === '/api/offline/health' && req.method === 'GET') {
				const catalogIds = await loadGameIds();
				sendJson(res, 200, {
					ok: true,
					dataDir: GAMES_DATA_DIR,
					catalogDir: CATALOG_DIR,
					catalogGameCount: catalogIds.length,
					port: PORT,
					activeDownloads: listDownloadingGameIds().size,
					liveSessions: liveSessionCount()
				});
				return;
			}

			if (pathname === '/api/offline/jobs' && req.method === 'GET') {
				const jobs = listRecentJobs();
				sendJson(res, 200, {
					ok: true,
					active: [...listDownloadingGameIds()],
					jobs,
					liveSessions: liveSessionCount()
				});
				return;
			}

			if (pathname === '/api/offline/status' && req.method === 'GET') {
				const idsParam = url.searchParams.get('ids');
				if (idsParam?.trim()) {
					const ids = idsParam
						.split(',')
						.map((id) => id.trim())
						.filter(Boolean);
					const statuses = await getGameStatusesForIds(ids);
					sendJson(res, 200, { games: statuses });
					return;
				}
				const statuses = await getDownloadedGameStatuses();
				sendJson(res, 200, { games: statuses });
				return;
			}

			const statusMatch = pathname.match(/^\/api\/offline\/status\/([^/]+)$/);
			if (statusMatch && req.method === 'GET') {
				const gameId = decodeURIComponent(statusMatch[1]);
				if (!isValidGameId(gameId)) {
					sendJson(res, 400, { error: 'Invalid game id' });
					return;
				}
				sendJson(res, 200, await getGameStatus(gameId, { repairThumbnail: true }));
				return;
			}

			const downloadMatch = pathname.match(/^\/api\/offline\/([^/]+)\/download$/);
			if (downloadMatch && req.method === 'POST') {
				const gameId = decodeURIComponent(downloadMatch[1]);
				const result = await startDownload(gameId);
				sendJson(res, 202, result);
				return;
			}

			const cancelMatch = pathname.match(/^\/api\/offline\/([^/]+)\/cancel$/);
			if (cancelMatch && req.method === 'POST') {
				const gameId = decodeURIComponent(cancelMatch[1]);
				const chunks: Buffer[] = [];
				for await (const chunk of req) {
					chunks.push(chunk as Buffer);
				}
				let discardCache = true;
				if (chunks.length > 0) {
					try {
						const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as {
							discardCache?: boolean;
						};
						discardCache = body.discardCache !== false;
					} catch {
						// default discard
					}
				}
				const result = await cancelDownload(gameId, discardCache);
				sendJson(res, 200, result);
				return;
			}

			const progressMatch = pathname.match(/^\/api\/offline\/([^/]+)\/progress$/);
			if (progressMatch && req.method === 'GET') {
				const gameId = decodeURIComponent(progressMatch[1]);
				const job = getProgressJobForGame(gameId);
				if (!job) {
					sendJson(res, 200, { state: 'idle', progress: 0, message: 'No active job' });
					return;
				}
				sendJson(res, 200, job);
				return;
			}

			/*
			 * Export a completed puller mirror to a web/PWA client. The puller still
			 * owns capture and rewriting; the browser only stores returned bytes.
			 */
			const exportMatch = pathname.match(/^\/api\/offline\/([^/]+)\/export$/);
			if (exportMatch && req.method === 'GET') {
				const gameId = decodeURIComponent(exportMatch[1]);
				if (!isValidGameId(gameId)) {
					sendJson(res, 400, { error: 'Invalid game id' });
					return;
				}
				if (!(await hasOfflineMirror(gameId))) {
					sendJson(res, 409, { error: 'Offline mirror is not complete' });
					return;
				}
				const offlineRoot = await resolveOfflineMirrorRoot(gameId);
				if (!offlineRoot) {
					sendJson(res, 404, { error: 'Offline mirror not found' });
					return;
				}
				const files = await listFiles(offlineRoot);
				sendJson(res, 200, {
					gameId,
					files: await Promise.all(
						files.map(async (relativePath) => {
							const absolute = path.join(offlineRoot, relativePath);
							const stat = await fs.stat(absolute);
							return {
								path: relativePath,
								size: stat.size,
								mimeType: mimeFor(absolute)
							};
						})
					)
				});
				return;
			}

			const exportFileMatch = pathname.match(/^\/api\/offline\/([^/]+)\/export\/file$/);
			if (exportFileMatch && req.method === 'GET') {
				const gameId = decodeURIComponent(exportFileMatch[1]);
				const relativePath = url.searchParams.get('path') ?? '';
				if (!isValidGameId(gameId) || !relativePath || relativePath.includes('..')) {
					sendJson(res, 400, { error: 'Invalid export path' });
					return;
				}
				const offlineRoot = await resolveOfflineMirrorRoot(gameId);
				if (!offlineRoot) {
					sendJson(res, 404, { error: 'Offline mirror not found' });
					return;
				}
				const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
				const absolute = path.join(offlineRoot, normalized);
				const resolvedRoot = path.resolve(offlineRoot);
				const resolvedAbs = path.resolve(absolute);
				if (!resolvedAbs.startsWith(resolvedRoot + path.sep) && resolvedAbs !== resolvedRoot) {
					sendJson(res, 400, { error: 'Invalid export path' });
					return;
				}
				if (!existsSync(absolute)) {
					sendJson(res, 404, { error: 'Export file not found' });
					return;
				}
				res.writeHead(200, {
					'Content-Type': mimeFor(absolute),
					'Access-Control-Allow-Origin': CORS_ORIGIN,
					'Access-Control-Allow-Private-Network': 'true',
					'Cache-Control': 'no-store'
				});
				createReadStream(absolute).pipe(res);
				return;
			}

			const unityPlayMatch = pathname.match(/^\/api\/unity-play\/([^/]+)$/);
			if (unityPlayMatch && req.method === 'GET') {
				const gameId = decodeURIComponent(unityPlayMatch[1]);
				if (!isValidGameId(gameId)) {
					sendJson(res, 400, { error: 'Invalid game id' });
					return;
				}
				if (!(await isGameInCatalog(gameId))) {
					sendJson(res, 404, { error: 'Game not in catalog' });
					return;
				}
				console.log(`[puller] unity-play game=${gameId}`);
				const unityResult = await fetchProxiedUnityHtml(gameId);
				if (unityResult?.kind === 'live-relay') {
					/*
					 * OpenFL/Lime (G-Switch 3) and other non-Unity shells: unity-play
					 * absolutize + Unity inject blacks the canvas. Serve game-live HTML.
					 */
					console.log(
						`[puller] unity-play → game-live relay game=${gameId} reason=${unityResult.reason}`
					);
					const meta = await readGameMetadata(gameId);
					const live = await startLiveGameHtml(
						gameId,
						meta?.engine,
						(sessionId) => `/api/game-live/${encodeURIComponent(gameId)}/${sessionId}`
					);
					if (!live) {
						sendJson(res, 502, { error: 'Could not fetch playable build' });
						return;
					}
					res.writeHead(200, {
						'Content-Type': live.contentType || 'text/html; charset=utf-8',
						'Access-Control-Allow-Origin': CORS_ORIGIN,
						'Access-Control-Allow-Private-Network': 'true',
						'Cache-Control': 'no-store'
					});
					res.end(live.html);
					return;
				}
				if (!unityResult || unityResult.kind !== 'unity') {
					console.warn(`[puller] unity-play failed game=${gameId}`);
					sendJson(res, 502, { error: 'Could not fetch Unity build' });
					return;
				}
				res.writeHead(200, {
					'Content-Type': 'text/html; charset=utf-8',
					'Access-Control-Allow-Origin': CORS_ORIGIN,
					'Access-Control-Allow-Private-Network': 'true',
					'Cache-Control': 'public, max-age=300'
				});
				res.end(injectGameStorageBridge(unityResult.html, gameId));
				return;
			}

			/*
			 * Live play relay (additional to offline scrape):
			 * GET /api/game-live/:gameId — entry HTML with touch bridge
			 * GET /api/game-live/:gameId/:sessionId/... — proxied assets
			 */
			const liveEntryMatch = pathname.match(/^\/api\/game-live\/([^/]+)\/?$/);
			if (liveEntryMatch && req.method === 'GET') {
				const gameId = decodeURIComponent(liveEntryMatch[1]);
				if (!isValidGameId(gameId)) {
					sendJson(res, 400, { error: 'Invalid game id' });
					return;
				}
				if (!(await isGameInCatalog(gameId))) {
					sendJson(res, 404, { error: 'Game not in catalog' });
					return;
				}
				console.log(`[puller] game-live game=${gameId}`);
				const meta = await readGameMetadata(gameId);
				const result = await startLiveGameHtml(
					gameId,
					meta?.engine,
					(sessionId) => `/api/game-live/${encodeURIComponent(gameId)}/${sessionId}`
				);
				if (!result) {
					console.warn(`[puller] game-live failed game=${gameId}`);
					sendJson(res, 502, { error: 'Could not fetch live game' });
					return;
				}
				console.log(
					`[puller] game-live session=${result.session.id} game=${gameId}`
				);
				res.writeHead(200, {
					'Content-Type': result.contentType.includes('text/html')
						? 'text/html; charset=utf-8'
						: result.contentType,
					'Access-Control-Allow-Origin': CORS_ORIGIN,
					'Access-Control-Allow-Private-Network': 'true',
					'Cache-Control': 'private, max-age=60',
					'X-PT-Live-Session': result.session.id
				});
				res.end(result.html);
				return;
			}

			const liveAssetMatch = pathname.match(/^\/api\/game-live\/([^/]+)\/([^/]+)\/(.*)$/);
			if (liveAssetMatch && req.method === 'GET') {
				const gameId = decodeURIComponent(liveAssetMatch[1]);
				const sessionId = decodeURIComponent(liveAssetMatch[2]);
				let assetPath = decodeURIComponent(liveAssetMatch[3] || '');
				if (!isValidGameId(gameId)) {
					sendJson(res, 400, { error: 'Invalid game id' });
					return;
				}
				if (!(await isGameInCatalog(gameId))) {
					sendJson(res, 404, { error: 'Game not in catalog' });
					return;
				}
				const absoluteOverride = assetPath === '_ext' ? url.searchParams.get('u') : null;
				if (!absoluteOverride && url.search) {
					assetPath += url.search;
				}
				try {
					const asset = await fetchLiveAsset(
						gameId,
						sessionId,
						absoluteOverride ? '' : assetPath,
						absoluteOverride
					);
					if (!asset) {
						sendJson(res, 404, { error: 'Live session expired or asset missing' });
						return;
					}
					res.writeHead(asset.status, {
						'Content-Type': asset.contentType,
						'Access-Control-Allow-Origin': CORS_ORIGIN,
						'Access-Control-Allow-Private-Network': 'true',
						'Cache-Control': asset.cacheControl || 'private, max-age=300'
					});
					res.end(asset.body);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					console.warn(
						`[puller] live asset failed game=${gameId} session=${sessionId} path=${assetPath}: ${message}`
					);
					sendJson(res, 502, { error: message });
				}
				return;
			}

			const deleteMatch = pathname.match(/^\/api\/offline\/([^/]+)$/);
			if (deleteMatch && req.method === 'DELETE') {
				const gameId = decodeURIComponent(deleteMatch[1]);
				await deleteOfflineGame(gameId);
				sendJson(res, 200, { deleted: true });
				return;
			}

			const browserDataGetMatch = pathname.match(/^\/api\/browser-data\/([^/]+)$/);
			if (browserDataGetMatch && req.method === 'GET') {
				const gameId = decodeURIComponent(browserDataGetMatch[1]);
				if (!isValidGameId(gameId)) {
					sendJson(res, 400, { error: 'Invalid game id' });
					return;
				}
				if (!(await isGameInCatalog(gameId))) {
					sendJson(res, 404, { error: 'Game not in catalog' });
					return;
				}
				const profile = await readGameBrowserProfile(gameId);
				if (!profile) {
					sendJson(res, 404, { error: 'No browser data' });
					return;
				}
				sendJson(res, 200, profile);
				return;
			}

			const browserDataPutMatch = pathname.match(/^\/api\/browser-data\/([^/]+)$/);
			if (browserDataPutMatch && req.method === 'PUT') {
				const gameId = decodeURIComponent(browserDataPutMatch[1]);
				if (!isValidGameId(gameId)) {
					sendJson(res, 400, { error: 'Invalid game id' });
					return;
				}
				if (!(await isGameInCatalog(gameId))) {
					sendJson(res, 404, { error: 'Game not in catalog' });
					return;
				}
				const chunks: Buffer[] = [];
				for await (const chunk of req) {
					chunks.push(chunk as Buffer);
				}
				const raw = Buffer.concat(chunks).toString('utf-8');
				const parsed = JSON.parse(raw) as unknown;
				await writeGameBrowserProfile(gameId, parsed as GameBrowserProfile);
				sendJson(res, 200, { saved: true });
				return;
			}

			const browserDataDeleteMatch = pathname.match(/^\/api\/browser-data\/([^/]+)$/);
			if (browserDataDeleteMatch && req.method === 'DELETE') {
				const gameId = decodeURIComponent(browserDataDeleteMatch[1]);
				if (!isValidGameId(gameId)) {
					sendJson(res, 400, { error: 'Invalid game id' });
					return;
				}
				if (!(await isGameInCatalog(gameId))) {
					sendJson(res, 404, { error: 'Game not in catalog' });
					return;
				}
				await deleteGameBrowserProfile(gameId);
				sendJson(res, 200, { deleted: true });
				return;
			}

			if (await serveStaticGames(req, res, pathname)) {
				return;
			}

			sendJson(res, 404, { error: 'Not found' });
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			sendJson(res, 500, { error: message });
		}
	});
}

export function startServer(): http.Server {
	const server = createServer();
	server.listen(PORT, '127.0.0.1', () => {
		console.log(`[puller] listening on http://127.0.0.1:${PORT}`);
		console.log(`[puller] games data: ${GAMES_DATA_DIR}`);
	});
	return server;
}
