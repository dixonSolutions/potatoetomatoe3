/**
 * Service worker for browser-hosted offline games (GitHub Pages).
 * Serves files from IndexedDB at /browser-offline/{gameId}/…
 * Injects storage bridge into game HTML at /games/{id}/online|offline/…
 * Relays /api/unity-play/{id} and /api/game-live/* to a locally running puller
 * (avoids HTTPS→HTTP iframe mixed content). Offline scrape remains the puller's
 * primary job; live relay is an additional capability when puller is running.
 * Also keeps the app shell, its hashed build assets, and catalog JSON cached, so a
 * game downloaded in the browser is still reachable when the network is gone —
 * without the shell there is no page from which to launch it.
 */
const SHELL_CACHE = 'pt-app-shell-v1';
const DATA_CACHE = 'pt-app-data-v1';
const KEEP_CACHES = [SHELL_CACHE, DATA_CACHE];
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
					/*
					 * Asset requests can legitimately receive an upstream HTML
					 * 404 page for an optional portal/ad file. Preserve that
					 * response instead of converting it into a misleading 502;
					 * relay errors are reserved for the top-level entry page.
					 */
					return new Response(body, {
						status: res.status,
						statusText: res.statusText,
						headers: res.headers
					});
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

/** Registration scope is `<origin><base>/`, so it doubles as the SPA shell URL. */
function shellUrl() {
	return self.registration.scope;
}

function isWithinScope(url) {
	return url.href.indexOf(shellUrl()) === 0;
}

/** Hashed build output — safe to serve from cache forever, and required by the shell. */
function isImmutableAsset(url) {
	return url.pathname.indexOf('/_app/immutable/') !== -1;
}

/**
 * Exactly the JSON the SPA needs to paint a browse page and a game page: SvelteKit's own
 * route data, the shard manifest, its shards, and per-game metadata. Deliberately narrow —
 * game payloads (Unity `Build/*.json` and friends) must keep coming from disk or
 * IndexedDB, where a delete-and-redownload replaces them, not from a revalidating cache.
 */
function isCatalogData(url) {
	return (
		/\/__data\.json$/i.test(url.pathname) ||
		/\/games\/games-index\/[^/]+\.json$/i.test(url.pathname) ||
		/\/games\/[^/]+\/online\/metadata\.json$/i.test(url.pathname)
	);
}

/**
 * The desktop shell already has every asset on disk and loads over a custom protocol,
 * so app-shell caching buys it nothing and a mis-served shell would be a black window.
 * Game routes below still apply there.
 */
function isNativeShellHost() {
	const host = self.location.hostname;
	return host === 'tauri.localhost' || host === 'asset.localhost';
}

function cachePut(cacheName, request, response) {
	if (!response || !response.ok || response.type === 'opaque') return response;
	const copy = response.clone();
	caches
		.open(cacheName)
		.then(function (cache) {
			return cache.put(request, copy);
		})
		.catch(function () {
			/* Quota or private mode — caching is an optimisation, never a hard requirement. */
		});
	return response;
}

