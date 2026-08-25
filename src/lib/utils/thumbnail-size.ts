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
 * Two separate causes, both handled here:
 *
 * 1. The importer stored HTML-escaped URLs, so 3,218 catalog covers carry `&amp;`
 *    between query parameters. The CDN then sees `amp;width=1200` rather than
 *    `width=1200` and ignores every parameter after the first — which is why a URL
 *    that literally says `width=1200` returned a 2730px image.
 * 2. Even honoured, 1200x630 is roughly 30x the pixels a grid tile displays.
 */

/**
 * Default request width, in source pixels.
 *
 * Sized for the worst case rather than the average: a square `aspect-square` tile crops a
 * 16:9 cover to its centre, so the source's *short* side is what has to cover the tile.
 * The densest case is a 138 CSS px tile at devicePixelRatio 2 — 276 device px — which
 * needs a 16:9 source at least 490 wide. 512x288 clears that with no visible upscale,
 * while still being ~0.15 MP against the 4.2 MP original.
 */
const DEFAULT_TARGET_PX = 512;

/**
 * Query parameters `imgs.crazygames.com` honours. Verified against a real cover: adding
 * `width`/`height`/`fit` returns a resized image, and the parameters are silently ignored
 * when misspelled (which is exactly what `&amp;` produced).
 */
const CRAZYGAMES_HOST = 'imgs.crazygames.com';

/**
 * Undo the HTML escaping the importers applied to URLs scraped out of page markup.
 * `&amp;` is the only entity observed in the catalog, but `&#38;` costs nothing to cover.
 */
export function decodeHtmlEntitiesInUrl(url: string): string {
	return url.replace(/&amp;/g, '&').replace(/&#0*38;/g, '&');
}

/**
 * Rewrite a remote cover URL to request roughly `targetPx` wide.
 *
 * Only hosts with a known, verified resizing API are touched; everything else is returned
 * with its entities decoded and otherwise unchanged, because guessing at query parameters
 * risks a 404 on a cover that currently works.
 */
export function sizedThumbnailUrl(url: string, targetPx = DEFAULT_TARGET_PX): string {
	const decoded = decodeHtmlEntitiesInUrl(url.trim());
	if (!/^https?:\/\//i.test(decoded)) return decoded;

	let parsed: URL;
	try {
		parsed = new URL(decoded);
	} catch {
		return decoded;
	}

	if (parsed.hostname !== CRAZYGAMES_HOST) return decoded;

	/* Device pixel ratio is not applied: a 2x tile still decodes 4x the pixels, and these
	   are lossy cover art where a slightly soft upscale is invisible at tile size. */
	const width = Math.max(120, Math.round(targetPx));
	parsed.searchParams.set('width', String(width));
	parsed.searchParams.set('height', String(Math.round(width * 0.5625)));
	parsed.searchParams.set('fit', 'crop');
	parsed.searchParams.set('quality', '80');
	parsed.searchParams.set('metadata', 'none');
	return parsed.toString();
}
