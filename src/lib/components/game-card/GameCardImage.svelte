<script lang="ts">
	import { resolveGameThumbnailSources } from '$lib/utils/games';

	/**
	 * A game cover sized for the box it is drawn in.
	 *
	 * Fills its parent (`h-full w-full object-cover`), so the parent owns the box: give it an
	 * `aspect-*` class and a `bg-muted` tint and there is nothing to shift or flash while the
	 * image arrives. `sizes` is the box's CSS width at each breakpoint and `boxAspect` its
	 * width/height; together they let the browser pick the smallest resized cover that
	 * still fills the box at the device's pixel ratio (see `thumbnailSrcset`).
	 *
	 * On error it tries the portal's original URL once, then gives up to a lettered tile
	 * instead of a broken-image icon or a "No Image" graphic.
	 */
	let {
		thumbnail,
		gameId,
		name,
		sizes,
		boxAspect = 1,
		priority = false,
		preferOffline = false,
		offlineThumbnailRel,
		alt = '',
		class: className = ''
	}: {
		thumbnail: string | undefined | null;
		gameId: string;
		/** Game name — the fallback tile shows its first letter. */
		name: string;
		sizes: string;
		/** Width / height of the box. */
		boxAspect?: number;
		/**
		 * The card is in the first visible row: load it eagerly and at high priority. Keep
		 * this to the handful of covers on screen at load, or it stops meaning anything.
		 */
		priority?: boolean;
		preferOffline?: boolean;
		offlineThumbnailRel?: string | null;
		alt?: string;
		class?: string;
	} = $props();

	const sources = $derived(
		resolveGameThumbnailSources(thumbnail, {
			gameId,
			preferOffline,
			offlineThumbnailRel,
			boxAspect
		})
	);

	/* Failures are remembered per URL, so a new cover (offline copy arrived) gets a fresh try. */
	let failedSrc = $state<string | null>(null);
	let failedFallback = $state<string | null>(null);

	const useFallback = $derived(
		sources.src !== null && failedSrc === sources.src && Boolean(sources.fallbackSrc)
	);
	const showTile = $derived(
		sources.src === null ||
			(failedSrc === sources.src &&
				(!sources.fallbackSrc || failedFallback === sources.fallbackSrc))
	);
	/* First letter or digit: plenty of catalog names open with a quote or an emoji. */
	const initial = $derived(name.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '?');

	/* Intrinsic size hints only — the box is sized by the parent, so these never lay out. */
	const hintWidth = 256;
	const hintHeight = $derived(Math.round(hintWidth / boxAspect));

	function onError() {
		if (useFallback) failedFallback = sources.fallbackSrc ?? null;
		else failedSrc = sources.src;
	}
</script>

{#if showTile}
	<div
		class="flex h-full w-full items-center justify-center bg-muted text-2xl font-semibold text-muted-foreground/60 select-none"
		role={alt ? 'img' : undefined}
		aria-label={alt || undefined}
		aria-hidden={alt ? undefined : 'true'}
	>
		{initial}
	</div>
{:else if useFallback}
	<img
		loading={priority ? 'eager' : 'lazy'}
		decoding="async"
		src={sources.fallbackSrc}
		{alt}
		width={hintWidth}
		height={hintHeight}
		class="h-full w-full object-cover {className}"
		onerror={onError}
	/>
{:else}
	<!-- `loading`, `sizes` and `srcset` before `src`, so the first request is already the right one. -->
	<img
		loading={priority ? 'eager' : 'lazy'}
		fetchpriority={priority ? 'high' : undefined}
		decoding="async"
		sizes={sources.srcset ? sizes : undefined}
		srcset={sources.srcset}
		src={sources.src}
		{alt}
		width={hintWidth}
		height={hintHeight}
		class="h-full w-full object-cover {className}"
		onerror={onError}
	/>
{/if}
