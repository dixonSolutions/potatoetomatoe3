/**
 * No `backdrop-filter` on WebKitGTK (issue #59).
 *
 * WebKitGTK's DMA-BUF renderer (the GNOME 50 runtime the Flatpak runs on, and
 * WebKitGTK 2.54 on the host) leaks without end when a page holds two or more
 * horizontally scrolling boxes that each contain an element with `backdrop-filter`. The
 * web process's compositor thread spins at full CPU and allocates about 400-500 MB/s
 * until the kernel OOM killer takes it — or, on a smaller machine, until the whole
 * desktop thrashes and stops responding. Home has exactly that: the favourite buttons on
 * the cards in both of its carousels used `backdrop-blur-sm`. It is not the app's own
 * code: the published web build leaks the same way in a bare WebKitGTK view, and a
 * standalone page with nothing but those two scrollers reproduces it
 * (docs/field-tests/webkitgtk-backdrop-leak-2026-10-16/REPORT.md).
 *
 * The fix is to never ask WebKitGTK for a backdrop filter. The early script in
 * `app.html` sets {@link NO_BACKDROP_FILTER_ATTR} on `<html>` before the first paint,
 * and `app.css` turns every backdrop filter off under it; once the compositor has
 * started leaking, removing the filter no longer stops it, so it has to be off from the
 * first frame. Elements that were translucent only because of the blur use the
 * `no-backdrop:` variant to stay legible.
 *
 * Every other engine keeps its blur: Safari renders it through Core Animation,
 * Chromium and Firefox through their own compositors, none of which has this bug.
 */

/** Set on `<html>` when the engine must not be given a backdrop filter. */
export const NO_BACKDROP_FILTER_ATTR = 'data-no-backdrop-filter';

/**
 * The test `app.html` inlines. WebKitGTK (and WPE) say `AppleWebKit` on Linux; Chromium
 * says `AppleWebKit` too but adds its own token, and Android WebView says `Android`.
 * Keep `app.html` in step: a spec compares the two.
 */
export const WEBKITGTK_UA = {
	engine: /AppleWebKit\//,
	platform: /\bLinux\b/,
	notWebKitGtk: /Android|Chrome\/|Chromium\/|CriOS\/|HeadlessChrome|Edg\/|OPR\//
} as const;

/** Whether `userAgent` is WebKitGTK or WPE, the engines with the leak. */
export function isWebKitGtkUserAgent(userAgent: string): boolean {
	return (
		WEBKITGTK_UA.engine.test(userAgent) &&
		WEBKITGTK_UA.platform.test(userAgent) &&
		!WEBKITGTK_UA.notWebKitGtk.test(userAgent)
	);
}
