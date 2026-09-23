/**
 * Ask portal image CDNs for a tile-sized cover instead of the full-resolution original.
 *
 * Measured on a Galaxy Tab Active3 (Android 13), Home screen, release build: 59 `<img>`
 * elements decoded **72.4 million pixels** to fill **1.77 million pixels** of layout — a
 * 41x overdraw, around 290 MB of decoded bitmap for one screen, on a device with ~90 MB
 * free. One 138x138 tile was showing a 2730x1535 cover. The main thread was 89% idle
 * throughout, so this never appeared in a JS profile; it showed up as 500-800ms frame
 * gaps and the app feeling frozen.
 *
 * It is also most of the bytes. A cold Home screen on the public site pulled 19 MB of
 * images for ~28 visible tiles: Unity Play serves its covers as 1920x1080 PNGs (~400 KB
 * each, behind a redirect to a signed URL that changes on every visit, so they were
 * never even cached), Playhop serves 512x512 PNG icons (~400 KB) and fnf-games.io up to
 * 2 MB PNGs. Every one of those portals runs a resizer of its own, which is what this
 * file asks instead:
 *
 * | Host                    | Share | Resizer                                          |
 * | ----------------------- | ----- | ------------------------------------------------ |
 * | play.unity.com          | 28%   | the site's own Next.js `/_next/image` optimiser  |
 * | imgs.crazygames.com     | 24%   | `width`/`height`/`fit` query (Cloudflare)        |
 * | avatars.mds.yandex.net  | 18%   | fixed size aliases in place of `/orig`           |
 * | fnf-games.io            | 5%    | a pre-rendered `-m200x200.webp` under `/cache/`  |
 *
 * All four answer in WebP or AVIF by `Accept`, and each was verified against real
 * catalog covers (2026-09). AddictingGames (9%) has no usable resizer — its only
 * public Drupal style is 100x65 — but its covers are mostly small already, so they are
 * left alone. Anything that fails falls back to the original URL in the component.
 *
 * Two older causes are still handled here too:
 *
 * 1. The importer stored HTML-escaped URLs, so 3,218 catalog covers carry `&amp;`
 *    between query parameters. The CDN then sees `amp;width=1200` rather than
 *    `width=1200` and ignores every parameter after the first — which is why a URL
 *    that literally says `width=1200` returned a 2730px image.
 * 2. Even honoured, 1200x630 is roughly 30x the pixels a grid tile displays.
 */

/**
 * Default request width, in source pixels, for callers that do not say how big the cover
 * is drawn (the player poster and its sidebar cards).
 *
 * Sized for the worst case rather than the average: a square `aspect-square` tile crops a
 * 16:9 cover to its centre, so the source's *short* side is what has to cover the tile.
 * The densest case is a 138 CSS px tile at devicePixelRatio 2 — 276 device px — which
 * needs a 16:9 source at least 490 wide.
 */
const DEFAULT_TARGET_PX = 512;

/**
 * A portal resizer: the widths it can serve and how to ask for one.
 *
 * The width ladders are deliberately short and shared between pages, so the Home tile, the
 * browse card and the player page mostly ask for the *same* URL and hit the HTTP cache
 * instead of fetching three sizes of one cover.
 */
interface ResizingHost {
	/** Width over height of what the resizer returns. */
	aspect: number;
	/** Source widths it serves, ascending. */
	widths: readonly number[];
	/** URL for one of `widths`, or null when this URL is not one the resizer takes. */
	resize(url: URL, width: number): string | null;
}

/**
 * `imgs.crazygames.com` is Cloudflare Image Resizing: any width, `fit=crop` to the 16:9
 * cover, format negotiated from `Accept` (AVIF in Chromium). Parameters are silently
 * ignored when misspelled, which is exactly what `&amp;` produced.
 */
const CRAZYGAMES: ResizingHost = {
	aspect: 16 / 9,
	widths: [256, 384, 640, 1080],
	resize(url, width) {
		const out = new URL(url);
		out.searchParams.set('width', String(width));
		out.searchParams.set('height', String(Math.round((width * 9) / 16)));
		out.searchParams.set('fit', 'crop');
		out.searchParams.set('quality', '75');
		out.searchParams.set('metadata', 'none');
		return out.toString();
	}
};

/**
 * Unity Play covers are `/api/v1/files/file/<id>/content`, a 302 to a signed Google
 * Storage URL for a 1920x1080 PNG. The signature changes per request, so the browser
 * cache never matched and every visit re-downloaded ~400 KB per tile. play.unity.com is
 * a Next.js site and resizes those same URLs for its own listings through `/_next/image`
 * — one stable, cacheable URL and a ~9 KB WebP at 384 wide. Next only accepts widths
 * from its configured list (these four are in the defaults) and answers anything else
 * with a 400.
 */
const UNITY_PLAY: ResizingHost = {
	aspect: 16 / 9,
	widths: [256, 384, 640, 1080],
	resize(url, width) {
		if (!/^\/(api\/v1\/files\/file\/[^/]+\/content|assets\/[^/]+)$/.test(url.pathname)) return null;
		return `https://play.unity.com/_next/image?url=${encodeURIComponent(url.toString())}&w=${width}&q=75`;
	}
};

