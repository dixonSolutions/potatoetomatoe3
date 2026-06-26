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
