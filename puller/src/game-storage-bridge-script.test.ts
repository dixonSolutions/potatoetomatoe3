import assert from 'node:assert/strict';
import { test } from 'node:test';
import { injectGameStorageBridge } from './game-storage-bridge-script.js';

test('injects the bridge first in <head>, ahead of every game script', () => {
	const html =
		'<!doctype html><html><head lang="en"><script>localStorage.getItem("x")</script></head><body></body></html>';
	const out = injectGameStorageBridge(html, 'some-game');
	const bridgeAt = out.indexOf('window.__ptGameId=');
	assert.ok(bridgeAt > 0, 'bridge inlined');
	assert.ok(bridgeAt < out.indexOf('localStorage.getItem("x")'), 'bridge runs before game script');
	assert.ok(out.startsWith('<!doctype html><html><head lang="en"><script>'), 'right after <head>');
});

test('does not mistake <header> for <head>', () => {
	const out = injectGameStorageBridge('<body><header>hi</header></body>', 'g');
	assert.ok(out.indexOf('<script>') < out.indexOf('<header>'));
	assert.ok(out.startsWith('<body><script>'));
});

test('never leaves a raw </script> inside the inline bridge', () => {
	const out = injectGameStorageBridge('<head></head>', 'g');
	const inline = out.slice(out.indexOf('<script>') + 8, out.lastIndexOf('</script>'));
	assert.equal(/<\/script/i.test(inline), false);
});

test('escapes the game id', () => {
	const out = injectGameStorageBridge('<head></head>', '</script><b>');
	assert.equal(out.includes('"</script><b>"'), false);
});
