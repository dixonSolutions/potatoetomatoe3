import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/paths', () => ({ base: '' }));

import { gameLaunchOrigins } from './network-warmup';

describe('gameLaunchOrigins', () => {
	it('warms the embed host of an external game', () => {
		expect(
			gameLaunchOrigins({
				onlineEmbedUrl: 'https://games.crazygames.com/en_US/a-castle-for-trolls/index.html'
			})
		).toEqual(['https://games.crazygames.com']);
	});

	it('falls back to the remote play URL when there is no embed URL', () => {
		expect(
			gameLaunchOrigins({
				remotePlayUrl: 'https://app-192105.games.s3.yandex.net/192105/x/index.html'
			})
		).toEqual(['https://app-192105.games.s3.yandex.net']);
	});

	it('adds the Unity Play CDN for Unity games', () => {
		expect(
			gameLaunchOrigins({
				engine: 'unity',
				onlineEmbedUrl: 'https://play.unity.com/api/v1/games/game/abc/build/latest/frame'
			})
		).toEqual(['https://play.unity.com', 'https://cdn.play.unity.com']);
	});

	it('skips same-origin shells and anything that is not http(s)', () => {
		expect(
			gameLaunchOrigins(
				{ onlineEmbedUrl: 'https://dixonsolutions.github.io/potatoetomatoe3/games/x/online/' },
				'https://dixonsolutions.github.io'
			)
		).toEqual([]);
		expect(gameLaunchOrigins({ onlineEmbedUrl: '/games/x/online/index.html' })).toEqual([]);
		expect(gameLaunchOrigins({ onlineEmbedUrl: 'blob:https://x/y' })).toEqual([]);
		expect(gameLaunchOrigins(null)).toEqual([]);
	});
});
