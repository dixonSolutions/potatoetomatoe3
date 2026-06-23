/**
 * In-game iframe helper: sync localStorage with the Potato Tomato shell via postMessage.
 * Auto-detects game id from /games/, /puller-games/, or /browser-offline/ URLs.
 */
(function () {
	var TYPE = 'potato-tomato-game-storage';

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

	function snapshotLocalStorage() {
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

	function pushToParent(gameId) {
		if (!gameId || window.parent === window) return;
		window.parent.postMessage(
			{
				type: TYPE,
				action: 'push',
				gameId: gameId,
				data: { localStorage: snapshotLocalStorage() }
			},
			'*'
		);
	}

	var gameId = detectGameId();
	if (!gameId || window.parent === window) return;

	window.addEventListener('message', function (event) {
		var msg = event.data;
		if (!msg || msg.type !== TYPE || msg.gameId !== gameId) return;
		if (msg.action !== 'hydrate' || !msg.data || !msg.data.localStorage) return;
		var stored = msg.data.localStorage;
		for (var key in stored) {
			if (!Object.prototype.hasOwnProperty.call(stored, key)) continue;
			try {
				localStorage.setItem(key, stored[key]);
			} catch (e) {
				/* ignore quota */
			}
		}
	});

	window.parent.postMessage({ type: TYPE, action: 'pull', gameId: gameId }, '*');
	setInterval(function () {
		pushToParent(gameId);
	}, 4000);
	window.addEventListener('pagehide', function () {
		pushToParent(gameId);
	});
})();
