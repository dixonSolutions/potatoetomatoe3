<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { GripHorizontal } from 'lucide-svelte';
	import TouchJoystick from './TouchJoystick.svelte';
	import TouchButton from './TouchButton.svelte';
	import {
		TOUCH_CONSOLE_CHANGED,
		directionsForJoystickScheme,
		getEffectiveConfig,
		saveLayout,
		setJoystickScheme,
		translateTouchLayout,
		type EffectiveTouchConfig,
		type TouchDirection,
		type TouchJoystickScheme,
		type TouchKeyCode,
		type TouchLayout,
		type TouchOrientation
	} from '$lib/utils/touch-console';
	import {
		emptyKeyProfile,
		keyProfileCodes,
		keyProfileSaysNoKeyboard,
		observeKeyProfile,
		planControlVisibility,
		type KeyProfile
	} from '$lib/utils/key-profile';
	import {
		KeyDispatcher,
		canUseTouchBridge,
		isLikelyInjectableUrl,
		resolveInjectable,
		isTouchOnlyDevice
	} from '$lib/utils/touch-input-dispatch';
	import { isLocalAppDeployment, shouldProbePullerBackend } from '$lib/utils/offline-deployment';
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

	/*
	 * What the game is actually listening for, as reported by the in-frame bridge.
	 *
	 * `liveProfile` updates the instant a report lands. `appliedProfile` is what the
	 * layout renders from, and it only catches up when the console is idle: buttons must
	 * never appear, vanish or fade under a thumb that is mid-press, and a layout that
	 * reflowed during a drag-edit would fight the drag.
	 */
	let liveProfile = $state<KeyProfile>(emptyKeyProfile(''));
	let appliedProfile = $state<KeyProfile>(emptyKeyProfile(''));
	/** Set once the player picks a scheme by hand — detection stops overriding after that. */
	let manualSchemeForGame = $state('');

	const DIRECTION_CODES: Record<TouchJoystickScheme, TouchKeyCode[]> = {
		arrows: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
		wasd: ['KeyW', 'KeyA', 'KeyS', 'KeyD']
	};

	const profileCodes = $derived(keyProfileCodes(appliedProfile));
	const noKeyboardDetected = $derived(keyProfileSaysNoKeyboard(appliedProfile));
	/*
	 * "Nothing listens" is the one verdict that can be premature. A Unity title binds its
	 * key handler only once wasm is up, so the bridge's early sweep honestly reports an
	 * empty frame and the later one corrects it. Showing the badge immediately would flash
	 * "No keys used" on a game that plays fine, so it waits for the correction window to
	 * pass. Every other verdict only ever adds keys, which can never flash a wrong answer.
	 */
	let noKeyboardSettled = $state(false);

	/**
	 * The scheme the game's own controls point at, or null when it names both or neither.
	 *
	 * Only `strong` evidence counts here. A minified bundle that happens to mention
	 * `KeyW` is not a reason to silently move the stick off the arrows the player chose.
	 */
	const detectedScheme = $derived.by<TouchJoystickScheme | null>(() => {
		if (appliedProfile.declared.length === 0) return null;
		const arrows = DIRECTION_CODES.arrows.some((c) => profileCodes.has(c));
		const wasd = DIRECTION_CODES.wasd.some((c) => profileCodes.has(c));
		if (arrows === wasd) return null;
		return arrows ? 'arrows' : 'wasd';
	});

	const effectiveScheme = $derived<TouchJoystickScheme>(
		manualSchemeForGame === gameId || !detectedScheme ? config.joystickScheme : detectedScheme
	);

	const effectiveDirections = $derived<Record<TouchDirection, TouchKeyCode[]>>(
		effectiveScheme === config.joystickScheme
			? config.mapping.directions
			: directionsForJoystickScheme(effectiveScheme)
	);

	/** False on Tauri mobile, which ships no sidecar — so hints must not mention one. */
	const pullerSupported = $derived(shouldProbePullerBackend());

	const orientation = $derived<TouchOrientation>(isPortrait ? 'portrait' : 'landscape');
	const layout = $derived(layoutDraft ?? config.layout);
	/*
	 * One plan for the whole console, not a test per control: the "never leave it empty"
	 * floor in planControlVisibility can only be applied once every control has been judged.
	 */
	const JOYSTICK_ID = '__joystick';
	const visibilityPlan = $derived(
		planControlVisibility(appliedProfile, [
			{ id: JOYSTICK_ID, codes: [...DIRECTION_CODES[effectiveScheme]] },
			...layout.buttons.map((b) => ({ id: b.id, codes: buttonCodes(b.id) }))
		])
	);
	const joystickFate = $derived(visibilityPlan[JOYSTICK_ID] ?? 'show');
	const hiddenControlCount = $derived(
		Object.values(visibilityPlan).filter((fate) => fate === 'hide').length
	);
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
	const showOverlay = $derived(started && visible && !paused && !privacyLocked && injectable);
	const showSurface = $derived(started && visible);
	const showBlockedHint = $derived(
		started && visible && !paused && !privacyLocked && !injectable && !canUseTouchBridge(playerUrl)
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
	/**
	 * Form controls must keep their default activation behaviour.
	 *
	 * This runs as a capture-phase `pointerdown` handler on the overlay root, so it saw
	 * every press inside the console — including the joystick scheme `<select>`. Calling
	 * `preventDefault()` on `pointerdown` suppresses the default activation, and on
	 * Android WebView that stops the native picker from ever opening: the Arrows/WASD
	 * dropdown looked dead. Suppression is only wanted for the game surface, where it
	 * stops the press stealing focus from the game.
	 */
	function isInteractiveControl(target: EventTarget | null): boolean {
		const el = target instanceof Element ? target : null;
		return Boolean(el?.closest('select, input, textarea, option, [data-console-control]'));
	}

	function keepGameFocused(e?: Event) {
		if (e && isInteractiveControl(e.target)) return;
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

	/**
	 * Svelte 5 exposes derived/state objects as reactive proxies. `structuredClone`
	 * cannot clone those proxies, so edit sessions need a plain layout snapshot.
	 */
	function cloneTouchLayout(source: TouchLayout): TouchLayout {
		return {
			console: { ...source.console },
			joystick: { ...source.joystick },
			buttons: source.buttons.map((button) => ({
				...button,
				codes: [...button.codes]
			}))
		};
	}

	function getSurfaceMetrics() {
		const overlayRect = surfaceEl?.getBoundingClientRect();
		const frame = surfaceEl?.parentElement?.querySelector<HTMLElement>(
			'.game-player-surface__frame'
		);
		const frameRect = frame?.getBoundingClientRect();
		const width =
			frameRect?.width ||
			overlayRect?.width ||
			surfaceEl?.parentElement?.clientWidth ||
			(typeof window !== 'undefined' ? window.innerWidth : 0);
		const height =
			frameRect?.height ||
			overlayRect?.height ||
			surfaceEl?.parentElement?.clientHeight ||
			(typeof window !== 'undefined' ? window.innerHeight : 0);
		return {
			width,
			height
		};
	}

	function beginEdit(control: 'console' | 'joystick' | string) {
		editingControl = control;
		editOrigin = cloneTouchLayout(layout);
		layoutDraft = cloneTouchLayout(layout);
	}

	function dragControl(control: 'console' | 'joystick' | string, delta: { x: number; y: number }) {
		const { width, height } = getSurfaceMetrics();
		if (!editOrigin || !layoutDraft || width <= 0 || height <= 0) return;
		const next = cloneTouchLayout(editOrigin);
		const dxPct = delta.x / width;
		const dyPct = delta.y / height;
		if (control === 'console') {
			layoutDraft = cloneTouchLayout(translateTouchLayout(editOrigin, dxPct, dyPct));
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
		const codes = KeyDispatcher.directionsFromVector(v.x, v.y, effectiveDirections);
		dispatcher.setJoystickCodes(codes);
	}

	function buttonCodes(id: string): string[] {
		return config.mapping.buttons[id] ?? layout.buttons.find((b) => b.id === id)?.codes ?? [];
	}

	function buttonAccent(id: string): 'green' | 'blue' | 'red' | 'amber' | 'slate' {
		if (id === 'space') return 'slate';
		if (id === 'a') return 'green';
		if (id === 'b') return 'blue';
		if (id === 'x') return 'red';
		return 'amber';
	}

	function buttonWidth(btn: { id: string; size: number }): number | undefined {
		if (btn.id === 'space') return Math.round(btn.size * 2.1 * scale);
		return undefined;
	}

	function onJoystickSchemeChange(scheme: TouchJoystickScheme) {
		/* An explicit pick outranks detection for the rest of this game's session. */
		manualSchemeForGame = gameId;
		setJoystickScheme(scheme);
		refreshConfig();
		dispatcher.setJoystickCodes([]);
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

	/*
	 * Cross-origin WindowProxy exists before the bridge script does — wait for load.
	 * Packaged Flatpak often swaps playerUrl onto the same iframe without remounting;
	 * contentDocument is opaque so a naive readyState check was clearing bridgeFrameLoaded
	 * after the load event already fired → Console stuck on “Waiting for…”.
	 */
	$effect(() => {
		const frame = iframe;
		void playerUrl;
		if (!frame) {
			untrack(() => {
				if (bridgeFrameLoaded) bridgeFrameLoaded = false;
			});
			return;
		}
		untrack(() => {
			bridgeFrameLoaded = false;
		});
		const markLoaded = () => {
			untrack(() => {
				if (!bridgeFrameLoaded) bridgeFrameLoaded = true;
			});
			probeInjectable();
		};
		frame.addEventListener('load', markLoaded);
		try {
			if (frame.contentDocument?.readyState === 'complete') markLoaded();
		} catch {
			/* Cross-origin — rely on load + retries below. */
		}
		const timers = [50, 250, 800, 2000, 5000, 9000].map((ms) =>
			window.setTimeout(() => {
				if (!frame.isConnected) return;
				try {
					if (frame.contentDocument?.readyState === 'complete') {
						markLoaded();
						return;
					}
				} catch {
					/* Cross-origin puller frame: load may have already fired before this effect. */
					const src = frame.getAttribute('src') || frame.src || '';
					if (src && src !== 'about:blank' && frame.contentWindow) markLoaded();
				}
				/* Last-resort: any non-blank frame with a WindowProxy is bridge-capable. */
				if (ms >= 5000 && frame.contentWindow) {
					const src = frame.getAttribute('src') || frame.src || '';
					if (src && src !== 'about:blank') markLoaded();
				}
			}, ms)
		);
		return () => {
			frame.removeEventListener('load', markLoaded);
			for (const t of timers) window.clearTimeout(t);
		};
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

	/*
	 * Listen for what the game reads. One observer per game id; the bridge keeps posting
	 * as engines bind their handlers, so reports arrive over the first several seconds
	 * rather than all at once.
	 */
	$effect(() => {
		const id = gameId;
		untrack(() => {
			if (liveProfile.gameId !== id) liveProfile = emptyKeyProfile(id);
			if (appliedProfile.gameId !== id) appliedProfile = emptyKeyProfile(id);
			manualSchemeForGame = '';
		});
		if (!id) return;
		return observeKeyProfile(id, (profile) => {
			liveProfile = profile;
		});
	});

	/*
	 * Move the layout onto the new profile only while nothing is being touched.
	 *
	 * Applying it eagerly is what would make this feel broken: a button fading or
	 * disappearing under a thumb turns one tap into a stuck key, and a control vanishing
	 * mid-drag snaps the edit to a position the player never chose. When busy, retry —
	 * the profile is worth applying a moment late, never worth applying mid-gesture.
	 */
	$effect(() => {
		const next = liveProfile;
		if (next === appliedProfile) return;
		let timer = 0;
		const apply = () => {
			if (editingControl !== null || dispatcher.hasHeldKeys()) {
				timer = window.setTimeout(apply, 400);
				return;
			}
			appliedProfile = next;
		};
		apply();
		return () => window.clearTimeout(timer);
	});

	/* The bridge's last sweep is 8s after the frame loads — outlast it before believing it. */
	$effect(() => {
		if (!noKeyboardDetected) {
			untrack(() => {
				if (noKeyboardSettled) noKeyboardSettled = false;
			});
			return;
		}
		const timer = window.setTimeout(() => {
			noKeyboardSettled = true;
		}, 9000);
		return () => window.clearTimeout(timer);
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
				<span class="mb-1 block font-medium text-emerald-400">Console enabled</span>
				{pullerSupported
					? 'Waiting for the puller-proxied game frame (or offline mirror) so controls can inject…'
					: 'Waiting for the game frame so controls can inject…'}
			</div>
		{:else if showBlockedHint || unavailableHint}
			<div
				class="pointer-events-auto absolute top-3 right-3 max-w-[min(280px,70vw)] rounded-lg border border-amber-500/50 bg-background/90 px-3 py-2 text-xs text-foreground shadow-md backdrop-blur-sm sm:top-4 sm:right-4"
				role="status"
			>
				<span class="mb-1 block font-medium text-amber-400">Console blocked</span>
				{#if pullerSupported}
					Online play needs the puller proxy; offline play needs a downloaded mirror. Raw
					third-party embeds cannot receive controls.
				{:else}
					<!--
						No sidecar on this platform, so there is no proxy to escalate to. Say what the user
						can actually do instead of naming a process they cannot start.
					-->
					This game runs on a third-party site, which will not accept injected controls. Touch the game
					directly, or download it for offline play to use the console.
				{/if}
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
				<label
					class="pointer-events-auto absolute top-2 left-2 z-10 flex max-w-[46%] items-center"
					aria-label="Joystick key scheme"
				>
					<select
						class="h-7 max-w-full truncate rounded-full border border-white/25 bg-black/35 px-2 text-[10px] font-semibold tracking-wide text-white/90 shadow-sm backdrop-blur-md outline-none"
						class:border-emerald-400={effectiveScheme !== config.joystickScheme}
						title={effectiveScheme !== config.joystickScheme
							? 'Matched to the keys this game says it reads — pick one to override'
							: 'Keys the joystick sends'}
						value={effectiveScheme}
						onchange={(e) =>
							onJoystickSchemeChange(
								(e.currentTarget as HTMLSelectElement).value === 'wasd' ? 'wasd' : 'arrows'
							)}
					>
						<option value="arrows">↑↓←→ Arrows</option>
						<option value="wasd">WASD</option>
					</select>
				</label>
				<button
					type="button"
					class="pointer-events-auto absolute top-2 left-1/2 z-10 flex h-7 w-14 -translate-x-1/2 items-center justify-center rounded-full border border-white/25 bg-white/10 text-white/80"
					aria-label="Hold, then drag to move the whole console"
					onpointerdown={(e) => {
						e.preventDefault();
						e.stopPropagation();
						const grip = e.currentTarget;
						try {
							grip.setPointerCapture?.(e.pointerId);
						} catch {
							/* Synthetic or WebView pointer events may not have an active capture target. */
						}
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
							/*
							 * Minor touch jitter should not cancel the long-press. Once editing
							 * begins, pointer capture keeps the drag alive outside the grip.
							 */
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
							try {
								if (grip.hasPointerCapture?.(e.pointerId)) {
									grip.releasePointerCapture(e.pointerId);
								}
							} catch {
								/* Ignore releases after a WebView pointer cancellation. */
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
				<!--
					Controls that quietly disappear read as a bug. One short badge says the
					layout was trimmed on purpose and what it was trimmed against.
				-->
				{#if noKeyboardSettled}
					<span
						class="pointer-events-none absolute top-2 right-3 z-10 rounded-full border border-amber-400/50 bg-black/40 px-2 py-0.5 text-[10px] font-semibold text-amber-200 backdrop-blur-md"
						title="Nothing in this game listens for key presses — touch the game directly."
					>
						No keys used
					</span>
				{:else if hiddenControlCount > 0}
					<span
						class="pointer-events-none absolute top-2 right-3 z-10 rounded-full border border-emerald-400/50 bg-black/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-200 backdrop-blur-md"
						title="Hidden because this game's own control list does not mention them."
					>
						−{hiddenControlCount} unused
					</span>
				{/if}
			</div>

			{#if joystickFate !== 'hide'}
				<div
					class="absolute"
					style={`left:${pctToPx(layout.joystick.xPct, 'x')}px;top:${surfaceOffsetY + pctToPx(layout.joystick.yPct, 'y')}px;`}
				>
					<TouchJoystick
						size={Math.round(layout.joystick.size * scale)}
						deadzone={layout.joystick.deadzone}
						opacity={joystickFate === 'dim' ? config.opacity * 0.4 : config.opacity}
						editing={editingControl === 'joystick'}
						disabled={Boolean(editingControl && editingControl !== 'joystick')}
						onVector={onJoystickVector}
						onHoldEditStart={() => beginEdit('joystick')}
						onHoldEditDrag={(d) => dragControl('joystick', d)}
						onHoldEditEnd={(c) => endEdit(c)}
					/>
				</div>
			{/if}

			{#each layout.buttons as btn (btn.id)}
				{@const fate = visibilityPlan[btn.id] ?? 'show'}
				{#if fate !== 'hide'}
					<div
						class="absolute"
						style={`left:${pctToPx(btn.xPct, 'x')}px;top:${surfaceOffsetY + pctToPx(btn.yPct, 'y')}px;`}
					>
						<TouchButton
							label={btn.label}
							size={Math.round(btn.size * scale)}
							width={buttonWidth(btn)}
							opacity={fate === 'dim' ? config.opacity * 0.4 : config.opacity}
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
				{/if}
			{/each}
		{/if}
	</div>
{/if}
