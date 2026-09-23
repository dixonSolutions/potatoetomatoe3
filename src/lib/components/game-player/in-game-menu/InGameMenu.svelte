<script lang="ts">
	/**
	 * The in-game menu: the only chrome over a fullscreen game.
	 *
	 * Reached by a small, faint button in one corner (the default), by moving the mouse
	 * into a thin hot zone along that corner's edge, or both — see Settings → Games. Touch
	 * cannot hover, so a touch device always gets the button.
	 *
	 * It is game chrome, so it never takes the keyboard from the game: presses on it are
	 * kept from moving focus, the button is out of the tab order, and closing it hands focus
	 * back to the frame (`onClosed`). Opening it does not pause the game — Pause does.
	 */
	import {
		ArrowLeft,
		Gamepad2,
		Keyboard,
		Menu,
		Minimize2,
		Pause,
		Play,
		RotateCcw
	} from 'lucide-svelte';
	import {
		menuButtonMetrics,
		showsMenuButton,
		usesHoverZone,
		type InGameMenuAccess,
		type InGameMenuButtonSize,
		type InGameMenuCorner
	} from '$lib/utils/game-player-settings';

	let {
		corner = 'top-left',
		access = 'button',
		buttonSize = 'auto',
		touch = false,
		open = $bindable(false),
		paused = false,
		consoleAvailable = false,
		consoleOn = false,
		controlsAvailable = false,
		onGesture,
		onTogglePause,
		onRestart,
		onToggleConsole,
		onOpenControls,
		onExitFullscreen,
		onBack,
		onClosed
	}: {
		corner?: InGameMenuCorner;
		access?: InGameMenuAccess;
		buttonSize?: InGameMenuButtonSize;
		/** A touch device: the button is always shown, and rows get touch-sized. */
		touch?: boolean;
		open?: boolean;
		paused?: boolean;
		consoleAvailable?: boolean;
		consoleOn?: boolean;
		controlsAvailable?: boolean;
		/** Any press on the menu — a user gesture the page can spend (audio, fullscreen). */
		onGesture?: () => void;
		onTogglePause: () => void;
		onRestart: () => void;
		onToggleConsole: () => void;
		onOpenControls: () => void;
		onExitFullscreen: () => void;
		onBack: () => void;
		/** The menu closed; give the keyboard back to the game. */
		onClosed?: () => void;
	} = $props();

	/** Distance from the surface edge, on top of any notch inset. */
	const EDGE = 8;
	/** How long a hover-revealed menu lingers after the pointer leaves it. */
	const HOVER_HIDE_MS = 1500;

	const metrics = $derived(menuButtonMetrics(buttonSize, touch));
	const buttonShown = $derived(showsMenuButton(access, touch));
	const hoverZone = $derived(usesHoverZone(access) && !open);
	const top = $derived(corner.startsWith('top'));
	const left = $derived(corner.endsWith('left'));

	/** Opened from the hot zone rather than the button: it hides by itself again. */
	let revealedByHover = $state(false);
	let hideTimer: ReturnType<typeof setTimeout> | undefined;

	function cancelHide() {
		if (hideTimer) clearTimeout(hideTimer);
		hideTimer = undefined;
	}

	function close() {
		cancelHide();
		if (!open) return;
		open = false;
		revealedByHover = false;
		onClosed?.();
	}

	function toggleFromButton() {
		onGesture?.();
		if (open) {
			close();
			return;
		}
		revealedByHover = false;
		open = true;
	}

	function revealFromHover(e: PointerEvent) {
		if (e.pointerType && e.pointerType !== 'mouse') return;
		cancelHide();
		revealedByHover = true;
		open = true;
	}

	function scheduleHide(e: PointerEvent) {
		if (!revealedByHover || (e.pointerType && e.pointerType !== 'mouse')) return;
		cancelHide();
		hideTimer = setTimeout(close, HOVER_HIDE_MS);
	}

	function run(action: () => void, gesture = true) {
		if (gesture) onGesture?.();
		close();
		action();
	}

	/* A press on game chrome must not pull focus out of the game frame. */
	function keepFocus(e: PointerEvent) {
		e.preventDefault();
	}

	function onPanelKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			close();
		}
	}

	$effect(() => () => cancelHide());

	/* Corner placement, clear of notches: the surface pads itself by the safe-area insets. */
	function cornerStyle(offset: number): string {
		const v = top
			? `top:calc(env(safe-area-inset-top, 0px) + ${offset}px);`
			: `bottom:calc(env(safe-area-inset-bottom, 0px) + ${offset}px);`;
		const h = left
			? `left:calc(env(safe-area-inset-left, 0px) + ${EDGE}px);`
			: `right:calc(env(safe-area-inset-right, 0px) + ${EDGE}px);`;
		return v + h;
	}

	const panelOffset = $derived(buttonShown ? EDGE + metrics.hit + 6 : EDGE);
	const rowClass = $derived(
		`flex w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-medium outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring ${
			touch ? 'h-11' : 'h-9'
		}`
	);
