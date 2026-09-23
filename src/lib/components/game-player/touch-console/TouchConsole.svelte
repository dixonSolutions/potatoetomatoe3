<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { Check, ChevronDown, GripHorizontal, Keyboard, Move, RotateCcw } from 'lucide-svelte';
	import TouchJoystick from './TouchJoystick.svelte';
	import TouchButton from './TouchButton.svelte';
	import ControlsMenu from './ControlsMenu.svelte';
	import {
		TOUCH_CONSOLE_CHANGED,
		directionsForJoystickScheme,
		getDefaultTouchLayout,
		keyLabel,
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
		keyPurpose,
		planExtraControls,
		withControlsHint,
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
		onRequestShow,
		/** Height of chrome drawn over the top of the game (fullscreen toolbar), in px. */
		topInset = 0,
		/** Controls menu (detected keys + full keyboard); opened from the toolbar or the panel. */
		menuOpen = $bindable(false),
		/** Catalog description — often names the controls before the game has loaded. */
		controlsHint = ''
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
		topInset?: number;
		menuOpen?: boolean;
		controlsHint?: string;
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
	/**
	 * The scheme picker is a custom listbox, not a `<select>`.
	 *
	 * A native picker paints itself from the platform theme: on Android WebView the
	 * Arrows/WASD list came up as an opaque white system sheet over a translucent glass
	 * console, and no CSS on the `<select>` can reach the popup to fix that. Owning the
	 * popup is the only way it can match the rest of the console.
	 */
	let schemeMenuOpen = $state(false);
	let schemeMenuEl = $state<HTMLDivElement | null>(null);
	/**
	 * Layout editing is a mode you switch on, not a long press. While it is on, pressing
	 * any control drags it and sends no key; while it is off, controls can be held for as
	 * long as the game needs without ever turning into drag handles.
	 */
	let editMode = $state(false);

	const DIRECTION_CODES: Record<TouchJoystickScheme, TouchKeyCode[]> = {
		arrows: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
		wasd: ['KeyW', 'KeyA', 'KeyS', 'KeyD']
	};

	const SCHEME_OPTIONS: { value: TouchJoystickScheme; label: string }[] = [
		{ value: 'arrows', label: '↑↓←→ Arrows' },
		{ value: 'wasd', label: 'WASD' }
	];

	/* Trigger pill height, and the popup it opens — used to flip the popup near an edge. */
	const SCHEME_TRIGGER_H = 28;
	const SCHEME_MENU_W = 152;
	const SCHEME_MENU_H = 8 + SCHEME_OPTIONS.length * 28;

	/*
	 * What the layout plans from (settled, plus the catalog's own controls text) and what
	 * the menu shows (live, same hint). Both include the catalog description, which often
	 * names the controls before the game has loaded a single script.
	 */
	const planProfile = $derived(withControlsHint(appliedProfile, controlsHint));
	const menuProfile = $derived(withControlsHint(liveProfile, controlsHint));
	const profileCodes = $derived(keyProfileCodes(planProfile));
	const noKeyboardDetected = $derived(keyProfileSaysNoKeyboard(planProfile));
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
		if (planProfile.declared.length === 0) return null;
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
		planControlVisibility(planProfile, [
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
	const showSurface = $derived(started && (visible || menuOpen));
	const showMenu = $derived(menuOpen && started && !privacyLocked && !editMode);
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
	 * This runs as a capture-phase `pointerdown` handler on the overlay root, so it sees
	 * every press inside the console. `preventDefault()` on `pointerdown` suppresses the
	 * default activation, which kills the press for whatever it landed on — back when the
	 * scheme picker was a `<select>`, that stopped Android WebView opening the native
	 * picker at all and the Arrows/WASD dropdown looked dead. Suppression is only wanted
	 * for the game surface, where it stops the press stealing focus from the game, so
	 * every console control carries `data-console-control`.
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

	/**
	 * Where a control is drawn, kept wholly on the game surface.
	 *
	 * Layouts are stored as fractions of the surface, so a layout made on a tall screen
	 * put its lowest button partly below the edge of a short landscape phone — the default
	 * Space pill was cut in half there. Clamping at render keeps every control reachable
	 * without rewriting what the player saved.
	 */
	function controlPos(xPct: number, yPct: number, w: number, h: number): string {
		const pad = 4;
		const left = Math.max(pad, Math.min(pctToPx(xPct, 'x'), surfaceW - w - pad));
		const top = Math.max(pad, Math.min(pctToPx(yPct, 'y'), surfaceH - h - pad));
		return `left:${left}px;top:${surfaceOffsetY + top}px;`;
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
		const held = dispatcher.joystickCodes();
		const codes = KeyDispatcher.directionsFromVector(v.x, v.y, effectiveDirections, held);
		/* A light tick when the stick engages a new direction — not on every move. */
		if (config.haptics && codes.some((c) => !held.has(c))) buzz(4);
		dispatcher.setJoystickCodes(codes);
	}

	function buzz(ms: number) {
		try {
			navigator.vibrate?.(ms);
		} catch {
			/* ignore */
		}
	}

	function resetLayout() {
		const fresh = getDefaultTouchLayout(orientation);
		saveLayout(orientation, fresh, gameId || null);
		config = getEffectiveConfig(gameId || null, orientation);
		layoutDraft = null;
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

	function schemeLabel(scheme: TouchJoystickScheme): string {
		return SCHEME_OPTIONS.find((o) => o.value === scheme)?.label ?? scheme;
	}

	function pickScheme(scheme: TouchJoystickScheme) {
		schemeMenuOpen = false;
		onJoystickSchemeChange(scheme);
	}

	/**
	 * The popup is a sibling of the console panel, not a child of it.
	 *
	 * The panel carries `opacity: config.opacity`, and opacity applies to the whole
	 * subtree — a menu nested inside it would be dimmed to the same 40% as the chrome
	 * behind it and become unreadable. Being a sibling costs it the panel's layout, so
	 * its position is computed from the same numbers the panel is drawn from.
	 */
	const schemeMenuPos = $derived.by(() => {
		const triggerLeft = pctToPx(layout.console.xPct, 'x') + 8;
		const triggerTop = surfaceOffsetY + pctToPx(layout.console.yPct, 'y') + 8;
		const below = triggerTop + SCHEME_TRIGGER_H + 6;
		const surfaceBottom = surfaceOffsetY + surfaceH;
		const flipUp = below + SCHEME_MENU_H > surfaceBottom;
		return {
			left: Math.max(4, Math.min(triggerLeft, surfaceW - SCHEME_MENU_W - 4)),
			top: flipUp
				? Math.max(surfaceOffsetY + 4, triggerTop - 6 - SCHEME_MENU_H)
				: Math.min(below, surfaceBottom - SCHEME_MENU_H - 4)
		};
	});

	/* A menu left open across a hide or a drag-edit would reopen over the wrong place. */
	$effect(() => {
		if (!showOverlay || editingControl !== null) schemeMenuOpen = false;
	});

	/* Hiding the console ends an edit session. */
	$effect(() => {
		if (!showOverlay) {
			untrack(() => {
				if (editMode) editMode = false;
			});
		}
	});

	/* The menu closes with the game (relaunch, lock screen). */
	$effect(() => {
		if (!started || privacyLocked) {
			untrack(() => {
				if (menuOpen) menuOpen = false;
			});
		}
	});

	/* Entering edit mode must not leave keys held from a press that started before it. */
	$effect(() => {
		if (editMode) {
			untrack(() => {
				dispatcher.releaseAll();
				menuOpen = false;
			});
		}
	});

	/*
	 * The dynamic part of the console: keys the game needs that the pad does not have yet.
	 * Only strong evidence earns a button — named in the controls, or seen in use — and
	 * only game keys, never shortcuts or letters the game reads as typed text.
	 */
	const coveredCodes = $derived.by(() => {
		const codes: string[] = [];
		if (joystickFate !== 'hide') codes.push(...DIRECTION_CODES[effectiveScheme]);
		for (const b of layout.buttons) {
			if ((visibilityPlan[b.id] ?? 'show') !== 'hide') codes.push(...buttonCodes(b.id));
		}
		return codes;
	});
	const extraControls = $derived(planExtraControls(planProfile, coveredCodes, 4));

	function purposeOf(codes: string[]): string {
		for (const c of codes) if (keyPurpose(planProfile, c)) return keyPurpose(planProfile, c);
		return '';
	}

	/**
	 * Put the caret in the game's text box so the device keyboard opens. Same-origin
	 * frames are focused directly (inside this tap, so mobile browsers allow the keyboard);
	 * otherwise the bridge is asked to do it.
	 */
	function typeWithDevice() {
		menuOpen = false;
		const target = resolveInjectable(iframe);
		try {
			const focus = (target?.win as (Window & { __ptFocusTextField?: () => boolean }) | undefined)
				?.__ptFocusTextField;
			if (typeof focus === 'function' && focus()) return;
		} catch {
			/* cross-origin — fall through to the bridge */
		}
		try {
			iframe?.contentWindow?.postMessage({ type: 'potato-tomato-focus-text' }, '*');
		} catch {
			/* ignore */
		}
	}

	/* Move focus into the popup so a keyboard (or a TV remote) can leave it again. */
	$effect(() => {
		if (!schemeMenuOpen || !schemeMenuEl) return;
		schemeMenuEl.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
	});

	function onSchemeMenuKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			schemeMenuOpen = false;
			return;
		}
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		const items = Array.from(schemeMenuEl?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
		if (items.length === 0) return;
		e.preventDefault();
		const at = items.indexOf(document.activeElement as HTMLElement);
		const step = e.key === 'ArrowDown' ? 1 : -1;
		items[(at + step + items.length) % items.length]?.focus();
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
		aria-hidden={!showOverlay && !showMenu}
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
				<button
					type="button"
					data-console-control
					class="pointer-events-auto absolute top-2 left-2 z-10 flex h-7 max-w-[34%] items-center gap-1 rounded-full border border-border/70 bg-background/80 px-2.5 text-[10px] font-semibold tracking-wide text-foreground shadow-sm backdrop-blur-md outline-none"
					class:border-emerald-400={effectiveScheme !== config.joystickScheme}
					aria-label="Joystick key scheme"
					aria-haspopup="listbox"
					aria-expanded={schemeMenuOpen}
					title={effectiveScheme !== config.joystickScheme
						? 'Matched to the keys this game says it reads — pick one to override'
						: 'Keys the joystick sends'}
					onclick={() => {
						schemeMenuOpen = !schemeMenuOpen;
					}}
				>
					<span class="truncate">{schemeLabel(effectiveScheme)}</span>
					<ChevronDown class="size-3 shrink-0 opacity-70" />
				</button>
				<button
					type="button"
					data-console-control
					class="pointer-events-auto absolute top-2 left-1/2 z-10 flex h-7 w-14 -translate-x-1/2 cursor-move touch-none items-center justify-center rounded-full border border-border/70 bg-background/80 text-foreground shadow-sm backdrop-blur-md"
					aria-label="Drag to move the whole console"
					title="Drag to move the whole console"
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
						/*
						 * The grip does nothing but move the console, so a drag starts as soon
						 * as the finger travels a few pixels — no long press to discover.
						 */
						const onMove = (ev: PointerEvent) => {
							if (ev.pointerId !== e.pointerId) return;
							const dx = ev.clientX - start.x;
							const dy = ev.clientY - start.y;
							if (!editing && Math.hypot(dx, dy) > 4) {
								editing = true;
								beginEdit('console');
							}
							if (editing) dragControl('console', { x: dx, y: dy });
						};
						const onUp = (ev: PointerEvent) => {
							if (ev.pointerId !== e.pointerId) return;
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
							endEdit(editing && ev.type !== 'pointercancel');
						};
						window.addEventListener('pointermove', onMove, true);
						window.addEventListener('pointerup', onUp, true);
						window.addEventListener('pointercancel', onUp, true);
					}}
				>
					<GripHorizontal class="size-4" />
				</button>
				<div class="pointer-events-auto absolute top-2 right-2 z-10 flex items-center gap-1">
					{#if editMode}
						<button
							type="button"
							data-console-control
							class="flex h-7 items-center justify-center rounded-full border border-border/70 bg-background/80 px-2 text-foreground shadow-sm backdrop-blur-md"
							aria-label="Reset layout to default"
							title="Reset layout to default"
							onclick={resetLayout}
						>
							<RotateCcw class="size-3.5" />
						</button>
					{:else}
						<button
							type="button"
							data-console-control
							data-testid="console-controls-toggle"
							class="flex h-7 w-8 items-center justify-center rounded-full border backdrop-blur-md {menuOpen
								? 'border-emerald-500/80 bg-emerald-500 text-white'
								: 'border-border/70 bg-background/80 text-foreground shadow-sm'}"
							aria-label={menuOpen ? 'Hide controls' : 'Show controls'}
							aria-pressed={menuOpen}
							title="Controls — what this game uses, and every key"
							onclick={() => (menuOpen = !menuOpen)}
						>
							<Keyboard class="size-3.5" />
						</button>
					{/if}
					<button
						type="button"
						data-console-control
						data-testid="console-edit-toggle"
						class="flex h-7 items-center justify-center gap-1 rounded-full border px-2 text-[10px] font-semibold backdrop-blur-md {editMode
							? 'border-rose-500/80 bg-rose-500 text-white'
							: 'border-border/70 bg-background/80 text-foreground shadow-sm'}"
						aria-label={editMode ? 'Done editing layout' : 'Edit layout'}
						aria-pressed={editMode}
						title={editMode ? 'Done — controls work again' : 'Move controls'}
						onclick={() => (editMode = !editMode)}
					>
						{#if editMode}
							Done
						{:else}
							<Move class="size-3.5" />
						{/if}
					</button>
				</div>
				<!--
					Controls that quietly disappear read as a bug. One short badge says the
					layout was trimmed on purpose and what it was trimmed against.
				-->
				{#if noKeyboardSettled}
					<span
						class="pointer-events-none absolute right-3 bottom-2 z-10 rounded-full border border-amber-500/50 bg-background/80 px-2 py-0.5 text-[10px] font-semibold text-amber-700 backdrop-blur-md dark:text-amber-300"
						title="Nothing in this game listens for key presses — touch the game directly."
					>
						No keys used
					</span>
				{:else if hiddenControlCount > 0}
					<span
						class="pointer-events-none absolute right-3 bottom-2 z-10 rounded-full border border-emerald-500/50 bg-background/80 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 backdrop-blur-md dark:text-emerald-300"
						title="Hidden because this game's own control list does not mention them."
					>
						−{hiddenControlCount} unused
					</span>
				{/if}
			</div>

			{#if schemeMenuOpen}
				<!--
					Full-surface scrim: a tap anywhere outside the popup closes it. Presses on
					the game go straight to the iframe and never reach a document listener, so
					an outside-click handler alone would leave the menu stuck open.
				-->
				<button
					type="button"
					data-console-control
					class="pointer-events-auto absolute inset-0 z-20 cursor-default"
					aria-label="Close the key scheme menu"
					onpointerdown={() => {
						schemeMenuOpen = false;
					}}
				></button>
				<div
					bind:this={schemeMenuEl}
					class="pointer-events-auto absolute z-30 overflow-hidden rounded-2xl border border-border bg-popover/95 p-1 text-popover-foreground shadow-xl backdrop-blur-xl"
					role="listbox"
					aria-label="Joystick key scheme"
					tabindex="-1"
					style={`left:${schemeMenuPos.left}px;top:${schemeMenuPos.top}px;width:${SCHEME_MENU_W}px;`}
					onkeydown={onSchemeMenuKeydown}
				>
					{#each SCHEME_OPTIONS as opt (opt.value)}
						<button
							type="button"
							data-console-control
							role="option"
							aria-selected={effectiveScheme === opt.value}
							class="flex h-7 w-full items-center justify-between rounded-xl px-2.5 text-[10px] font-semibold tracking-wide outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring {effectiveScheme ===
							opt.value
								? 'bg-accent text-accent-foreground'
								: ''}"
							onclick={() => pickScheme(opt.value)}
						>
							<span class="truncate">{opt.label}</span>
							{#if effectiveScheme === opt.value}
								<Check class="size-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
							{/if}
						</button>
					{/each}
				</div>
			{/if}

			{#if extraControls.length && !editMode}
				<!--
					Added from detection: the keys this game needs that the pad lacks, just above it.
				-->
				<div
					class="pointer-events-none absolute z-10 flex gap-1.5"
					data-testid="console-extras"
					style={`left:${Math.max(4, pctToPx(layout.console.xPct, 'x'))}px;top:${Math.max(
						surfaceOffsetY + topInset + 4,
						surfaceOffsetY + pctToPx(layout.console.yPct, 'y') - 50
					)}px;`}
				>
					{#each extraControls as extra (extra.code)}
						<TouchButton
							label={keyLabel(extra.code)}
							caption={extra.purpose}
							size={Math.round(42 * scale)}
							width={extra.purpose
								? Math.round(Math.min(120, Math.max(46, extra.purpose.length * 6.2 + 18)) * scale)
								: undefined}
							opacity={config.opacity}
							accent="slate"
							onPress={() => {
								dispatcher.down([extra.code]);
								if (config.haptics) buzz(8);
							}}
							onRelease={() => dispatcher.up([extra.code])}
						/>
					{/each}
				</div>
			{/if}

			{#if editMode}
				<div
					class="pointer-events-none absolute inset-x-0 z-30 flex justify-center"
					style={`top:${surfaceOffsetY + topInset + 8}px;`}
					role="status"
				>
					<span
						class="rounded-full border border-rose-500/60 bg-popover/90 px-3 py-1 text-[11px] font-semibold text-popover-foreground shadow-md backdrop-blur-md"
					>
						Drag any control to move it · tap Done when finished
					</span>
				</div>
			{/if}

			{#if joystickFate !== 'hide'}
				<div
					class="absolute"
					style={controlPos(
						layout.joystick.xPct,
						layout.joystick.yPct,
						Math.round(layout.joystick.size * scale),
						Math.round(layout.joystick.size * scale)
					)}
				>
					<TouchJoystick
						size={Math.round(layout.joystick.size * scale)}
						deadzone={layout.joystick.deadzone}
						opacity={joystickFate === 'dim' ? config.opacity * 0.4 : config.opacity}
						editing={editingControl === 'joystick'}
						{editMode}
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
						style={controlPos(
							btn.xPct,
							btn.yPct,
							buttonWidth(btn) ?? Math.round(btn.size * scale),
							Math.round(btn.size * scale)
						)}
					>
						<TouchButton
							label={btn.label}
							caption={purposeOf(buttonCodes(btn.id))}
							size={Math.round(btn.size * scale)}
							width={buttonWidth(btn)}
							opacity={fate === 'dim' ? config.opacity * 0.4 : config.opacity}
							accent={buttonAccent(btn.id)}
							editing={editingControl === btn.id}
							{editMode}
							disabled={Boolean(editingControl && editingControl !== btn.id)}
							onPress={() => {
								if (editingControl) return;
								dispatcher.down(buttonCodes(btn.id));
								if (config.haptics) buzz(8);
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

		{#if showMenu && surfaceW > 0}
			<div
				class="pointer-events-none absolute inset-x-0 z-40 flex justify-center px-2"
				style={`top:${surfaceOffsetY + topInset + 8}px;max-height:${Math.max(160, surfaceH - topInset - 16)}px;`}
			>
				<ControlsMenu
					profile={menuProfile}
					canSend={injectable}
					onDown={(code) => {
						dispatcher.down([code]);
						if (config.haptics) buzz(6);
					}}
					onUp={(code) => dispatcher.up([code])}
					onClose={() => (menuOpen = false)}
					onTypeWithDevice={typeWithDevice}
				/>
			</div>
		{/if}
	</div>
{/if}
