<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { Loader2 } from 'lucide-svelte';
	import {
		captureGameStorageFromIframe,
		noteGameFrameTree,
		registerGameFrameHost
	} from '$lib/utils/game-storage-bridge';
	import { unlockGameIframeAudio } from '$lib/utils/game-audio';
	import {
		frameLoadsPerStart,
		frameSandboxFor,
		shellFrameSrcFor
	} from '$lib/utils/online-play-routing-shell';

	/**
	 * Runs the shipped HTML5 build in a **same-origin** isolated document (`src` = `/games/{id}/offline/…`, `/puller-games/{id}/…`, or `/online/…`).
	 * Same app origin keeps game localStorage aligned across online/offline; puller copies use `/puller-games/` (proxied in dev).
	 * A separate document is required so the game keeps its own globals and relative asset paths;
	 * rendering the bundle inline in Svelte would break typical builds. An app-made shell
	 * (third-party HTML the app plays from a document of its own) is the exception to "same
	 * origin": it is sandboxed away from the app's origin (`frameSandboxFor`).
	 *
	 * The game starts as soon as its play URL is known — there is no click-to-play step.
	 * Until then (`gameUrl` empty) and until the frame fires `load` (or the stall watchdog
	 * gives up on it), the cover art stays up as a loading backdrop, then fades out.
	 */
	let {
		gameUrl,
		gameId = '',
		title,
		posterUrl,
		iframeAllow,
		fillContainer = false,
		startDisabled = false,
		held = false,
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
		/** Hold the frame back while the online/offline play URL is still being resolved. */
		startDisabled?: boolean;
		/**
		 * Hold a started game off screen (the privacy lock): the frame shows `about:blank`,
		 * so nothing in it runs or plays sound, and nothing is reported about it. Released,
		 * it loads `gameUrl` as it is then — the page's current play URL, not the one the
		 * frame had when it was held.
		 */
		held?: boolean;
		/**
		 * How long a frame may go without firing `load` before it counts as stalled.
		 * `load` waits for every subresource, and a Unity build is tens of megabytes, so
		 * this has to be generous — a false stall would push a working game onto the
		 * slower relay path. Frame refusals (X-Frame-Options) fire `load` anyway and are
		 * handled by host policy in `online-play-routing`, not here.
		 */
		stallTimeoutMs?: number;
		/** True once the frame has been given its URL. Set here; the page only reads it. */
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

	/*
	 * An app-made shell runs third-party HTML, so it gets a sandbox without the app's origin,
	 * and its loader fires a `load` of its own before the game's (`online-play-routing-shell`).
	 */
	const sandbox = $derived(frameSandboxFor(gameUrl));
	/* A shell's play URL only names it: the frame loads the shell's loader. */
	const frameSrc = $derived(shellFrameSrcFor(gameUrl) ?? gameUrl);
	const loadsPerStart = $derived(frameLoadsPerStart(gameUrl));
	/** `load` events seen since the current start; the game is up after `loadsPerStart`. */
	let loadsSeen = 0;

	function reportLoadState(next: FrameLoadState) {
		if (loadState === next) return;
		loadState = next;
		onLoadStateChange?.(next, gameUrl);
	}

	/**
	 * Watchdog per (started, url) pair. Cleared by the iframe `load` handler; a URL swap
	 * restarts it so a relay upgrade gets its own grace period. Off while the frame is held:
	 * a held frame is not loading anything, and releasing it starts a fresh watch.
	 */
	$effect(() => {
		const url = gameUrl;
		if (!started || !url || held) return;
		loadsSeen = 0;
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
		/* `about:blank` while held: not the game, and nothing to report. */
		if (held) return;
		loadsSeen++;
		if (iframeEl && gameId) noteGameFrameTree(iframeEl, gameId);
		if (loadsSeen < loadsPerStart && loadState === 'loading') return;
		reportLoadState('loaded');
		bumpAudioUnlock();
		focusFrameIfIdle();
	}

	function bumpAudioUnlock() {
		unlockGameIframeAudio(iframeEl);
		/* Nested player shells / late Unity AudioContext creation */
		window.setTimeout(() => unlockGameIframeAudio(iframeEl), 250);
		window.setTimeout(() => unlockGameIframeAudio(iframeEl), 1000);
		window.setTimeout(() => unlockGameIframeAudio(iframeEl), 3000);
	}

	/**
	 * Hand the keyboard to the game — unless the user is already somewhere else on the
	 * page (a settings field, a dialog), which a game starting by itself must not steal.
	 */
	function focusFrameIfIdle() {
		const active = document.activeElement;
		if (active && active !== document.body && active !== iframeEl) return;
		iframeEl?.focus?.();
	}

	/*
	 * The frame loads as soon as there is a URL to load. It used to wait for a Play click,
	 * which WebKitGTK wanted as the gesture that unlocks audio; audio is now unlocked by the
	 * first press on the surface or the player's menus, and by the bridge inside the frame.
	 */
	$effect(() => {
		if (started || startDisabled || !gameUrl) return;
		untrack(() => {
			started = true;
			void tick().then(() => {
				bumpAudioUnlock();
				focusFrameIfIdle();
			});
		});
	});

	/* The cover stays up until the game has something to show, then fades away. */
	const posterVisible = $derived(!started || loadState === 'loading');
	let posterGone = $state(false);

	$effect(() => {
		if (posterVisible) {
			posterGone = false;
			return;
		}
		const timer = window.setTimeout(() => (posterGone = true), 400);
		return () => clearTimeout(timer);
	});

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

	/*
	 * This frame is where the game's saves come from: only it, and frames nested in it, may
	 * pull or push them (`game-storage-bridge.ts`).
	 */
	$effect(() => {
		const id = gameId;
		const frame = started ? iframeEl : null;
		if (!frame || !id) return;
		return registerGameFrameHost(frame, id);
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
	{#if started && gameUrl}
		<!--
			A frame's sandbox applies from its next navigation, so a change of sandbox (a route
			moving between a shell and anything else) gets a new frame rather than a new `src`.
			`sandbox` comes before `src` for the same reason.
		-->
		{#key sandbox}
			<iframe
				bind:this={iframeEl}
				{sandbox}
				src={held ? 'about:blank' : frameSrc}
				{title}
				class="h-full w-full border-0 bg-black"
				class:invisible={held}
				aria-hidden={held ? 'true' : undefined}
				loading="eager"
				allowfullscreen
				allow={iframeAllow || DEFAULT_IFRAME_ALLOW}
				referrerpolicy="no-referrer-when-downgrade"
				onload={handleFrameLoad}
			></iframe>
		{/key}
	{/if}
	{#if !posterGone}
		<!--
			A loading backdrop, not a button: presses fall through to the frame, so a game that
			is already drawing before its last asset lands can be played straight away.
		-->
		<div
			class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 transition-opacity duration-300 {posterVisible
				? 'opacity-100'
				: 'opacity-0'}"
			data-testid="game-loading-poster"
			aria-hidden={!posterVisible}
		>
			<img
				src={posterUrl}
				alt=""
				class="absolute inset-0 h-full w-full object-cover"
				decoding="async"
				draggable="false"
			/>
			<div
				class="absolute inset-0 bg-gradient-to-t from-background/90 via-background/50 to-background/30"
				aria-hidden="true"
			></div>
			<!-- On a card of its own: cover art is anything from white to black. -->
			<div
				class="relative z-[1] flex max-w-[90%] flex-col items-center gap-1 rounded-2xl border border-border/60 bg-background/80 px-5 py-3 text-center shadow-lg backdrop-blur-md"
			>
				<span class="max-w-full truncate text-base font-semibold text-foreground sm:text-lg">
					{title}
				</span>
				<span class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
					<Loader2 class="size-4 animate-spin" aria-hidden="true" />
					Starting…
				</span>
			</div>
		</div>
	{/if}
</div>
