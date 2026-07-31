/**
 * Injected into Unity WebGL shells BEFORE the loader runs.
 * Removes splash banners, stubs Emscripten stdin, spoofs focus-loss,
 * and reduces ad SDK / portal noise.
 */
(function () {
	if (window.__ptUnityInjectInstalled) return;
	window.__ptUnityInjectInstalled = true;

	/* ——— Emscripten / Unity FS: avoid "invalid handle for stdin" aborts ——— */
	function ptNullStdin() {
		return null;
	}
	function ptNoopOut() {}

	function ensureUnityModuleHooks(mod) {
		mod = mod || {};
		if (typeof mod.stdin !== 'function') mod.stdin = ptNullStdin;
		if (typeof mod.stdout !== 'function') mod.stdout = ptNoopOut;
		if (typeof mod.stderr !== 'function') mod.stderr = ptNoopOut;
		if (!mod.ENVIRONMENT) mod.ENVIRONMENT = 'WEB';
		return mod;
	}

	try {
		window.Module = ensureUnityModuleHooks(window.Module || {});
	} catch (e) {
		/* ignore */
	}

	/* ——— Focus spoof: games stay "focused"; app pause still uses postMessage ——— */
	(function patchFocusSpoof() {
		if (window.__ptFocusSpoofInstalled) return;
		window.__ptFocusSpoofInstalled = true;

		/*
		 * Safe to spoof hasFocus HERE (iframe realm only). Parent mute-on-focus-loss
		 * reads the shell document — not this prototype. Unity polls hasFocus() when
		 * the touch console (parent overlay) steals DOM focus; without this the game freezes.
		 */
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

		/* Capture-phase: Unity never sees blur / visibilitychange (keeps in-game pause menus off). */
		['blur', 'focusout', 'visibilitychange'].forEach(function (type) {
			window.addEventListener(type, swallow, true);
			document.addEventListener(type, swallow, true);
		});

		/* Block late-registered blur handlers (Unity / portal SDKs). */
		function blockFocusLossListeners(target) {
			try {
				var add = target.addEventListener;
				target.addEventListener = function (type, listener, options) {
					if (focusLossEvents[type]) return;
					return add.call(this, type, listener, options);
				};
			} catch (e3) {
				/* ignore */
			}
		}
		blockFocusLossListeners(window);
		blockFocusLossListeners(document);
	})();

	/* ——— Reject HTML mistaken for JS/wasm (SPA fallback / missing Build files) ——— */
	(function patchAssetFetch() {
		if (window.__ptUnityFetchPatched || typeof window.fetch !== 'function') return;
		window.__ptUnityFetchPatched = true;
		var origFetch = window.fetch.bind(window);
		var assetRe = /\.(js|mjs|wasm|unityweb|data|json)(\?|#|$)/i;

		function looksLikeHtml(text) {
			var t = String(text || '')
				.trim()
				.slice(0, 64)
				.toLowerCase();
			return t.charAt(0) === '<' || t.indexOf('<!doctype') === 0 || t.indexOf('<html') === 0;
		}

		window.fetch = function (input, init) {
			var url = typeof input === 'string' ? input : input && input.url;
			var p = origFetch(input, init);
			if (!url || !assetRe.test(url)) return p;
			return p.then(function (res) {
				var ct = (res.headers && res.headers.get('content-type')) || '';
				if (/text\/html/i.test(ct)) {
					return res.text().then(function () {
						throw new Error(
							'Unity asset returned HTML instead of binary/JS (missing file or SPA fallback): ' +
								url
						);
					});
				}
				/* Opaque / no content-type: sniff a clone for script-like URLs */
				if (!ct && /\.js(\?|#|$)/i.test(url)) {
					return res
						.clone()
						.text()
						.then(function (body) {
							if (looksLikeHtml(body)) {
								throw new Error(
									'Unity script URL returned HTML (missing Build asset?): ' + url
								);
							}
							return res;
						});
				}
				return res;
			});
		};
	})();

	/* Unity "Made with Unity" banner — no-op */
	window.unityShowBanner = function () {};

	/* Hide splash, progress bars, portal play gates, ad containers */
	var hideCss =
		'#unity-logo,#unity-footer,#unity-loading-bar,#unity-progress-bar-empty,#unity-progress-bar-full,' +
		'.webgl-content .logo,.webgl-content .progress,#splash,#splash-screen,#loading-cover,#play-cover,' +
		'.loading-cover,.poki-sdk-container,.y8-lifecycle-ad,.y8-preloader,.idnet-preloader,' +
		'[class*="splash"],[id*="splash"],[class*="loading-screen"],[id*="loading-screen"]' +
		'{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}';
	var style = document.createElement('style');
	style.id = 'pt-unity-inject-style';
	style.textContent = hideCss;
	(document.head || document.documentElement).appendChild(style);

	function hideLoadingDom() {
		var selectors = [
			'#unity-loading-bar',
			'#unity-logo',
			'#unity-footer',
			'#play-cover',
			'#loading-cover',
			'.loading-cover',
			'.poki-sdk-container'
		];
		for (var i = 0; i < selectors.length; i++) {
			var nodes = document.querySelectorAll(selectors[i]);
			for (var j = 0; j < nodes.length; j++) {
				nodes[j].style.display = 'none';
			}
		}
	}

	/*
	 * Older Unity/Emscripten frameworks assume that stdin/stdout/stderr are
	 * allocated at descriptors 0/1/2. WebKitGTK can leave descriptor 0
	 * occupied while the framework is being evaluated, which aborts startup
	 * with "invalid handle for stdin (1)". Repair only this known assertion
	 * pattern after the framework has been decompressed and before it runs.
	 *
	 * Frameworks emit either `0===stdin.fd` or `stdin.fd===0` — match both.
	 * Keep in sync with puller/src/unity/framework-patches.ts.
	 */
	function repairStdioAssert(stream, expected) {
		return (
			'if (' +
			stream +
			'.fd !== ' +
			expected +
			') { FS.streams[' +
			stream +
			'.fd] = null; ' +
			stream +
			'.fd = ' +
			expected +
			'; FS.streams[' +
			expected +
			'] = ' +
			stream +
			'; }'
		);
	}

	function patchUnityFrameworkSource(source) {
		var original = source;
		var text = source;
		var bytes = false;
		try {
			if (typeof source !== 'string') {
				if (source instanceof ArrayBuffer) source = new Uint8Array(source);
				if (!source || typeof source.byteLength !== 'number' || typeof TextDecoder !== 'function') {
					return original;
				}
				text = new TextDecoder('utf-8').decode(source);
				bytes = true;
			}
		} catch (e) {
			return original;
		}

		if (typeof text !== 'string' || text.indexOf('invalid handle for stdin') === -1) {
			return original;
		}

		var assertionLiteralLeft =
			/assert\(\s*([0-2])===([A-Za-z_$][\w$]*)\.fd\s*,\s*["']invalid handle for (stdin|stdout|stderr) \(["']\+\2\.fd\+["']\)["']\s*\);/g;
		var assertionStreamLeft =
			/assert\(\s*([A-Za-z_$][\w$]*)\.fd===([0-2])\s*,\s*["']invalid handle for (stdin|stdout|stderr) \(["']\+\1\.fd\+["']\)["']\s*\);/g;
		var patched = text.replace(assertionLiteralLeft, function (_match, expected, stream) {
			return repairStdioAssert(stream, expected);
		});
		patched = patched.replace(assertionStreamLeft, function (_match, stream, expected) {
			return repairStdioAssert(stream, expected);
		});

		if (patched === text) return original;
		if (!bytes) return patched;
		try {
			return typeof TextEncoder === 'function' ? new TextEncoder().encode(patched) : original;
		} catch (e) {
			return original;
		}
	}

	/* Legacy UnityLoader: only gunzip real gzip; pass through plain UnityFS / decoded bodies. */
	function isGzipMagic(data) {
		return data && data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
	}

	function wrapUnityDecompress(fn) {
		if (typeof fn !== 'function' || fn.__ptSafeDecompress) return fn;
		var wrapped = function (data) {
			var bytes =
				data instanceof Uint8Array
					? data
					: data && typeof data.byteLength === 'number'
						? new Uint8Array(data)
						: null;
			if (!bytes || !isGzipMagic(bytes)) return data;
			return fn(data);
		};
		wrapped.__ptSafeDecompress = true;
		return wrapped;
	}

	function forceUnityCompressionSupported(UL) {
		try {
			var cs = UL && UL.CompressionState;
			if (!cs || typeof cs.Set !== 'function') return;
			if (typeof cs.Supported === 'number') cs.Set(cs.Supported);
		} catch (e) {
			/* ignore */
		}
	}

	/* Wrap createUnityInstance once the loader defines it */
	var _cui = window.createUnityInstance;
	Object.defineProperty(window, 'createUnityInstance', {
		configurable: true,
		enumerable: true,
		get: function () {
			return _cui;
		},
		set: function (fn) {
			if (typeof fn !== 'function') {
				_cui = fn;
				return;
			}
			_cui = function (canvas, config, onProgress) {
				config = ensureUnityModuleHooks(config || {});
				if ('showBanner' in config) config.showBanner = false;
				hideLoadingDom();
				return fn(canvas, config, function (progress) {
					hideLoadingDom();
					if (typeof onProgress === 'function') onProgress(progress);
				}).then(function (instance) {
					hideLoadingDom();
					return instance;
				});
			};
		}
	});

	/* Legacy UnityLoader.instantiate — trap assignment so we wrap even if inject runs first */
	var _ul = window.UnityLoader;
	function patchUnityLoader(UL) {
		if (!UL || UL.__ptPatched) return UL;
		UL.__ptPatched = true;
		/* Skip mobile / browser warning popups (alert with "Press OK if you wish to continue"). */
		if (typeof UL.compatibilityCheck === 'function') {
			UL.compatibilityCheck = function (_gameInstance, onsuccess) {
				if (typeof onsuccess === 'function') onsuccess();
			};
		}
		if (typeof UL.instantiate === 'function') {
			var origInstantiate = UL.instantiate.bind(UL);
			UL.instantiate = function (container, url, opts) {
				hideLoadingDom();
				forceUnityCompressionSupported(UL);
				opts = opts || {};
				opts.Module = ensureUnityModuleHooks(opts.Module || {});
				if (opts.onProgress) {
					var origProgress = opts.onProgress;
					opts.onProgress = function (gameInstance, progress) {
						hideLoadingDom();
						return origProgress(gameInstance, progress);
					};
				}
				var instance = origInstantiate(container, url, opts);
				try {
					if (instance) {
						window.gameInstance = instance;
						window.__ptUnityInstance = instance;
					}
				} catch (e) {}
				return instance;
			};
		}
		if (typeof UL.loadCode === 'function' && !UL.loadCode.__ptStdioPatched) {
			var origLoadCode = UL.loadCode;
			/*
			 * UnityLoader (5.x / v3): loadCode(job, code, callback, options)
			 * where options.isModularized is required. Do NOT treat arg0 as
			 * source text — that shifts args and throws
			 * "undefined is not an object (evaluating 'n.isModularized')".
			 */
			var patchedLoadCode = function (job, code, callback, options) {
				if (typeof callback === 'function') {
					return origLoadCode.call(
						this,
						job,
						patchUnityFrameworkSource(code),
						callback,
						options || { isModularized: false }
					);
				}
				/* Defensive fallback for unknown 2–3 arg shapes. */
				if (typeof code === 'function') {
					return origLoadCode.call(
						this,
						patchUnityFrameworkSource(job),
						code,
						callback
					);
				}
				return origLoadCode.apply(this, arguments);
			};
			patchedLoadCode.__ptStdioPatched = true;
			UL.loadCode = patchedLoadCode;
		}
		forceUnityCompressionSupported(UL);
		return UL;
	}
	Object.defineProperty(window, 'UnityLoader', {
		configurable: true,
		enumerable: true,
		get: function () {
			return _ul;
		},
		set: function (UL) {
			_ul = patchUnityLoader(UL);
		}
	});
	if (_ul) _ul = patchUnityLoader(_ul);

	/*
	 * UnityLoader.js assigns window.unityDecompressReleaseFile = pako.inflate at parse time.
	 * Trap the property so we wrap it even when the script loads after inject.
	 */
	(function trapUnityDecompress() {
		if (window.__ptUnityDecompressTrap) return;
		window.__ptUnityDecompressTrap = true;
		var _decompress = wrapUnityDecompress(window.unityDecompressReleaseFile);
		try {
			Object.defineProperty(window, 'unityDecompressReleaseFile', {
				configurable: true,
				enumerable: true,
				get: function () {
					return _decompress;
				},
				set: function (fn) {
					_decompress = wrapUnityDecompress(fn);
				}
			});
		} catch (e) {
			if (typeof window.unityDecompressReleaseFile === 'function') {
				window.unityDecompressReleaseFile = wrapUnityDecompress(
					window.unityDecompressReleaseFile
				);
			}
		}
	})();

	/* Track every AudioContext so focus-loss mute can suspend Unity Web Audio too. */
	var audioContexts = [];
	(function patchAudioContext() {
		if (window.__ptAudioContextPatched) return;
		var OrigAC = window.AudioContext || window.webkitAudioContext;
		if (!OrigAC) return;
		window.__ptAudioContextPatched = true;
		function PatchedAudioContext() {
			var args = arguments;
			var ctx;
			try {
				if (typeof Reflect !== 'undefined' && Reflect.construct) {
					ctx = Reflect.construct(OrigAC, args);
				} else {
					ctx = new OrigAC();
				}
			} catch (e) {
				ctx = new OrigAC();
			}
			audioContexts.push(ctx);
			window.__ptSharedAudioCtx = ctx;
			/* Mute-only — never suspend for app Pause (Unity/WebKit black-canvas trap). */
			if (window.__ptAudioOutputMuted) {
				try {
					ctx.suspend();
				} catch (e2) {}
			}
			return ctx;
		}
		PatchedAudioContext.prototype = OrigAC.prototype;
		try {
			Object.setPrototypeOf(PatchedAudioContext, OrigAC);
		} catch (e) {}
		window.AudioContext = PatchedAudioContext;
		if ('webkitAudioContext' in window) window.webkitAudioContext = PatchedAudioContext;
	})();

	function unlockAudio() {
		/* Mute still blocks unlock; app Pause must NOT — WebKit never resumes AC after suspend(). */
		if (window.__ptAudioOutputMuted) return;
		for (var i = 0; i < audioContexts.length; i++) {
			try {
				if (audioContexts[i].state === 'suspended') audioContexts[i].resume();
			} catch (e) {}
		}
	}

	function applyEffectiveAudioMute() {
		/*
		 * Only real mute suspends AudioContext. Tying pause to suspend() freezes Unity
		 * WebGL on WebKitGTK/Flatpak — resume() after Pause often never runs (no gesture
		 * in the iframe), so the canvas stays black and Play never continues.
		 */
		var muted = !!window.__ptAudioOutputMuted;
		for (var i = 0; i < audioContexts.length; i++) {
			try {
				if (muted) {
					if (audioContexts[i].state === 'running') audioContexts[i].suspend();
				} else if (audioContexts[i].state === 'suspended') {
					audioContexts[i].resume();
				}
			} catch (e) {}
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
					} catch (e) {}
				} else if (el.getAttribute('data-pt-pause-was-playing') === '1') {
					el.removeAttribute('data-pt-pause-was-playing');
					try {
						el.play();
					} catch (e) {}
				}
			}
		} catch (e) {}
		/* Parent also blocks pointer-events; wake audio on resume for Unity. */
		if (!paused) unlockAudio();
	}

	/* ——— Touch console → synthetic keyboard (cross-origin parent uses postMessage) ——— */
	var PT_KEY_CODE_TO_KEY = {
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
		AltLeft: 'Alt',
		AltRight: 'Alt',
		Tab: 'Tab',
		Backspace: 'Backspace'
	};
	var PT_KEY_CODE_TO_KEY_CODE = {
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
		AltLeft: 18,
		AltRight: 18,
		Tab: 9,
		Backspace: 8
	};
	var ptTouchHeld = Object.create(null);

	function ptKeyFromCode(code) {
		if (PT_KEY_CODE_TO_KEY[code]) return PT_KEY_CODE_TO_KEY[code];
		if (code && code.indexOf('Key') === 0 && code.length === 4) return code.charAt(3).toLowerCase();
		if (code && code.indexOf('Digit') === 0 && code.length === 6) return code.charAt(5);
		return code || '';
	}

	function ptKeyCodeFromCode(code) {
		if (PT_KEY_CODE_TO_KEY_CODE[code] != null) return PT_KEY_CODE_TO_KEY_CODE[code];
		if (code && code.indexOf('Key') === 0 && code.length === 4) return code.charCodeAt(3);
		if (code && code.indexOf('Digit') === 0 && code.length === 6) return code.charCodeAt(5);
		return 0;
	}

	function ptTouchFocus() {
		try {
			var canvas =
				document.querySelector('canvas') ||
				document.querySelector(
					'#openfl-content canvas, #unity-canvas, #gameContainer canvas, #gameContainer, #game, .game-canvas, [data-game-canvas]'
				);
			if (canvas && canvas.focus) canvas.focus({ preventScroll: true });
		} catch (e) {}
		try {
			var openfl = document.getElementById('openfl-content');
			if (openfl && openfl.focus) openfl.focus({ preventScroll: true });
		} catch (e) {}
		try {
			window.focus();
		} catch (e) {}
	}

	function ptDispatchKey(type, code) {
		if (!code) return;
		var key = ptKeyFromCode(code);
		var keyCode = ptKeyCodeFromCode(code);
		var init = {
			key: key,
			code: code,
			keyCode: keyCode,
			which: keyCode,
			bubbles: true,
			cancelable: true,
			composed: true,
			view: window
		};
		var event;
		try {
			event = new KeyboardEvent(type, init);
			try {
				Object.defineProperty(event, 'keyCode', { get: function () { return keyCode; } });
				Object.defineProperty(event, 'which', { get: function () { return keyCode; } });
				Object.defineProperty(event, 'charCode', { get: function () { return 0; } });
			} catch (e) {}
		} catch (e) {
			return;
		}
		ptTouchFocus();
		var canvas =
			document.querySelector('canvas') ||
			document.querySelector(
				'#openfl-content canvas, #unity-canvas, #gameContainer canvas, #gameContainer, #game, .game-canvas, [data-game-canvas]'
			);
		var targets = [];
		if (canvas) targets.push(canvas);
		var openfl = document.getElementById('openfl-content');
		if (openfl) targets.push(openfl);
		if (document.body) targets.push(document.body);
		if (document.documentElement) targets.push(document.documentElement);
		targets.push(document, window);
		var seen = {};
		for (var i = 0; i < targets.length; i++) {
			var t = targets[i];
			if (!t || seen[t]) continue;
			seen[t] = true;
			try {
				t.dispatchEvent(event);
			} catch (e) {}
		}
	}

	function ptTouchInputDown(codes) {
		if (!codes || !codes.length) return;
		ptTouchFocus();
		for (var i = 0; i < codes.length; i++) {
			var code = codes[i];
			if (!code || ptTouchHeld[code]) continue;
			ptTouchHeld[code] = true;
			ptDispatchKey('keydown', code);
		}
	}

	function ptTouchInputUp(codes) {
		if (!codes || !codes.length) return;
		for (var i = 0; i < codes.length; i++) {
			var code = codes[i];
			if (!code || !ptTouchHeld[code]) continue;
			delete ptTouchHeld[code];
			ptDispatchKey('keyup', code);
		}
	}

	function ptTouchInputReleaseAll() {
		var codes = Object.keys(ptTouchHeld);
		ptTouchHeld = Object.create(null);
		for (var i = 0; i < codes.length; i++) ptDispatchKey('keyup', codes[i]);
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
	/* CrazyGames / portal shells nest the real canvas in a same-origin proxied iframe. */
	function ptForwardTouchToChildFrames(data) {
		if (!data || data.type !== 'potato-tomato-touch-input') return;
		var frames = document.getElementsByTagName('iframe');
		for (var i = 0; i < frames.length; i++) {
			try {
				var win = frames[i].contentWindow;
				if (win) win.postMessage(data, '*');
			} catch (e) {}
			try {
				var doc = frames[i].contentDocument;
				if (!doc) continue;
				var canvas =
					doc.querySelector('canvas') ||
					doc.querySelector(
						'#openfl-content canvas, #unity-canvas, #gameContainer canvas, #gameContainer'
					);
				if (canvas && canvas.focus) canvas.focus({ preventScroll: true });
			} catch (e) {}
		}
	}

	function handleTouchInputMessage(data) {
		if (!data || data.type !== 'potato-tomato-touch-input') return;
		var action = data.action;
		var codes = Array.isArray(data.codes)
			? data.codes
			: data.code
				? [data.code]
				: [];
		if (action === 'down') ptTouchInputDown(codes);
		else if (action === 'up') ptTouchInputUp(codes);
		else if (action === 'releaseAll') ptTouchInputReleaseAll();
		ptForwardTouchToChildFrames(data);
		sendTouchInputAck(data, codes);
	}

	/* App-driven pause/mute/touch — must keep working despite focus spoof */
	window.addEventListener('message', function (ev) {
		var data = ev && ev.data;
		if (!data || typeof data !== 'object') return;
		if (data.type === 'potato-tomato-unlock-audio') unlockAudio();
		if (data.type === 'potato-tomato-audio-output') setAudioOutputMuted(!!data.muted);
		if (data.type === 'potato-tomato-game-pause') setGamePaused(!!data.paused);
		handleTouchInputMessage(data);
	});
	['pointerdown', 'touchstart', 'keydown'].forEach(function (type) {
		document.addEventListener(type, unlockAudio, true);
	});

	/* Stub portal SDKs so games do not pause on ads / login */
	window.PokiSDK =
		window.PokiSDK ||
		{
			init: function () {
				return Promise.resolve();
			},
			gameLoadingFinished: function () {},
			gameplayStart: function () {},
			commercialBreak: function () {
				return Promise.resolve();
			},
			rewardedBreak: function () {
				return Promise.resolve();
			}
		};

	/*
	 * CrazyGames Unity 5.6 builds call bare `CrazySDK.init` / `requestAd` from
	 * the framework. Unwrapped / offline hosts strip the portal shell, so stub
	 * the global before Unity runs (WebKit: "Can't find variable: CrazySDK").
	 */
	(function stubCrazySDK() {
		if (window.CrazySDK && window.CrazySDK.__ptStub) return;
		var objectName = 'CrazySDK';
		function send(method, arg) {
			try {
				var inst =
					window.gameInstance || window.unityInstance || window.__ptUnityInstance;
				if (!inst || typeof inst.SendMessage !== 'function') return;
				inst.SendMessage(objectName, method, arg == null ? '' : String(arg));
			} catch (e) {}
		}
		window.CrazySDK = {
			__ptStub: true,
			init: function (opts) {
				opts = opts || {};
				if (opts.crazySDKObjectName) objectName = String(opts.crazySDKObjectName);
				setTimeout(function () {
					send('InitCallback', '');
				}, 0);
			},
			requestAd: function () {
				setTimeout(function () {
					/* Finish immediately — no real ads in Potato Tomato. */
					send('AdFinished', '');
				}, 0);
			}
		};
		window.CrazyGames =
			window.CrazyGames ||
			{
				SDK: {
					init: function () {
						return Promise.resolve();
					},
					ad: {
						requestAd: function (_type, cb) {
							cb = cb || {};
							try {
								if (typeof cb.adFinished === 'function') cb.adFinished();
							} catch (e) {}
							return Promise.resolve();
						}
					},
					game: {
						gameplayStart: function () {},
						gameplayStop: function () {},
						happytime: function () {}
					}
				}
			};
	})();

	window.y8 =
		window.y8 ||
		{
			ready: function (cb) {
				if (typeof cb === 'function') cb();
			},
			sdk: function () {
				return {
					init: function () {},
					showAd: function () {},
					showRewardAd: function () {}
				};
			},
			emitReadyEvent: function () {}
		};

	window.YaGames =
		window.YaGames ||
		{
			init: function () {
				return Promise.resolve({
					adv: {
						showFullscreenAdv: function (o) {
							if (o && o.callbacks && o.callbacks.onClose) o.callbacks.onClose(false);
						},
						showRewardedVideo: function (o) {
							if (o && o.callbacks) {
								if (o.callbacks.onRewarded) o.callbacks.onRewarded();
								if (o.callbacks.onClose) o.callbacks.onClose();
							}
						}
					},
					features: { LoadingAPI: { ready: function () {} } },
					getPlayer: function () {
						return Promise.resolve({
							setData: function () {
								return Promise.resolve();
							},
							getData: function () {
								return Promise.resolve({});
							}
						});
					}
				});
			}
		};

	document.addEventListener('DOMContentLoaded', hideLoadingDom);
	setInterval(hideLoadingDom, 500);
})();
