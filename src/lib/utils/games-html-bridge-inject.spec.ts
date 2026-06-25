import { describe, expect, it } from 'vitest';
import { injectBridgeIntoHtml } from '../../../vite-plugins/games-html-bridge-inject';

describe('games-html-bridge-inject', () => {
	it('injects bridge script into head', () => {
		const html = '<html><head><title>t</title></head><body></body></html>';
		const out = injectBridgeIntoHtml(html);
		expect(out).toContain('game-storage-bridge.child.js');
		expect(out.indexOf('game-storage-bridge')).toBeLessThan(out.indexOf('</head>'));
	});

	it('does not double-inject', () => {
		const html =
			'<html><head><script src="/game-storage-bridge.child.js"></script></head><body></body></html>';
		expect(injectBridgeIntoHtml(html)).toBe(html);
	});
});
