/**
 * Injected into Unity WebGL shells before the loader runs.
 * Removes splash banners, portal loading screens, and ad SDK noise.
 */
(function () {
	if (window.__ptUnityInjectInstalled) return;
	window.__ptUnityInjectInstalled = true;

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
				config = config || {};
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

	/* Legacy UnityLoader.instantiate — skip TemplateData splash delay */
	if (window.UnityLoader && typeof window.UnityLoader.instantiate === 'function') {
		var origInstantiate = window.UnityLoader.instantiate.bind(window.UnityLoader);
		window.UnityLoader.instantiate = function (container, url, opts) {
			hideLoadingDom();
			opts = opts || {};
			if (opts.onProgress) {
				var origProgress = opts.onProgress;
				opts.onProgress = function (gameInstance, progress) {
					hideLoadingDom();
					return origProgress(gameInstance, progress);
				};
			}
			return origInstantiate(container, url, opts);
		};
	}

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
			if (window.__ptAudioOutputMuted || window.__ptGamePaused) {
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
		if (window.__ptAudioOutputMuted || window.__ptGamePaused) return;
		for (var i = 0; i < audioContexts.length; i++) {
			try {
				if (audioContexts[i].state === 'suspended') audioContexts[i].resume();
			} catch (e) {}
		}
	}

	function applyEffectiveAudioMute() {
		var effective = !!window.__ptAudioOutputMuted || !!window.__ptGamePaused;
		for (var i = 0; i < audioContexts.length; i++) {
			try {
				if (effective) {
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
		applyEffectiveAudioMute();
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
	}

	window.addEventListener('message', function (ev) {
		var data = ev && ev.data;
		if (!data || typeof data !== 'object') return;
		if (data.type === 'potato-tomato-unlock-audio') unlockAudio();
		if (data.type === 'potato-tomato-audio-output') setAudioOutputMuted(!!data.muted);
		if (data.type === 'potato-tomato-game-pause') setGamePaused(!!data.paused);
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
