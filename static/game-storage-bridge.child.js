/**
 * In-game iframe bridge: virtual per-game storage, live key detection, and the
 * console's input / pause / audio channel. Runs at the very top of <head>, before
 * any game script, so everything below is in place before the game reads it.
 *
 * Storage model ("virtual storage")
 * ---------------------------------
 * Games used to write straight into the app origin's real localStorage and cookies.
 * Every same-origin game shared one bucket (and could `localStorage.clear()` the app's
 * own settings), and the saved profile only reached the game after an async round
 * trip — long after its boot code had already read an empty store.
 *
 * Now each game gets its own localStorage, sessionStorage and cookie jar, keyed by
 * catalog id. They are ready synchronously at boot:
 *
 *   1. a same-origin parent exposes the preloaded profile on `top.__ptGameProfiles`;
 *   2. otherwise the last copy this origin cached is used (namespaced real storage);
 *   3. otherwise the profile is pulled over postMessage, and if it brings saves the
 *      game booted without, the frame reloads once so the game sees them.
 *
 * IndexedDB stays real (it is already per origin and per database name). Its records
 * are mirrored into the profile with a typed encoding so Uint8Array / Date / ArrayBuffer
 * values — what Unity's IDBFS stores — survive the round trip, and saved records are
 * restored with add-if-absent so a stale profile can never overwrite newer real data.
 */
