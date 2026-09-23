import { describe, expect, it } from 'vitest';
import {
	decodeHtmlEntitiesInUrl,
	isDeadThumbnailUrl,
	sizedThumbnailUrl,
	thumbnailSrcset
} from './thumbnail-size';

const COVER = 'https://imgs.crazygames.com/home-pin-2-fpx_16x9/2026/cover';
const UNITY =
	'https://play.unity.com/api/v1/files/file/34770f41-f944-436f-9980-ab4530ca79a3/content';
const UNITY_DEFAULT = 'https://play.unity.com/assets/default_thumbnail.png';
const YANDEX =
	'https://avatars.mds.yandex.net/get-games/17921938/2a0000019ec1c64af530afd96637d69c38e7/orig';
const FNF = 'https://fnf-games.io/data/image/game/2v2-io/2v2-io.png';
const ADDICTING = 'https://prod.addictinggames.com/sites/default/files/1001-arabian-nights.jpg';

/** Parse a `srcset` into [url, descriptor-width] pairs. */
function candidates(srcset: string): Array<[string, number]> {
	return srcset.split(', ').map((c) => {
		const [url, w] = c.split(' ');
		return [url!, Number(w!.replace(/w$/, ''))];
	});
}

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
		expect(url.searchParams.get('width')).toBe('640');
		expect(url.searchParams.get('height')).toBe('360');
		expect(url.searchParams.get('fit')).toBe('crop');
		expect(url.searchParams.get('quality')).toBe('75');
		expect(url.searchParams.has('amp;width')).toBe(false);
	});

	it('rounds up to the next width on the shared ladder', () => {
		const url = new URL(sizedThumbnailUrl(`${COVER}`, 240));
		expect(url.searchParams.get('width')).toBe('256');
		expect(url.searchParams.get('height')).toBe('144');
		expect(new URL(sizedThumbnailUrl(COVER, 10)).searchParams.get('width')).toBe('256');
	});

	it('asks Unity Play for its own resized cover instead of the 1920x1080 PNG', () => {
		const url = new URL(sizedThumbnailUrl(UNITY, 300));
		expect(url.origin + url.pathname).toBe('https://play.unity.com/_next/image');
		expect(url.searchParams.get('url')).toBe(UNITY);
		expect(url.searchParams.get('w')).toBe('384');
		expect(url.searchParams.get('q')).toBe('75');
		expect(new URL(sizedThumbnailUrl(UNITY_DEFAULT, 200)).searchParams.get('url')).toBe(
			UNITY_DEFAULT
		);
	});

	it('leaves other play.unity.com paths alone', () => {
		const page = 'https://play.unity.com/en/games/abc/some-game';
		expect(sizedThumbnailUrl(page)).toBe(page);
	});

	it('swaps a Playhop /orig for a size alias', () => {
		expect(sizedThumbnailUrl(YANDEX, 200)).toBe(YANDEX.replace(/orig$/, 'pjpg256x256'));
		expect(sizedThumbnailUrl(YANDEX, 384)).toBe(YANDEX.replace(/orig$/, '384x384'));
		expect(sizedThumbnailUrl(YANDEX, 1000)).toBe(YANDEX.replace(/orig$/, '512x512'));
	});

	it('uses the pre-rendered fnf-games.io thumbnail for tiles', () => {
		expect(sizedThumbnailUrl(FNF, 180)).toBe(
			'https://fnf-games.io/cache/data/image/game/2v2-io/2v2-io-m200x200.webp'
		);
	});

	it('keeps the original when the only resized copy is far too small', () => {
		expect(sizedThumbnailUrl(FNF, 1080)).toBe(FNF);
	});

	it('leaves hosts without a known resizing API untouched apart from unescaping', () => {
		expect(sizedThumbnailUrl(`${ADDICTING}?a=1&amp;b=2`)).toBe(`${ADDICTING}?a=1&b=2`);
	});

	it('passes through local, blob and malformed values', () => {
		expect(sizedThumbnailUrl('/games/x/assets/thumb.png')).toBe('/games/x/assets/thumb.png');
		expect(sizedThumbnailUrl('not a url')).toBe('not a url');
	});
});

describe('thumbnailSrcset', () => {
	it('describes a 16:9 cover by the square it can fill, not its pixel width', () => {
		/*
		 * A 384x216 cover only covers a 216px square. Describing it as 384w would make the
		 * browser pick it for a 300px tile and stretch it 1.4x.
		 */
		const set = thumbnailSrcset(COVER, 1)!;
		expect(candidates(set.srcset).map(([, w]) => w)).toEqual([144, 216, 360, 607]);
		expect(new URL(set.src).searchParams.get('width')).toBe('384');
	});

	it('uses pixel widths when the cover already matches the box', () => {
		const set = thumbnailSrcset(COVER, 16 / 9)!;
		expect(candidates(set.srcset).map(([, w]) => w)).toEqual([256, 384, 640, 1080]);
	});

	it('uses pixel widths for a square icon in a wide box', () => {
		const set = thumbnailSrcset(YANDEX, 16 / 9)!;
		expect(candidates(set.srcset)).toEqual([
			[YANDEX.replace(/orig$/, 'pjpg160x160'), 160],
			[YANDEX.replace(/orig$/, 'pjpg256x256'), 256],
			[YANDEX.replace(/orig$/, '384x384'), 384],
			[YANDEX.replace(/orig$/, '512x512'), 512]
		]);
	});

	it('keeps every candidate URL free of the commas and spaces srcset splits on', () => {
		for (const url of [COVER, UNITY, YANDEX, FNF]) {
			for (const [candidate] of candidates(thumbnailSrcset(url)!.srcset)) {
				expect(candidate).not.toMatch(/[\s,]/);
			}
		}
	});

	it('returns null where there is no resizer, so the caller uses the original', () => {
		expect(thumbnailSrcset(ADDICTING)).toBeNull();
		expect(thumbnailSrcset('/games/x/online/assets/thumb.png')).toBeNull();
		expect(thumbnailSrcset('https://play.unity.com/en/games/abc')).toBeNull();
	});
});

describe('isDeadThumbnailUrl', () => {
	it('flags the expired Google Sites image links', () => {
		expect(isDeadThumbnailUrl('https://sites.google.com/sitesv-images-rt/ACHe0d2gHlko')).toBe(true);
		expect(isDeadThumbnailUrl(COVER)).toBe(false);
		expect(isDeadThumbnailUrl('https://sites.google.com/view/some-site')).toBe(false);
	});
});
