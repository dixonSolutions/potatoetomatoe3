/*
 * Touch-console bridge, injected natively into every frame.
 *
 * Why this exists: the app cannot script a cross-origin game document from JavaScript.
 * That is Blink's same-origin policy, not an Android limitation — it applies in Chrome,
 * in Safari, and in any embedded Chromium. On the web the only way round it is to serve
 * the game from our own origin (the puller relay).
 *
 * A native embedder is outside that sandbox. `WebViewCompat.addDocumentStartJavaScript`
 * runs this file at document start in EVERY frame whose origin matches the allowed rules,
 * cross-origin subframes included, before any of the page's own script. So on Android the
 * relay is not needed for the console at all: the bridge is already inside the game.
 *
 * Installed by MainActivity.onWebViewCreate. Speaks the same postMessage protocol as
 * `static/game-storage-bridge.child.js` — keep `potato-tomato-touch-input` in sync.
 *
 * Runs in every frame including ad and pixel frames, so it must be cheap and must never
 * throw: a failure here would break the page it was injected into.
 */
(function () {
	if (window.__ptNativeBridge) return;
	window.__ptNativeBridge = 1;

	var isGameFrame = window.top !== window;

	/*
	 * Report the orientation of THIS FRAME, not the device.
	 *
	 * Portal shells gate on `window.orientation` / `screen.orientation`, which report the
	 * physical device. Measured on a Galaxy Tab Active3: CrazyGames' bootstrap declares
	 * `orientation: PORTRAIT` for Home Pin 2, Tower Swap and 2048; the tablet reported
	 * `window.orientation === 90`, so every one of them rendered "Rotate your screen"
	 * forever — in both device rotations, because a landscape-native tablet is still
	 * landscape at rotation 0. No CSS could reach it: the check never looks at element size.
	 *
	 * An embedder presents a viewport, so the honest answer to "which way up are you?" is
	 * the shape of the frame. Defined at document start, before the page's own script runs,
	 * so these win. Only in game frames — the app's own top frame keeps the real values.
	 */
	if (isGameFrame) {
		var isPortrait = function () {
			return window.innerHeight > window.innerWidth;
		};
		try {
			Object.defineProperty(window, 'orientation', {
				configurable: true,
				get: function () {
					return isPortrait() ? 0 : 90;
				}
			});
		} catch (e) {
			/* already non-configurable on this engine */
		}
		/*
		 * One stable shim, not a fresh object per access: games hold the reference, compare
		 * identity, and call `addEventListener('change')` on it. Handing back a new object
		 * each time would silently drop every listener they register.
		 */
		var listeners = [];
		var shim = {
			get angle() {
				return isPortrait() ? 0 : 90;
			},
			get type() {
				return isPortrait() ? 'portrait-primary' : 'landscape-primary';
			},
			onchange: null,
			addEventListener: function (type, fn) {
				if (type === 'change' && typeof fn === 'function') listeners.push(fn);
			},
			removeEventListener: function (type, fn) {
				var i = listeners.indexOf(fn);
				if (i >= 0) listeners.splice(i, 1);
			},
			/* Games call lock() on entry; resolving keeps their startup path alive. */
			lock: function () {
				return Promise.resolve();
			},
			unlock: function () {}
		};
		/* The frame is resized when the app reshapes the surface — that IS our rotation. */
		var lastPortrait = isPortrait();
		window.addEventListener('resize', function () {
			var now = isPortrait();
			if (now === lastPortrait) return;
			lastPortrait = now;
			var event;
			try {
				event = new Event('change');
			} catch (e) {
				return;
			}
			if (typeof shim.onchange === 'function') {
				try {
					shim.onchange(event);
				} catch (e) {
					/* game handler threw */
				}
			}
			for (var i = 0; i < listeners.length; i++) {
				try {
					listeners[i](event);
				} catch (e) {
					/* game handler threw */
				}
			}
			try {
				window.dispatchEvent(new Event('orientationchange'));
			} catch (e) {
				/* older engine */
			}
		});
		try {
			Object.defineProperty(screen, 'orientation', {
				configurable: true,
				get: function () {
					return shim;
				}
			});
		} catch (e) {
			/* leave the real object in place */
		}
	}

	/*
	 * Tell the app which shape this game wants, so the surface can be reshaped to match.
	 * Without a portrait-shaped box, reporting "portrait" above would only trade the gate
	 * for a game rendering sideways.
	 */
	function reportDeclaredOrientation() {
		if (!isGameFrame) return;
		var want = null;
		try {
			var scripts = document.getElementsByTagName('script');
			for (var i = 0; i < scripts.length && !want; i++) {
				var text = scripts[i].textContent || '';
				if (text.indexOf('gfBuildPath') === -1 && text.indexOf('orientation') === -1) continue;
				var m = text.match(/orientation["']?\s*[:=]\s*["']?(PORTRAIT|LANDSCAPE)/i);
				if (m) want = m[1].toLowerCase();
			}
		} catch (e) {
			return;
		}
		if (!want) return;
		try {
			window.top.postMessage({ type: 'potato-tomato-frame-orientation', want: want }, '*');
		} catch (e) {
			/* top gone */
		}
	}

	if (isGameFrame) {
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', reportDeclaredOrientation);
		} else {
			reportDeclaredOrientation();
		}
		/* The bootstrap is often written after DOMContentLoaded — look once more. */
		setTimeout(reportDeclaredOrientation, 1500);
	}

	var KEY_BY_CODE = {
		ArrowUp: 'ArrowUp',
		ArrowDown: 'ArrowDown',
		ArrowLeft: 'ArrowLeft',
		ArrowRight: 'ArrowRight',
		Space: ' ',
		Enter: 'Enter',
		Escape: 'Escape',
		ShiftLeft: 'Shift',
		ShiftRight: 'Shift',
		ControlLeft: 'Control',
		ControlRight: 'Control',
		Tab: 'Tab',
		Backspace: 'Backspace'
	};
	var KEYCODE_BY_CODE = {
		ArrowLeft: 37,
		ArrowUp: 38,
		ArrowRight: 39,
		ArrowDown: 40,
		Space: 32,
		Enter: 13,
		Escape: 27,
		ShiftLeft: 16,
		ShiftRight: 16,
		ControlLeft: 17,
		ControlRight: 17,
		Tab: 9,
		Backspace: 8
	};

	function keyFor(code) {
		if (KEY_BY_CODE[code]) return KEY_BY_CODE[code];
		if (code.indexOf('Key') === 0 && code.length === 4) return code.charAt(3).toLowerCase();
		if (code.indexOf('Digit') === 0 && code.length === 6) return code.charAt(5);
		return code;
	}

	function keyCodeFor(code) {
		if (KEYCODE_BY_CODE[code] != null) return KEYCODE_BY_CODE[code];
		if (code.indexOf('Key') === 0 && code.length === 4) return code.charCodeAt(3);
		if (code.indexOf('Digit') === 0 && code.length === 6) return code.charCodeAt(5);
		return 0;
	}

	var held = Object.create(null);

	function gameCanvas() {
		try {
			return (
				document.querySelector('canvas') ||
				document.querySelector('#unity-canvas, #openfl-content canvas, #gameContainer canvas')
			);
		} catch (e) {
			return null;
		}
	}

	function dispatch(type, code) {
		if (!code) return;
		var keyCode = keyCodeFor(code);
		var event;
		try {
			event = new KeyboardEvent(type, {
				key: keyFor(code),
				code: code,
				keyCode: keyCode,
				which: keyCode,
				bubbles: true,
				cancelable: true,
				composed: true,
				view: window
			});
			/* Engines that predate `code` still read the legacy numeric fields. */
			Object.defineProperty(event, 'keyCode', {
				get: function () {
					return keyCode;
				}
			});
			Object.defineProperty(event, 'which', {
				get: function () {
					return keyCode;
				}
			});
		} catch (e) {
			return;
		}

		var canvas = gameCanvas();
		try {
			if (canvas && canvas.focus) canvas.focus({ preventScroll: true });
		} catch (e) {
			/* focus is best effort */
		}

		/*
		 * Dispatch once, on `document.body` — NOT the canvas.
		 *
		 * Two constraints pull against each other and body is the only target that meets
		 * both. Dispatching at several targets delivers one press as four `keydown`s to
		 * anything listening on window (one Space tap became four jumps). But dispatching
		 * at the canvas is silently ignored by Scratch, which is what most of the
		 * abinbins-hosted catalog is: its handler drops key events whose `target` is
		 * neither `document` nor `document.body`, so that typing into its answer box does
		 * not drive the game. Measured against a live VM on device:
		 *
		 *   dispatch on canvas -> vm.runtime.ioDevices.keyboard._keysPressed === []
		 *   dispatch on body   -> vm.runtime.ioDevices.keyboard._keysPressed === ["space"]
		 *
		 * The event bubbles and is composed, so window-, document- and body-level
		 * listeners each still see it exactly once. Only a listener bound directly to the
		 * canvas misses it, which is rare — a canvas needs tabindex and focus to receive
		 * key events naturally, so engines bind to document or window instead.
		 */
		var target = document.body || document.documentElement || document;
		try {
			target.dispatchEvent(event);
		} catch (e) {
			/* detached document */
		}
	}

	/*
	 * The console posts to the top game frame; portal shells nest the real game one level
	 * deeper. Every frame runs this script, so forwarding reaches the canvas wherever it is.
	 */
	function forwardToChildren(data) {
		var frames;
		try {
			frames = document.getElementsByTagName('iframe');
		} catch (e) {
			return;
		}
		for (var i = 0; i < frames.length; i++) {
			try {
				var win = frames[i].contentWindow;
				if (win && win !== window) win.postMessage(data, '*');
			} catch (e) {
				/* cross-origin child: postMessage still delivered where possible */
			}
		}
	}

	function ack(data, codes) {
		if (!data || !data.ackId) return;
		try {
			window.parent.postMessage(
				{
					type: 'potato-tomato-touch-input-ack',
					ackId: data.ackId,
					action: data.action,
					codes: codes || [],
					path: 'native',
					ok: true
				},
				'*'
			);
		} catch (e) {
			/* parent gone */
		}
	}

	window.addEventListener('message', function (event) {
		var data = event && event.data;
		if (!data || typeof data !== 'object') return;
		if (data.type !== 'potato-tomato-touch-input') return;

		var codes = Array.isArray(data.codes) ? data.codes : data.code ? [data.code] : [];

		if (data.action === 'releaseAll') {
			var open = Object.keys(held);
			held = Object.create(null);
			for (var r = 0; r < open.length; r++) dispatch('keyup', open[r]);
			forwardToChildren(data);
			ack(data, open);
			return;
		}
		if (data.action === 'down') {
			for (var d = 0; d < codes.length; d++) {
				if (!codes[d] || held[codes[d]]) continue;
				held[codes[d]] = true;
				dispatch('keydown', codes[d]);
			}
			forwardToChildren(data);
			ack(data, codes);
			return;
		}
		if (data.action === 'up') {
			for (var u = 0; u < codes.length; u++) {
				if (!codes[u] || !held[codes[u]]) continue;
				delete held[codes[u]];
				dispatch('keyup', codes[u]);
			}
			forwardToChildren(data);
			ack(data, codes);
		}
	});
})();
