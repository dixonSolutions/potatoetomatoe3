import { describe, expect, it } from 'vitest';
import { isLocalOfflinePlayUrl } from './games';

describe('isLocalOfflinePlayUrl', () => {
	it('accepts blob URLs used by browser offline storage', () => {
		expect(isLocalOfflinePlayUrl('blob:http://localhost:5173/abc-123')).toBe(true);
	});

	it('accepts browser-offline and puller-games paths', () => {
		expect(isLocalOfflinePlayUrl('/browser-offline/microgame/online/index.html')).toBe(true);
		expect(isLocalOfflinePlayUrl('/puller-games/microgame/offline/index.html')).toBe(true);
	});

	it('accepts static offline game paths', () => {
		expect(isLocalOfflinePlayUrl('/games/microgame/offline/index.html')).toBe(true);
	});

	it('rejects remote Unity CDN embeds', () => {
		expect(isLocalOfflinePlayUrl('https://play.unity.com/game/xyz')).toBe(false);
		expect(isLocalOfflinePlayUrl('https://storage-direct.y8.com/build/index.html')).toBe(false);
	});
});
