import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildMirrorManifest } from './mirror-manifest.js';

test('builds a deterministic integrity manifest for a mirror', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'potato-tomato-mirror-'));
	try {
		await fs.mkdir(path.join(root, 'assets'));
		await fs.writeFile(path.join(root, 'index.html'), '<!doctype html>');
		await fs.writeFile(path.join(root, 'assets', 'game.js'), 'console.log("ok");');

		const manifest = await buildMirrorManifest(root, {
			gameId: 'fixture',
			entry: 'index.html',
			mirroredFrom: 'https://example.test/game/',
			captureMethod: 'playwright',
			notes: []
		});

		assert.equal(manifest.version, 1);
		assert.deepEqual(
			manifest.files.map((file) => file.path),
			['assets/game.js', 'index.html']
		);
		assert.match(manifest.files[0].sha256, /^[a-f0-9]{64}$/);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});
