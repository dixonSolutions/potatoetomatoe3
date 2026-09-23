import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$app/paths', () => ({ base: '' }));

vi.mock('$lib/utils/offline-downloader-puller', () => ({
	shouldUsePullerGameProxy: vi.fn(() => true),
	pullerOfflineAssetUrl: vi.fn((gameId: string, relPath: string, basePath = '') =>
		`${basePath}/puller-games/${gameId}/offline/${relPath}`.replace(/\/{2,}/g, '/')
	)
}));

vi.mock('$lib/utils/offline-deployment', async () => {
	const actual =
		await vi.importActual<typeof import('./offline-deployment')>('./offline-deployment');
	return {
		...actual,
		shouldProbePullerBackend: vi.fn(() => false),
		isPublicSiteDeployment: vi.fn(() => false)
	};
});

import { resolveGameThumbnailSources, resolveGameThumbnailSrc } from './games';
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

describe('resolveGameThumbnailSources', () => {
	const CRAZY =
		'https://imgs.crazygames.com/cover?metadata=none&amp;quality=100&amp;width=1200&amp;height=630';

	it('offers resized candidates and keeps the unescaped original as the fallback', () => {
		const sources = resolveGameThumbnailSources(CRAZY, { gameId: 'demo', boxAspect: 1 });
		expect(sources.srcset?.split(', ')).toHaveLength(4);
		expect(new URL(sources.src!).searchParams.get('width')).toBe('384');
		expect(sources.fallbackSrc).toBe(
			'https://imgs.crazygames.com/cover?metadata=none&quality=100&width=1200&height=630'
		);
	});

	it('uses the original alone for hosts without a resizer', () => {
		expect(resolveGameThumbnailSources('https://cdn.example/cover.jpg')).toEqual({
			src: 'https://cdn.example/cover.jpg'
		});
	});

	it('requests nothing for missing or known-dead covers', () => {
		expect(resolveGameThumbnailSources('')).toEqual({ src: null });
		expect(resolveGameThumbnailSources('/games/x/online/assets/.gitkeep')).toEqual({ src: null });
		expect(
			resolveGameThumbnailSources('https://sites.google.com/sitesv-images-rt/ACHe0d2gHlko')
		).toEqual({ src: null });
	});

	it('prefers the offline cover and never resizes it', () => {
		expect(
			resolveGameThumbnailSources(CRAZY, {
				gameId: 'demo',
				preferOffline: true,
				offlineThumbnailRel: 'assets/thumbnail.png'
			})
		).toEqual({ src: '/puller-games/demo/offline/assets/thumbnail.png' });
	});

	it('serves local catalog covers as they are', () => {
		expect(resolveGameThumbnailSources('/games/x/online/assets/thumb.png')).toEqual({
			src: '/games/x/online/assets/thumb.png'
		});
	});
});