/**
 * Playhop covers are 512x512 icons at `/get-games/<ns>/<id>/orig`. The avatars service
 * replaces the last segment with a size alias; these are the ones it answers for this
 * namespace (most other `NxN` spellings 404).
 */
const YANDEX_ALIASES: Record<number, string> = {
	160: 'pjpg160x160',
	256: 'pjpg256x256',
	384: '384x384',
	512: '512x512'
};
const YANDEX_AVATARS: ResizingHost = {
	aspect: 1,
	widths: [160, 256, 384, 512],
	resize(url, width) {
		const parts = url.pathname.split('/');
		if (parts.length !== 5 || parts[1] !== 'get-games') return null;
		parts[4] = YANDEX_ALIASES[width]!;
		return `${url.origin}${parts.join('/')}`;
	}
};

/**
 * fnf-games.io keeps a 200x200 WebP of every cover beside the original (its own listing
 * pages use it) — the originals are PNGs of up to 2 MB. No other size exists.
 */
const FNF_GAMES: ResizingHost = {
	aspect: 1,
	widths: [200],
	resize(url) {
		const m = url.pathname.match(/^\/(data\/image\/game\/[^/]+)\/([^/]+)\.(?:png|jpe?g|webp)$/i);
		if (!m) return null;
		return `${url.origin}/cache/${m[1]}/${m[2]}-m200x200.webp`;
	}
};

const RESIZING_HOSTS: Record<string, ResizingHost> = {
	'imgs.crazygames.com': CRAZYGAMES,
	'play.unity.com': UNITY_PLAY,
	'avatars.mds.yandex.net': YANDEX_AVATARS,
	'fnf-games.io': FNF_GAMES
};

/**
 * Covers that can never load. The Google Sites importer stored `sitesv-images-rt` URLs,
 * which are short-lived signed links: every one in the catalog (546 games) now answers
 * 403. Requesting them only costs a connection and an error round trip per tile.
 */
export function isDeadThumbnailUrl(url: string): boolean {
	return /^https:\/\/sites\.google\.com\/sitesv-images-rt\//i.test(url.trim());
}

/**
 * Undo the HTML escaping the importers applied to URLs scraped out of page markup.
 * `&amp;` is the only entity observed in the catalog, but `&#38;` costs nothing to cover.
 */
export function decodeHtmlEntitiesInUrl(url: string): string {
	return url.replace(/&amp;/g, '&').replace(/&#0*38;/g, '&');
}

function parseRemote(url: string): { decoded: string; parsed: URL | null } {
	const decoded = decodeHtmlEntitiesInUrl(url.trim());
	if (!/^https?:\/\//i.test(decoded)) return { decoded, parsed: null };
	try {
		return { decoded, parsed: new URL(decoded) };
	} catch {
		return { decoded, parsed: null };
	}
}

/**
 * Rewrite a remote cover URL to request roughly `targetPx` wide.
 *
 * Picks the smallest width the host serves that covers `targetPx`, or its largest when
 * nothing does — unless even that is far too small (fnf's 200px cover for a 1080px
 * poster), where the original is the better picture. Hosts without a known resizer are
 * returned with their entities decoded and otherwise unchanged, because guessing at
 * query parameters risks a 404 on a cover that currently works.
 */
export function sizedThumbnailUrl(url: string, targetPx = DEFAULT_TARGET_PX): string {
	const { decoded, parsed } = parseRemote(url);
	if (!parsed) return decoded;
	const host = RESIZING_HOSTS[parsed.hostname];
	if (!host) return decoded;

	const widths = host.widths;
	const largest = widths[widths.length - 1]!;
	const width = widths.find((w) => w >= targetPx) ?? largest;
	if (width < targetPx * 0.35) return decoded;
	return host.resize(parsed, width) ?? decoded;
}

export interface ThumbnailSrcset {
	/** A mid-size candidate, for `src`. */
	src: string;
	/** `srcset` with `w` descriptors, to pair with the caller's `sizes`. */
	srcset: string;
}

/**
 * Every size a host can serve for this cover, as a `srcset`, or null when the host has no
 * resizer (use the original then).
 *
 * `boxAspect` is the width/height of the box the cover is drawn into with `object-fit:
 * cover`. When the source is wider than the box — a 16:9 cover in a square tile — its
 * *height* is what has to fill the box, so each candidate is described as the box width
 * it can cover rather than its pixel width. A 384x216 cover is worth a 216px square, not
 * a 384px one; describing it as 384w would make the browser pick one size too small and
 * upscale it 1.8x. The layout is unaffected: these boxes are sized by CSS, not by the
 * image's intrinsic size.
 */
export function thumbnailSrcset(url: string, boxAspect = 1): ThumbnailSrcset | null {
	const { parsed } = parseRemote(url);
	if (!parsed) return null;
	const host = RESIZING_HOSTS[parsed.hostname];
	if (!host) return null;

	const crop = Math.max(1, host.aspect / boxAspect);
	const candidates: string[] = [];
	for (const width of host.widths) {
		const sized = host.resize(parsed, width);
		if (!sized) return null;
		candidates.push(`${sized} ${Math.floor(width / crop)}w`);
	}
	const mid = host.widths[Math.min(1, host.widths.length - 1)]!;
	return { src: host.resize(parsed, mid)!, srcset: candidates.join(', ') };
}
