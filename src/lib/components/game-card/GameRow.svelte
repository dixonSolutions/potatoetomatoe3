<script
	lang="ts"
	generics="T extends { id: string; name: string; thumbnail?: string | null; author?: string }"
>
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import GameTile from './GameTile.svelte';

	/**
	 * A titled, horizontally scrolling row of games (the Roblox home pattern). Touch and
	 * trackpads scroll it natively; on a mouse, arrows page it. Only the first row on the
	 * page asks for its covers at high priority.
	 */
	let {
		id,
		title,
		games,
		seeAll,
		priority = false,
		favouriteIds,
		offlineIds,
		preferOffline = false,
		offlineThumbnails = {},
		onToggleFavourite
	}: {
		id: string;
		title: string;
		games: T[];
		/** Already resolved href for "See all". */
		seeAll?: string;
		priority?: boolean;
		favouriteIds: ReadonlySet<string>;
		offlineIds: ReadonlySet<string>;
		preferOffline?: boolean;
		offlineThumbnails?: Record<string, string | undefined>;
		onToggleFavourite?: (id: string) => void;
	} = $props();

	/* Tile widths below; `sizes` must match them. */
	const TILE_SIZES = '(min-width: 1024px) 176px, (min-width: 640px) 152px, 36vw';
	/* Tiles on screen at once on the narrowest layout plus one. */
	const PRIORITY_TILES = 8;

	let scroller: HTMLDivElement | undefined = $state();
	let atStart = $state(true);
	let atEnd = $state(false);

	function updateEdges() {
		if (!scroller) return;
		atStart = scroller.scrollLeft <= 4;
		atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4;
	}

	function page(direction: 1 | -1) {
		if (!scroller) return;
		scroller.scrollBy({ left: direction * scroller.clientWidth * 0.85, behavior: 'smooth' });
	}

	$effect(() => {
		void games.length;
		queueMicrotask(updateEdges);
	});
</script>

<section class="mb-7 md:mb-9" aria-labelledby="row-{id}">
	<div class="mb-2 flex items-center justify-between gap-3">
		<h2 id="row-{id}" class="text-base font-semibold md:text-lg">
			{#if seeAll}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- the caller passes a resolved href -->
				<a href={seeAll} class="inline-flex items-center gap-0.5 hover:underline">
					{title}
					<ChevronRight class="h-4 w-4 text-muted-foreground" aria-hidden="true" />
				</a>
			{:else}
				{title}
			{/if}
		</h2>
		<div class="hidden gap-1 [@media(hover:hover)]:flex">
			<Button
				variant="ghost"
				size="icon"
				class="h-8 w-8"
				disabled={atStart}
				onclick={() => page(-1)}
				aria-label="Scroll {title} left"
			>
				<ChevronLeft class="h-4 w-4" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="h-8 w-8"
				disabled={atEnd}
				onclick={() => page(1)}
				aria-label="Scroll {title} right"
			>
				<ChevronRight class="h-4 w-4" />
			</Button>
		</div>
	</div>
	<div
		bind:this={scroller}
		onscroll={updateEdges}
		class="-mx-3 flex snap-x scroll-px-3 gap-3 overflow-x-auto px-3 pb-1 [scrollbar-width:none] sm:-mx-5 sm:scroll-px-5 sm:px-5 [&::-webkit-scrollbar]:hidden"
	>
		{#each games as game, i (game.id)}
			<div class="w-[36vw] max-w-40 shrink-0 snap-start sm:w-38 sm:max-w-none lg:w-44">
				<GameTile
					{game}
					sizes={TILE_SIZES}
					priority={priority && i < PRIORITY_TILES}
					favourite={favouriteIds.has(game.id)}
					offline={offlineIds.has(game.id)}
					preferOffline={preferOffline || offlineIds.has(game.id)}
					offlineThumbnailRel={offlineThumbnails[game.id]}
					{onToggleFavourite}
				/>
			</div>
		{/each}
	</div>
</section>
