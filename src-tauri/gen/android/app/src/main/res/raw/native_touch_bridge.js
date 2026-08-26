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
	 * Present desktop input traits to portal shells that we already tell "desktop".
	 *
	 * The privacy disguise reports a desktop Linux user agent. CrazyGames' GameFrame
	 * classifies the device from that UA *and* from `navigator.maxTouchPoints`, and it
	 * has a branch specifically for the combination:
	 *
	 *   if ("Linux" === os.name && navigator.maxTouchPoints > 0) { ... return "tablet" }
	 *
	 * so a desktop-Linux UA on a touchscreen lands in its tablet layout. That layout
	 * mounts an empty `#gfMainContainer` and never requests the Unity loader when the
	 * shell is embedded anywhere other than crazygames.com — measured on device: zero
	 * requests to files.crazygames.com, a bare "Exit" button, black frame, forever.
	 * Chrome on the same handset does exactly the same thing with the page open at top
	 * level, so this is the shell's own mobile path, not something the app blocks.
	 *
	 * Forcing `maxTouchPoints` to 0 for the shell alone moved it onto the desktop path
	 * and the build downloaded immediately. The rule is simply consistency: if we claim
	 * to be a desktop browser, the input traits have to agree, or sniffers take branches
	 * no real client ever takes.
	 *
	 * Scoped to the shell hostname on purpose. The playable game lives one frame deeper
	 * (`<slug>.game-files.crazygames.com`) and keeps real touch there, so games that
	 * feature-detect touch to bind their own on-screen controls are untouched. Add a host
	 * here only after measuring that it misclassifies the same way — playhop,
	 * addictinggames and unity-play were checked and load fine without it.
	 */
	var DESKTOP_TRAIT_SHELLS = { 'games.crazygames.com': 1 };
	if (isGameFrame && DESKTOP_TRAIT_SHELLS[location.hostname]) {
		try {
			Object.defineProperty(navigator, 'maxTouchPoints', {
				configurable: true,
				get: function () {
					return 0;
				}
			});
		} catch (e) {
			/* already non-configurable on this engine */
		}
		try {
			var nativeMatchMedia = window.matchMedia.bind(window);
			window.matchMedia = function (query) {
				var result = nativeMatchMedia(query);
				try {
					if (/pointer\s*:\s*coarse/.test(query)) {
						Object.defineProperty(result, 'matches', {
							get: function () {
								return false;
							}
						});
					}
					if (/hover\s*:\s*hover/.test(query)) {
						Object.defineProperty(result, 'matches', {
							get: function () {
								return true;
							}
						});
					}
				} catch (e) {
					/* MediaQueryList.matches is not configurable here — leave it alone */
				}
				return result;
			};
		} catch (e) {
			/* matchMedia missing or frozen */
		}
	}

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

	/*
	 * ---------------------------------------------------------------------------
	 * Which keys does THIS game actually read?
	 * ---------------------------------------------------------------------------
	 *
	 * The console used to show a fixed D-pad and five face buttons for every title,
	 * so a mouse-only puzzle game got a joystick that did nothing and a WASD platformer
	 * got arrow keys it ignores. Nothing on the page announces its controls, and no
	 * Android or WebView API can answer the question either — the only vantage point is
	 * inside the game document, at document start, before its own script runs. That is
	 * exactly where this file already is.
	 *
	 * Three sources, cheapest and most certain first:
	 *
	 *   declared  Portal shells ship the control scheme as prose. CrazyGames' bootstrap
	 *             carries `"controls":{"text":"<h3>Controls</h3>...WASD or arrow keys =
	 *             move...Space = dash"}`. Exact, free, and available before the game
	 *             has even loaded.
	 *   listeners Wrapping addEventListener records every key handler the page installs.
	 *             Their `toString()` usually still contains the literals it compares
	 *             against, even minified. A frame that registers none is a game the
	 *             console cannot help at all — worth knowing on its own.
	 *   scripts   Inline script text, same regexes. Cheap; no network fetches.
	 *
	 * Nothing here dispatches a probe key. Firing synthetic keys to see what sticks does
	 * work — `defaultPrevented` cleanly picked out the arrow keys on a Unity title — but
	 * the game's handler runs for real, so probing costs the player a stray jump or a
	 * pause. Passive evidence first; the console treats "no evidence" as "change
	 * nothing", so a silent engine (Unity's wasm handler tells us nothing) simply keeps
	 * the full layout.
	 *
	 * Runs in ad and pixel frames too, so everything below is bounded: the wrapper does
	 * one cheap type test per registration, stored handler source is capped, reports are
	 * debounced and stop after a fixed window, and frames too small to hold a game are
	 * never reported at all.
	 */

	/* Codes the console can actually emit. Anything outside this is noise to us. */
	var EMITTABLE = {
		ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
		KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1,
		Space: 1, Enter: 1, Escape: 1, ShiftLeft: 1, ControlLeft: 1,
		KeyQ: 1, KeyE: 1, KeyR: 1, KeyF: 1, KeyC: 1, KeyV: 1, KeyX: 1, KeyZ: 1,
		KeyJ: 1, KeyK: 1, KeyL: 1, KeyM: 1, KeyN: 1, KeyP: 1,
		Digit1: 1, Digit2: 1, Digit3: 1, Digit4: 1, Digit5: 1,
		Digit6: 1, Digit7: 1, Digit8: 1, Digit9: 1, Digit0: 1
	};

	var CODE_BY_KEYCODE = {
		13: 'Enter', 16: 'ShiftLeft', 17: 'ControlLeft', 27: 'Escape', 32: 'Space',
		37: 'ArrowLeft', 38: 'ArrowUp', 39: 'ArrowRight', 40: 'ArrowDown'
	};

	function codeFromLegacyKeyCode(n) {
		if (CODE_BY_KEYCODE[n]) return CODE_BY_KEYCODE[n];
		if (n >= 65 && n <= 90) return 'Key' + String.fromCharCode(n);
		if (n >= 48 && n <= 57) return 'Digit' + String.fromCharCode(n);
		return null;
	}

	function codeFromKeyName(name) {
		var k = String(name);
		if (k.length === 1) {
			if (k === ' ') return 'Space';
			if (k >= '0' && k <= '9') return 'Digit' + k;
			if (/[a-zA-Z]/.test(k)) return 'Key' + k.toUpperCase();
			return null;
		}
		if (k === 'Spacebar') return 'Space';
		if (k === 'Esc') return 'Escape';
		if (k === 'Up') return 'ArrowUp';
		if (k === 'Down') return 'ArrowDown';
		if (k === 'Left') return 'ArrowLeft';
		if (k === 'Right') return 'ArrowRight';
		if (k === 'Shift') return 'ShiftLeft';
		if (k === 'Control') return 'ControlLeft';
		return EMITTABLE[k] ? k : null;
	}

	/*
	 * A key only counts if the game reads it on its own. `Ctrl+S`, `Alt+Enter` and the
	 * devtools hotkeys are application shortcuts: putting an S button on the console for
	 * them would be pure clutter, and pressing it would do nothing without the modifier
	 * the console cannot send. So a literal whose neighbourhood mentions a modifier flag
	 * is discarded — the window is deliberately wide enough to cover a minified
	 * `e.ctrlKey&&e.key==="s"` and the reversed order of the same test.
	 */
	var MODIFIER_NEAR = /ctrlKey|metaKey|altKey|getModifierState/;
	var SHORTCUT_WINDOW = 72;

	function isShortcutContext(text, index) {
		var from = index - SHORTCUT_WINDOW;
		if (from < 0) from = 0;
		return MODIFIER_NEAR.test(text.slice(from, index + SHORTCUT_WINDOW));
	}

	function scanCodes(text, into) {
		if (!text) return;
		var re, m;
		re = /\b(Arrow(?:Up|Down|Left|Right)|Key[A-Z]|Digit[0-9]|Space|Enter|Escape|ShiftLeft|ControlLeft)\b/g;
		while ((m = re.exec(text))) {
			if (EMITTABLE[m[1]] && !isShortcutContext(text, m.index)) into[m[1]] = 1;
		}
		re = /(?:keyCode|which)\s*(?:={2,3})\s*(\d{1,3})/g;
		while ((m = re.exec(text))) {
			var byNum = codeFromLegacyKeyCode(Number(m[1]));
			if (byNum && EMITTABLE[byNum] && !isShortcutContext(text, m.index)) into[byNum] = 1;
		}
		re = /\.key\s*(?:={2,3})\s*["'`]([^"'`]{1,12})["'`]/g;
		while ((m = re.exec(text))) {
			var byName = codeFromKeyName(m[1]);
			if (byName && EMITTABLE[byName] && !isShortcutContext(text, m.index)) into[byName] = 1;
		}
	}

	/* Portal control blurbs are written for people, so read them like a person would. */
	function scanProse(text, into) {
		if (!text) return;
		var t = String(text).toLowerCase();
		var add = function (list) {
			for (var i = 0; i < list.length; i++) if (EMITTABLE[list[i]]) into[list[i]] = 1;
		};
		if (/\bwasd\b/.test(t)) add(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
		if (/arrow\s*keys?|\barrows\b|[←↑→↓]/.test(t)) {
			add(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
		}
		if (/\bspace\s*bar\b|\bspace\b/.test(t)) add(['Space']);
		if (/\benter\b|\breturn key\b/.test(t)) add(['Enter']);
		if (/\besc(ape)?\b/.test(t)) add(['Escape']);
		if (/\bshift\b/.test(t)) add(['ShiftLeft']);
		if (/\bctrl\b|\bcontrol key\b/.test(t)) add(['ControlLeft']);
		/*
		 * "F key", "E = interact", "1 = pistol" — a single letter named as a key.
		 *
		 * What follows the letter is the whole signal, so it has to be specific: "letter,
		 * punctuation, word" on its own is just English. "collect a key to open doors"
		 * would declare KeyA and the step list "1 - move with the mouse" would declare
		 * Digit1, and a declared code is strong evidence — one stray letter hides every
		 * control the blurb happens not to name. So the article is never the A key, and a
		 * digit needs an explicit `=` rather than the dash a numbered list uses too.
		 */
		var re = /\b(?!a\s+key\b)([a-z0-9])\b\s*(?:key\b|=\s*\w)|\b([a-z])\b\s*[:–—-]\s*\w/g;
		var m;
		while ((m = re.exec(t))) {
			var ch = m[1] || m[2];
			var code = ch >= '0' && ch <= '9' ? 'Digit' + ch : 'Key' + ch.toUpperCase();
			if (EMITTABLE[code]) into[code] = 1;
		}
	}

	var profile = {
		listenerCount: 0,
		/* Handler sources are the highest-signal text we get; keep a bounded sample. */
		sources: [],
		sourceBytes: 0,
		declared: {},
		inferred: {}
	};
	var MAX_SOURCE_BYTES = 400000;
	var MAX_SOURCES = 60;

	function noteHandlerSource(fn) {
		if (profile.sources.length >= MAX_SOURCES || profile.sourceBytes >= MAX_SOURCE_BYTES) return;
		var src = '';
		try {
			src = String(typeof fn === 'function' ? fn : fn && fn.handleEvent);
		} catch (e) {
			return;
		}
		if (!src || src.length > 60000) return;
		profile.sources.push(src);
		profile.sourceBytes += src.length;
	}

	/*
	 * addEventListener is on the hottest path in the engine — a page installs thousands.
	 * Everything before the early return is one property lookup on a plain object.
	 */
	var KEY_EVENT = { keydown: 1, keyup: 1, keypress: 1 };
	try {
		if (!isGameFrame) throw 0; /* the app's own frame is not a game — do not wrap it */
		var nativeAdd = EventTarget.prototype.addEventListener;
		EventTarget.prototype.addEventListener = function (type, fn, opts) {
			if (KEY_EVENT[type] && fn) {
				try {
					profile.listenerCount++;
					noteHandlerSource(fn);
					scheduleReport();
				} catch (e) {
					/* detection must never break the page it watches */
				}
			}
			return nativeAdd.call(this, type, fn, opts);
		};
		/*
		 * A patched `addEventListener` is visible to anything that stringifies it, and
		 * portal anti-tamper code does look. This only covers the common
		 * `fn.toString()` check — `Function.prototype.toString.call` still sees through
		 * it — but it costs nothing and removes the obvious tell.
		 */
		EventTarget.prototype.addEventListener.toString = function () {
			return 'function addEventListener() { [native code] }';
		};
	} catch (e) {
		/* top frame, or a frozen prototype — fall back to the other two sources */
	}

	/*
	 * Older engines assign `document.onkeydown = fn` instead of registering.
	 *
	 * These are IDL event-handler attributes: the engine wires the handler into the
	 * target only when its own setter runs. A wrapper that just stashed the function
	 * would count the listener and then swallow every key press the game was waiting
	 * for — including the synthetic ones the console dispatches. So find the real
	 * accessor (own property on `window`, `Document.prototype` for `document`) and
	 * delegate to it; if it is not there, leave the property completely alone.
	 */
	function watchHandlerProperty(target, prop) {
		try {
			var nativeProp;
			for (var owner = target; owner && !nativeProp; owner = Object.getPrototypeOf(owner)) {
				nativeProp = Object.getOwnPropertyDescriptor(owner, prop);
			}
			if (!nativeProp || !nativeProp.get || !nativeProp.set) return;
			Object.defineProperty(target, prop, {
				configurable: true,
				enumerable: nativeProp.enumerable,
				get: function () {
					return nativeProp.get.call(this);
				},
				set: function (fn) {
					nativeProp.set.call(this, fn);
					try {
						if (fn) {
							profile.listenerCount++;
							noteHandlerSource(fn);
							scheduleReport();
						}
					} catch (e) {
						/* ignore */
					}
				}
			});
		} catch (e) {
			/* leave the real accessor in place */
		}
	}

	function collectDeclared() {
		var scripts;
		try {
			scripts = document.getElementsByTagName('script');
		} catch (e) {
			return;
		}
		for (var i = 0; i < scripts.length; i++) {
			var text = scripts[i].textContent || '';
			if (!text || text.length > 200000) continue;
			var m = text.match(/"controls"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
			if (m) {
				var prose = m[1].replace(/\\n/g, ' ').replace(/\\u003c[^\\]*?\\u003e/g, ' ').replace(/<[^>]*>/g, ' ');
				scanProse(prose, profile.declared);
			}
			scanCodes(text, profile.inferred);
		}
	}

	function currentCodes(bag) {
		var out = [];
		for (var k in bag) if (bag[k]) out.push(k);
		out.sort();
		return out;
	}

	/*
	 * Ad and analytics frames run this file too. A game needs somewhere to draw, so a
	 * frame with no meaningful box is never a game frame and must not be reported —
	 * otherwise a 1x1 tracking pixel that happens to bind a keypress handler would tell
	 * the console the game reads the keyboard.
	 */
	/*
	 * A video-ad SDK is the awkward case: `imasdk.googleapis.com` mounts a full-size frame
	 * and binds a keydown handler, so size alone let it through and it told the console
	 * "this game reads the keyboard" on a title that does not. Ad and measurement hosts
	 * are a short, stable list, and none of them is ever the game.
	 */
	var AD_HOST =
		/(^|\.)(doubleclick\.net|googlesyndication\.com|googletagservices\.com|googleapis\.com|amazon-adsystem\.com|criteo\.com|pubmatic\.com|rubiconproject\.com|casalemedia\.com|adsrvr\.org|33across\.com|sharethrough\.com|media\.net|openx\.net|adnxs\.com|privacymanager\.io|crwdcntrl\.net|creativecdn\.com|fastclick\.net|rlcdn\.com|nexx360\.io|dotomi\.com|sentry\.io|moatads\.com|adsafeprotected\.com)$/;
	var AD_HOST_HINT = /(^|[.-])(ads?|adserver|adservice|adtech|prebid|beacon|analytics)([.-]|$)/;

	function isPlausibleGameFrame() {
		var host;
		try {
			host = location.hostname;
		} catch (e) {
			return false;
		}
		if (AD_HOST.test(host) || AD_HOST_HINT.test(host)) return false;
		return window.innerWidth >= 200 && window.innerHeight >= 150;
	}

	var reportTimer = null;
	var reportsSent = 0;
	var lastPayload = '';
	var MAX_REPORTS = 10;

	function sendReport() {
		reportTimer = null;
		if (!isGameFrame || !isPlausibleGameFrame() || reportsSent >= MAX_REPORTS) return;
		for (var i = 0; i < profile.sources.length; i++) scanCodes(profile.sources[i], profile.inferred);
		profile.sources.length = 0;
		var payload = {
			type: 'potato-tomato-key-profile',
			v: 1,
			url: location.href.slice(0, 300),
			listens: profile.listenerCount > 0,
			listenerCount: profile.listenerCount,
			declared: currentCodes(profile.declared),
			inferred: currentCodes(profile.inferred)
		};
		var fingerprint =
			payload.listens + '|' + payload.declared.join(',') + '|' + payload.inferred.join(',');
		if (fingerprint === lastPayload) return;
		lastPayload = fingerprint;
		reportsSent++;
		try {
			window.top.postMessage(payload, '*');
		} catch (e) {
			/* top gone or blocked — the console keeps its default layout */
		}
	}

	function scheduleReport() {
		if (reportTimer || reportsSent >= MAX_REPORTS) return;
		reportTimer = setTimeout(sendReport, 700);
	}

	if (isGameFrame) {
		watchHandlerProperty(window, 'onkeydown');
		watchHandlerProperty(window, 'onkeyup');
		watchHandlerProperty(document, 'onkeydown');
		watchHandlerProperty(document, 'onkeyup');

		var sweep = function () {
			try {
				collectDeclared();
			} catch (e) {
				/* ignore */
			}
			scheduleReport();
		};
		if (document.readyState === 'loading') {
			document.addEventListener('DOMContentLoaded', sweep);
		} else {
			sweep();
		}
		/* Engines bind their handlers well after load — Unity only once wasm is up. */
		setTimeout(sweep, 2500);
		setTimeout(sweep, 8000);
	}
})();