(function () {
	var TYPE = 'potato-tomato-game-storage';
	var SCHEMA_VERSION = 1;
	var TS_KEY = '__pt_ts';
	var BOOT_AT = Date.now();
	/* A late profile may reload the frame only while the game is still starting up. */
	var RELOAD_WINDOW_MS = 20000;
	/* App-owned keys that older builds snapshotted into game profiles along with the game's. */
	var APP_KEY = /^(potato-?tomato|pt-|scn-|mode-watcher|__pt)/;

	function hasOwn(o, k) {
		return Object.prototype.hasOwnProperty.call(o, k);
	}

	function detectGameId() {
		try {
			if (typeof window.__ptGameId === 'string' && window.__ptGameId) return window.__ptGameId;
			var cs = document.currentScript;
			var attr = cs && cs.getAttribute && cs.getAttribute('data-pt-game');
			if (attr) return attr;
		} catch (e) {
			/* ignore */
		}
		var path = location.pathname;
		var patterns = [
			/\/puller-games\/([^/]+)\//,
			/\/browser-offline\/([^/]+)\//,
			/\/games\/([^/]+)\/(?:offline|online)\//,
			/\/api\/(?:unity-play|game-live)\/([^/]+)/
		];
		for (var i = 0; i < patterns.length; i++) {
			var match = path.match(patterns[i]);
			if (match) return decodeURIComponent(match[1]);
		}
		return '';
	}

	var gameId = detectGameId();
	var isGameFrame = Boolean(gameId) && window.top !== window;
	var nativeAdd = EventTarget.prototype.addEventListener;

	/* Storage messages go to the app, which is the top frame even for nested game shells. */
	function appWindow() {
		try {
			return window.top || window.parent;
		} catch (e) {
			return window.parent;
		}
	}

	/* ======================================================================
	 * Live key detection (web / desktop)
	 *
	 * Android installs native_touch_bridge.js into every frame and reports from there;
	 * everywhere else this is the only reporter. Same protocol, same evidence tiers:
	 *   declared  the game's own controls text          (strong)
	 *   used      keys the game visibly handled — it called preventDefault on a real
	 *             or console key event                   (strong, observed live)
	 *   inferred  literals in key handler / script text  (weak)
	 * Installed before the focus spoof below so handlers registered through its
	 * window/document wrappers still pass through this one.
	 * ==================================================================== */
	var keyTargets = [];
	var keyDetect = (function () {
		if (!isGameFrame || window.__ptNativeBridge || window.__ptKeyDetectInstalled) return null;
		window.__ptKeyDetectInstalled = true;

		var EMITTABLE = {
			ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1,
			Space: 1, Enter: 1, Escape: 1, ShiftLeft: 1, ControlLeft: 1,
			KeyA: 1, KeyB: 1, KeyC: 1, KeyD: 1, KeyE: 1, KeyF: 1, KeyG: 1, KeyH: 1, KeyI: 1,
			KeyJ: 1, KeyK: 1, KeyL: 1, KeyM: 1, KeyN: 1, KeyO: 1, KeyP: 1, KeyQ: 1, KeyR: 1,
			KeyS: 1, KeyT: 1, KeyU: 1, KeyV: 1, KeyW: 1, KeyX: 1, KeyY: 1, KeyZ: 1,
			Digit0: 1, Digit1: 1, Digit2: 1, Digit3: 1, Digit4: 1,
			Digit5: 1, Digit6: 1, Digit7: 1, Digit8: 1, Digit9: 1
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
			var alias = {
				Spacebar: 'Space', Esc: 'Escape', Up: 'ArrowUp', Down: 'ArrowDown',
				Left: 'ArrowLeft', Right: 'ArrowRight', Shift: 'ShiftLeft', Control: 'ControlLeft'
			};
			if (alias[k]) return alias[k];
			return EMITTABLE[k] ? k : null;
		}
		/* A literal near a modifier test is an app shortcut (Ctrl+S), not a game key. */
		var MODIFIER_NEAR = /ctrlKey|metaKey|altKey|getModifierState/;
		function isShortcutContext(text, index) {
			var from = Math.max(0, index - 72);
			return MODIFIER_NEAR.test(text.slice(from, index + 72));
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
				if (byNum && !isShortcutContext(text, m.index)) into[byNum] = 1;
			}
			re = /\.key\s*(?:={2,3})\s*["'`]([^"'`]{1,12})["'`]/g;
			while ((m = re.exec(text))) {
				var byName = codeFromKeyName(m[1]);
				if (byName && !isShortcutContext(text, m.index)) into[byName] = 1;
			}
		}
		function scanProse(text, into) {
			if (!text) return;
			var raw = String(text);
			var t = raw.toLowerCase();
			function add(list) {
				for (var i = 0; i < list.length; i++) if (EMITTABLE[list[i]]) into[list[i]] = 1;
			}
			if (/\bwasd\b/.test(t)) add(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
			if (/arrow\s*keys?|\barrows\b|[←↑→↓]/.test(t)) {
				add(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
			}
			if (/\bspace\s*bar\b|\bspace\b/.test(t)) add(['Space']);
			if (/\benter\b|\breturn key\b/.test(t)) add(['Enter']);
			if (/\besc(ape)?\b/.test(t)) add(['Escape']);
			if (/\bshift\b/.test(t)) add(['ShiftLeft']);
			if (/\bctrl\b|\bcontrol key\b/.test(t)) add(['ControlLeft']);
			var re =
				/(?:\b[Pp]ress\s+|\b[Hh]old\s+|\b[Tt]ap\s+)([A-Za-z0-9])\b|\b([A-Z])\b\s*(?:[Kk]ey\b|[=:–—-]\s*\w)|\b([0-9])\b\s*=\s*\w/g;
			var m;
			while ((m = re.exec(raw))) {
				var ch = m[1] || m[2] || m[3];
				if (!ch || ch === 'a') continue;
				var code = ch >= '0' && ch <= '9' ? 'Digit' + ch : 'Key' + ch.toUpperCase();
				if (EMITTABLE[code]) into[code] = 1;
			}
		}

		var profile = {
			listenerCount: 0,
			sources: [],
			sourceBytes: 0,
			declared: {},
			inferred: {},
			used: {},
			/* Keys the game handled only with Ctrl / Alt / Meta held: shortcuts, not play. */
			shortcuts: {},
			/* The player typed into a text field — letters there are typing. */
			textEntry: false,
			/* The game's own controls text, forwarded for the app to read purposes from. */
			controlsText: ''
		};

		function isEditable(el) {
			if (!el || el.nodeType !== 1) return false;
			if (el.isContentEditable) return true;
			var tag = el.tagName;
			if (tag === 'TEXTAREA') return true;
			if (tag !== 'INPUT') return false;
			var type = (el.getAttribute('type') || 'text').toLowerCase();
			return /^(text|search|email|password|number|tel|url)$/.test(type);
		}

		var CONTROLS_HINT = /\b(arrow|wasd|space\s*bar|spacebar|press|keys?|controls?)\b/i;
		function noteControlsText(text) {
			if (!text) return;
			var t = String(text)
				.replace(/[ \t\f\v\r]+/g, ' ')
				.replace(/\n\s*/g, '\n')
				.trim();
			if (!t || !CONTROLS_HINT.test(t) || profile.controlsText.indexOf(t.slice(0, 80)) !== -1) return;
			var next = (profile.controlsText ? profile.controlsText + '\n' : '') + t.slice(0, 1200);
			profile.controlsText = next.slice(0, 3000);
		}
		function noteHandlerSource(fn) {
			if (profile.sources.length >= 60 || profile.sourceBytes >= 400000) return;
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

		var KEY_EVENT = { keydown: 1, keyup: 1, keypress: 1 };
		try {
			EventTarget.prototype.addEventListener = function (type, fn, opts) {
				if (KEY_EVENT[type] && fn) {
					try {
						profile.listenerCount++;
						noteHandlerSource(fn);
						/* Remember element-level key listeners: the console dispatches there. */
						if (
							this &&
							this.nodeType === 1 &&
							/^(CANVAS|DIV)$/.test(this.tagName) &&
							keyTargets.indexOf(this) === -1 &&
							keyTargets.length < 8
						) {
							keyTargets.push(this);
						}
						scheduleReport();
					} catch (e) {
						/* detection must never break the page it watches */
					}
				}
				return nativeAdd.call(this, type, fn, opts);
			};
			EventTarget.prototype.addEventListener.toString = function () {
				return 'function addEventListener() { [native code] }';
			};
		} catch (e) {
			/* frozen prototype — the other two sources still work */
		}

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
							/* observation must never cost the assignment */
						}
					}
				});
			} catch (e) {
				/* leave the real accessor in place */
			}
		}

		function collectDeclared() {
			var scripts = document.getElementsByTagName('script');
			for (var i = 0; i < scripts.length; i++) {
				var text = scripts[i].textContent || '';
				if (!text || text.length > 200000) continue;
				var m = text.match(/"controls"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
				if (m) {
					var prose = m[1]
						.replace(/\\n/g, ' ')
						.replace(/\\u003c[^\\]*?\\u003e/g, ' ')
						.replace(/<[^>]*>/g, ' ');
					scanProse(prose, profile.declared);
					/* Keep the markup's line breaks: the app reads "heading / list item" structure. */
					noteControlsText(
						m[1]
							.replace(/\\n/g, '\n')
							.replace(/\\u003c/gi, '<')
							.replace(/\\u003e/gi, '>')
							.replace(/<\s*(br|\/p|\/li|\/h\d|\/div)\b[^>]*>/gi, '\n')
							.replace(/<[^>]*>/g, ' ')
					);
				}
				/*
				 * Not scanned for key literals: inline script text is mostly data and prose
				 * (a JSON controls blurb says "Space" too). Only functions the game actually
				 * registers as key handlers count as code evidence.
				 */
			}
			/*
			 * Controls panels shipped in the page itself ("How to play", "#controls") and the
			 * page description. Only text that talks about keys is kept; the app decides what
			 * each key does.
			 */
			try {
				var panels = document.querySelectorAll(
					'[id*="control" i], [class*="control" i], [id*="instruction" i], [class*="instruction" i], [id*="how-to" i], [class*="how-to" i], [id*="howto" i], [class*="howto" i]'
				);
				for (var p = 0; p < panels.length && p < 12; p++) {
					var el = panels[p];
					if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') continue;
					var txt = el.innerText || el.textContent || '';
					if (txt.length > 0 && txt.length < 1500) noteControlsText(txt);
				}
				var meta = document.querySelector('meta[name="description"], meta[property="og:description"]');
				if (meta) noteControlsText(meta.getAttribute('content'));
			} catch (e) {
				/* detection must never break the page */
			}
		}

		function list(bag) {
			var out = [];
			for (var k in bag) if (bag[k]) out.push(k);
			out.sort();
			return out;
		}

		var AD_HOST =
			/(^|\.)(doubleclick\.net|googlesyndication\.com|googletagservices\.com|googleapis\.com|amazon-adsystem\.com|criteo\.com|pubmatic\.com|adnxs\.com|moatads\.com|sentry\.io)$/;
		function isPlausibleGameFrame() {
			try {
				if (AD_HOST.test(location.hostname)) return false;
			} catch (e) {
				return false;
			}
			return window.innerWidth >= 200 && window.innerHeight >= 150;
		}

		/* ------------------------------------------------------------------
		 * Engine bindings — the reliable source.
		 *
		 * Text says what a page *claims*; handler source says what a function *mentions*.
		 * Neither is what the game binds. Engines that register keys through an API tell us
		 * exactly, at runtime, so the bridge listens to those APIs as the game calls them:
		 *
		 *   Phaser 3      KeyboardPlugin.addKey / addKeys / createCursorKeys / on('keydown-X')
		 *   Phaser 2 / CE Keyboard.addKey / addKeys / isDown / createCursorKeys / addKeyCapture
		 *   PlayCanvas    Keyboard.isPressed / wasPressed / wasReleased (polled every frame)
		 *   GDevelop      gdjs.evtTools.input.isKeyPressed / wasKeyReleased / …
		 *   Kaboom/Kaplay onKeyPress / onKeyDown / isKeyDown / … (global or context)
		 *   Scratch       the project's own "when key pressed" / "key pressed?" blocks
		 *
		 * Engines are found as they load — a setter on the global the engine assigns — so
		 * keys registered during boot are caught too. Unity keeps its input map inside wasm
		 * and exposes nothing; for Unity only live use (below) is reliable.
		 * ------------------------------------------------------------------ */
		profile.bound = {};
		profile.boundPurpose = {};
		profile.engine = '';

		var NAMED = {
			SPACE: 'Space', SPACEBAR: 'Space', ENTER: 'Enter', RETURN: 'Enter',
			ESC: 'Escape', ESCAPE: 'Escape', SHIFT: 'ShiftLeft', LSHIFT: 'ShiftLeft',
			SHIFTLEFT: 'ShiftLeft', CTRL: 'ControlLeft', CONTROL: 'ControlLeft', LCONTROL: 'ControlLeft',
			LCTRL: 'ControlLeft', CONTROLLEFT: 'ControlLeft', UP: 'ArrowUp', DOWN: 'ArrowDown',
			LEFT: 'ArrowLeft', RIGHT: 'ArrowRight', ARROWUP: 'ArrowUp', ARROWDOWN: 'ArrowDown',
			ARROWLEFT: 'ArrowLeft', ARROWRIGHT: 'ArrowRight', UPARROW: 'ArrowUp', DOWNARROW: 'ArrowDown',
			LEFTARROW: 'ArrowLeft', RIGHTARROW: 'ArrowRight', ZERO: 'Digit0', ONE: 'Digit1', TWO: 'Digit2',
			THREE: 'Digit3', FOUR: 'Digit4', FIVE: 'Digit5', SIX: 'Digit6', SEVEN: 'Digit7',
			EIGHT: 'Digit8', NINE: 'Digit9'
		};

		/** Engine key name / number / Key object → KeyboardEvent.code, or null. */
		function engineKeyCode(k, keyCodes) {
			if (k == null) return null;
			if (typeof k === 'number') return codeFromLegacyKeyCode(k);
			if (typeof k === 'object') {
				if (typeof k.keyCode === 'number') return codeFromLegacyKeyCode(k.keyCode);
				return null;
			}
			var s = String(k).trim();
			if (!s) return null;
			if (EMITTABLE[s]) return s;
			var up = s.toUpperCase().replace(/[\s_-]+/g, '');
			if (NAMED[up]) return NAMED[up];
			/* GDevelop: "Num0".."Num9"; Scratch: "left arrow" (collapsed above). */
			var num = /^NUM(?:PAD)?([0-9])$/.exec(up);
			if (num) return 'Digit' + num[1];
			if (keyCodes && typeof keyCodes[up] === 'number') return codeFromLegacyKeyCode(keyCodes[up]);
			if (s.length === 1) return codeFromKeyName(s);
			return null;
		}

		/* "moveLeft" → "Move left", "jump" → "Jump". */
		function humanize(name) {
			var s = String(name)
				.replace(/([a-z])([A-Z])/g, '$1 $2')
				.replace(/[_-]+/g, ' ')
				.trim()
				.toLowerCase();
			return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
		}

		function noteBound(code, purpose) {
			if (!code || !EMITTABLE[code]) return;
			var fresh = !profile.bound[code];
			var named = purpose && !profile.boundPurpose[code];
			if (!fresh && !named) return;
			profile.bound[code] = 1;
			if (named) profile.boundPurpose[code] = String(purpose).slice(0, 28);
			scheduleReport();
		}

		function noteKeyList(keys, keyCodes) {
			if (keys == null) return;
			if (typeof keys === 'string') {
				var parts = keys.split(',');
				for (var i = 0; i < parts.length; i++) noteBound(engineKeyCode(parts[i], keyCodes));
				return;
			}
			if (Array.isArray(keys)) {
				for (var j = 0; j < keys.length; j++) noteBound(engineKeyCode(keys[j], keyCodes));
				return;
			}
			if (typeof keys === 'object') {
				/* { jump: 'SPACE', left: 'A' } — the property names say what each key does. */
				for (var name in keys) {
					if (hasOwn(keys, name)) noteBound(engineKeyCode(keys[name], keyCodes), humanize(name));
				}
				return;
			}
			noteBound(engineKeyCode(keys, keyCodes));
		}

		/** Call `observe(args)` before every call of `obj[name]`; never throws into the game. */
		function tap(obj, name, observe) {
			try {
				var orig = obj && obj[name];
				if (typeof orig !== 'function' || orig.__ptTapped) return;
				var wrapped = function () {
					try {
						observe(arguments, this);
					} catch (e) {
						/* observation must never cost the call */
					}
					return orig.apply(this, arguments);
				};
				wrapped.__ptTapped = true;
				try {
					wrapped.toString = function () {
						return Function.prototype.toString.call(orig);
					};
				} catch (e) {
					/* ignore */
				}
				obj[name] = wrapped;
			} catch (e) {
				/* frozen object — leave it */
			}
		}

		var CURSORS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft'];

		function hookPhaser(P) {
			if (!P || typeof P !== 'object' && typeof P !== 'function') return;
			var K3 = P.Input && P.Input.Keyboard;
			if (K3 && K3.KeyboardPlugin && K3.KeyboardPlugin.prototype) {
				var proto3 = K3.KeyboardPlugin.prototype;
				var codes3 = K3.KeyCodes;
				profile.engine = 'phaser3';
				tap(proto3, 'addKey', function (a) {
					noteKeyList(a[0], codes3);
				});
				tap(proto3, 'addKeys', function (a) {
					noteKeyList(a[0], codes3);
				});
				tap(proto3, 'createCursorKeys', function () {
					for (var i = 0; i < CURSORS.length; i++) noteBound(CURSORS[i]);
				});
				tap(proto3, 'checkDown', function (a) {
					noteKeyList(a[0], codes3);
				});
				var onKey = function (a) {
					var m = /^key(?:down|up)-(\w+)$/i.exec(String(a[0] || ''));
					if (m) noteBound(engineKeyCode(m[1], codes3));
				};
				tap(proto3, 'on', onKey);
				tap(proto3, 'once', onKey);
				tap(proto3, 'addListener', onKey);
			}
			var K2 = P.Keyboard;
			if (K2 && K2.prototype && typeof K2.prototype.addKey === 'function') {
				var proto2 = K2.prototype;
				profile.engine = profile.engine || 'phaser2';
				tap(proto2, 'addKey', function (a) {
					noteKeyList(a[0], K2);
				});
				tap(proto2, 'addKeys', function (a) {
					noteKeyList(a[0], K2);
				});
				tap(proto2, 'isDown', function (a) {
					noteKeyList(a[0], K2);
				});
				tap(proto2, 'createCursorKeys', function () {
					for (var i = 0; i < 4; i++) noteBound(CURSORS[i]);
				});
				tap(proto2, 'addKeyCapture', function (a) {
					noteKeyList(a[0], K2);
				});
			}
		}

		function hookPlayCanvas(pc) {
			var proto = pc && pc.Keyboard && pc.Keyboard.prototype;
			if (!proto) return;
			profile.engine = 'playcanvas';
			var observe = function (a) {
				if (typeof a[0] === 'number' && !profile.bound[codeFromLegacyKeyCode(a[0])]) {
					noteBound(codeFromLegacyKeyCode(a[0]));
				}
			};
			tap(proto, 'isPressed', observe);
			tap(proto, 'wasPressed', observe);
			tap(proto, 'wasReleased', observe);
		}

		function hookGDevelop(gdjs) {
			var input = gdjs && gdjs.evtTools && gdjs.evtTools.input;
			if (!input) return;
			profile.engine = 'gdevelop';
			var observe = function (a) {
				noteBound(engineKeyCode(a[1]));
			};
			var names = ['isKeyPressed', 'wasKeyReleased', 'wasKeyJustPressed'];
			for (var i = 0; i < names.length; i++) tap(input, names[i], observe);
		}

		var KABOOM_FNS = [
			'onKeyPress', 'onKeyDown', 'onKeyRelease', 'onKeyPressRepeat',
			'isKeyDown', 'isKeyPressed', 'isKeyReleased', 'isKeyPressedRepeat',
			'keyPress', 'keyDown', 'keyRelease'
		];
		function kaboomObserve(a) {
			if (typeof a[0] === 'function') return; /* any key */
			noteKeyList(a[0]);
		}
		function hookKaboomContext(ctx) {
			if (!ctx || typeof ctx !== 'object') return;
			profile.engine = profile.engine || 'kaboom';
			for (var i = 0; i < KABOOM_FNS.length; i++) tap(ctx, KABOOM_FNS[i], kaboomObserve);
		}

		/* Scratch has no API to hook, but its project is data: read the key blocks. */
		function scanScratch() {
			var vm = null;
			try {
				vm = (window.scaffolding && window.scaffolding.vm) || window.vm || null;
			} catch (e) {
				return;
			}
			var targets = vm && vm.runtime && vm.runtime.targets;
			if (!targets || !targets.length) return;
			profile.engine = 'scratch';
			for (var t = 0; t < targets.length; t++) {
				var blocks = targets[t] && targets[t].blocks && targets[t].blocks._blocks;
				if (!blocks) continue;
				for (var id in blocks) {
					var b = blocks[id];
					if (!b || (b.opcode !== 'event_whenkeypressed' && b.opcode !== 'sensing_keyoptions')) continue;
					var f = b.fields && b.fields.KEY_OPTION;
					var v = f && f.value;
					if (v && v !== 'any') noteBound(engineKeyCode(v));
				}
			}
		}

		function scanEngines() {
			try {
				if (window.Phaser) hookPhaser(window.Phaser);
				if (window.pc) hookPlayCanvas(window.pc);
				if (window.gdjs) hookGDevelop(window.gdjs);
				for (var i = 0; i < KABOOM_FNS.length; i++) {
					if (typeof window[KABOOM_FNS[i]] === 'function') tap(window, KABOOM_FNS[i], kaboomObserve);
				}
				scanScratch();
			} catch (e) {
				/* ignore */
			}
		}

		/*
		 * Catch engines the moment their global is assigned, before the game's boot code
		 * registers its keys. A classic-script `var Phaser` or UMD `root.Phaser = …` goes
		 * through the setter; engines kept in module scope are found by the sweeps instead.
		 */
		function trapGlobal(name, onSet) {
			try {
				var existing = Object.getOwnPropertyDescriptor(window, name);
				if (existing && !existing.configurable) return;
				if (existing && 'value' in existing) {
					onSet(existing.value);
					return;
				}
				var value;
				Object.defineProperty(window, name, {
					configurable: true,
					enumerable: true,
					get: function () {
						return value;
					},
					set: function (v) {
						value = v;
						try {
							onSet(v);
						} catch (e) {
							/* ignore */
						}
					}
				});
			} catch (e) {
				/* ignore */
			}
		}
		trapGlobal('Phaser', hookPhaser);
		trapGlobal('pc', hookPlayCanvas);
		trapGlobal('gdjs', hookGDevelop);
		['kaboom', 'kaplay'].forEach(function (name) {
			trapGlobal(name, function (factory) {
				if (typeof factory !== 'function' || factory.__ptTapped) return;
				var wrapped = function () {
					var ctx = factory.apply(this, arguments);
					hookKaboomContext(ctx);
					return ctx;
				};
				wrapped.__ptTapped = true;
				Object.defineProperty(window, name, {
					configurable: true,
					enumerable: true,
					writable: true,
					value: wrapped
				});
			});
		});
		for (var kf = 0; kf < KABOOM_FNS.length; kf++) {
			(function (fn) {
				trapGlobal(fn, function (v) {
					if (typeof v !== 'function' || v.__ptTapped) return;
					/* Replace the stored value with a tapped one, then drop the trap. */
					var holder = {};
					holder[fn] = v;
					tap(holder, fn, kaboomObserve);
					Object.defineProperty(window, fn, {
						configurable: true,
						enumerable: true,
						writable: true,
						value: holder[fn]
					});
				});
			})(KABOOM_FNS[kf]);
		}

		var reportTimer = null;
		var reportsSent = 0;
		var lastFingerprint = '';
		/* "used" keeps arriving as the player plays, so the budget is wider than Android's. */
		var MAX_REPORTS = 40;

		function sendReport() {
			reportTimer = null;
			if (!isPlausibleGameFrame() || reportsSent >= MAX_REPORTS) return;
			for (var i = 0; i < profile.sources.length; i++) scanCodes(profile.sources[i], profile.inferred);
			profile.sources.length = 0;
			var payload = {
				type: 'potato-tomato-key-profile',
				v: 1,
				url: location.href.slice(0, 300),
				listens: profile.listenerCount > 0,
				listenerCount: profile.listenerCount,
				declared: list(profile.declared),
				inferred: list(profile.inferred),
				used: list(profile.used),
				shortcuts: list(profile.shortcuts),
				bound: list(profile.bound),
				boundPurposes: profile.boundPurpose,
				engine: profile.engine,
				textEntry: profile.textEntry,
				controlsText: profile.controlsText
			};
			var fp =
				payload.listens +
				'|' +
				payload.declared.join(',') +
				'|' +
				payload.inferred.join(',') +
				'|' +
				payload.used.join(',') +
				'|' +
				payload.shortcuts.join(',') +
				'|' +
				payload.textEntry +
				'|' +
				payload.controlsText.length +
				'|' +
				payload.bound.join(',') +
				'|' +
				Object.keys(payload.boundPurposes).length;
			if (fp === lastFingerprint) return;
			lastFingerprint = fp;
			reportsSent++;
			try {
				appWindow().postMessage(payload, '*');
			} catch (e) {
				/* console keeps its configured layout */
			}
		}
		function scheduleReport() {
			if (reportTimer || reportsSent >= MAX_REPORTS) return;
			reportTimer = setTimeout(sendReport, 500);
		}

		/*
		 * The live signal: a game that calls preventDefault on a key is using it. Checked
		 * after dispatch finishes (setTimeout), so every game handler has had its turn.
		 */
		nativeAdd.call(
			window,
			'keydown',
			function (ev) {
				var code = ev && ev.code;
				if (!code || !EMITTABLE[code]) return;
				/* Typing into a text box is text entry, not a control the game binds. */
				if (isEditable(ev.target)) {
					if (!profile.textEntry) {
						profile.textEntry = true;
						scheduleReport();
					}
					return;
				}
				var modified = ev.ctrlKey || ev.metaKey || ev.altKey;
				var bag = modified ? profile.shortcuts : profile.used;
				if (bag[code]) return;
				setTimeout(function () {
					if (!ev.defaultPrevented || bag[code]) return;
					bag[code] = 1;
					scheduleReport();
				}, 0);
			},
			true
		);

		/* A text box the player focuses means some keys are for typing. */
		nativeAdd.call(
			document,
			'focusin',
			function (ev) {
				if (profile.textEntry || !isEditable(ev.target)) return;
				var el = ev.target;
				if (!el.offsetWidth && !el.offsetHeight) return;
				profile.textEntry = true;
				scheduleReport();
			},
			true
		);

		watchHandlerProperty(window, 'onkeydown');
		watchHandlerProperty(window, 'onkeyup');
		watchHandlerProperty(document, 'onkeydown');
		watchHandlerProperty(document, 'onkeyup');

		function sweep() {
			scanEngines();
			try {
				collectDeclared();
			} catch (e) {
				/* ignore */
			}
			scheduleReport();
		}
		if (document.readyState === 'loading') {
			nativeAdd.call(document, 'DOMContentLoaded', sweep);
		} else {
			sweep();
		}
		setTimeout(sweep, 1000);
		setTimeout(sweep, 2500);
		setTimeout(sweep, 8000);
		/* Scratch projects and late-registered engine keys keep arriving; keep looking a while. */
		setTimeout(sweep, 15000);
		return { profile: profile };
	})();

	/*
	 * Focus spoof: stop blur/visibility from auto-pausing the game. The app's Pause
	 * control is the only pause channel. Spoofs hasFocus in this iframe realm only.
	 */
	(function patchFocusSpoof() {
		if (window.__ptFocusSpoofInstalled) return;
		window.__ptFocusSpoofInstalled = true;
		try {
			Object.defineProperty(Document.prototype, 'hidden', {
				configurable: true,
				get: function () {
					return false;
				}
			});
			Object.defineProperty(Document.prototype, 'visibilityState', {
				configurable: true,
				get: function () {
					return 'visible';
				}
			});
			Document.prototype.hasFocus = function () {
				return true;
			};
		} catch (e) {
			/* ignore */
		}
		function swallow(ev) {
			try {
				ev.stopImmediatePropagation();
				ev.stopPropagation();
				ev.preventDefault();
			} catch (e2) {
				/* ignore */
			}
		}
		var focusLossEvents = { blur: true, focusout: true, visibilitychange: true };
		['blur', 'focusout', 'visibilitychange'].forEach(function (type) {
			nativeAdd.call(window, type, swallow, true);
			nativeAdd.call(document, type, swallow, true);
		});
		/*
		 * The console lives in the parent document. Tapping it can blur this iframe, and
		 * some games register blur handlers after this bridge loads — block those.
		 */
		function blockFocusLossListeners(target) {
			try {
				var add = target.addEventListener;
				target.addEventListener = function (type, listener, options) {
					if (focusLossEvents[type]) return;
					return add.call(this, type, listener, options);
				};
			} catch (e) {
				/* ignore */
			}
		}
		blockFocusLossListeners(window);
		blockFocusLossListeners(document);
	})();

	/* Generic Emscripten/Unity stdin stubs (bridge may load when inject.js does not). */
	(function patchUnityModuleStdio() {
		if (window.__ptModuleStdioInstalled) return;
		window.__ptModuleStdioInstalled = true;
		function nullIn() {
			return null;
		}
		function noopOut() {}
		try {
			var mod = window.Module || {};
			if (typeof mod.stdin !== 'function') mod.stdin = nullIn;
			if (typeof mod.stdout !== 'function') mod.stdout = noopOut;
			if (typeof mod.stderr !== 'function') mod.stderr = noopOut;
			if (!mod.ENVIRONMENT) mod.ENVIRONMENT = 'WEB';
			window.Module = mod;
		} catch (e) {
			/* ignore */
		}
	})();

	if (!isGameFrame) return;

	/* ======================================================================
	 * Typed value encoding (IndexedDB records)
	 * ==================================================================== */
	var ENC_PREFIX = '__pt2:';

	function bytesToB64(bytes) {
		var out = '';
		for (var i = 0; i < bytes.length; i += 0x8000) {
			out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
		}
		return btoa(out);
	}
	function b64ToBytes(b64) {
		var bin = atob(b64);
		var bytes = new Uint8Array(bin.length);
		for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		return bytes;
	}
	var UNSUPPORTED = {};

	function enc(v, depth) {
		if (depth > 64) throw UNSUPPORTED;
		if (v === undefined) return { __pt: 'u' };
		if (v === null) return null;
		var t = typeof v;
		if (t === 'bigint') return { __pt: 'bi', v: String(v) };
		if (t === 'number') return isFinite(v) ? v : { __pt: 'n', v: String(v) };
		if (t !== 'object') return v;
		if (v instanceof ArrayBuffer) return { __pt: 'ab', b: bytesToB64(new Uint8Array(v)) };
		if (ArrayBuffer.isView(v)) {
			var view = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
			var name = Object.prototype.toString.call(v).slice(8, -1);
			return { __pt: 'ta', t: name, b: bytesToB64(view) };
		}
		if (v instanceof Date) return { __pt: 'd', v: v.getTime() };
		if (typeof Blob !== 'undefined' && v instanceof Blob) throw UNSUPPORTED;
		if (v instanceof Map) {
			var entries = [];
			v.forEach(function (val, key) {
				entries.push([enc(key, depth + 1), enc(val, depth + 1)]);
			});
			return { __pt: 'm', v: entries };
		}
		if (v instanceof Set) {
			var items = [];
			v.forEach(function (val) {
				items.push(enc(val, depth + 1));
			});
			return { __pt: 's', v: items };
		}
		if (v instanceof RegExp) return { __pt: 'r', s: v.source, f: v.flags };
		if (Array.isArray(v)) {
			var arr = new Array(v.length);
			for (var i = 0; i < v.length; i++) arr[i] = enc(v[i], depth + 1);
			return arr;
		}
		var out = {};
		for (var k in v) {
			if (hasOwn(v, k)) out[k] = enc(v[k], depth + 1);
		}
		/* An object that already has a `__pt` field must not be mistaken for a tag. */
		return hasOwn(out, '__pt') ? { __pt: 'o', v: out } : out;
	}

	function dec(v) {
		if (v === null || typeof v !== 'object') return v;
		if (Array.isArray(v)) return v.map(dec);
		switch (v.__pt) {
			case 'u':
				return undefined;
			case 'bi':
				return typeof BigInt === 'function' ? BigInt(v.v) : Number(v.v);
			case 'n':
				return Number(v.v);
			case 'ab':
				return b64ToBytes(v.b).buffer;
			case 'ta': {
				var bytes = b64ToBytes(v.b);
				var Ctor = window[v.t];
				if (v.t === 'DataView') return new DataView(bytes.buffer);
				if (typeof Ctor !== 'function' || !Ctor.BYTES_PER_ELEMENT) return bytes;
				return new Ctor(bytes.buffer, 0, bytes.byteLength / Ctor.BYTES_PER_ELEMENT);
			}
			case 'd':
				return new Date(v.v);
			case 'm': {
				var map = new Map();
				for (var i = 0; i < v.v.length; i++) map.set(dec(v.v[i][0]), dec(v.v[i][1]));
				return map;
			}
			case 's': {
				var set = new Set();
				for (var j = 0; j < v.v.length; j++) set.add(dec(v.v[j]));
				return set;
			}
			case 'r':
				return new RegExp(v.s, v.f);
			case 'o':
				v = v.v;
				break;
			default:
				break;
		}
		var out = {};
		for (var k in v) if (hasOwn(v, k)) out[k] = dec(v[k]);
		return out;
	}

	function encodeStored(value) {
		return ENC_PREFIX + JSON.stringify(enc(value, 0));
	}

	/* Also reads what earlier bridge versions wrote. */
	function decodeStored(str) {
		if (str == null) return null;
		if (str.indexOf(ENC_PREFIX) === 0) return dec(JSON.parse(str.slice(ENC_PREFIX.length)));
		if (str.indexOf('__ab__:') === 0) return b64ToBytes(str.slice(7)).buffer;
		try {
			return JSON.parse(str);
		} catch (e) {
			return str;
		}
	}

	/* ======================================================================
	 * Profile sources
	 * ==================================================================== */
	var origin = location.origin;
	var NS = '__pt_vs:' + gameId + ':';
	var realLS = null;
	var realSS = null;
	try {
		realLS = window.localStorage;
		realLS.getItem('__pt_probe');
	} catch (e) {
		realLS = null;
	}
	try {
		realSS = window.sessionStorage;
		realSS.getItem('__pt_probe');
	} catch (e) {
		realSS = null;
	}

	function readJSON(store, key) {
		if (!store) return null;
		try {
			var raw = store.getItem(key);
			return raw ? JSON.parse(raw) : null;
		} catch (e) {
			return null;
		}
	}
	function writeJSON(store, key, value) {
		if (!store) return;
		try {
			store.setItem(key, JSON.stringify(value));
		} catch (e) {
			/* quota — the parent profile still has it */
		}
	}

	/** The profile the app preloaded, when the top frame is same-origin. undefined = unknown. */
	function readSyncProfile() {
		try {
			var bag = window.top && window.top.__ptGameProfiles;
			if (bag && hasOwn(bag, gameId)) return bag[gameId] || null;
		} catch (e) {
			/* cross-origin top — pull over postMessage instead */
		}
		return undefined;
	}

	function profileDefault(profile) {
		return profile && profile.profile && profile.profile.Default ? profile.profile.Default : null;
	}

	/**
	 * Pick the freshest localStorage bucket. Buckets are per origin (online play and the
	 * puller's offline mirror are different origins); the bridge stamps each with the
	 * time it last changed so the newest save wins wherever it was written.
	 */
	function freshestBucket(def) {
		var buckets = def && def.localStorage;
		if (!buckets || typeof buckets !== 'object') return null;
		var best = null;
		var bestTs = -1;
		for (var o in buckets) {
			if (!hasOwn(buckets, o) || !buckets[o] || typeof buckets[o] !== 'object') continue;
			var ts = Number(buckets[o][TS_KEY]) || 0;
			if (ts > bestTs || (ts === bestTs && o === origin)) {
				best = { origin: o, data: buckets[o], ts: ts };
				bestTs = ts;
			}
		}
		return best;
	}

	function cleanBucket(data, fromLegacy) {
		var out = Object.create(null);
		for (var k in data) {
			if (!hasOwn(data, k) || k === TS_KEY) continue;
			if (fromLegacy && APP_KEY.test(k)) continue;
			out[k] = String(data[k]);
		}
		return out;
	}

	/* ======================================================================
	 * Virtual Storage (localStorage / sessionStorage)
	 * ==================================================================== */
	/*
	 * Only a stored data key counts as "this origin has its own copy". Metadata alone
	 * (a half-cleared store) must not make an empty store look authoritative.
	 */
	var initialized = Boolean(realLS && realLS.getItem(NS + 'ls') !== null);
	var meta = (initialized && readJSON(realLS, NS + 'meta')) || { ts: 0 };
	var dirty = false;
	var pushTimer = null;

	function touch() {
		meta.ts = Date.now();
		dirty = true;
		schedulePersist();
		schedulePush();
	}

	var persistTimer = null;
	var persisters = [];
	function schedulePersist() {
		if (persistTimer) return;
		persistTimer = setTimeout(persistNow, 60);
	}
	function persistNow() {
		if (persistTimer) {
			clearTimeout(persistTimer);
			persistTimer = null;
		}
		var wrote = false;
		for (var i = 0; i < persisters.length; i++) wrote = persisters[i]() || wrote;
		if (wrote) writeJSON(realLS, NS + 'meta', meta);
	}

	function createVirtualStorage(backing, backingKey, onChange) {
		var data = Object.create(null);
		var initial = readJSON(backing, backingKey);
		if (initial) for (var k in initial) if (hasOwn(initial, k)) data[k] = String(initial[k]);
		var changed = false;
		persisters.push(function () {
			if (!changed) return false;
			changed = false;
			writeJSON(backing, backingKey, data);
			return true;
		});
		function mark() {
			changed = true;
			onChange();
		}
		var proto = typeof Storage !== 'undefined' ? Storage.prototype : Object.prototype;
		var api = Object.create(proto);
		var methods = {
			getItem: function (key) {
				key = String(key);
				return key in data ? data[key] : null;
			},
			setItem: function (key, value) {
				key = String(key);
				value = String(value);
				if (data[key] === value) return;
				data[key] = value;
				mark();
			},
			removeItem: function (key) {
				key = String(key);
				if (!(key in data)) return;
				delete data[key];
				mark();
			},
			clear: function () {
				if (!Object.keys(data).length) return;
				data = Object.create(null);
				mark();
			},
			key: function (index) {
				var keys = Object.keys(data);
				index = Number(index) || 0;
				return index >= 0 && index < keys.length ? keys[index] : null;
			}
		};
		for (var m in methods) {
			Object.defineProperty(api, m, { value: methods[m], writable: true, configurable: true });
		}
		var proxy = new Proxy(api, {
			get: function (target, prop) {
				if (typeof prop === 'symbol') return target[prop];
				if (prop === 'length') return Object.keys(data).length;
				if (hasOwn(methods, prop)) return methods[prop];
				if (prop in data) return data[prop];
				if (prop in target) {
					var v = target[prop];
					return typeof v === 'function' ? v : undefined;
				}
				return undefined;
			},
			set: function (target, prop, value) {
				if (typeof prop === 'symbol' || hasOwn(methods, prop) || prop === 'length') return true;
				methods.setItem(prop, value);
				return true;
			},
			has: function (target, prop) {
				return typeof prop === 'string' && (prop in data || hasOwn(methods, prop));
			},
			deleteProperty: function (target, prop) {
				if (typeof prop === 'string') methods.removeItem(prop);
				return true;
			},
			ownKeys: function () {
				return Object.keys(data);
			},
			getOwnPropertyDescriptor: function (target, prop) {
				if (typeof prop === 'string' && prop in data) {
					return { value: data[prop], writable: true, enumerable: true, configurable: true };
				}
				return undefined;
			},
			defineProperty: function (target, prop, desc) {
				if (typeof prop === 'string' && desc && 'value' in desc) methods.setItem(prop, desc.value);
				return true;
			}
		});
		return {
			proxy: proxy,
			snapshot: function () {
				var out = {};
				for (var k in data) out[k] = data[k];
				return out;
			},
			replace: function (next) {
				data = Object.create(null);
				for (var k in next) data[k] = next[k];
				changed = true;
			},
			isEmpty: function () {
				return Object.keys(data).length === 0;
			},
			equals: function (other) {
				var a = Object.keys(data);
				var b = Object.keys(other);
				if (a.length !== b.length) return false;
				for (var i = 0; i < a.length; i++) if (other[a[i]] !== data[a[i]]) return false;
				return true;
			}
		};
	}

	/* ======================================================================
	 * Virtual cookie jar
	 * ==================================================================== */
	function createCookieJar(backing, backingKey, onChange) {
		/* name -> { value, expires (ms, 0 = session) } */
		var jar = Object.create(null);
		var initial = readJSON(backing, backingKey);
		if (initial && Array.isArray(initial)) {
			for (var i = 0; i < initial.length; i++) {
				var c = initial[i];
				if (c && typeof c.name === 'string') jar[c.name] = { value: String(c.value), expires: c.expires || 0 };
			}
		}
		var changed = false;
		persisters.push(function () {
			if (!changed) return false;
			changed = false;
			writeJSON(backing, backingKey, list());
			return true;
		});
		function sweepExpired() {
			var now = Date.now();
			for (var n in jar) if (jar[n].expires && jar[n].expires <= now) delete jar[n];
		}
		function list() {
			sweepExpired();
			var out = [];
			for (var n in jar) out.push({ name: n, value: jar[n].value, path: '/', expires: jar[n].expires || undefined });
			return out;
		}
		function set(str) {
			var parts = String(str).split(';');
			var first = parts.shift() || '';
			var eq = first.indexOf('=');
			var name = (eq === -1 ? '' : first.slice(0, eq)).trim();
			var value = (eq === -1 ? first : first.slice(eq + 1)).trim();
			var expires = 0;
			for (var i = 0; i < parts.length; i++) {
				var p = parts[i].trim();
				var peq = p.indexOf('=');
				var attr = (peq === -1 ? p : p.slice(0, peq)).trim().toLowerCase();
				var av = peq === -1 ? '' : p.slice(peq + 1).trim();
				if (attr === 'max-age') {
					var secs = Number(av);
					if (!isNaN(secs)) expires = secs <= 0 ? -1 : Date.now() + secs * 1000;
				} else if (attr === 'expires' && expires === 0) {
					var at = Date.parse(av);
					if (!isNaN(at)) expires = at <= Date.now() ? -1 : at;
				}
			}
			if (expires === -1) {
				if (name in jar) {
					delete jar[name];
					changed = true;
					onChange();
				}
				return;
			}
			var prev = jar[name];
			if (prev && prev.value === value && prev.expires === expires) return;
			jar[name] = { value: value, expires: expires };
			changed = true;
			onChange();
		}
		function serialize() {
			sweepExpired();
			var out = [];
			for (var n in jar) out.push(n ? n + '=' + jar[n].value : jar[n].value);
			return out.join('; ');
		}
		function replace(cookies) {
			jar = Object.create(null);
			for (var i = 0; i < cookies.length; i++) {
				var c = cookies[i];
				if (!c || typeof c.name !== 'string' || c.httpOnly) continue;
				jar[c.name] = {
					value: String(c.value),
					expires: c.expires && c.expires > 0 ? c.expires : 0
				};
			}
			changed = true;
		}
		return { set: set, serialize: serialize, list: list, replace: replace };
	}

	/* ======================================================================
	 * Install
	 * ==================================================================== */
	var virtual = { installed: false, cookiesInstalled: false, ls: null, ss: null, cookies: null };

	(function installVirtualStorage() {
		var ls = createVirtualStorage(realLS, NS + 'ls', touch);
		var ss = createVirtualStorage(realSS, NS + 'ss', function () {
			dirty = true;
			schedulePersist();
			schedulePush();
		});
		var cookies = createCookieJar(realLS, NS + 'ck', touch);
		try {
			Object.defineProperty(window, 'localStorage', {
				configurable: true,
				enumerable: true,
				get: function () {
					return ls.proxy;
				}
			});
			Object.defineProperty(window, 'sessionStorage', {
				configurable: true,
				enumerable: true,
				get: function () {
					return ss.proxy;
				}
			});
			if (window.localStorage !== ls.proxy) throw new Error('override refused');
			virtual.installed = true;
		} catch (e) {
			virtual.installed = false;
		}
		try {
			Object.defineProperty(document, 'cookie', {
				configurable: true,
				enumerable: true,
				get: function () {
					return cookies.serialize();
				},
				set: function (v) {
					cookies.set(v);
				}
			});
			virtual.cookiesInstalled = true;
		} catch (e) {
			/* real cookies stay in use */
		}
		virtual.ls = ls;
		virtual.ss = ss;
		virtual.cookies = cookies;
	})();

	/**
	 * Apply a saved profile to the virtual stores. Returns true when it changed what the
	 * game can see (so a late arrival knows whether a reload is worth it).
	 */
	function applyProfileStores(profile, force) {
		var def = profileDefault(profile);
		if (!def) return false;
		var bucket = freshestBucket(def);
		var changed = false;
		if (bucket && (force || !initialized || bucket.ts > (meta.ts || 0))) {
			var next = cleanBucket(bucket.data, bucket.ts === 0);
			if (!virtual.ls.equals(next)) {
				virtual.ls.replace(next);
				changed = true;
			}
			if (Array.isArray(def.cookies)) {
				virtual.cookies.replace(def.cookies);
			}
			meta.ts = bucket.ts || Date.now();
			var ssBucket = def.sessionStorage && def.sessionStorage[bucket.origin];
			/* `force` carries a profile across the late-restore reload, past the session the empty boot persisted. */
			if (ssBucket && (force || virtual.ss.isEmpty())) virtual.ss.replace(cleanBucket(ssBucket, bucket.ts === 0));
		} else if (!bucket && !initialized && Array.isArray(def.cookies) && def.cookies.length) {
			virtual.cookies.replace(def.cookies);
			changed = true;
		}
		if (!virtual.installed && changed) {
			/* Browser refused the override: fall back to hydrating the real store in place. */
			var snap = virtual.ls.snapshot();
			for (var k in snap) {
				try {
					realLS && realLS.setItem(k, snap[k]);
				} catch (e) {
					/* quota */
				}
			}
		}
		initialized = true;
		persistNow();
		return changed;
	}

	/* ======================================================================
	 * IndexedDB mirror
	 * ==================================================================== */
	/* Caches, not saves: large, rebuildable, and not worth shipping through postMessage. */
	var SKIP_DB = /^(UnityCache|__pt)/i;
	var MAX_RECORD_CHARS = 8 * 1024 * 1024;
	/* name -> { name, version, objectStores[], records[] } */
	var idbProfile = Object.create(null);
	var idbHydrated = Object.create(null);
	var idbConns = Object.create(null);
	/* Set on the boot after a late-restore reload: the carried profile wins over the database. */
	var restoreOverwrite = false;
	var pendingIdbHydrate = [];

	function ensureDb(name) {
		if (!idbProfile[name]) idbProfile[name] = { name: name, version: 1, objectStores: [], records: [] };
		return idbProfile[name];
	}

	function loadIdbProfile(profile) {
		var def = profileDefault(profile);
		if (!def || !Array.isArray(def.indexedDB)) return;
		for (var i = 0; i < def.indexedDB.length; i++) {
			var db = def.indexedDB[i];
			if (!db || typeof db.name !== 'string' || SKIP_DB.test(db.name)) continue;
			idbProfile[db.name] = {
				name: db.name,
				version: db.version || 1,
				objectStores: (db.objectStores || []).slice(),
				records: Array.isArray(db.records) ? db.records.slice() : []
			};
		}
	}

	function storeNamesOf(conn) {
		var out = [];
		try {
			for (var i = 0; i < conn.objectStoreNames.length; i++) out.push(conn.objectStoreNames[i]);
		} catch (e) {
			/* closed */
		}
		return out;
	}

	var protoTransaction = window.IDBDatabase && IDBDatabase.prototype.transaction;
	var realOpen = null;

	function withConnection(dbName, fn) {
		var conn = idbConns[dbName];
		if (conn) {
			try {
				return fn(conn, false);
			} catch (e) {
				/* closed by the game — reopen below */
			}
		}
		if (!realOpen) return;
		try {
			var req = realOpen(dbName);
			req.onsuccess = function () {
				var c = req.result;
				try {
					fn(c, true);
				} catch (e2) {
					try {
						c.close();
					} catch (e3) {
						/* ignore */
					}
				}
			};
		} catch (e) {
			/* ignore */
		}
	}

	/** Re-read the given stores from the real database into the profile. */
	function snapshotStores(dbName, names) {
		withConnection(dbName, function (conn, ownConn) {
			var all = storeNamesOf(conn);
			var wanted = (names || all).filter(function (n) {
				return all.indexOf(n) !== -1;
			});
			var entry = ensureDb(dbName);
			entry.version = conn.version || entry.version;
			entry.objectStores = all;
			if (!wanted.length) {
				if (ownConn) conn.close();
				return;
			}
			var tx = protoTransaction.call(conn, wanted, 'readonly');
			var fresh = [];
			wanted.forEach(function (storeName) {
				var req = tx.objectStore(storeName).openCursor();
				req.onsuccess = function () {
					var cursor = req.result;
					if (!cursor) return;
					try {
						var value = encodeStored(cursor.value);
						if (value.length <= MAX_RECORD_CHARS) {
							fresh.push({ storeName: storeName, key: encodeStored(cursor.primaryKey), value: value });
						}
					} catch (e) {
						/* Blob or cyclic value — not mirrorable, left to the real database */
					}
					cursor.continue();
				};
			});
			tx.oncomplete = function () {
				entry.records = entry.records
					.filter(function (r) {
						return wanted.indexOf(r.storeName) === -1;
					})
					.concat(fresh);
				if (ownConn) conn.close();
				dirty = true;
				schedulePush();
			};
			tx.onabort = function () {
				if (ownConn) conn.close();
			};
		});
	}

	/*
	 * Games that write every frame would otherwise re-read a store per transaction.
	 * Coalesce: collect touched stores and read them once things go quiet.
	 */
	var snapshotQueue = Object.create(null);
	var snapshotTimer = null;
	function scheduleSnapshot(dbName, stores) {
		var q = snapshotQueue[dbName];
		if (stores === null || q === null) {
			snapshotQueue[dbName] = null;
		} else {
			q = q || {};
			for (var i = 0; i < stores.length; i++) q[stores[i]] = 1;
			snapshotQueue[dbName] = q;
		}
		if (snapshotTimer) return;
		snapshotTimer = setTimeout(runSnapshots, 400);
	}
	function runSnapshots() {
		snapshotTimer = null;
		var queue = snapshotQueue;
		snapshotQueue = Object.create(null);
		for (var name in queue) snapshotStores(name, queue[name] ? Object.keys(queue[name]) : null);
	}

	/**
	 * Restore saved records into the real database.
	 *
	 * Normally add-if-absent: whatever the real database already holds is at least as new
	 * as the profile, so it is never overwritten. The exception is `overwrite`, used only
	 * when the saves arrived after a game that booted with none — anything it wrote in the
	 * meantime is fresh-game defaults, and the frame is about to reload onto the saves.
	 */
	function hydrateConnection(conn, dbName, done, overwrite) {
		var saved = idbProfile[dbName];
		if (!saved || !saved.records.length || idbHydrated[dbName]) return done(0);
		var all = storeNamesOf(conn);
		var byStore = Object.create(null);
		for (var i = 0; i < saved.records.length; i++) {
			var r = saved.records[i];
			if (all.indexOf(r.storeName) === -1) continue;
			(byStore[r.storeName] = byStore[r.storeName] || []).push(r);
		}
		var names = Object.keys(byStore);
		if (!names.length) return done(0);
		idbHydrated[dbName] = true;
		var added = 0;
		var tx;
		try {
			tx = protoTransaction.call(conn, names, 'readwrite');
		} catch (e) {
			return done(0);
		}
		names.forEach(function (storeName) {
			var store = tx.objectStore(storeName);
			var inline = store.keyPath !== null && store.keyPath !== undefined;
			byStore[storeName].forEach(function (rec) {
				var req;
				try {
					var value = decodeStored(rec.value);
					var method = overwrite ? 'put' : 'add';
					req = inline ? store[method](value) : store[method](value, decodeStored(rec.key));
				} catch (e) {
					return;
				}
				req.onsuccess = function () {
					added++;
				};
				req.onerror = function (ev) {
					/* Already present: the real record is newer — keep it, keep the tx alive. */
					ev.preventDefault();
					ev.stopPropagation();
				};
			});
		});
		tx.oncomplete = function () {
			done(added);
		};
		tx.onabort = function () {
			done(added);
		};
	}

	(function installIdbShim() {
		if (!window.indexedDB || !protoTransaction) return;
		realOpen = window.indexedDB.open.bind(window.indexedDB);
		window.indexedDB.open = function (name, version) {
			var req = arguments.length > 1 && version !== undefined ? realOpen(name, version) : realOpen(name);
			var dbName = String(name);
			if (SKIP_DB.test(dbName)) return req;
			/* Registered before the game's own onsuccess, so its first reads see restored data. */
			nativeAdd.call(req, 'success', function () {
				var conn = req.result;
				idbConns[dbName] = conn;
				try {
					nativeAdd.call(conn, 'close', function () {
						if (idbConns[dbName] === conn) delete idbConns[dbName];
					});
				} catch (e) {
					/* ignore */
				}
				/* Queued ahead of the game's own transactions, so this restore is never late. */
				hydrateConnection(
					conn,
					dbName,
					function () {
						scheduleSnapshot(dbName, null);
					},
					restoreOverwrite
				);
			});
			return req;
		};
		IDBDatabase.prototype.transaction = function (names, mode) {
			var tx = protoTransaction.apply(this, arguments);
			if (mode === 'readwrite') {
				var conn = this;
				var dbName = conn.name;
				if (!SKIP_DB.test(dbName)) {
					var stores = [];
					try {
						for (var i = 0; i < tx.objectStoreNames.length; i++) stores.push(tx.objectStoreNames[i]);
					} catch (e) {
						stores = null;
					}
					nativeAdd.call(tx, 'complete', function () {
						scheduleSnapshot(dbName, stores);
					});
				}
			}
			return tx;
		};
	})();

	/* ======================================================================
	 * Parent sync
	 * ==================================================================== */
	var profileSettled = false;

	function snapshotReal(store) {
		var out = {};
		if (!store) return out;
		try {
			for (var i = 0; i < store.length; i++) {
				var k = store.key(i);
				if (k && k.indexOf('__pt_vs:') !== 0 && !APP_KEY.test(k)) out[k] = store.getItem(k);
			}
		} catch (e) {
			/* ignore */
		}
		return out;
	}

	function realCookies() {
		var out = [];
		var parts = (Object.getOwnPropertyDescriptor(Document.prototype, 'cookie').get.call(document) || '').split(';');
		for (var i = 0; i < parts.length; i++) {
			var t = parts[i].trim();
			var eq = t.indexOf('=');
			if (eq > 0) out.push({ name: t.slice(0, eq), value: t.slice(eq + 1), path: '/' });
		}
		return out;
	}

	function buildProfile() {
		var ls = virtual.installed ? virtual.ls.snapshot() : snapshotReal(realLS);
		ls[TS_KEY] = String(meta.ts || Date.now());
		var local = {};
		local[origin] = ls;
		var session = {};
		session[origin] = virtual.installed ? virtual.ss.snapshot() : snapshotReal(realSS);
		var dbs = [];
		for (var name in idbProfile) {
			var db = idbProfile[name];
			dbs.push({
				name: db.name,
				version: db.version,
				objectStores: db.objectStores.slice(),
				records: db.records.slice()
			});
		}
		return {
			schemaVersion: SCHEMA_VERSION,
			updatedAt: Date.now(),
			profile: {
				Default: {
					localStorage: local,
					sessionStorage: session,
					cookies: virtual.cookiesInstalled ? virtual.cookies.list() : realCookies(),
					indexedDB: dbs
				}
			}
		};
	}

	function pushToParent() {
		if (pushTimer) {
			clearTimeout(pushTimer);
			pushTimer = null;
		}
		/*
		 * Never push before the saved profile is known — an empty boot would overwrite it —
		 * nor while reloading onto a late profile, when memory may still hold the defaults.
		 */
		if (!dirty || !profileSettled || reloading || reloadWanted) return;
		dirty = false;
		try {
			appWindow().postMessage(
				{ type: TYPE, action: 'push', gameId: gameId, data: buildProfile() },
				'*'
			);
		} catch (e) {
			dirty = true;
		}
	}

	function schedulePush() {
		if (pushTimer) return;
		pushTimer = setTimeout(pushToParent, 800);
	}

	function flush() {
		persistNow();
		pushToParent();
	}

	/**
	 * A profile that arrives after the game already started only helps if the game
	 * reads it again. While the game is still booting, reload once so it does.
	 */
	var bootedEmpty = !initialized;
	var lateProfile = null;
	var reloading = false;
	var reloadWanted = false;
	var pendingRestores = 0;

	function canReloadOnce() {
		if (Date.now() - BOOT_AT > RELOAD_WINDOW_MS || !realSS) return false;
		try {
			return !realSS.getItem(NS + 'reloaded');
		} catch (e) {
			return false;
		}
	}

	/* Reload only after every restore transaction has committed — unloading aborts them. */
	function maybeReload() {
		if (!reloadWanted || pendingRestores > 0 || reloading) return;
		reloading = true;
		try {
			realSS.setItem(NS + 'reloaded', '1');
		} catch (e) {
			/* canReloadOnce checked it is writable */
		}
		/*
		 * Hand the profile to the next boot. The game keeps running until the unload, and
		 * can still commit a default save after this point; the reloaded boot restores
		 * from this copy synchronously and lets it win.
		 */
		writeJSON(realSS, NS + 'carry', lateProfile);
		persistNow();
		location.reload();
	}

	function onProfile(profile, late) {
		if (profile) {
			loadIdbProfile(profile);
			/*
			 * A late profile only helps if the game reads it again — while it is still
			 * booting, reload once so it does. Decided up front, because it also decides
			 * whether saved records may replace what the empty boot already wrote.
			 */
			var reloadable = late && canReloadOnce();
			lateProfile = profile;
			var overwrite = reloadable && bootedEmpty;
			var changed = applyProfileStores(profile, restoreOverwrite);
			/* Databases the game already opened before the profile arrived. */
			for (var name in idbConns) {
				pendingRestores++;
				(function (dbName) {
					hydrateConnection(
						idbConns[dbName],
						dbName,
						function (added) {
							pendingRestores--;
							if (added > 0 && reloadable) reloadWanted = true;
							maybeReload();
						},
						overwrite
					);
				})(name);
			}
			if (changed && reloadable) reloadWanted = true;
			maybeReload();
		} else if (!initialized) {
			initialized = true;
			persistNow();
		}
		profileSettled = true;
		/* Anything written while waiting is now safe to send. */
		if (dirty) schedulePush();
	}

	/* A profile carried across a late-restore reload beats everything else. */
	var carried = readJSON(realSS, NS + 'carry');
	if (carried) {
		try {
			realSS.removeItem(NS + 'carry');
		} catch (e) {
			/* ignore */
		}
		restoreOverwrite = true;
	}
	var syncProfile = carried || readSyncProfile();
	if (syncProfile !== undefined) onProfile(syncProfile, false);

	/*
	 * Some engines refuse to let `window.localStorage` be redefined. The game then writes
	 * the real store directly, so no write is ever seen — sample it on a timer instead.
	 */
	if (!virtual.installed) {
		setInterval(function () {
			dirty = true;
			schedulePush();
		}, 5000);
	}

	window.__ptStorageBridge = {
		gameId: gameId,
		virtual: virtual.installed,
		flush: flush,
		/* Same-origin parent teardown: hand over unsaved changes directly, no message hop. */
		takeDirtySnapshot: function () {
			if (!dirty || !profileSettled || reloading || reloadWanted) return null;
			dirty = false;
			persistNow();
			return buildProfile();
		}
	};

	/* ======================================================================
	 * Audio / pause
	 * ==================================================================== */
	function unlockAudio() {
		/* Mute still blocks unlock; app Pause must not (WebKit AC resume trap). */
		if (window.__ptAudioOutputMuted) return;
		try {
			var AC = window.AudioContext || window.webkitAudioContext;
			if (!AC) return;
			if (!window.__ptSharedAudioCtx) window.__ptSharedAudioCtx = new AC();
			if (window.__ptSharedAudioCtx.state === 'suspended') {
				window.__ptSharedAudioCtx.resume();
			}
		} catch (e) {
			/* ignore */
		}
	}

	function applyEffectiveAudioMute() {
		try {
			var ctx = window.__ptSharedAudioCtx;
			if (!ctx) {
				var AC = window.AudioContext || window.webkitAudioContext;
				if (!AC) return;
				ctx = new AC();
				window.__ptSharedAudioCtx = ctx;
			}
			/* Mute-only — pause must not suspend AudioContext (Unity black canvas). */
			var muted = !!window.__ptAudioOutputMuted;
			if (muted) {
				if (ctx.state === 'running') ctx.suspend();
			} else if (ctx.state === 'suspended') {
				ctx.resume();
			}
		} catch (e) {
			/* ignore */
		}
	}

	function setAudioOutputMuted(muted) {
		window.__ptAudioOutputMuted = !!muted;
		applyEffectiveAudioMute();
	}

	function setGamePaused(paused) {
		window.__ptGamePaused = !!paused;
		try {
			var media = document.querySelectorAll('audio, video');
			for (var i = 0; i < media.length; i++) {
				var el = media[i];
				if (paused) {
					if (!el.paused) el.setAttribute('data-pt-pause-was-playing', '1');
					try {
						el.pause();
					} catch (e2) {}
				} else if (el.getAttribute('data-pt-pause-was-playing') === '1') {
					el.removeAttribute('data-pt-pause-was-playing');
					try {
						el.play();
					} catch (e2) {}
				}
			}
		} catch (e) {
			/* ignore */
		}
		if (!paused) unlockAudio();
		/* A pause is a natural save point. */
		flush();
	}

	/* ======================================================================
	 * Console input
	 * ==================================================================== */
	var ptTouchHeld = Object.create(null);
	var ptHeldCount = 0;
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
	function ptKeyFromCode(code) {
		if (KEY_BY_CODE[code]) return KEY_BY_CODE[code];
		if (code && code.indexOf('Key') === 0 && code.length === 4) return code.charAt(3).toLowerCase();
		if (code && code.indexOf('Digit') === 0 && code.length === 6) return code.charAt(5);
		return code || '';
	}
	function ptKeyCodeFromCode(code) {
		if (KEYCODE_BY_CODE[code] != null) return KEYCODE_BY_CODE[code];
		if (code && code.indexOf('Key') === 0 && code.length === 4) return code.charCodeAt(3);
		if (code && code.indexOf('Digit') === 0 && code.length === 6) return code.charCodeAt(5);
		return 0;
	}

	function gameCanvas() {
		return (
			document.querySelector('#unity-canvas, #openfl-content canvas, #gameContainer canvas') ||
			document.querySelector('canvas')
		);
	}

	/**
	 * Where a synthetic key should be dispatched — exactly one target.
	 *
	 * The old bridge fired every key at canvas, body, html, document and window in turn.
	 * Because key events bubble, a window listener saw each press up to six times: games
	 * double-stepped, toggled menus open and shut, and the extra work showed as input lag.
	 * An element that registered its own key listener gets the event (it bubbles on up to
	 * body, document and window from there); otherwise body, which Scratch requires.
	 */
	function keyDispatchTarget() {
		for (var i = 0; i < keyTargets.length; i++) {
			var el = keyTargets[i];
			/* Only the game surface itself — never a text box or a menu that happens to listen. */
			if (el.isConnected && (el.tagName === 'CANVAS' || el.querySelector('canvas'))) return el;
		}
		return document.body || document.documentElement || document;
	}
	window.__ptKeyDispatchTarget = keyDispatchTarget;

	function ptDispatchKey(type, code) {
		if (!code) return;
		var key = ptKeyFromCode(code);
		var keyCode = ptKeyCodeFromCode(code);
		var event;
		try {
			event = new KeyboardEvent(type, {
				key: key,
				code: code,
				keyCode: keyCode,
				which: keyCode,
				bubbles: true,
				cancelable: true,
				composed: true,
				view: window
			});
			try {
				Object.defineProperty(event, 'keyCode', { get: function () { return keyCode; } });
				Object.defineProperty(event, 'which', { get: function () { return keyCode; } });
			} catch (e) {}
		} catch (e) {
			return;
		}
		try {
			keyDispatchTarget().dispatchEvent(event);
		} catch (e) {}
	}

	/**
	 * Put the caret in the game's text box so the device keyboard comes up — typing a name
	 * or a code is the device keyboard's job, not a grid of console buttons.
	 */
	function focusTextField() {
		try {
			var fields = document.querySelectorAll(
				'input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="number"], input[type="tel"], input[type="url"], input[type="password"], textarea, [contenteditable="true"]'
			);
			for (var i = 0; i < fields.length; i++) {
				var el = fields[i];
				if (el.disabled || (!el.offsetWidth && !el.offsetHeight)) continue;
				el.focus({ preventScroll: false });
				return true;
			}
		} catch (e) {
			/* ignore */
		}
		return false;
	}
	window.__ptFocusTextField = focusTextField;

	/* Focus the game once per press burst, not on every key — focus() forces layout. */
	function focusGameOnce() {
		try {
			var canvas = gameCanvas();
			if (canvas && canvas.focus) canvas.focus({ preventScroll: true });
		} catch (e) {}
	}

	function sendTouchInputAck(data, codes) {
		if (!data || !data.ackId) return;
		try {
			window.parent.postMessage(
				{
					type: 'potato-tomato-touch-input-ack',
					ackId: data.ackId,
					action: data.action,
					codes: codes || [],
					path: 'bridge',
					ok: true
				},
				'*'
			);
		} catch (e) {}
	}
	function ptForwardTouchToChildFrames(data) {
		var frames = document.getElementsByTagName('iframe');
		for (var i = 0; i < frames.length; i++) {
			try {
				var win = frames[i].contentWindow;
				if (win) win.postMessage(data, '*');
			} catch (e) {}
		}
	}

	function handleTouchInputMessage(data) {
		var codes = Array.isArray(data.codes) ? data.codes : data.code ? [data.code] : [];
		if (data.action === 'releaseAll') {
			var held = Object.keys(ptTouchHeld);
			ptTouchHeld = Object.create(null);
			ptHeldCount = 0;
			for (var r = 0; r < held.length; r++) ptDispatchKey('keyup', held[r]);
			ptForwardTouchToChildFrames(data);
			sendTouchInputAck(data, held);
			return;
		}
		if (data.action === 'down') {
			if (ptHeldCount === 0) focusGameOnce();
			for (var d = 0; d < codes.length; d++) {
				if (!codes[d] || ptTouchHeld[codes[d]]) continue;
				ptTouchHeld[codes[d]] = true;
				ptHeldCount++;
				ptDispatchKey('keydown', codes[d]);
			}
			ptForwardTouchToChildFrames(data);
			sendTouchInputAck(data, codes);
			return;
		}
		if (data.action === 'up') {
			for (var u = 0; u < codes.length; u++) {
				if (!codes[u] || !ptTouchHeld[codes[u]]) continue;
				delete ptTouchHeld[codes[u]];
				ptHeldCount--;
				ptDispatchKey('keyup', codes[u]);
			}
			ptForwardTouchToChildFrames(data);
			sendTouchInputAck(data, codes);
		}
	}

	nativeAdd.call(window, 'message', function (event) {
		var data = event && event.data;
		if (!data || typeof data !== 'object') return;
		switch (data.type) {
			case 'potato-tomato-touch-input':
				handleTouchInputMessage(data);
				return;
			case 'potato-tomato-unlock-audio':
				unlockAudio();
				return;
			case 'potato-tomato-audio-output':
				setAudioOutputMuted(!!data.muted);
				return;
			case 'potato-tomato-game-pause':
				setGamePaused(!!data.paused);
				return;
			case 'potato-tomato-focus-text':
				focusTextField();
				return;
			case TYPE:
				if (data.gameId !== gameId || data.action !== 'hydrate') return;
				if (profileSettled && syncProfile !== undefined) return;
				onProfile(data.data || null, true);
				return;
			default:
				return;
		}
	});
	['pointerdown', 'touchstart', 'keydown'].forEach(function (type) {
		nativeAdd.call(document, type, unlockAudio, true);
	});

	if (syncProfile === undefined) {
		try {
			appWindow().postMessage({ type: TYPE, action: 'pull', gameId: gameId }, '*');
		} catch (e) {
			profileSettled = true;
		}
		/* Parent never answered (older shell): stop holding writes back. */
		setTimeout(function () {
			if (!profileSettled) onProfile(null, false);
		}, 4000);
	}
	nativeAdd.call(window, 'pagehide', flush);
	nativeAdd.call(window, 'beforeunload', flush);
})();

/* ==========================================================================
 * Pointer lock guard — a self-contained block (own scope, own state); nothing
 * above depends on it and it depends on nothing above.
 *
 * Games that grab the mouse (`requestPointerLock()`, FPS-style mouse look) keep it.
 * This adds the way out and tells the app when it matters:
 *
 *   - `pointerlockchange` → posts {type:'potato-tomato-pointer-lock', state:'locked' |
 *     'unlocked'} to the app, which shows a one-line hint;
 *   - presses on a hidden cursor (`cursor: none`) with no lock, three within 2.5 s →
 *     state:'stuck', since that looks exactly like a cursor stuck on the game;
 *   - two quick double-clicks → `exitPointerLock()`, the cursor forced visible until the
 *     game locks again, the unlocking press and the clicks right after it swallowed (a
 *     game that locks on click would otherwise re-lock at once) → state:'released'.
 *
 * Esc is untouched: browsers release a lock on Esc themselves. Runs in frames only — the
 * app watches its own document. The gesture rules mirror `isUnlockGesture` in
 * src/lib/utils/pointer-lock.ts; pointer-lock.spec.ts runs this block against the same
 * cases, so change both together.
 * ========================================================================== */
(function () {
	if (window.top === window || window.__ptPointerLockGuard) return;
	window.__ptPointerLockGuard = true;

	var MSG = 'potato-tomato-pointer-lock';
	var PRESSES = 4;
	var PAIR_MAX_MS = 400;
	var TOTAL_MAX_MS = 1400;
	var PAUSE_RATIO = 1.25;
	var MAX_TRAVEL_PX = 48;
	var STUCK_PRESSES = 3;
	var STUCK_WINDOW_MS = 2500;
	var SWALLOW_MS = 600;
	var STYLE_ID = '__pt-cursor-visible';

	var presses = [];
	var stuckAt = [];
	var stuckReported = false;
	var travel = 0;
	var lastPointerDownAt = -Infinity;
	var swallowUntil = 0;

	function post(state) {
		var msg = { type: MSG, state: state };
		try {
			(window.top || window.parent).postMessage(msg, '*');
		} catch (e) {
			try {
				window.parent.postMessage(msg, '*');
			} catch (e2) {
				/* detached */
			}
		}
	}

	function isUnlockGesture(list) {
		if (list.length < PRESSES) return false;
		var a = list[list.length - 4];
		var b = list[list.length - 3];
		var c = list[list.length - 2];
		var d = list[list.length - 1];
		var total = d.at - a.at;
		if (total < 0 || total > TOTAL_MAX_MS) return false;
		var firstPair = b.at - a.at;
		var pause = c.at - b.at;
		var secondPair = d.at - c.at;
		if (firstPair > PAIR_MAX_MS || secondPair > PAIR_MAX_MS) return false;
		if (pause < Math.max(firstPair, secondPair) * PAUSE_RATIO) return false;
		return d.travel - a.travel <= MAX_TRAVEL_PX;
	}
	/* Exposed for pointer-lock.spec.ts, which checks it against the TypeScript rules. */
	window.__ptIsUnlockGesture = isUnlockGesture;

	function cursorHidden(target) {
		if (!target || target.nodeType !== 1) return false;
		try {
			return window.getComputedStyle(target).cursor === 'none';
		} catch (e) {
			return false;
		}
	}

	function showCursor() {
		if (document.getElementById(STYLE_ID)) return;
		var style = document.createElement('style');
		style.id = STYLE_ID;
		style.textContent = '*,*::before,*::after{cursor:auto!important}';
		(document.head || document.documentElement).appendChild(style);
	}

	function restoreCursor() {
		var style = document.getElementById(STYLE_ID);
		if (style && style.parentNode) style.parentNode.removeChild(style);
	}

	function release() {
		presses = [];
		stuckAt = [];
		stuckReported = false;
		swallowUntil = Date.now() + SWALLOW_MS;
		try {
			if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
		} catch (e) {
			/* nothing to release */
		}
		showCursor();
		post('released');
	}

	function swallow(e) {
		e.preventDefault();
		if (e.stopImmediatePropagation) e.stopImmediatePropagation();
	}

	function onPress(e) {
		var now = Date.now();
		if (now <= swallowUntil) {
			/* The unlocking press's own mousedown, or a click right after it. */
			swallow(e);
			return;
		}
		if (e.button !== 0) return;
		if (e.type === 'pointerdown') {
			if (e.pointerType && e.pointerType !== 'mouse') return;
			lastPointerDownAt = now;
		} else if (now - lastPointerDownAt < 100) {
			return; /* the mousedown twin of a pointerdown already counted */
		}
		var locked = Boolean(document.pointerLockElement);
		var hidden = !locked && cursorHidden(e.target);
		if (!locked && !hidden) {
			presses = [];
			return;
		}
		presses.push({ at: now, travel: travel });
		if (presses.length > PRESSES) presses.shift();
		if (isUnlockGesture(presses)) {
			swallow(e);
			release();
			return;
		}
		if (!hidden) return;
		var recent = [];
		for (var i = 0; i < stuckAt.length; i++) {
			if (now - stuckAt[i] <= STUCK_WINDOW_MS) recent.push(stuckAt[i]);
		}
		recent.push(now);
		stuckAt = recent;
		if (!stuckReported && stuckAt.length >= STUCK_PRESSES) {
			stuckReported = true;
			post('stuck');
		}
	}

	function onFollowUp(e) {
		if (Date.now() <= swallowUntil) swallow(e);
	}

	window.addEventListener(
		'mousemove',
		function (e) {
			travel += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
		},
		true
	);
	window.addEventListener('pointerdown', onPress, true);
	window.addEventListener('mousedown', onPress, true);
	['pointerup', 'mouseup', 'click', 'dblclick'].forEach(function (type) {
		window.addEventListener(type, onFollowUp, true);
	});
	document.addEventListener('pointerlockchange', function () {
		presses = [];
		if (document.pointerLockElement) {
			restoreCursor();
			post('locked');
		} else {
			post('unlocked');
		}
	});
})();
