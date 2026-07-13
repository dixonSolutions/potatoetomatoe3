import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
	applyOfflineAdStripping,
	indexHtmlReferencesPokiSdk,
	indexHtmlReferencesYandexSdk,
	stripAdIframes
} from './apply.js';

describe('ads/apply', () => {
	it('detects Poki and Yandex SDK references', () => {
		assert.equal(indexHtmlReferencesPokiSdk('<script src="poki-sdk.js"></script>'), true);
		assert.equal(indexHtmlReferencesYandexSdk('window.YaGames = {}'), true);
		assert.equal(indexHtmlReferencesPokiSdk('<html></html>'), false);
	});

	it('strips known ad iframes', () => {
		const html =
			'<html><iframe src="https://googleads.g.doubleclick.net/pagead/ads"></iframe><iframe src="https://game.cdn/play"></iframe></html>';
		const out = stripAdIframes(html);
		assert.match(out, /ad iframe removed/);
		assert.match(out, /game\.cdn\/play/);
	});

	it('writes offline stubs and injects scripts into entry HTML', async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pt-ads-'));
		const html = `<!DOCTYPE html><html><head></head><body>
<script src="https://game-cdn.poki.com/scripts/v2/poki-sdk.js"></script>
<iframe src="https://securepubads.g.doubleclick.net/gampad"></iframe>
</body></html>`;
		await fs.writeFile(path.join(dir, 'index.html'), html, 'utf-8');

		await applyOfflineAdStripping({ outDir: dir, entryRel: 'index.html' });

		const result = await fs.readFile(path.join(dir, 'index.html'), 'utf-8');
		assert.match(result, /poki-sdk\.js/);
		assert.match(result, /pt-adfree\.js/);
		assert.match(result, /ad iframe removed/);

		const poki = await fs.readFile(path.join(dir, 'poki-sdk.js'), 'utf-8');
		assert.match(poki, /PokiSDK/);
		assert.match(poki, /commercialBreak/);

		const generic = await fs.readFile(path.join(dir, 'pt-adfree.js'), 'utf-8');
		assert.match(generic, /__ptAdFree/);
	});
});
