/*
 * WebKitGTK tuning for game frames (see game_frame_tuning.rs).
 *
 * Installed natively as a document-start user script in every frame of the app's webview
 * while a game page is open, and removed when it is left. It runs before any of the
 * frame's own script. It only ever touches frames inside the app page, never the app's own
 * top document, and it must never throw into the page.
 *
 *   dprCap              The display's real scale on a fractional-scaled desktop (1.25 at
 *                       125 %), when WebKit reports more (GTK3 renders at 2 there). Games
 *                       size their canvases from devicePixelRatio, so with the cap they draw
 *                       the pixels the monitor shows instead of 2.56 times as many.
 *   swallowFirstInput   The app sends one F24 key press into a game frame that has focus,
 *                       to lift WebKit's 30 fps throttle on cross-origin frames the user has
 *                       not touched yet (frame_first_input.rs). Swallow it here, in capture
 *                       phase on the window, before any listener of the game's can see it.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- called by name from game_frame_tuning.rs
function ptGameFrameTuning(T) {
	if (window.top === window) return;
	var ancestors = location.ancestorOrigins;
	if (!ancestors || !ancestors.length || ancestors[ancestors.length - 1] !== T.appOrigin) return;
	/* document.open() re-runs user scripts against the same global. */
	if (window.__ptGameFrameTuning) return;
	window.__ptGameFrameTuning = true;

	var cap = Number(T.dprCap);
	if (cap > 0 && window.devicePixelRatio > cap + 0.001) {
		Object.defineProperty(window, 'devicePixelRatio', {
			configurable: true,
			enumerable: true,
			get: function () {
				return cap;
			},
			/* [Replaceable], as the real one is: a game assigning it gets its own value. */
			set: function (value) {
				Object.defineProperty(window, 'devicePixelRatio', {
					configurable: true,
					enumerable: true,
					writable: true,
					value: value
				});
			}
		});
	}

	if (T.swallowFirstInput) {
		var swallow = function (event) {
			if (!event.isTrusted) return;
			if (event.keyCode !== 135 && event.key !== 'F24' && event.code !== 'F24') return;
			event.stopImmediatePropagation();
			event.preventDefault();
		};
		window.addEventListener('keydown', swallow, true);
		window.addEventListener('keypress', swallow, true);
		window.addEventListener('keyup', swallow, true);
	}
}
