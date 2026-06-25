import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { CORS_ORIGIN, CATALOG_DIR, GAMES_DATA_DIR, PORT } from './config.js';
import {
  getAllGameStatuses,
  getGameStatus,
  deleteOfflineGame,
  startDownload
} from './download-manager.js';
import { getActiveJobForGame } from './jobs.js';
import { isValidGameId, loadGameIds, resolveOfflineFilePath } from './catalog.js';
import { injectGameStorageBridge } from './game-storage-bridge-script.js';
import {
	deleteGameBrowserProfile,
	readGameBrowserProfile,
	writeGameBrowserProfile
} from './browser-data.js';
import type { GameBrowserProfile } from './browser-data-profile.js';

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(payload);
}

function mimeFor(filePath: string): string {
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
    '.br': 'application/octet-stream',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
  };
  return map[ext] ?? 'application/octet-stream';
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

  const ids = await loadGameIds();
  if (!ids.includes(gameId)) {
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

  const isHtml = /\.html?$/i.test(absPath);

  res.writeHead(200, {
    'Content-Type': mimeFor(absPath),
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Cache-Control': 'public, max-age=3600'
  });

  if (isHtml) {
    const raw = await fs.readFile(absPath, 'utf-8');
    res.end(injectGameStorageBridge(raw, gameId));
    return true;
  }

  createReadStream(absPath).pipe(res);
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
        'Access-Control-Allow-Headers': 'Content-Type'
      });
      res.end();
      return;
    }

    try {
      if (pathname === '/api/offline/health' && req.method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          dataDir: GAMES_DATA_DIR,
          catalogDir: CATALOG_DIR
        });
        return;
      }

      if (pathname === '/api/offline/status' && req.method === 'GET') {
        const statuses = await getAllGameStatuses();
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
        sendJson(res, 200, await getGameStatus(gameId));
        return;
      }

      const downloadMatch = pathname.match(/^\/api\/offline\/([^/]+)\/download$/);
      if (downloadMatch && req.method === 'POST') {
        const gameId = decodeURIComponent(downloadMatch[1]);
        const result = await startDownload(gameId);
        sendJson(res, 202, result);
        return;
      }

      const progressMatch = pathname.match(/^\/api\/offline\/([^/]+)\/progress$/);
      if (progressMatch && req.method === 'GET') {
        const gameId = decodeURIComponent(progressMatch[1]);
        const job = getActiveJobForGame(gameId);
        if (!job) {
          sendJson(res, 200, { state: 'idle', progress: 0, message: 'No active job' });
          return;
        }
        sendJson(res, 200, job);
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
        const ids = await loadGameIds();
        if (!ids.includes(gameId)) {
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
        const ids = await loadGameIds();
        if (!ids.includes(gameId)) {
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
        const ids = await loadGameIds();
        if (!ids.includes(gameId)) {
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
