import { describe, expect, it } from 'vitest';
import { decodeHtmlEntitiesInUrl, sizedThumbnailUrl } from './thumbnail-size';

const COVER = 'https://imgs.crazygames.com/home-pin-2-fpx_16x9/2026/cover';

describe('decodeHtmlEntitiesInUrl', () => {
	it('undoes the importer escaping that broke CDN sizing', () => {
		expect(decodeHtmlEntitiesInUrl(`${COVER}?metadata=none&amp;width=1200`)).toBe(
			`${COVER}?metadata=none&width=1200`
		);
		expect(decodeHtmlEntitiesInUrl(`${COVER}?a=1&#38;b=2`)).toBe(`${COVER}?a=1&b=2`);
	});

	it('leaves a clean URL alone', () => {
		expect(decodeHtmlEntitiesInUrl(`${COVER}?a=1&b=2`)).toBe(`${COVER}?a=1&b=2`);
	});
});

describe('sizedThumbnailUrl', () => {
	it('replaces the escaped, ignored parameters with real ones', () => {
		/*
		 * Regression: with `&amp;` the CDN saw `amp;width` and returned the 2730x1535
		 * original for a 138px tile.
		 */
		const url = new URL(
			sizedThumbnailUrl(`${COVER}?metadata=none&amp;quality=100&amp;width=1200&amp;height=630`)
		);
		expect(url.searchParams.get('width')).toBe('512');
		expect(url.searchParams.get('height')).toBe('288');
		expect(url.searchParams.get('fit')).toBe('crop');
		expect(url.searchParams.has('amp;width')).toBe(false);
	});

	it('sizes a cover that carried no parameters at all', () => {
		const url = new URL(sizedThumbnailUrl(`${COVER}`, 240));
		expect(url.searchParams.get('width')).toBe('240');
		expect(url.searchParams.get('height')).toBe('135');
	});

	it('never asks for an absurdly small image', () => {
		expect(new URL(sizedThumbnailUrl(COVER, 10)).searchParams.get('width')).toBe('120');
	});

	it('leaves hosts without a known resizing API untouched apart from unescaping', () => {
		const other = 'https://play.unity.com/api/v1/files/file/abc/content?a=1&amp;b=2';
		expect(sizedThumbnailUrl(other)).toBe(
			'https://play.unity.com/api/v1/files/file/abc/content?a=1&b=2'
		);
	});

	it('passes through local, blob and malformed values', () => {
		expect(sizedThumbnailUrl('/games/x/assets/thumb.png')).toBe('/games/x/assets/thumb.png');
		expect(sizedThumbnailUrl('not a url')).toBe('not a url');
	});
});
