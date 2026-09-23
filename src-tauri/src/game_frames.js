/*
 * Preamble for the in-frame bridge the desktop app installs natively (see game_frames.rs).
 *
 * WebKitGTK runs this at document start in every frame of the app's webview, before any
 * of the frame's own script, including cross-origin game frames the app's JavaScript can
 * never reach. It is only installed while a game is being launched or played, and the Rust
 * side calls this function with that game's context, then runs the bridge itself only when
 * it returns a role.
 *
 * It must be cheap and must never throw into the page, and it decides very little on its
 * own: whether this frame is one of the app's game frames, and which part it plays.
 *
 *   game    the outermost frame the app did not serve itself: the game, or the portal
 *           shell that hosts it. Gets the full bridge (virtual storage, key detection,
 *           console input, pause, audio) under the game's catalog id.
 *   nested  a frame inside the game frame (the playable canvas of a portal shell, an SDK
 *           frame). Gets the bridge without a game id — focus and pause handling, but no
 *           storage of its own — plus console input relayed down from the game frame.
 *           Only one frame per game may own the saved profile: the bridge restores the
 *           freshest bucket it finds, so two owners would trade each other's saves.
 *   ad      a known ad or measurement host. Left alone.
 *
 * Everything else — the app's own top document, its same-origin shells and blob
 * documents, a puller relay page — is not touched here: those documents bring their own
 * bridge in their HTML, or are same-origin and reachable from the app directly.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- called by name from game_frames.rs
function ptGameFramePreamble(CTX) {
	if (window.top === window) return null;

	var ancestors = location.ancestorOrigins;
	/* No ancestor list means no way to tell whose frame this is; stay out of it. */
	if (!ancestors || !ancestors.length) return null;
	if (ancestors[ancestors.length - 1] !== CTX.appOrigin) return null;
	if (location.protocol !== 'https:' && location.protocol !== 'http:') return null;
	if (location.origin === CTX.appOrigin) return null;
	for (var own = 0; own < CTX.ownOrigins.length; own++) {
		if (location.origin === CTX.ownOrigins[own]) return null;
	}

	/* document.open() re-runs user scripts against the same global. */
	if (window.__ptNativeGameFrame) return null;

	var AD_HOST =
		/(^|\.)(doubleclick\.net|googlesyndication\.com|googletagservices\.com|googletagmanager\.com|google-analytics\.com|googleadservices\.com|imasdk\.googleapis\.com|amazon-adsystem\.com|criteo\.com|pubmatic\.com|adnxs\.com|moatads\.com|rubiconproject\.com|openx\.net|casalemedia\.com|3lift\.com|taboola\.com|outbrain\.com|sentry\.io|hotjar\.com|facebook\.com|facebook\.net)$/;

	var outermost = true;
	for (var a = 0; a < ancestors.length - 1; a++) {
		if (ancestors[a] !== CTX.appOrigin) {
			outermost = false;
			break;
		}
	}

	var role = AD_HOST.test(location.hostname)
		? 'ad'
		: outermost && !CTX.topHasBridge
			? 'game'
			: 'nested';
	window.__ptNativeGameFrame = { role: role, gameId: role === 'game' ? CTX.gameId : '' };
	if (role === 'ad') return null;

	if (role === 'game') {
		/*
		 * First launch of this game with the bridge on this origin: start its virtual store
		 * from what the game already saved here while it ran without one, instead of from
		 * nothing. The saved profile, when the app has one, still takes precedence.
		 */
		try {
			var ns = '__pt_vs:' + CTX.gameId + ':';
			var real = window.localStorage;
			if (real.getItem(ns + 'ls') === null) {
				var seed = {};
				var seeded = 0;
				for (var i = 0; i < real.length; i++) {
					var key = real.key(i);
					if (!key || key.indexOf('__pt_vs:') === 0) continue;
					seed[key] = real.getItem(key);
					seeded++;
				}
				if (seeded) real.setItem(ns + 'ls', JSON.stringify(seed));
			}
		} catch {
			/* storage blocked for this origin — the bridge copes on its own */
		}
		window.__ptGameId = CTX.gameId;
		/*
		 * Proof of life for the launch watchdog: a frame that fires `load` without ever
		 * saying this never ran a script — a host that refused to be framed, an error page,
		 * a file that is not a page — and the app moves on to the next way to play it.
		 */
		try {
			window.top.postMessage(
				{
					type: 'potato-tomato-game-frame',
					role: role,
					gameId: CTX.gameId,
					href: String(location.href).slice(0, 300)
				},
				'*'
			);
		} catch {
			/* top unreachable */
		}
	} else {
		window.__ptGameId = '';
		/*
		 * Console input reaches the game frame by postMessage and its bridge forwards it to
		 * every child frame. Without a game id the bridge here does not listen, so dispatch it
		 * into this document and pass it further down.
		 */
		(function relayConsoleInput() {
			var KEY = {
				ArrowUp: 'ArrowUp',
				ArrowDown: 'ArrowDown',
				ArrowLeft: 'ArrowLeft',
				ArrowRight: 'ArrowRight',
				Space: ' ',
				Enter: 'Enter',
				Escape: 'Escape',
				ShiftLeft: 'Shift',
				ControlLeft: 'Control',
				Tab: 'Tab',
				Backspace: 'Backspace'
			};
			var KEY_CODE = {
				ArrowLeft: 37,
				ArrowUp: 38,
				ArrowRight: 39,
				ArrowDown: 40,
				Space: 32,
				Enter: 13,
				Escape: 27,
				ShiftLeft: 16,
				ControlLeft: 17,
				Tab: 9,
				Backspace: 8
			};
			var held = Object.create(null);
			var add = EventTarget.prototype.addEventListener;

			function keyOf(code) {
				if (KEY[code]) return KEY[code];
				if (/^Key[A-Z]$/.test(code)) return code.charAt(3).toLowerCase();
				if (/^Digit[0-9]$/.test(code)) return code.charAt(5);
				return code;
			}
			function keyCodeOf(code) {
				if (KEY_CODE[code] != null) return KEY_CODE[code];
				if (/^(Key[A-Z]|Digit[0-9])$/.test(code)) return code.charCodeAt(code.length - 1);
				return 0;
			}
			function target() {
				var active = document.activeElement;
				if (active && active !== document.body && active.tagName !== 'IFRAME') return active;
				return document.querySelector('canvas') || document.body || document.documentElement;
			}
			function dispatch(type, code) {
				var keyCode = keyCodeOf(code);
				var event;
				try {
					event = new KeyboardEvent(type, {
						key: keyOf(code),
						code: code,
						keyCode: keyCode,
						which: keyCode,
						bubbles: true,
						cancelable: true,
						composed: true,
						view: window
					});
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
					target().dispatchEvent(event);
				} catch {
					/* a detached document mid-navigation */
				}
			}
			function forward(data) {
				var frames = document.getElementsByTagName('iframe');
				for (var f = 0; f < frames.length; f++) {
					try {
						if (frames[f].contentWindow) frames[f].contentWindow.postMessage(data, '*');
					} catch {
						/* frame gone */
					}
				}
			}
			add.call(window, 'message', function (event) {
				var data = event && event.data;
				if (!data || typeof data !== 'object' || data.type !== 'potato-tomato-touch-input') return;
				/* Only what comes down the frame chain from the app, never a sibling or a child. */
				if (event.source !== window.parent) return;
				var codes = Array.isArray(data.codes) ? data.codes : data.code ? [data.code] : [];
				var c;
				if (data.action === 'releaseAll') {
					for (c in held) dispatch('keyup', c);
					held = Object.create(null);
				} else if (data.action === 'down') {
					for (c = 0; c < codes.length; c++) {
						if (typeof codes[c] !== 'string' || held[codes[c]]) continue;
						held[codes[c]] = true;
						dispatch('keydown', codes[c]);
					}
				} else if (data.action === 'up') {
					for (c = 0; c < codes.length; c++) {
						if (typeof codes[c] !== 'string' || !held[codes[c]]) continue;
						delete held[codes[c]];
						dispatch('keyup', codes[c]);
					}
				} else {
					return;
				}
				forward(data);
			});
		})();
	}
	return role;
}
