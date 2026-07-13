import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractIframeSrc, parseEmbedFileUrl } from './frames.js';

describe('capture/frames', () => {
	it('extracts http iframe src', () => {
		const html = '<iframe src="https://cdn.example.com/game/index.html" width="100%"></iframe>';
		assert.equal(extractIframeSrc(html), 'https://cdn.example.com/game/index.html');
	});

	it('parses FILE_URL from embed launcher', () => {
		const html = `const FILE_URL = 'https://cdn.jsdelivr.net/gh/owner/repo@main/1.xml';`;
		assert.equal(
			parseEmbedFileUrl(html),
			'https://cdn.jsdelivr.net/gh/owner/repo@main/1.xml'
		);
	});

	it('returns null when no iframe', () => {
		assert.equal(extractIframeSrc('<html><body>no game</body></html>'), null);
	});
});
