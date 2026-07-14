import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$app/paths', () => ({ base: '' }));

vi.mock('$lib/utils/offline-downloader-puller', () => ({
	shouldUsePullerGameProxy: vi.fn(() => true),
	pullerOfflineAssetUrl: vi.fn(
		(gameId: string, relPath: string, basePath = '') =>
			`${basePath}/puller-games/${gameId}/offline/${relPath}`.replace(/\/{2,}/g, '/')
	)
}));

vi.mock('$lib/utils/offline-deployment', async () => {
	const actual = await vi.importActual<typeof import('./offline-deployment')>(
		'./offline-deployment'
	);
	return {
		...actual,
		shouldProbePullerBackend: vi.fn(() => false),
		isPublicSiteDeployment: vi.fn(() => false)
	};
});

import { resolveGameThumbnailSrc } from './games';
import { shouldUsePullerGameProxy } from './offline-downloader-puller';
import { shouldProbePullerBackend } from './offline-deployment';

describe('resolveGameThumbnailSrc offline covers', () => {
	beforeEach(() => {
		vi.mocked(shouldUsePullerGameProxy).mockReturnValue(true);
		vi.mocked(shouldProbePullerBackend).mockReturnValue(false);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it('uses puller-proxied offline cover when preferOffline and rel path are set', () => {
		const src = resolveGameThumbnailSrc('https://cdn.example/cover.jpg', {
			gameId: 'demo-game',
			preferOffline: true,
			offlineThumbnailRel: 'assets/thumbnail.png'
		});
		expect(src).toBe('/puller-games/demo-game/offline/assets/thumbnail.png');
	});

	it('falls back to catalog remote thumb when offline cover is not preferred', () => {
		const src = resolveGameThumbnailSrc('https://cdn.example/cover.jpg', {
			gameId: 'demo-game',
			preferOffline: false,
			offlineThumbnailRel: 'assets/thumbnail.png'
		});
		expect(src).toBe('https://cdn.example/cover.jpg');
	});

	it('uses blob offlineThumbnail URLs as-is', () => {
		const src = resolveGameThumbnailSrc('https://cdn.example/cover.jpg', {
			gameId: 'demo-game',
			preferOffline: true,
			offlineThumbnailRel: 'blob:http://localhost/abc'
		});
		expect(src).toBe('blob:http://localhost/abc');
	});
});