function offlineShellFallback() {
	return new Response(
		'<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Offline</title></head>' +
			'<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#111;' +
			'color:#ddd;font:400 0.95rem/1.5 system-ui,sans-serif;text-align:center">' +
			'<p>You are offline and this page has not been cached yet.<br/>Reconnect once, then it stays available.</p>' +
			'</body></html>',
		{ status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
	);
}

/** Network-first: an updated deploy must win while there is a network to fetch it from. */
function handleNavigation(request) {
	return fetch(request)
		.then(function (response) {
			return cachePut(SHELL_CACHE, shellUrl(), response);
		})
		.catch(function () {
			return caches.match(shellUrl()).then(function (cached) {
				return cached || offlineShellFallback();
			});
		});
}

/**
 * Hashed filenames never collide, so nothing here is ever invalidated — across enough
 * deploys that is unbounded growth in a quota shared with the downloaded games. Cache
 * entries come back in insertion order, so dropping from the front evicts the oldest
 * deploy's chunks first. One page needs a few dozen; this leaves several deploys' worth.
 */
const MAX_ASSET_ENTRIES = 200;

function trimAssetCache() {
	return caches
		.open(SHELL_CACHE)
		.then(function (cache) {
			return cache.keys().then(function (keys) {
				const excess = keys.length - MAX_ASSET_ENTRIES;
				if (excess <= 0) return undefined;
				return Promise.all(
					keys.slice(0, excess).map(function (key) {
						/* Never evict the shell itself — it is the offline entry point. */
						if (key.url === shellUrl()) return undefined;
						return cache.delete(key);
					})
				);
			});
		})
		.catch(function () {
			/* Trimming is housekeeping; a failure must not break the response. */
		});
}

function handleImmutableAsset(request) {
	return caches.match(request).then(function (cached) {
		if (cached) return cached;
		return fetch(request).then(function (response) {
			const out = cachePut(SHELL_CACHE, request, response);
			void trimAssetCache();
			return out;
		});
	});
}

/**
 * SvelteKit appends a per-load `?x-sveltekit-invalidated=…` hint to route data requests,
 * so the same document has a different URL on every navigation. Key these by path alone
 * or the cache never gets a hit — which is what left an otherwise-booting offline app on
 * a 500 for the very page holding the downloaded game.
 */
function catalogCacheKey(url) {
	return url.origin + url.pathname;
}

/** Stale-while-revalidate: catalog JSON is small, changes between deploys, and blocks render. */
function handleCatalogData(request) {
	const key = catalogCacheKey(new URL(request.url));
	return caches.match(key).then(function (cached) {
		const network = fetch(request)
			.then(function (response) {
				return cachePut(DATA_CACHE, key, response);
			})
			.catch(function () {
				return cached || Response.error();
			});
		return cached || network;
	});
}

/**
 * Cache the shell and the entry chunks it names.
 *
 * The fetch handler alone is not enough for these: this worker registers from the app's
 * own `onMount`, so by the time it can intercept anything, the entry chunks have already
 * been fetched by an uncontrolled page and will not be requested again. Reading them out
 * of the shell HTML keeps the list correct across deploys without a generated manifest.
 * Route chunks stay lazy — the fetch handler picks those up once the worker is in control.
 */
function precacheAppShell(cache) {
	return fetch(new Request(shellUrl(), { cache: 'reload' })).then(function (response) {
		if (!response.ok) throw new Error('App shell fetch failed: ' + response.status);
		return response
			.clone()
			.text()
			.then(function (html) {
				return cache.put(shellUrl(), response).then(function () {
					const seen = [];
					const refs = html.match(/_app\/immutable\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+/g) || [];
					refs.forEach(function (ref) {
						/* Resolve against the scope so a project-site base path is preserved. */
						const href = new URL(ref, shellUrl()).href;
						if (seen.indexOf(href) === -1) seen.push(href);
					});
					return Promise.all(
						seen.map(function (href) {
							return cache.add(new Request(href, { cache: 'reload' })).catch(function () {
								/* One missing chunk must not fail the whole install. */
							});
						})
					);
				});
			});
	});
}

self.addEventListener('install', function (event) {
	self.skipWaiting();
	if (isNativeShellHost()) return;
	event.waitUntil(
		caches
			.open(SHELL_CACHE)
			.then(precacheAppShell)
			.catch(function () {
				/* Installed while offline — handleNavigation fills the shell in on first load. */
			})
	);
});

/**
 * Cache assets an *uncontrolled* page already loaded.
 *
 * A worker registered from the app's own `onMount` misses every request the first page
 * load made, route chunks included, and hashed URLs are never requested again. The page
 * knows what it loaded, so it sends the list here after each navigation and the worker
 * fills the gap — otherwise "download a game, then lose the network" leaves the game in
 * IndexedDB with no app able to boot and play it.
 */
self.addEventListener('message', function (event) {
	const data = event.data;
	if (!data || data.type !== 'pt-cache-app-assets' || !Array.isArray(data.urls)) return;
	if (isNativeShellHost()) return;
	const wanted = [];
	data.urls.forEach(function (raw) {
		if (typeof raw !== 'string') return;
		let parsed;
		try {
			parsed = new URL(raw, shellUrl());
		} catch {
			return;
		}
		if (parsed.origin !== self.location.origin) return;
		/* Same split the fetch handler uses, so warming never lands in the wrong cache. */
		if (isImmutableAsset(parsed)) wanted.push([SHELL_CACHE, parsed.href, parsed.href]);
		else if (isWithinScope(parsed) && isCatalogData(parsed)) {
			wanted.push([DATA_CACHE, catalogCacheKey(parsed), parsed.href]);
		}
	});
	event.waitUntil(
		Promise.all(
			wanted.map(function (entry) {
				return caches.open(entry[0]).then(function (cache) {
					return cache.match(entry[1]).then(function (hit) {
						if (hit) return undefined;
						return fetch(entry[2])
							.then(function (response) {
								if (!response.ok) return undefined;
								return cache.put(entry[1], response);
							})
							.catch(function () {
								/* A single stale URL must not abort the rest. */
							});
					});
				});
			})
		)
			.then(trimAssetCache)
			.catch(function () {
				/* Warming the cache is opportunistic. */
			})
	);
});

self.addEventListener('activate', function (event) {
	event.waitUntil(
		caches
			.keys()
			.then(function (names) {
				return Promise.all(
					names.map(function (name) {
						if (name.indexOf('pt-app-') === 0 && KEEP_CACHES.indexOf(name) === -1) {
							return caches.delete(name);
						}
						return undefined;
					})
				);
			})
			.then(function () {
				return self.clients.claim();
			})
	);
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

	if (event.request.method === 'GET' && event.request.mode === 'navigate' && !isNativeShellHost()) {
		event.respondWith(handleNavigation(event.request));
		return;
	}

	if (
		event.request.method === 'GET' &&
		url.origin === self.location.origin &&
		!isNativeShellHost()
	) {
		if (isImmutableAsset(url)) {
			event.respondWith(handleImmutableAsset(event.request));
			return;
		}
		if (isWithinScope(url) && isCatalogData(url)) {
			event.respondWith(handleCatalogData(event.request));
			return;
		}
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