</script>

<div class="pointer-events-none absolute inset-0 z-40" data-testid="in-game-menu">
	{#if open && !revealedByHover}
		<!--
			Tap-away scrim. Presses on the game go to the frame and never reach this document,
			so an outside-click listener alone could not close the menu.
		-->
		<button
			type="button"
			tabindex="-1"
			class="pointer-events-auto absolute inset-0 cursor-default"
			aria-label="Close the in-game menu"
			onpointerdown={(e) => {
				keepFocus(e);
				close();
			}}
		></button>
	{/if}

	{#if hoverZone}
		<!-- Thin strip along the edge: the mouse flicks here, the game keeps its corners. -->
		<div
			class="pointer-events-auto absolute h-2.5 w-2/5 {top ? 'top-0' : 'bottom-0'} {left
				? 'left-0'
				: 'right-0'}"
			data-testid="in-game-menu-hover-zone"
			aria-hidden="true"
			onpointerenter={revealFromHover}
		></div>
	{/if}

	{#if buttonShown}
		<button
			type="button"
			tabindex="-1"
			class="group pointer-events-auto absolute flex items-center justify-center rounded-full outline-none"
			style={`${cornerStyle(EDGE)}width:${metrics.hit}px;height:${metrics.hit}px;`}
			aria-label="In-game menu"
			aria-haspopup="menu"
			aria-expanded={open}
			data-testid="in-game-menu-button"
			onpointerdown={keepFocus}
			onclick={toggleFromButton}
		>
			<span
				class="flex items-center justify-center rounded-full border border-border/70 bg-background/80 text-foreground shadow-md backdrop-blur-md transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 {open
					? 'opacity-100'
					: touch
						? 'opacity-70'
						: 'opacity-45'}"
				style={`width:${metrics.visual}px;height:${metrics.visual}px;`}
			>
				<Menu style={`width:${metrics.icon}px;height:${metrics.icon}px;`} aria-hidden="true" />
			</span>
		</button>
	{/if}

	{#if open}
		<div
			class="pointer-events-auto absolute flex w-52 flex-col gap-0.5 rounded-xl border border-border bg-popover/95 p-1.5 text-popover-foreground shadow-xl backdrop-blur-xl"
			style={cornerStyle(panelOffset)}
			role="menu"
			tabindex="-1"
			aria-label="In-game menu"
			data-testid="in-game-menu-panel"
			onpointerdown={keepFocus}
			onpointerenter={cancelHide}
			onpointerleave={scheduleHide}
			onkeydown={onPanelKeydown}
		>
			<button type="button" role="menuitem" class={rowClass} onclick={() => run(onTogglePause)}>
				{#if paused}
					<Play class="size-4 shrink-0 fill-current" aria-hidden="true" />
					Resume
				{:else}
					<Pause class="size-4 shrink-0" aria-hidden="true" />
					Pause
				{/if}
			</button>
			<button type="button" role="menuitem" class={rowClass} onclick={() => run(onRestart)}>
				<RotateCcw class="size-4 shrink-0" aria-hidden="true" />
				Restart
			</button>
			{#if consoleAvailable}
				<button
					type="button"
					role="menuitemcheckbox"
					aria-checked={consoleOn}
					class={rowClass}
					data-testid="in-game-menu-console"
					onclick={() => run(onToggleConsole)}
				>
					<Gamepad2 class="size-4 shrink-0" aria-hidden="true" />
					<span class="flex-1">Console</span>
					<span
						class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase {consoleOn
							? 'bg-emerald-600 text-white'
							: 'bg-muted text-muted-foreground'}">{consoleOn ? 'On' : 'Off'}</span
					>
				</button>
			{/if}
			{#if controlsAvailable}
				<button
					type="button"
					role="menuitem"
					class={rowClass}
					data-testid="in-game-menu-controls"
					onclick={() => run(onOpenControls)}
				>
					<Keyboard class="size-4 shrink-0" aria-hidden="true" />
					Controls
				</button>
			{/if}
			<div class="mx-1 my-1 h-px bg-border" role="separator"></div>
			<button
				type="button"
				role="menuitem"
				class={rowClass}
				data-testid="in-game-menu-exit-fullscreen"
				onclick={() => run(onExitFullscreen, false)}
			>
				<Minimize2 class="size-4 shrink-0" aria-hidden="true" />
				Exit fullscreen
			</button>
			<button type="button" role="menuitem" class={rowClass} onclick={() => run(onBack, false)}>
				<ArrowLeft class="size-4 shrink-0" aria-hidden="true" />
				Back to games
			</button>
		</div>
	{/if}
</div>
