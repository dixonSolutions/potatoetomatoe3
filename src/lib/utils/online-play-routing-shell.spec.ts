import { describe, expect, it } from 'vitest';
import { buildShellHtml, insertFirstInHead, looksLikeHtml } from './online-play-routing-shell';

const bridge = 'http://app.test/game-storage-bridge.child.js';

describe('buildShellHtml', () => {
	it('puts the base and the bridge ahead of everything in <head>', () => {
		const out = buildShellHtml(
			'<!DOCTYPE html><html lang="en"><head><script src="game.js"></script></head></html>',
			{ gameId: 'g-1', baseHref: 'https://cdn.jsdelivr.net/gh/u/r@1/index.html', bridgeSrc: bridge }
		);
		const base = out.indexOf('<base href="https://cdn.jsdelivr.net/gh/u/r@1/index.html">');
		const bridgeAt = out.indexOf(`<script src="${bridge}" data-pt-game="g-1"></script>`);
		expect(out.indexOf('<head>')).toBeLessThan(base);
		expect(base).toBeLessThan(bridgeAt);
		expect(bridgeAt).toBeLessThan(out.indexOf('game.js'));
	});

	it('keeps a page’s own <base> (Drive U 7 embed.html brings one)', () => {
		const html = '<html><head><base href="https://cdn.jsdelivr.net/gh/x/y@main/a/"></head></html>';
		const out = buildShellHtml(html, {
			gameId: 'g',
			baseHref: 'https://other/',
			bridgeSrc: bridge
		});
		expect(out).not.toContain('https://other/');
		expect(out).toContain('data-pt-game="g"');
	});

	it('replaces a bridge tag written for the page’s own URL, which the shell’s base would break', () => {
		/* The dev server injects this into catalog HTML; under a jsDelivr <base> it would 404. */
		const html =
			'<head><script src="/game-storage-bridge.child.js"></script><base href="https://cdn.x/"></head>';
		const out = buildShellHtml(html, { gameId: 'g', bridgeSrc: bridge });
		expect(out.match(/game-storage-bridge\.child\.js/g)).toHaveLength(1);
		expect(out).toContain(`<script src="${bridge}" data-pt-game="g"></script>`);
	});

	it('escapes what it writes into attributes', () => {
		const out = buildShellHtml('<head></head>', {
			gameId: 'a"<b>',
			baseHref: 'https://h/?q="x"',
			bridgeSrc: bridge
		});
		expect(out).toContain('data-pt-game="ab"');
		expect(out).toContain('href="https://h/?q=&quot;x&quot;"');
	});
});

describe('insertFirstInHead', () => {
	it('falls back to <html>, then to the very start', () => {
		expect(insertFirstInHead('<html><body></body></html>', 'X')).toBe(
			'<html>X<body></body></html>'
		);
		expect(insertFirstInHead('<p>bare</p>', 'X')).toBe('X<p>bare</p>');
		expect(insertFirstInHead('<header>not head</header>', 'X')).toBe('X<header>not head</header>');
	});
});

describe('looksLikeHtml', () => {
	it('recognises HTML served as text/plain and rejects other text', () => {
		expect(looksLikeHtml('\uFEFF  <!DOCTYPE html><html>')).toBe(true);
		expect(looksLikeHtml('<html lang="en">')).toBe(true);
		expect(looksLikeHtml('{"not":"html"}')).toBe(false);
		expect(looksLikeHtml('console.log(1)')).toBe(false);
	});
});
