import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';
import { isCapturableUrl, localPathForUrl, relativePathForUrl } from './rewrite.js';

describe('capture/rewrite', () => {
	const outDir = '/tmp/offline-game';
	const baseUrl = 'https://cdn.example.com/games/foo/';

	it('maps same-origin assets under the game path', () => {
		const dest = localPathForUrl(baseUrl, 'https://cdn.example.com/games/foo/Build/game.js', outDir);
		assert.equal(dest, path.join(outDir, 'Build', 'game.js'));
	});

	it('maps cross-origin assets under _external/host', () => {
		const dest = localPathForUrl(
			baseUrl,
			'https://assets.other.com/img/logo.png',
			outDir
		);
		assert.equal(dest, path.join(outDir, '_external', 'assets.other.com', 'img', 'logo.png'));
	});

	it('returns relative paths with forward slashes', () => {
		const rel = relativePathForUrl(
			baseUrl,
			'https://cdn.example.com/games/foo/style.css',
			outDir
		);
		assert.equal(rel, 'style.css');
	});

	it('rejects blob and data URLs', () => {
		assert.equal(isCapturableUrl('blob:https://x/1'), false);
		assert.equal(isCapturableUrl('data:text/plain,hi'), false);
		assert.equal(isCapturableUrl('https://cdn.example.com/a.js'), true);
	});
});
