<script lang="ts">
	import { resolve } from '$app/paths';
	import { Heart, HardDrive } from 'lucide-svelte';
	import GameCardImage from './GameCardImage.svelte';
	import { warmGameLaunch } from '$lib/utils/network-warmup';

	/**
	 * One game: square cover, name, a quiet line of detail. Used by the Home rows and the
	 * Games grid so both look the same. The parent sizes it (a row gives it a fixed width,
	 * the grid a column).
	 */
	let {
		game,
		sizes,
		priority = false,
		favourite = false,
		offline = false,
		preferOffline = false,
		offlineThumbnailRel,
		detail,
		onToggleFavourite
	}: {
		game: { id: string; name: string; thumbnail?: string | null; author?: string };
		sizes: string;
		priority?: boolean;
		favourite?: boolean;
		/** Downloaded for offline play. */
		offline?: boolean;
		preferOffline?: boolean;
		offlineThumbnailRel?: string;
		/** Line under the name; defaults to the author. */
		detail?: string;
		onToggleFavourite?: (id: string) => void;
	} = $props();

	let line = $derived(detail ?? game.author ?? '');
</script>

<div class="group relative">
	<a
		href={resolve(`/games/${game.id}`)}
		data-sveltekit-preload-data="hover"
		onpointerenter={() => warmGameLaunch(game.id)}
		ontouchstart={() => warmGameLaunch(game.id)}
		onfocus={() => warmGameLaunch(game.id)}
		class="block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
	>
		<div class="relative aspect-square overflow-hidden rounded-xl bg-muted">
			<GameCardImage
				thumbnail={game.thumbnail}
				gameId={game.id}
				name={game.name}
				alt={game.name}
				{sizes}
				{priority}
				{preferOffline}
				{offlineThumbnailRel}
				class="transition-transform duration-200 group-hover:scale-[1.03]"
			/>
			{#if offline}
				<span
					class="absolute bottom-1.5 left-1.5 rounded-full bg-background/85 p-1"
					title="Downloaded"
				>
					<HardDrive class="h-3 w-3" aria-label="Downloaded" />
				</span>
			{/if}
		</div>
		<p class="mt-1.5 line-clamp-2 text-xs leading-tight font-medium sm:text-sm">{game.name}</p>
		{#if line}
			<p class="truncate text-[11px] text-muted-foreground sm:text-xs">{line}</p>
		{/if}
	</a>
	{#if onToggleFavourite}
		<button
			type="button"
			onclick={(e) => {
				e.preventDefault();
				e.stopPropagation();
				onToggleFavourite(game.id);
			}}
			class="absolute top-1.5 right-1.5 rounded-full bg-background/85 p-1.5 transition-opacity focus-visible:opacity-100 {favourite
				? 'opacity-100'
				: 'opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100'}"
			aria-pressed={favourite}
			aria-label={favourite ? 'Remove from favourites' : 'Add to favourites'}
		>
			<Heart class="h-4 w-4 {favourite ? 'fill-red-500 text-red-500' : 'text-muted-foreground'}" />
		</button>
	{/if}
</div>
