import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { liveSessionBaseHref, rewriteHtmlForLiveSession } from './proxy.js';
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
		assert.match(out, new RegExp(`<base href="${prefix}/en_US/ovo/">`));
	});

	it('sets <base> so OpenFL relative assets keep the live session prefix', () => {
		const session = createLiveSession({
			gameId: 'g-switch-3',
			targetUrl: 'https://abinbins.github.io/a4/g-switch-3'
		});
		session.baseHref = 'https://abinbins.github.io/a4/g-switch-3';
		const prefix = `/api/game-live/g-switch-3/${session.id}`;
		assert.equal(liveSessionBaseHref(session, prefix), `${prefix}/a4/g-switch-3/`);
		const out = rewriteHtmlForLiveSession(
			`<html><head></head><script src="G-Switch3.js"></script></html>`,
			session,
			prefix
		);
		assert.match(out, new RegExp(`<base href="${prefix}/a4/g-switch-3/">`));
		assert.match(out, new RegExp(`${prefix}/a4/g-switch-3/G-Switch3\\.js`));
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

	it('treats extensionless game paths as directories for Build assets', () => {
		const session = createLiveSession({
			gameId: 'mob-city',
			targetUrl: 'https://abinbins.github.io/a/mob-city'
		});
		session.baseHref = 'https://abinbins.github.io/a/mob-city';
		const prefix = `/api/game-live/mob-city/${session.id}`;
		const html = `<script src="Build/UnityLoader.js"></script>
<script>UnityLoader.instantiate("gameContainer", "Build/mob-city.json", {});</script>`;
		const out = rewriteHtmlForLiveSession(html, session, prefix);
		assert.match(out, new RegExp(`${prefix}/a/mob-city/Build/UnityLoader\\.js`));
		assert.match(out, new RegExp(`${prefix}/a/mob-city/Build/mob-city\\.json`));
		assert.doesNotMatch(out, new RegExp(`${prefix}/a/Build/`));
	});
});
