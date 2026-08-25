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
		startDisabled = false,
		stallTimeoutMs = 25_000,
		started = $bindable(false),
		onIframeReady,
		onLoadStateChange
	}: {
		gameUrl: string;
		gameId?: string;
		title: string;
		posterUrl: string;
		iframeAllow?: string;
		/** When true, fill the parent (fullscreen / flex child) instead of fixed 16:9. */
		fillContainer?: boolean;
		/** Prevent starting while an online/offline play URL is being resolved. */
		startDisabled?: boolean;
		/**
		 * How long a frame may go without firing `load` before it counts as stalled.
		 * `load` waits for every subresource, and a Unity build is tens of megabytes, so
		 * this has to be generous — a false stall would push a working game onto the
		 * slower relay path. Frame refusals (X-Frame-Options) fire `load` anyway and are
		 * handled by host policy in `online-play-routing`, not here.
		 */
		stallTimeoutMs?: number;
		started?: boolean;
		onIframeReady?: (el: HTMLIFrameElement | null) => void;
		/**
		 * Launch watchdog. A frame that never fires `load` (dead relay, hung proxy,
		 * unreachable embed) used to sit black forever with no way to tell why.
		 */
		onLoadStateChange?: (state: FrameLoadState, url: string) => void;
	} = $props();

	type FrameLoadState = 'loading' | 'loaded' | 'stalled';

	const DEFAULT_IFRAME_ALLOW = 'fullscreen; autoplay; gamepad; microphone; camera';

	let iframeEl = $state<HTMLIFrameElement | null>(null);
	let surfaceEl = $state<HTMLDivElement | null>(null);
	let loadState = $state<FrameLoadState>('loading');
	/**
	 * Shape the game asked for, reported by the native bridge from inside the game frame.
	 *
	 * Portal shells refuse to start when the orientation they declare does not match the
	 * viewport — CrazyGames renders "Rotate your screen" and nothing else. The declaration
	 * is only visible from inside that cross-origin document, so it arrives by postMessage.
	 */
	let declaredOrientation = $state<'portrait' | 'landscape' | null>(null);

	$effect(() => {
		const onMessage = (event: MessageEvent) => {
			const data = event.data as { type?: string; want?: string } | null;
			if (!data || data.type !== 'potato-tomato-frame-orientation') return;
			if (data.want !== 'portrait' && data.want !== 'landscape') return;
			if (declaredOrientation !== data.want) declaredOrientation = data.want;
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	});

	/* A new game must not inherit the previous game's declared shape. */
	$effect(() => {
		void gameUrl;
		declaredOrientation = null;
	});

	function reportLoadState(next: FrameLoadState) {
		if (loadState === next) return;
		loadState = next;
		onLoadStateChange?.(next, gameUrl);
	}

	/**
	 * Watchdog per (started, url) pair. Cleared by the iframe `load` handler; a URL swap
	 * restarts it so a relay upgrade gets its own grace period.
	 */
	$effect(() => {
		const url = gameUrl;
		if (!started || !url) return;
		loadState = 'loading';
		onLoadStateChange?.('loading', url);
		const timer = window.setTimeout(
			() => {
				if (loadState === 'loading') reportLoadState('stalled');
			},
			Math.max(1000, stallTimeoutMs)
		);
		return () => clearTimeout(timer);
	});

	function handleFrameLoad() {
		reportLoadState('loaded');
		bumpAudioUnlock();
	}

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
		: 'game-surface-aspect rounded-lg border shadow-lg'}"
	style={fillContainer || !declaredOrientation
		? undefined
		: `aspect-ratio: ${declaredOrientation === 'portrait' ? '3 / 4' : '16 / 9'};`}
	onpointerdown={() => {
		if (started) bumpAudioUnlock();
	}}
>
	{#if !started}
		<button
			type="button"
			class="group absolute inset-0 flex w-full flex-col items-center justify-center gap-3 ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
			onclick={startGame}
			disabled={startDisabled}
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
					{startDisabled ? 'Preparing play…' : 'Play'}
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
			onload={handleFrameLoad}
		></iframe>
	{/if}
</div>
