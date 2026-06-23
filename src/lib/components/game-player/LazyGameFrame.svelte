<script lang="ts">
	import { tick } from 'svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Play } from 'lucide-svelte';
	import { captureGameStorageFromIframe } from '$lib/utils/game-storage-bridge';

	/**
	 * Runs the shipped HTML5 build in a **same-origin** isolated document (`src` = `/games/{id}/offline/…`, `/puller-games/{id}/…`, or `/online/…`).
	 * Same app origin keeps game localStorage aligned across online/offline; puller copies use `/puller-games/` (proxied in dev).
	 * A separate document is required so the game keeps its own globals and relative asset paths;
	 * rendering the bundle inline in Svelte would break typical builds.
	 * `src` is attached only after Play so heavy assets are not loaded on navigation alone.
	 */
	let {
		gameUrl,
		gameId = '',
		title,
		posterUrl,
		iframeAllow,
		started = $bindable(false),
		onIframeReady
	}: {
		gameUrl: string;
		gameId?: string;
		title: string;
		posterUrl: string;
		iframeAllow?: string;
		started?: boolean;
		onIframeReady?: (el: HTMLIFrameElement | null) => void;
	} = $props();

	let iframeEl = $state<HTMLIFrameElement | null>(null);

	$effect(() => {
		const el = started ? iframeEl : null;
		if (started && iframeEl) {
			void tick().then(() => onIframeReady?.(iframeEl));
		} else {
			onIframeReady?.(el);
		}
	});

	$effect(() => {
		const id = gameId;
		const active = started;
		const frame = iframeEl;
		return () => {
			if (active && frame && id) {
				captureGameStorageFromIframe(frame, id);
			}
		};
	});
</script>

<div
	class="relative w-full overflow-hidden rounded-lg border bg-muted shadow-lg"
	style="aspect-ratio: 16 / 9;"
>
	{#if !started}
		<button
			type="button"
			class="group absolute inset-0 flex w-full flex-col items-center justify-center gap-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
			onclick={() => {
				started = true;
			}}
			aria-label="Load and play {title}"
		>
			<img
				src={posterUrl}
				alt=""
				class="absolute inset-0 h-full w-full object-cover"
				loading="lazy"
				decoding="async"
				draggable="false"
			/>
			<div
				class="absolute inset-0 bg-gradient-to-t from-background/90 via-background/40 to-background/20"
				aria-hidden="true"
			></div>
			<span
				class="relative z-[1] max-w-[90%] truncate px-2 text-center text-lg font-semibold text-foreground drop-shadow-sm sm:text-xl"
			>
				{title}
			</span>
			<span class="relative z-[1] flex items-center gap-2">
				<Button type="button" size="lg" class="pointer-events-none gap-2 shadow-md">
					<Play class="h-5 w-5 fill-current" aria-hidden="true" />
					Play
				</Button>
			</span>
			<span class="relative z-[1] max-w-md px-4 text-center text-xs text-muted-foreground">
				Load game on demand — avoids pulling heavy assets until you start.
			</span>
		</button>
	{:else}
		<iframe
			bind:this={iframeEl}
			src={gameUrl}
			{title}
			class="h-full w-full border-0 bg-black"
			loading="lazy"
			allowfullscreen
			allow={iframeAllow}
			referrerpolicy="no-referrer-when-downgrade"
		></iframe>
	{/if}
</div>
