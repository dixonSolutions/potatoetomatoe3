import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
	isCapturableUrl,
	localPathForUrl,
	relativePathForUrl,
	rewriteAbsoluteUrlsToMirroredExternal
} from './rewrite.js';

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

	it('rewrites absolute CDN URLs only when vaulted under _external', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-ext-'));
		const vaulted = path.join(
			root,
			'_external',
			'cdn.example.com',
			'Build',
			'game.json'
		);
		fs.mkdirSync(path.dirname(vaulted), { recursive: true });
		fs.writeFileSync(vaulted, '{}');
		const html = [
			'<script src="https://cdn.example.com/Build/game.json"></script>',
			'<script src="https://missing.example.com/nope.js"></script>'
		].join('');
		const out = rewriteAbsoluteUrlsToMirroredExternal(html, root);
		assert.match(out, /src="_external\/cdn\.example\.com\/Build\/game\.json"/);
		assert.match(out, /src="https:\/\/missing\.example\.com\/nope\.js"/);
		fs.rmSync(root, { recursive: true, force: true });
	});
});
