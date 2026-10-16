import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isWebKitGtkUserAgent, NO_BACKDROP_FILTER_ATTR, WEBKITGTK_UA } from './webkitgtk-backdrop';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('isWebKitGtkUserAgent', () => {
	it('matches the Linux app and WebKitGTK browsers', () => {
		for (const ua of [
			/* The Flatpak's own webview, as its inspector reported it. */
			'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/60.5 Safari/605.1.15',
			/* GNOME Web. */
			'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 Epiphany/605.1.15',
			'Mozilla/5.0 (X11; Fedora; Linux aarch64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
		]) {
			expect(isWebKitGtkUserAgent(ua), ua).toBe(true);
		}
	});

	it('leaves every other engine its blur', () => {
		for (const ua of [
			'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
			'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
			'Mozilla/5.0 (Linux; Android 14; SM-T575 Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Safari/537.36',
			'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
			'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
			'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36'
		]) {
			expect(isWebKitGtkUserAgent(ua), ua).toBe(false);
		}
	});
});

describe('the page wiring', () => {
	const html = read('../../app.html');
	const css = read('../../app.css');

	it('app.html marks <html> before the first paint with the same test', () => {
		expect(html).toContain(`'${NO_BACKDROP_FILTER_ATTR}'`);
		for (const re of Object.values(WEBKITGTK_UA)) {
			expect(html, `app.html is missing ${re}`).toContain(String(re));
		}
		/* Before %sveltekit.head%: nothing the app renders may paint first. */
		expect(html.indexOf(NO_BACKDROP_FILTER_ATTR)).toBeLessThan(html.indexOf('%sveltekit.head%'));
	});

	it('app.css turns every backdrop filter off under the attribute', () => {
		const rule = css.slice(css.indexOf(`html[${NO_BACKDROP_FILTER_ATTR}] *`));
		expect(rule).toMatch(/^html\[data-no-backdrop-filter\] \*,/);
		expect(rule).toContain('-webkit-backdrop-filter: none !important;');
		expect(rule).toContain('backdrop-filter: none !important;');
		expect(css).toContain(`@custom-variant no-backdrop (html[${NO_BACKDROP_FILTER_ATTR}] &);`);
	});
});
