import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { rewriteHtmlForLiveSession } from './proxy.js';
import { createLiveSession } from './session.js';

describe('live/proxy rewrite', () => {
	it('rewrites same-origin assets onto the session proxy prefix', () => {
		const session = createLiveSession({
			gameId: 'ovo',
			targetUrl: 'https://games.example.com/en_US/ovo/index.html'
		});
		const prefix = `/api/game-live/ovo/${session.id}`;
		const html = `<html><script src="Build/game.js"></script><link href="/shared/style.css" rel="stylesheet"></html>`;
		const out = rewriteHtmlForLiveSession(html, session, prefix);
		assert.match(out, new RegExp(`${prefix}/en_US/ovo/Build/game\\.js`));
		assert.match(out, new RegExp(`${prefix}/shared/style\\.css`));
	});

	it('routes cross-origin absolute URLs through _ext?u=', () => {
		const session = createLiveSession({
			gameId: 'ovo',
			targetUrl: 'https://games.example.com/en_US/ovo/index.html'
		});
		const prefix = `/api/game-live/ovo/${session.id}`;
		const html = `<script src="https://cdn.other.com/vendor.js"></script>`;
		const out = rewriteHtmlForLiveSession(html, session, prefix);
		assert.match(out, /_ext\?u=/);
		assert.match(out, /cdn\.other\.com/);
	});
});
