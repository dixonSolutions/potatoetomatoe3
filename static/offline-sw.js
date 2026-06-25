/**
 * Service worker for browser-hosted offline games (GitHub Pages).
 * Serves files from IndexedDB at /browser-offline/{gameId}/…
 * Injects storage bridge into game HTML at /games/{id}/online|offline/…
 */
const DB_NAME = 'potatotomato-offline-v1';
const DB_VERSION = 1;
const FILES_STORE = 'files';

function fileKey(gameId, filePath) {
	return gameId + '::' + filePath;
}

function openDb() {
	return new Promise(function (resolve, reject) {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onerror = function () {
			reject(req.error || new Error('IndexedDB open failed'));
		};
		req.onsuccess = function () {
			resolve(req.result);
		};
		req.onupgradeneeded = function (event) {
			const db = event.target.result;
			if (!db.objectStoreNames.contains(FILES_STORE)) {
				db.createObjectStore(FILES_STORE);
			}
			if (!db.objectStoreNames.contains('games')) {
				db.createObjectStore('games');
			}
		};
	});
}

function getFile(gameId, filePath) {
	return openDb().then(function (db) {
		return new Promise(function (resolve, reject) {
			const tx = db.transaction(FILES_STORE, 'readonly');
			tx.onerror = function () {
				reject(tx.error || new Error('IndexedDB read failed'));
			};
			const req = tx.objectStore(FILES_STORE).get(fileKey(gameId, filePath));
			req.onsuccess = function () {
				resolve(req.result || null);
			};
			req.onerror = function () {
				reject(req.error || new Error('IndexedDB read failed'));
			};
		});
	});
}

function guessMime(path) {
	const lower = path.toLowerCase();
	if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html; charset=utf-8';
	if (lower.endsWith('.js')) return 'application/javascript; charset=utf-8';
	if (lower.endsWith('.css')) return 'text/css; charset=utf-8';
	if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
	if (lower.endsWith('.wasm')) return 'application/wasm';
	if (lower.endsWith('.svg')) return 'image/svg+xml';
	if (lower.endsWith('.png')) return 'image/png';
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
	if (lower.endsWith('.webp')) return 'image/webp';
	if (lower.endsWith('.gif')) return 'image/gif';
	if (lower.endsWith('.mp3')) return 'audio/mpeg';
	if (lower.endsWith('.ogg')) return 'audio/ogg';
	if (lower.endsWith('.wav')) return 'audio/wav';
	return 'application/octet-stream';
}

function injectBridge(html, bridgeSrc) {
	if (html.indexOf('game-storage-bridge.child.js') !== -1) return html;
	var tag = '<script src="' + bridgeSrc + '"></script>';
	if (html.indexOf('</head>') !== -1) {
		return html.replace('</head>', tag + '</head>');
	}
	return tag + html;
}

function appBaseFromPath(pathname) {
	var offlineMatch = pathname.match(/^(.*)\/browser-offline\/[^/]+/);
	if (offlineMatch) return offlineMatch[1] || '';
	var gamesMatch = pathname.match(/^(.*)\/games\/[^/]+\/(?:online|offline)/);
	if (gamesMatch) return gamesMatch[1] || '';
	return '';
}

self.addEventListener('install', function (event) {
	self.skipWaiting();
});

self.addEventListener('activate', function (event) {
	event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (event) {
	const url = new URL(event.request.url);
	const pathname = url.pathname;

	const offlineMatch = pathname.match(/\/browser-offline\/([^/]+)\/(.*)$/);
	if (offlineMatch) {
		const gameId = decodeURIComponent(offlineMatch[1]);
		let filePath = decodeURIComponent(offlineMatch[2]);
		if (!filePath || filePath.endsWith('/')) {
			filePath = (filePath || '') + 'online/index.html';
		}
		if (!filePath.startsWith('online/')) {
			filePath = 'online/' + filePath.replace(/^\//, '');
		}

		event.respondWith(
			getFile(gameId, filePath).then(function (record) {
				if (!record || !record.data) {
					return new Response('Offline file not found', { status: 404 });
				}
				const mime = record.mimeType || guessMime(filePath);
				var body = record.data;
				if (mime.indexOf('text/html') === 0) {
					var html = new TextDecoder('utf-8').decode(record.data);
					var appBase = appBaseFromPath(pathname);
					var bridgeSrc = url.origin + appBase + '/game-storage-bridge.child.js';
					html = injectBridge(html, bridgeSrc);
					body = new TextEncoder().encode(html);
				}
				return new Response(body, {
					headers: {
						'Content-Type': mime,
						'Cache-Control': 'private, max-age=31536000'
					}
				});
			})
		);
		return;
	}

	const gamesMatch = pathname.match(/\/games\/([^/]+)\/(online|offline)\/(.*)$/);
	if (gamesMatch && event.request.method === 'GET') {
		let fileRel = decodeURIComponent(gamesMatch[3]);
		if (!fileRel || fileRel.endsWith('/')) {
			fileRel = fileRel + 'index.html';
		}
		if (!/\.html?$/i.test(fileRel)) {
			return;
		}

		event.respondWith(
			fetch(event.request).then(function (response) {
				const mime = response.headers.get('Content-Type') || '';
				if (!response.ok || mime.indexOf('text/html') === -1) {
					return response;
				}
				return response.text().then(function (html) {
					var appBase = appBaseFromPath(pathname);
					var bridgeSrc = url.origin + appBase + '/game-storage-bridge.child.js';
					html = injectBridge(html, bridgeSrc);
					return new Response(html, {
						status: response.status,
						statusText: response.statusText,
						headers: response.headers
					});
				});
			})
		);
	}
});
