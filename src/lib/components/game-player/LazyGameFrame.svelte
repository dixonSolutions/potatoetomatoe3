<script lang="ts">
	import { tick } from 'svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Play } from 'lucide-svelte';
	import { captureGameStorageFromIframe } from '$lib/utils/game-storage-bridge';
	import { unlockGameIframeAudio } from '$lib/utils/game-audio';

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
		fillContainer = false,
		started = $bindable(false),
		onIframeReady
	}: {
		gameUrl: string;
		gameId?: string;
		title: string;
		posterUrl: string;
		iframeAllow?: string;
		/** When true, fill the parent (fullscreen / flex child) instead of fixed 16:9. */
		fillContainer?: boolean;
		started?: boolean;
		onIframeReady?: (el: HTMLIFrameElement | null) => void;
	} = $props();

	const DEFAULT_IFRAME_ALLOW = 'fullscreen; autoplay; gamepad; microphone; camera';

	let iframeEl = $state<HTMLIFrameElement | null>(null);
	let surfaceEl = $state<HTMLDivElement | null>(null);

	function bumpAudioUnlock() {
		unlockGameIframeAudio(iframeEl);
		/* Nested player shells / late Unity AudioContext creation */
		window.setTimeout(() => unlockGameIframeAudio(iframeEl), 250);
		window.setTimeout(() => unlockGameIframeAudio(iframeEl), 1000);
		window.setTimeout(() => unlockGameIframeAudio(iframeEl), 3000);
	}

	function startGame() {
		started = true;
		/* Kick unlock from the user gesture that starts play (WebKitGTK needs this). */
		void tick().then(() => {
			bumpAudioUnlock();
			iframeEl?.focus?.();
		});
	}

	let lastReadyEl: HTMLIFrameElement | null | undefined = undefined;

	$effect(() => {
		const el = started ? iframeEl : null;
		if (el === lastReadyEl) return;
		lastReadyEl = el;
		if (started && iframeEl) {
			void tick().then(() => {
				if (iframeEl === lastReadyEl) onIframeReady?.(iframeEl);
			});
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
				void captureGameStorageFromIframe(frame, id);
			}
		};
	});
</script>

<div
	bind:this={surfaceEl}
	class="relative w-full overflow-hidden bg-muted {fillContainer
		? 'h-full min-h-0 border-0 shadow-none'
		: 'rounded-lg border shadow-lg'}"
	style={fillContainer ? undefined : 'aspect-ratio: 16 / 9;'}
	onpointerdown={() => {
		if (started) bumpAudioUnlock();
	}}
>
	{#if !started}
		<button
			type="button"
			class="group absolute inset-0 flex w-full flex-col items-center justify-center gap-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
			onclick={startGame}
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
			loading="eager"
			allowfullscreen
			allow={iframeAllow || DEFAULT_IFRAME_ALLOW}
			referrerpolicy="no-referrer-when-downgrade"
			onload={bumpAudioUnlock}
		></iframe>
	{/if}
</div>
