/*
 * Launch-measurement probe, injected into every frame by the play-path bench.
 *
 * The bench cannot screenshot the Tauri window, and a cross-origin game frame cannot be
 * read from the page that hosts it. So each frame reports on itself: once when its
 * document has loaded (with what the storage bridge installed there), and once when a
 * game-sized canvas exists. Reports go to the top frame by postMessage; the bench route
 * there timestamps them and forwards them to the collector.
 *
 * Chromium gets this through Playwright's `addInitScript`; the Tauri debug build gets it
 * from `POTATO_TOMATO_FRAME_PROBE` (see `src-tauri/src/game_frames.rs`). Never shipped.
 */
(function () {
	if (window.top === window || window.__ptFrameProbe) return;
	window.__ptFrameProbe = 1;

	/*
	 * Nobody is there to dismiss a dialog. WebKitGTK runs cross-origin frames in the page's
	 * own process, so one `alert()` from a game would block the launcher and every later run.
	 */
	window.alert = function () {};
	window.confirm = function () {
		return true;
	};
	window.prompt = function () {
		return null;
	};

	function depth() {
		var n = 0;
		var w = window;
		try {
			while (w !== w.top && n < 12) {
				w = w.parent;
				n++;
			}
		} catch {
			/* parent chain unreadable — depth stays what we counted */
		}
		return n;
	}

	function report(kind, extra) {
		var msg = {
			type: 'pt-frame-probe',
			kind: kind,
			href: String(location.href).slice(0, 240),
			depth: depth(),
			at: Date.now()
		};
		for (var k in extra) msg[k] = extra[k];
		try {
			window.top.postMessage(msg, '*');
		} catch {
			/* top unreachable */
		}
	}

	/* Can this frame reach into the app page — its document, or the desktop app's IPC? */
	function can(read) {
		try {
			return read() !== false;
		} catch {
			return false;
		}
	}

	function bridgeState() {
		var b = window.__ptStorageBridge;
		return {
			bridge: Boolean(b),
			bridgeGameId: b ? String(b.gameId || '') : '',
			virtual: Boolean(b && b.virtual),
			nativeBridge: Boolean(window.__ptNativeGameFrame),
			nativeRole: window.__ptNativeGameFrame ? String(window.__ptNativeGameFrame.role || '') : '',
			origin: String(self.origin),
			appDocument: can(function () {
				return typeof window.top.document.title === 'string';
			}),
			appIpc: can(function () {
				return Boolean(window.top.__TAURI_INTERNALS__);
			})
		};
	}

	window.addEventListener('load', function () {
		report('load', bridgeState());
	});

	/* Same criterion as scripts/verify-game-launches.mjs: a game-sized, visible canvas. */
	var started = Date.now();
	var timer = setInterval(function () {
		if (Date.now() - started > 180000) {
			clearInterval(timer);
			return;
		}
		var canvases = Array.prototype.slice.call(document.getElementsByTagName('canvas'));
		/* Ruffle (Flash titles) draws inside its player element's shadow root. */
		var players = document.querySelectorAll('ruffle-player, ruffle-embed, ruffle-object');
		for (var p = 0; p < players.length; p++) {
			var root = players[p].shadowRoot;
			if (root)
				canvases = canvases.concat(Array.prototype.slice.call(root.querySelectorAll('canvas')));
		}
		for (var i = 0; i < canvases.length; i++) {
			var c = canvases[i];
			if (c.width < 200 || c.height < 150) continue;
			var box = c.getBoundingClientRect();
			if (box.width < 50 || box.height < 50) continue;
			clearInterval(timer);
			var extra = bridgeState();
			extra.w = c.width;
			extra.h = c.height;
			report('canvas', extra);
			return;
		}
	}, 200);
})();
