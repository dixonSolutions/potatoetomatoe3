/**
 * In-game iframe: sync full browser profile with Potato Tomato shell via postMessage.
 * Includes IndexedDB shim for Unity WebGL and other IDB-based saves.
 */
(function () {
	var TYPE = 'potato-tomato-game-storage';
	var SCHEMA_VERSION = 1;
	var gameId = '';
	var origin = location.origin;
	var idbProfile = [];
	var idbShimInstalled = false;
	var pushTimer = null;

	function detectGameId() {
		var path = location.pathname;
		var patterns = [
			/\/puller-games\/([^/]+)\//,
			/\/browser-offline\/([^/]+)\//,
			/\/games\/([^/]+)\/(?:offline|online)\//
		];
		for (var i = 0; i < patterns.length; i++) {
			var match = path.match(patterns[i]);
			if (match) return decodeURIComponent(match[1]);
		}
		return '';
	}

	function emptyProfile() {
		return {
			schemaVersion: SCHEMA_VERSION,
			updatedAt: 0,
			profile: {
				Default: {
					localStorage: {},
					sessionStorage: {},
					cookies: [],
					indexedDB: []
				}
			}
		};
	}

	function snapLocalStorage() {
		var data = {};
		try {
			for (var i = 0; i < localStorage.length; i++) {
				var key = localStorage.key(i);
				if (key) data[key] = localStorage.getItem(key);
			}
		} catch (e) {
			/* ignore */
		}
		return data;
	}

	function snapSessionStorage() {
		var data = {};
		try {
			for (var i = 0; i < sessionStorage.length; i++) {
				var key = sessionStorage.key(i);
				if (key) data[key] = sessionStorage.getItem(key);
			}
		} catch (e) {
			/* ignore */
		}
		return data;
	}

	function snapCookies() {
		var raw = document.cookie;
		if (!raw) return [];
		var cookies = [];
		var parts = raw.split(';');
		for (var i = 0; i < parts.length; i++) {
			var trimmed = parts[i].trim();
			if (!trimmed) continue;
			var eq = trimmed.indexOf('=');
			if (eq === -1) continue;
			cookies.push({
				name: trimmed.slice(0, eq).trim(),
				value: trimmed.slice(eq + 1).trim(),
				path: '/'
			});
		}
		return cookies;
	}

	function serializeKey(key) {
		try {
			return JSON.stringify(key);
		} catch (e) {
			return String(key);
		}
	}

	function serializeValue(val) {
		if (val == null) return 'null';
		if (typeof val === 'string') return val;
		try {
			if (val instanceof ArrayBuffer) {
				var bytes = new Uint8Array(val);
				var bin = '';
				for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
				return '__ab__:' + btoa(bin);
			}
			return JSON.stringify(val);
		} catch (e) {
			return String(val);
		}
	}

	function findDbProfile(name) {
		for (var i = 0; i < idbProfile.length; i++) {
			if (idbProfile[i].name === name) return idbProfile[i];
		}
		return null;
	}

	function upsertRecord(dbName, storeName, key, value) {
		var db = findDbProfile(dbName);
		if (!db) {
			db = { name: dbName, version: 1, objectStores: [], records: [] };
			idbProfile.push(db);
		}
		if (db.objectStores.indexOf(storeName) === -1) db.objectStores.push(storeName);
		var keyStr = serializeKey(key);
		var valStr = serializeValue(value);
		for (var i = 0; i < db.records.length; i++) {
			if (db.records[i].storeName === storeName && db.records[i].key === keyStr) {
				db.records[i].value = valStr;
				return;
			}
		}
		db.records.push({ storeName: storeName, key: keyStr, value: valStr });
	}

	function removeRecord(dbName, storeName, key) {
		var db = findDbProfile(dbName);
		if (!db) return;
		var keyStr = serializeKey(key);
		db.records = db.records.filter(function (r) {
			return r.storeName !== storeName || r.key !== keyStr;
		});
	}

	function installIdbShim() {
		if (idbShimInstalled || !window.indexedDB) return;
		idbShimInstalled = true;
		var realOpen = window.indexedDB.open.bind(window.indexedDB);

		window.indexedDB.open = function (name, version) {
			var req = realOpen(name, version || 1);
			var dbName = String(name);
			var dbVersion = version || 1;

			req.addEventListener('upgradeneeded', function () {
				var db = req.result;
				var stores = [];
				try {
					for (var i = 0; i < db.objectStoreNames.length; i++) {
						stores.push(db.objectStoreNames[i]);
					}
				} catch (e) {
					/* ignore */
				}
				var existing = findDbProfile(dbName);
				if (!existing) {
					idbProfile.push({
						name: dbName,
						version: dbVersion,
						objectStores: stores,
						records: []
					});
				} else {
					existing.version = dbVersion;
					existing.objectStores = stores;
				}
			});

			req.addEventListener('success', function () {
				var db = req.result;
				wrapDatabase(db, dbName);
				hydrateIdbDatabase(db, dbName);
			});

			return req;
		};
	}

	function wrapDatabase(db, dbName) {
		var origTransaction = db.transaction.bind(db);
		db.transaction = function (storeNames, mode) {
			var tx = origTransaction(storeNames, mode);
			wrapTransaction(tx, dbName, storeNames);
			return tx;
		};
	}

	function wrapTransaction(tx, dbName, storeNames) {
		var names = Array.isArray(storeNames) ? storeNames : [storeNames];
		tx.addEventListener('complete', function () {
			schedulePush();
		});

		var origObjectStore = tx.objectStore.bind(tx);
		tx.objectStore = function (name) {
			var store = origObjectStore(name);
			wrapObjectStore(store, dbName, name);
			return store;
		};
	}

	function wrapObjectStore(store, dbName, storeName) {
		var origPut = store.put.bind(store);
		var origAdd = store.add.bind(store);
		var origDelete = store.delete.bind(store);

		store.put = function (value, key) {
			upsertRecord(dbName, storeName, key !== undefined ? key : value, value);
			return origPut(value, key);
		};
		store.add = function (value, key) {
			upsertRecord(dbName, storeName, key !== undefined ? key : value, value);
			return origAdd(value, key);
		};
		store.delete = function (key) {
			removeRecord(dbName, storeName, key);
			return origDelete(key);
		};
	}

	function parseStoredValue(valStr) {
		if (valStr == null) return null;
		if (valStr.indexOf('__ab__:') === 0) {
			var bin = atob(valStr.slice(7));
			var bytes = new Uint8Array(bin.length);
			for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
			return bytes.buffer;
		}
		try {
			return JSON.parse(valStr);
		} catch (e) {
			return valStr;
		}
	}

	function parseStoredKey(keyStr) {
		try {
			return JSON.parse(keyStr);
		} catch (e) {
			return keyStr;
		}
	}

	function hydrateIdbDatabase(db, dbName) {
		var profile = findDbProfile(dbName);
		if (!profile || !profile.records.length) return;

		for (var i = 0; i < profile.records.length; i++) {
			var rec = profile.records[i];
			try {
				if (!db.objectStoreNames.contains(rec.storeName)) continue;
				var tx = db.transaction(rec.storeName, 'readwrite');
				var store = tx.objectStore(rec.storeName);
				var key = parseStoredKey(rec.key);
				var value = parseStoredValue(rec.value);
				store.put(value, key);
			} catch (e) {
				/* store may not exist yet */
			}
		}
	}

	function buildProfile() {
		var p = emptyProfile();
		p.updatedAt = Date.now();
		p.profile.Default.localStorage[origin] = snapLocalStorage();
		p.profile.Default.sessionStorage[origin] = snapSessionStorage();
		p.profile.Default.cookies = snapCookies();
		p.profile.Default.indexedDB = idbProfile.map(function (db) {
			return {
				name: db.name,
				version: db.version,
				objectStores: db.objectStores.slice(),
				records: db.records.slice()
			};
		});
		return p;
	}

	function applyProfile(profile) {
		if (!profile || !profile.profile || !profile.profile.Default) return;
		var def = profile.profile.Default;

		var ls = def.localStorage && def.localStorage[origin];
		if (ls) {
			for (var key in ls) {
				if (!Object.prototype.hasOwnProperty.call(ls, key)) continue;
				try {
					localStorage.setItem(key, ls[key]);
				} catch (e) {
					/* quota */
				}
			}
		}

		var ss = def.sessionStorage && def.sessionStorage[origin];
		if (ss) {
			for (var sk in ss) {
				if (!Object.prototype.hasOwnProperty.call(ss, sk)) continue;
				try {
					sessionStorage.setItem(sk, ss[sk]);
				} catch (e) {
					/* ignore */
				}
			}
		}

		if (def.cookies && def.cookies.length) {
			for (var ci = 0; ci < def.cookies.length; ci++) {
				var c = def.cookies[ci];
				if (c.httpOnly) continue;
				var segment =
					encodeURIComponent(c.name) + '=' + encodeURIComponent(c.value);
				if (c.path) segment += '; path=' + c.path;
				if (c.domain) segment += '; domain=' + c.domain;
				if (c.secure) segment += '; secure';
				if (c.sameSite) segment += '; samesite=' + c.sameSite;
				try {
					document.cookie = segment;
				} catch (e) {
					/* ignore */
				}
			}
		}

		if (def.indexedDB && def.indexedDB.length) {
			idbProfile = def.indexedDB.map(function (db) {
				return {
					name: db.name,
					version: db.version,
					objectStores: (db.objectStores || []).slice(),
					records: (db.records || []).slice()
				};
			});
		}
	}

	function pushToParent() {
		if (!gameId || window.parent === window) return;
		window.parent.postMessage(
			{
				type: TYPE,
				action: 'push',
				gameId: gameId,
				data: buildProfile()
			},
			'*'
		);
	}

	function schedulePush() {
		if (pushTimer) return;
		pushTimer = setTimeout(function () {
			pushTimer = null;
			pushToParent();
		}, 500);
	}

	gameId = detectGameId();
	if (!gameId || window.parent === window) return;

	installIdbShim();

	window.addEventListener('message', function (event) {
		var msg = event.data;
		if (!msg || msg.type !== TYPE || msg.gameId !== gameId) return;
		if (msg.action === 'hydrate' && msg.data) {
			applyProfile(msg.data);
		}
	});

	window.parent.postMessage({ type: TYPE, action: 'pull', gameId: gameId }, '*');
	setInterval(pushToParent, 4000);
	window.addEventListener('pagehide', pushToParent);
})();
