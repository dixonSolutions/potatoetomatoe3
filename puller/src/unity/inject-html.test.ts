import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { injectUnityPatches, stripUnityPortalBloat } from './inject-html.js';

describe('unity/inject-html portal bloat', () => {
	it('strips dead adinLoader.js that 404s as HTML (Script error)', () => {
		const html = `<!doctype html><html><head>
<script src="/adinLoader.js"></script>
<script src="UnityLoader.js"></script>
<script>var gameInstance = UnityLoader.instantiate("c", "build.json");</script>
</head><body>
<div id="gameContainer"></div>
<script>
  if (typeof getAdinDomain !== 'undefined') {
    const bodyTag = document.getElementsByTagName('body')[0];
    let addAdinPreroll = document.createElement('script');
    addAdinPreroll.src = getAdinDomain;
    bodyTag.appendChild(addAdinPreroll);
  }
</script>
</body></html>`;
		const out = stripUnityPortalBloat(html);
		assert.doesNotMatch(out, /adinLoader/i);
		assert.doesNotMatch(out, /getAdinDomain/);
		assert.match(out, /UnityLoader\.js/);
		assert.match(out, /UnityLoader\.instantiate/);
	});

	it('injectUnityPatches still injects before Unity loader', () => {
		const html = `<html><head>
<script src="https://abinbins.github.io/adinLoader.js"></script>
<script src="UnityLoader.js"></script>
</head><body><div id="gameContainer"></div></body></html>`;
		const out = injectUnityPatches(html);
		assert.match(out, /__ptUnityInjectInstalled/);
		assert.doesNotMatch(out, /adinLoader/i);
		const injectAt = out.indexOf('__ptUnityInjectInstalled');
		const loaderAt = out.indexOf('UnityLoader.js');
		assert.ok(injectAt >= 0 && loaderAt > injectAt);
	});
});
