/**
 * Service worker for browser-hosted offline games (GitHub Pages).
 * Serves files from IndexedDB at /browser-offline/{gameId}/…
 * Injects storage bridge into game HTML at /games/{id}/online|offline/…
 * Relays /api/unity-play/{id} and /api/game-live/* to a locally running puller
 * (avoids HTTPS→HTTP iframe mixed content). Offline scrape remains the puller's
 * primary job; live relay is an additional capability when puller is running.
 */
const DB_NAME = 'potatotomato-offline-v1';
const DB_VERSION = 1;
const FILES_STORE = 'files';
const DEFAULT_PULLER = 'http://127.0.0.1:18787';
const DEFAULT_PULLER_UNITY = DEFAULT_PULLER + '/api/unity-play/';
const DEFAULT_PULLER_LIVE = DEFAULT_PULLER + '/api/game-live/';

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
	if (html.indexOf('<head') !== -1) {
		return html.replace(/<head([^>]*)>/i, '<head$1>' + tag);
	}
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
	var unityMatch = pathname.match(/^(.*)\/api\/unity-play\//);
	if (unityMatch) return unityMatch[1] || '';
	var liveMatch = pathname.match(/^(.*)\/api\/game-live\//);
	if (liveMatch) return liveMatch[1] || '';
	return '';
}

function pullerRelayErrorHtml(kind, gameId, reason) {
	var safeId = String(gameId || '').replace(/[<>&"]/g, '');
	var safeReason = String(reason || 'Puller unreachable').replace(/[<>&"]/g, '');
	var title = kind === 'live' ? 'Live game relay' : 'Unity play proxy';
	var pathHint =
		kind === 'live' ? '/api/game-live/' + safeId : '/api/unity-play/' + safeId;
	return (
		'<!DOCTYPE html><html><head><meta charset="utf-8"/><title>' +
		title +
		'</title>' +
		'<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111;color:#ddd;' +
		'font:400 0.95rem/1.5 system-ui,sans-serif;padding:1.5rem;text-align:center}' +
		'code{background:#222;padding:0.15rem 0.4rem;border-radius:4px}</style></head><body>' +
		'<div><p><strong>Local puller required for touch-enabled play</strong></p>' +
		'<p>This page relays <code>' +
		pathHint +
		'</code> to <code>http://127.0.0.1:18787</code> via the service worker.</p>' +
		'<p>On this machine run:</p><p><code>pnpm puller:start</code></p>' +
		'<p style="opacity:.75;font-size:.85rem">' +
		safeReason +
		'</p></div></body></html>'
	);
}

function relayPullerHtml(targetUrl, kind, gameId) {
	return fetch(targetUrl, {
		method: 'GET',
		headers: { Accept: 'text/html,*/*' },
		mode: 'cors',
		credentials: 'omit'
	})
		.then(function (res) {
			if (!res.ok) {
				return res.text().then(function (body) {
					var detail = body && body.length < 200 ? body : 'HTTP ' + res.status;
					return new Response(pullerRelayErrorHtml(kind, gameId, detail), {
						status: 502,
						headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
					});
				});
			}
			return res.text().then(function (html) {
				return new Response(html, {
					status: 200,
					headers: {
						'Content-Type': 'text/html; charset=utf-8',
						'Cache-Control': 'private, max-age=60'
					}
				});
			});
		})
		.catch(function (err) {
			var msg = err && err.message ? err.message : 'Network error';
			return new Response(pullerRelayErrorHtml(kind, gameId, msg), {
				status: 502,
				headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
			});
		});
}

function relayPullerPassthrough(targetUrl, kind, gameId) {
	return fetch(targetUrl, {
		method: 'GET',
		mode: 'cors',
		credentials: 'omit'
	})
		.then(function (res) {
			if (!res.ok) {
				return res.text().then(function (body) {
					var detail = body && body.length < 200 ? body : 'HTTP ' + res.status;
					var ct = (res.headers.get('Content-Type') || '').toLowerCase();
					if (ct.indexOf('text/html') === 0 || kind === 'live') {
						return new Response(pullerRelayErrorHtml(kind, gameId, detail), {
							status: 502,
							headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
						});
					}
					return new Response(body, { status: res.status });
				});
			}
			return res.arrayBuffer().then(function (buf) {
				var headers = {
					'Content-Type': res.headers.get('Content-Type') || 'application/octet-stream',
					'Cache-Control': res.headers.get('Cache-Control') || 'private, max-age=60'
				};
				return new Response(buf, { status: res.status, headers: headers });
			});
		})
		.catch(function (err) {
			var msg = err && err.message ? err.message : 'Network error';
			return new Response(pullerRelayErrorHtml(kind, gameId, msg), {
				status: 502,
				headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
			});
		});
}

function relayUnityPlay(gameId) {
	return relayPullerHtml(DEFAULT_PULLER_UNITY + encodeURIComponent(gameId), 'unity', gameId);
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

	const unityPlayMatch = pathname.match(/\/api\/unity-play\/([^/]+)\/?$/);
	if (unityPlayMatch && event.request.method === 'GET') {
		const gameId = decodeURIComponent(unityPlayMatch[1]);
		event.respondWith(relayUnityPlay(gameId));
		return;
	}

	const livePlayMatch = pathname.match(/\/api\/game-live\/([^/]+)(?:\/(.*))?$/);
	if (livePlayMatch && event.request.method === 'GET') {
		const gameId = decodeURIComponent(livePlayMatch[1]);
		const rest = livePlayMatch[2] ? livePlayMatch[2] : '';
		const target =
			DEFAULT_PULLER_LIVE +
			encodeURIComponent(gameId) +
			(rest ? '/' + rest : '') +
			url.search;
		event.respondWith(
			rest
				? relayPullerPassthrough(target, 'live', gameId)
				: relayPullerHtml(target, 'live', gameId)
		);
		return;
	}

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
