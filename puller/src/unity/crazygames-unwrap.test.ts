import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	extractCrazyGamesUnityBuild,
	isCrazyGamesShellHtml
} from './crazygames-unwrap.js';

const SAMPLE = `
var options = {"loader":"5.6.x","loaderOptions":{"moduleJsonUrl":"https://files.crazygames.com/tunnel-rush/5/Build/tunnel_rush_dec_build18.json","unityLoaderUrl":"https://files.crazygames.com/unityloaders/UnityLoader-v3.js"},"gameName":"Color Tunnel"};
var gfBuildPath = 'https://builds.crazygames.com/gameframe';
var useLocalGF = false;
loadScript(gameframeJs, function() { Crazygames.load(options); });
`;

describe('crazygames-shell detect', () => {
	it('extracts moduleJsonUrl + unityLoaderUrl', () => {
		const build = extractCrazyGamesUnityBuild(SAMPLE);
		assert.ok(build);
		assert.equal(
			build.moduleJsonUrl,
			'https://files.crazygames.com/tunnel-rush/5/Build/tunnel_rush_dec_build18.json'
		);
		assert.equal(
			build.unityLoaderUrl,
			'https://files.crazygames.com/unityloaders/UnityLoader-v3.js'
		);
	});

	it('classifies CrazyGames gameframe HTML as a portal shell', () => {
		assert.equal(isCrazyGamesShellHtml(SAMPLE), true);
		assert.equal(isCrazyGamesShellHtml('<html><script>UnityLoader.instantiate("c","Build/g.json")</script></html>'), false);
	});
});
