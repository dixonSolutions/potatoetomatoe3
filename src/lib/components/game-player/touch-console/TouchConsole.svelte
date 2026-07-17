<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { GripHorizontal } from 'lucide-svelte';
	import TouchJoystick from './TouchJoystick.svelte';
	import TouchButton from './TouchButton.svelte';
	import {
		TOUCH_CONSOLE_CHANGED,
		getEffectiveConfig,
		saveLayout,
		translateTouchLayout,
		type EffectiveTouchConfig,
		type TouchLayout,
		type TouchOrientation
	} from '$lib/utils/touch-console';
	import {
		KeyDispatcher,
		canUseTouchBridge,
		isLikelyInjectableUrl,
		resolveInjectable,
		isTouchOnlyDevice
	} from '$lib/utils/touch-input-dispatch';
	import { isLocalAppDeployment } from '$lib/utils/offline-deployment';
	import { IsMobile } from '$lib/hooks/is-mobile.svelte.js';

	let {
		iframe = null,
		gameId = '',
		playerUrl = '',
		isPortrait = false,
		paused = false,
		started = false,
		/**
		 * Parent toolbar owns on/off — one-way prop only.
		 * Never $bindable: child remounts / effects were wiping parent back to Off.
		 */
		visible = false,
		/** Whether the parent should show the Console toolbar button. */
		chromeAvailable = $bindable(false),
		/** Auto-enable on touch-only devices asks the parent to turn Console on. */
		onRequestShow
	}: {
		iframe?: HTMLIFrameElement | null;
		gameId?: string;
		playerUrl?: string;
		isPortrait?: boolean;
		paused?: boolean;
		started?: boolean;
		visible?: boolean;
		chromeAvailable?: boolean;
		onRequestShow?: () => void;
	} = $props();

	const isMobile = new IsMobile();
	const dispatcher = new KeyDispatcher();

	let injectable = $state(false);
	let unavailableHint = $state(false);
	let surfaceEl = $state<HTMLDivElement | null>(null);
	let surfaceW = $state(0);
	let surfaceH = $state(0);
	let surfaceOffsetY = $state(0);
	let config = $state<EffectiveTouchConfig>(getEffectiveConfig(null, 'landscape'));
	let layoutDraft = $state<TouchLayout | null>(null);
	let editingControl = $state<'console' | 'joystick' | string | null>(null);
	let editOrigin = $state<TouchLayout | null>(null);
	let privacyLocked = $state(false);
	let autoOpenedForGame = $state('');
	/** Track last game id so we only clear visibility on actual navigation. */
	let visibilityGameId = $state('');
	/** Cross-origin bridge scripts can only receive input after their iframe has loaded. */
	let bridgeFrameLoaded = $state(false);

	const orientation = $derived<TouchOrientation>(isPortrait ? 'portrait' : 'landscape');
	const layout = $derived(layoutDraft ?? config.layout);
	const canOfferChrome = $derived(
		config.enabled &&
			config.availability !== 'off' &&
			(config.availability === 'always' ||
				isMobile.current ||
				isLocalAppDeployment() ||
				injectable ||
				canUseTouchBridge(playerUrl) ||
				isLikelyInjectableUrl(playerUrl))
	);
	/*
	 * When the parent toolbar forces Console ON, always show the surface —
	 * even if chromeAvailable briefly lags — so the button never looks stuck Off
	 * while inject/proxy catches up.
	 */
	const waitingForInjection = $derived(
		started && visible && !paused && !privacyLocked && !injectable && canUseTouchBridge(playerUrl)
	);
	const showOverlay = $derived(
		started && visible && !paused && !privacyLocked && injectable
	);
	const showSurface = $derived(started && visible);
	const showBlockedHint = $derived(
		started &&
			visible &&
			!paused &&
			!privacyLocked &&
			!injectable &&
			!canUseTouchBridge(playerUrl)
	);
	const scale = $derived(config.scale);

	function refreshConfig() {
		config = getEffectiveConfig(gameId || null, orientation);
		/* Do not clear layoutDraft here — that aborted in-progress drag-edit on every refresh. */
	}

	/** Track game id for auto-open; parent owns visible — do not write it here. */
	function noteGameId(nextGameId: string) {
		if (!nextGameId || visibilityGameId === nextGameId) return;
		visibilityGameId = nextGameId;
		autoOpenedForGame = '';
	}

	function requestAutoShow() {
		if (
			!started ||
			!config.autoEnableOnTouchOnly ||
			!isTouchOnlyDevice() ||
			autoOpenedForGame === gameId
		) {
			return;
		}
		autoOpenedForGame = gameId;
		onRequestShow?.();
	}

	/**
	 * Console is game chrome. preventDefault stops the overlay from taking DOM focus
	 * (which would make Unity see hasFocus()===false). Do NOT iframe.focus() here —
	 * that steals pointer capture from the joystick mid-drag.
	 */
	function keepGameFocused(e?: Event) {
		e?.preventDefault?.();
		try {
			iframe?.contentWindow?.postMessage({ type: 'potato-tomato-unlock-audio' }, '*');
		} catch {
			/* ignore */
		}
	}

	function probeInjectable() {
		/*
		 * Never rebind dispatch targets while keys are held — setTarget/setBridgeFrame
		 * used to releaseAll() and drop mid-gesture input (game looks frozen).
		 */
		if (dispatcher.hasHeldKeys()) {
			const nextInjectable = dispatcher.hasDispatchPath();
			if (injectable !== nextInjectable) injectable = nextInjectable;
			return;
		}

		const loaded = untrack(() => bridgeFrameLoaded);
		const target = resolveInjectable(iframe);
		let nextInjectable = false;
		if (target) {
			dispatcher.setTarget(target);
			nextInjectable = true;
		} else if (iframe && loaded && canUseTouchBridge(playerUrl)) {
			dispatcher.setBridgeFrame(iframe);
			nextInjectable = Boolean(iframe.contentWindow);
		} else {
			dispatcher.setTarget(null);
			dispatcher.setBridgeFrame(null);
			nextInjectable = false;
		}
		if (injectable !== nextInjectable) injectable = nextInjectable;
		if (nextInjectable) requestAutoShow();

		const nextHint = Boolean(
			started &&
				visible &&
				!nextInjectable &&
				!canUseTouchBridge(playerUrl) &&
				(config.availability === 'always' ||
					isLocalAppDeployment() ||
					!isLikelyInjectableUrl(playerUrl))
		);
		if (unavailableHint !== nextHint) unavailableHint = nextHint;
	}

	function pctToPx(pct: number, axis: 'x' | 'y'): number {
		return pct * (axis === 'x' ? surfaceW : surfaceH);
	}

	function clampPct(n: number): number {
		return Math.max(0, Math.min(1, n));
	}

	function beginEdit(control: 'console' | 'joystick' | string) {
		editingControl = control;
		editOrigin = structuredClone(layout);
		layoutDraft = structuredClone(layout);
	}

	function dragControl(control: 'console' | 'joystick' | string, delta: { x: number; y: number }) {
		if (!editOrigin || !layoutDraft || surfaceW <= 0 || surfaceH <= 0) return;
		const next = structuredClone(editOrigin);
		const dxPct = delta.x / surfaceW;
		const dyPct = delta.y / surfaceH;
		if (control === 'console') {
			layoutDraft = translateTouchLayout(editOrigin, dxPct, dyPct);
			return;
		} else if (control === 'joystick') {
			next.joystick.xPct = clampPct(editOrigin.joystick.xPct + dxPct);
			next.joystick.yPct = clampPct(editOrigin.joystick.yPct + dyPct);
		} else {
			next.buttons = next.buttons.map((b) => {
				if (b.id !== control) return b;
				const originBtn = editOrigin!.buttons.find((ob) => ob.id === control);
				if (!originBtn) return b;
				return {
					...b,
					xPct: clampPct(originBtn.xPct + dxPct),
					yPct: clampPct(originBtn.yPct + dyPct)
				};
			});
		}
		layoutDraft = next;
	}

	function endEdit(committed: boolean) {
		if (committed && layoutDraft) {
			saveLayout(orientation, layoutDraft, gameId || null);
			config = getEffectiveConfig(gameId || null, orientation);
		}
		layoutDraft = null;
		editOrigin = null;
		editingControl = null;
	}

	function onJoystickVector(v: { x: number; y: number }) {
		if (!showOverlay || editingControl) {
			dispatcher.setJoystickCodes([]);
			return;
		}
		const codes = KeyDispatcher.directionsFromVector(v.x, v.y, config.mapping.directions);
		dispatcher.setJoystickCodes(codes);
	}

	function buttonCodes(id: string): string[] {
		return config.mapping.buttons[id] ?? layout.buttons.find((b) => b.id === id)?.codes ?? [];
	}

	function buttonAccent(id: string): 'green' | 'blue' | 'red' | 'amber' {
		if (id === 'a') return 'green';
		if (id === 'b') return 'blue';
		if (id === 'x') return 'red';
		return 'amber';
	}

	function measureSurface() {
		if (!surfaceEl) return;
		const overlayRect = surfaceEl.getBoundingClientRect();
		const frame = surfaceEl.parentElement?.querySelector<HTMLElement>(
			'.game-player-surface__frame'
		);
		const rect = frame?.getBoundingClientRect() ?? overlayRect;
		const parent = frame ?? surfaceEl.parentElement;
		/* Match the playable iframe region, not optional banners above the frame. */
		const nextW =
			rect.width || parent?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 0);
		const nextH =
			rect.height ||
			parent?.clientHeight ||
			(typeof window !== 'undefined' ? window.innerHeight : 0);
		const nextOffsetY = rect.top - overlayRect.top;
		if (surfaceW !== nextW) surfaceW = nextW;
		if (surfaceH !== nextH) surfaceH = nextH;
		if (surfaceOffsetY !== nextOffsetY) surfaceOffsetY = nextOffsetY;
	}

	onMount(() => {
		refreshConfig();

		const onSettings = () => refreshConfig();
		const onPrivacy = (e: Event) => {
			const d = (e as CustomEvent<{ locked: boolean }>).detail;
			privacyLocked = d?.locked ?? document.documentElement.hasAttribute('data-privacy-locked');
			if (privacyLocked) dispatcher.releaseAll();
		};
		privacyLocked = document.documentElement.hasAttribute('data-privacy-locked');

		window.addEventListener(TOUCH_CONSOLE_CHANGED, onSettings);
		window.addEventListener('potato-tomato-privacy-locked', onPrivacy);

		return () => {
			window.removeEventListener(TOUCH_CONSOLE_CHANGED, onSettings);
			window.removeEventListener('potato-tomato-privacy-locked', onPrivacy);
			dispatcher.releaseAll();
		};
	});

	$effect(() => {
		const next = canOfferChrome;
		if (chromeAvailable !== next) chromeAvailable = next;
	});

	$effect(() => {
		if (!visible) {
			dispatcher.releaseAll();
			if (editingControl !== null) editingControl = null;
			if (layoutDraft !== null) layoutDraft = null;
		}
	});

	/* surfaceEl only exists after showSurface — measure/observe whenever it binds. */
	$effect(() => {
		const el = surfaceEl;
		if (!el) return;
		measureSurface();
		const ro =
			typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => measureSurface()) : null;
		ro?.observe(el);
		const onWinResize = () => measureSurface();
		window.addEventListener('resize', onWinResize);
		return () => {
			ro?.disconnect();
			window.removeEventListener('resize', onWinResize);
		};
	});

	/* Remeasure when the overlay actually appears (first paint after toggle). */
	$effect(() => {
		if (!showOverlay) return;
		measureSurface();
		const id = requestAnimationFrame(() => measureSurface());
		return () => cancelAnimationFrame(id);
	});

	$effect(() => {
		void orientation;
		refreshConfig();
	});

	$effect(() => {
		const id = gameId;
		noteGameId(id);
		refreshConfig();
	});

	$effect(() => {
		void iframe;
		void playerUrl;
		void started;
		void config.enabled;
		void config.availability;
		/* Probe writes injectable — keep that outside the dependency graph. */
		untrack(() => probeInjectable());
	});

	/* A cross-origin WindowProxy exists before the bridge script does. Do not expose controls until load. */
	$effect(() => {
		const frame = iframe;
		if (!frame) {
			untrack(() => {
				if (bridgeFrameLoaded) bridgeFrameLoaded = false;
			});
			return;
		}
		const onLoad = () => {
			untrack(() => {
				if (!bridgeFrameLoaded) bridgeFrameLoaded = true;
			});
			probeInjectable();
		};
		frame.addEventListener('load', onLoad);
		let loaded = false;
		try {
			loaded = frame.contentDocument?.readyState === 'complete';
		} catch {
			/* Cross-origin documents become ready only through the iframe load event. */
		}
		untrack(() => {
			if (bridgeFrameLoaded !== loaded) bridgeFrameLoaded = loaded;
		});
		if (loaded) probeInjectable();
		return () => frame.removeEventListener('load', onLoad);
	});

	/* Unity / nested shells often create the canvas after first probe — keep trying while visible. */
	$effect(() => {
		if (!started || !visible || !iframe) return;
		const frame = iframe;
		untrack(() => probeInjectable());
		const t1 = window.setTimeout(() => probeInjectable(), 400);
		const t2 = window.setTimeout(() => probeInjectable(), 1500);
		const t3 = window.setTimeout(() => probeInjectable(), 4000);
		const onLoad = () => probeInjectable();
		frame.addEventListener('load', onLoad);
		return () => {
			window.clearTimeout(t1);
			window.clearTimeout(t2);
			window.clearTimeout(t3);
			frame.removeEventListener('load', onLoad);
		};
	});

	$effect(() => {
		if (paused || privacyLocked || !visible) {
			dispatcher.releaseAll();
		}
	});
