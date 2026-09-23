import { afterEach, describe, expect, it, vi } from 'vitest';
import { readOnlineShellIframeSrc } from './browser-offline-download';

/* The catalog shell (online/index.html) framing `src`. */
function shellFraming(src: string) {
	vi.stubGlobal('window', { location: { origin: 'http://app.test' } });
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(`<html><body><iframe src="${src}"></iframe></body></html>`))
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('readOnlineShellIframeSrc', () => {
	it('hands back a web page on another host, which the desktop app frames in its place', async () => {
		shellFraming('https://games.example/play/index.html?x=1');
		expect(await readOnlineShellIframeSrc('g')).toBe('https://games.example/play/index.html?x=1');
		shellFraming('http://games.example/play');
		expect(await readOnlineShellIframeSrc('g')).toBe('http://games.example/play');
	});

	it('refuses anything but http(s), and the app’s own pages', async () => {
		for (const src of [
			'javascript:alert(1)',
			'httpjs:alert(1)',
			'http-evil:x',
			'data:text/html,hi',
			'blob:http://app.test/1',
			'http://app.test/games/other/online/index.html'
		]) {
			shellFraming(src);
			expect(await readOnlineShellIframeSrc('g'), src).toBeNull();
		}
	});
});
