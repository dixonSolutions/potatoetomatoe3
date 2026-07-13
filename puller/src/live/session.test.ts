import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	allowOrigin,
	createLiveSession,
	getLiveSession,
	isOriginAllowed,
	resolveSessionAssetUrl
} from './session.js';

describe('live/session', () => {
	it('creates a session scoped to the game and target origin', () => {
		const session = createLiveSession({
			gameId: 'ovo',
			targetUrl: 'https://games.example.com/en_US/ovo/index.html'
		});
		assert.equal(session.gameId, 'ovo');
		assert.equal(session.targetOrigin, 'https://games.example.com');
		assert.equal(isOriginAllowed(session, 'https://games.example.com'), true);
		assert.equal(getLiveSession('ovo', session.id)?.id, session.id);
		assert.equal(getLiveSession('other', session.id), null);
	});

	it('resolves relative assets and allowlisted absolute overrides', () => {
		const session = createLiveSession({
			gameId: 'ovo',
			targetUrl: 'https://games.example.com/en_US/ovo/index.html'
		});
		const relative = resolveSessionAssetUrl(session, 'Build/game.js');
		assert.equal(relative, 'https://games.example.com/en_US/ovo/Build/game.js');

		allowOrigin(session, 'https://cdn.example.com');
		const absolute = resolveSessionAssetUrl(
			session,
			'_ext',
			'https://cdn.example.com/a.wasm'
		);
		assert.equal(absolute, 'https://cdn.example.com/a.wasm');
		assert.throws(
			() => resolveSessionAssetUrl(session, '_ext', 'https://evil.example/x'),
			/not allowed/
		);
	});
});