</script>

{#if showSurface}
	<div
		bind:this={surfaceEl}
		class="pointer-events-none absolute inset-0 z-30 overflow-hidden"
		aria-hidden={!showOverlay}
		onpointerdowncapture={keepGameFocused}
	>
		{#if waitingForInjection}
			<div
				class="pointer-events-auto absolute top-3 right-3 max-w-[min(280px,70vw)] rounded-lg border border-emerald-500/40 bg-background/90 px-3 py-2 text-xs text-foreground shadow-md backdrop-blur-sm sm:top-4 sm:right-4"
				role="status"
				onpointerdown={keepGameFocused}
			>
				<span class="mb-1 block font-medium text-emerald-400">Console · ON</span>
				Waiting for the puller-proxied game frame (or offline mirror) so controls can inject…
			</div>
		{:else if showBlockedHint || unavailableHint}
			<div
				class="pointer-events-auto absolute top-3 right-3 max-w-[min(280px,70vw)] rounded-lg border border-amber-500/50 bg-background/90 px-3 py-2 text-xs text-foreground shadow-md backdrop-blur-sm sm:top-4 sm:right-4"
				role="status"
			>
				<span class="mb-1 block font-medium text-amber-400">Console · blocked</span>
				Online play needs the puller proxy; offline play needs a downloaded mirror. Raw third-party embeds
				cannot receive controls.
			</div>
		{/if}

		{#if showOverlay && surfaceW > 0 && surfaceH > 0}
			<!-- Compact console panel (visual grouping + whole-unit drag handle) -->
			<div
				class="pointer-events-none absolute rounded-[26px] border border-white/20 bg-white/[0.04] shadow-[0_10px_40px_rgb(0_0_0_/0.35)]"
				class:ring-2={editingControl === 'console'}
				class:ring-rose-400={editingControl === 'console'}
				class:ring-dashed={editingControl === 'console'}
				style={`left:${pctToPx(layout.console.xPct, 'x')}px;top:${surfaceOffsetY + pctToPx(layout.console.yPct, 'y')}px;width:${pctToPx(layout.console.widthPct, 'x')}px;height:${pctToPx(layout.console.heightPct, 'y')}px;opacity:${config.opacity};`}
			>
				<button
					type="button"
					class="pointer-events-auto absolute top-2 left-1/2 z-10 flex h-7 w-14 -translate-x-1/2 items-center justify-center rounded-full border border-white/25 bg-white/10 text-white/80"
					aria-label="Hold, then drag to move the whole console"
					onpointerdown={(e) => {
						e.preventDefault();
						e.stopPropagation();
						const grip = e.currentTarget;
						grip.setPointerCapture?.(e.pointerId);
						const start = { x: e.clientX, y: e.clientY };
						let editing = false;
						let cancelled = false;
						const timer = setTimeout(() => {
							if (cancelled) return;
							editing = true;
							beginEdit('console');
						}, 650);
						const onMove = (ev: PointerEvent) => {
							if (ev.pointerId !== e.pointerId) return;
							const dx = ev.clientX - start.x;
							const dy = ev.clientY - start.y;
							// Minor touch jitter should not cancel the long-press. Once editing
							// begins, pointer capture keeps the drag alive outside the small grip.
							if (!editing && Math.hypot(dx, dy) > 24) {
								cancelled = true;
								clearTimeout(timer);
							}
							if (editing) dragControl('console', { x: dx, y: dy });
						};
						const onUp = (ev: PointerEvent) => {
							if (ev.pointerId !== e.pointerId) return;
							clearTimeout(timer);
							window.removeEventListener('pointermove', onMove, true);
							window.removeEventListener('pointerup', onUp, true);
							window.removeEventListener('pointercancel', onUp, true);
							if (grip.hasPointerCapture?.(e.pointerId)) {
								grip.releasePointerCapture(e.pointerId);
							}
							endEdit(editing);
						};
						window.addEventListener('pointermove', onMove, true);
						window.addEventListener('pointerup', onUp, true);
						window.addEventListener('pointercancel', onUp, true);
					}}
				>
					<GripHorizontal class="size-4" />
				</button>
			</div>

			<div
				class="absolute"
				style={`left:${pctToPx(layout.joystick.xPct, 'x')}px;top:${surfaceOffsetY + pctToPx(layout.joystick.yPct, 'y')}px;`}
			>
				<TouchJoystick
					size={Math.round(layout.joystick.size * scale)}
					deadzone={layout.joystick.deadzone}
					opacity={config.opacity}
					editing={editingControl === 'joystick'}
					disabled={Boolean(editingControl && editingControl !== 'joystick')}
					onVector={onJoystickVector}
					onHoldEditStart={() => beginEdit('joystick')}
					onHoldEditDrag={(d) => dragControl('joystick', d)}
					onHoldEditEnd={(c) => endEdit(c)}
				/>
			</div>

			{#each layout.buttons as btn (btn.id)}
				<div
					class="absolute"
					style={`left:${pctToPx(btn.xPct, 'x')}px;top:${surfaceOffsetY + pctToPx(btn.yPct, 'y')}px;`}
				>
					<TouchButton
						label={btn.label}
						size={Math.round(btn.size * scale)}
						opacity={config.opacity}
						accent={buttonAccent(btn.id)}
						editing={editingControl === btn.id}
						disabled={Boolean(editingControl && editingControl !== btn.id)}
						onPress={() => {
							if (editingControl) return;
							dispatcher.down(buttonCodes(btn.id));
							if (config.haptics) {
								try {
									navigator.vibrate?.(8);
								} catch {
									/* ignore */
								}
							}
						}}
						onRelease={() => dispatcher.up(buttonCodes(btn.id))}
						onHoldEditStart={() => beginEdit(btn.id)}
						onHoldEditDrag={(d) => dragControl(btn.id, d)}
						onHoldEditEnd={(c) => endEdit(c)}
					/>
				</div>
			{/each}
		{/if}
	</div>
{/if}
