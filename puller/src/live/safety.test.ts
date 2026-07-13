import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertSafePlayUrl, isBlockedHostname } from './safety.js';

describe('live/safety', () => {
	it('blocks localhost and private hosts', () => {
		assert.equal(isBlockedHostname('localhost'), true);
		assert.equal(isBlockedHostname('127.0.0.1'), true);
		assert.equal(isBlockedHostname('10.0.0.2'), true);
		assert.equal(isBlockedHostname('192.168.1.1'), true);
		assert.equal(isBlockedHostname('cdn.example.com'), false);
	});

	it('accepts public http(s) play targets', () => {
		const url = assertSafePlayUrl('https://games.example.com/play/index.html');
		assert.equal(url.hostname, 'games.example.com');
	});

	it('rejects private and non-http targets', () => {
		assert.throws(() => assertSafePlayUrl('http://127.0.0.1/secret'), /not allowed/);
		assert.throws(() => assertSafePlayUrl('file:///etc/passwd'), /http\(s\)/);
	});
});
