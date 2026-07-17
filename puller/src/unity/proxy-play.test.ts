import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { absolutizeAgainstBase, documentBaseHref } from './proxy-play.js';

describe('unity/proxy-play absolutize', () => {
	it('treats extensionless paths as directories', () => {
		assert.equal(
			documentBaseHref('https://abinbins.github.io/a/mob-city'),
			'https://abinbins.github.io/a/mob-city/'
		);
	});

	it('keeps file URLs as files', () => {
		assert.equal(
			documentBaseHref('https://cdn.example.com/games/foo/index.html'),
			'https://cdn.example.com/games/foo/index.html'
		);
	});

	it('rewrites Build assets under the game directory, not the parent', () => {
		const html = `<!doctype html><html><head>
<script src="Build/UnityLoader.js"></script>
<script>var gameInstance = UnityLoader.instantiate("gameContainer", "Build/mob-city.json", {onProgress: UnityProgress});</script>
</head><body></body></html>`;
		const out = absolutizeAgainstBase(html, 'https://abinbins.github.io/a/mob-city');
		assert.match(out, /src="https:\/\/abinbins\.github\.io\/a\/mob-city\/Build\/UnityLoader\.js"/);
		assert.match(
			out,
			/UnityLoader\.instantiate\("gameContainer", "https:\/\/abinbins\.github\.io\/a\/mob-city\/Build\/mob-city\.json"/
		);
		assert.match(out, /<base href="https:\/\/abinbins\.github\.io\/a\/mob-city\/">/);
		assert.doesNotMatch(out, /https:\/\/abinbins\.github\.io\/a\/Build\//);
	});
});
