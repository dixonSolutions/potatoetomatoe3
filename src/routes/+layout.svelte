<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import {
		cacheLoadedAppAssets,
		ensureOfflineServiceWorker
	} from '$lib/utils/browser-offline-download';
	import { startAutoApkUpdate } from '$lib/utils/auto-apk-update';
	import { isBrowserStorageSupported } from '$lib/utils/offline-downloader';
	/** Same potato-over-tomato mark as TopBar (`logo.png`). `?url` keeps SSR/client href identical. */
	import favicon from '$lib/assets/logo.png?url';
	import TopBar from '$lib/components/TopBar.svelte';
	import PrivacyGate from '$lib/components/privacy-gateway/PrivacyGate.svelte';
	import PlayLimitGate from '$lib/components/play-limit-gateway/PlayLimitGate.svelte';
	import Settings from '$lib/components/settings/Settings.svelte';
	import { toast } from 'svelte-sonner';
	import { isGlobalDailyLimitExceeded } from '$lib/utils/play-recommendations';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import { setSettingsUiContext } from '$lib/settings-ui-context';
	import {
		isPrivacyEnabled,
		isPrivacySessionUnlocked,
		lockPrivacySession,
		getDecoyTitleForSession,
		getPrivacyLockDelayMs,
		getPrivacyDisguiseMode,
		getPrivacyLockShortcut,
		getPrivacyDisguiseProvider,
		getPrivacyDisguiseServiceId,
		privacyLockShortcutMatches,
		syncPrivacyUnlockCookieWithSession,
		REAL_APP_TITLE
	} from '$lib/utils/privacy-mode';
	import { getDecoyFaviconUrl } from '$lib/utils/privacy-disguise-registry';
	import {
		getNativeIdentityTarget,
		syncNativeIdentity,
		type NativeIdentityTarget
	} from '$lib/utils/native-disguise';
	import type { PrivacyDisguiseMode } from '$lib/utils/site-settings';
	import { attachGlobalMediaMute } from '$lib/utils/audio-mute';
	import {
		APP_WINDOW_FOCUS_CHANGED,
		attachAppWindowFocusTracking,
		isAppWindowFocused
	} from '$lib/utils/app-window-focus';
	import { attachGameStorageBridge } from '$lib/utils/game-storage-bridge';
	import { GAME_IMMERSIVE_CHANGED } from '$lib/utils/game-immersive';
	import {
		attachDesktopTrayListeners,
		getTrayLifecycleState,
		markTrayCloseHintShown,
		shouldShowTrayCloseHint,
		syncDesktopTrayRecent
	} from '$lib/utils/desktop-tray';
	import { isTauriApp, shouldProbePullerBackend } from '$lib/utils/offline-deployment';
	import { invalidateOfflineBackendCache } from '$lib/utils/offline-runtime';
	import { dispatchOfflineStatusChanged } from '$lib/utils/offline-status-events';

	let { data, children } = $props();

	/** Dev harness routes: strip app chrome (TopBar / privacy / play-limit). */
	const isDevHarnessRoute = $derived(
		page.url.pathname === '/dev' || page.url.pathname.startsWith('/dev/')
	);

	const ssrPrivacyHeadFallback = {
		privacyModeEnabled: false,
		decoyTitle: null as string | null,
		decoyFavicon: null as string | null,
		privacySessionUnlocked: true
	};
	const ssrPrivacyHead = $derived(data.ssrPrivacyHead ?? ssrPrivacyHeadFallback);

	/** SSR snapshot for $state seeds only — do not read $derived here (captures once by design). */
	const initialPrivacyHead = data.ssrPrivacyHead ?? ssrPrivacyHeadFallback;

	/** SSR uses settings + unlock cookie so the first document request matches privacy state (no flash of full UI while locked). */
	let privacyEnabled = $state(!!initialPrivacyHead.privacyModeEnabled);
	let privacyUnlocked = $state(
		!initialPrivacyHead.privacyModeEnabled || !!initialPrivacyHead.privacySessionUnlocked
	);
	let settingsOpen = $state(false);
	let decoyTitle = $state(initialPrivacyHead.decoyTitle ?? 'Google Docs');
	/** Prefer SSR disguise URL; never default to the brand logo (that caused privacy-login tab flashes). */
	let decoyFavicon = $state(
		initialPrivacyHead.decoyFavicon ?? getDecoyFaviconUrl('google', 'docs')
	);
	let privacyDisguiseMode = $state<PrivacyDisguiseMode>('focus_loss');
	/** Tab in background — used when disguise mode is "focus loss" (Google Docs tab while away). */
	/** Assume visible for first paint to match SSR; real state applied in onMount (tab hidden is client-only). */
	let tabHidden = $state(false);
	/*
	 * Real OS window focus, not `document.visibilityState`. A desktop window that is merely
	 * behind another one stays "visible", so `tabHidden` never flips on alt-tab — which is
	 * exactly when the taskbar entry is the only thing anyone can see of this app.
	 */
	let appWindowFocused = $state(true);
	let privacyBootstrapReady = $state(false);
	let playLimitLocked = $state(false);
	let playLimitToastIssued = $state(false);
	let gameImmersive = $state(false);

	/**
	 * Title/icon must come from reactive <svelte:head>. Imperative document.title / link.href
	 * is overwritten when Svelte reconciles head, so the Google Docs decoy never persisted.
	 */
	function shouldShowDecoyTab(
		mode: PrivacyDisguiseMode,
		enabled: boolean,
		unlocked: boolean,
		hidden: boolean
	): boolean {
		if (!enabled) return false;
		if (mode === 'off') return false;
		if (mode === 'always') return true;
		return hidden || !unlocked;
	}

	const activeTitle = $derived.by(() => {
		if (!browser) {
			if (ssrPrivacyHead.decoyTitle) {
				return ssrPrivacyHead.decoyTitle;
			}
			return REAL_APP_TITLE;
		}
		/* Match SSR until bootstrap runs — avoids title/favicon hydration mismatches. */
		if (!privacyBootstrapReady) {
			if (ssrPrivacyHead.decoyTitle) {
				return ssrPrivacyHead.decoyTitle;
			}
			return REAL_APP_TITLE;
		}
		if (shouldShowDecoyTab(privacyDisguiseMode, privacyEnabled, privacyUnlocked, tabHidden)) {
			return decoyTitle;
		}
		return REAL_APP_TITLE;
	});

	const activeFavicon = $derived.by(() => {
		if (!browser) {
			if (ssrPrivacyHead.decoyFavicon) return ssrPrivacyHead.decoyFavicon;
			if (ssrPrivacyHead.decoyTitle) return decoyFavicon;
			return favicon;
		}
		/* Match SSR / early app.html script until bootstrap — avoid brand logo while privacy login is pending. */
		if (!privacyBootstrapReady) {
			if (ssrPrivacyHead.decoyFavicon) return ssrPrivacyHead.decoyFavicon;
			if (ssrPrivacyHead.decoyTitle) return decoyFavicon;
			return favicon;
		}
		if (shouldShowDecoyTab(privacyDisguiseMode, privacyEnabled, privacyUnlocked, tabHidden)) {
			return decoyFavicon;
		}
		return favicon;
	});

	/** App brand is PNG; privacy decoys are SVG. */
	const activeFaviconType = $derived(
		activeFavicon.includes('.png') ? 'image/png' : 'image/svg+xml'
	);

	/**
	 * The same disguise, applied to the surfaces a `<svelte:head>` cannot reach: the Android
	 * recents card, and on desktop the window title, taskbar entry and tray.
	 *
	 * Android is disguised as though the app were *already* hidden. `TaskDescription` is
	 * only ever read from the recents card, and the system can snapshot that as the app
	 * pauses — waiting for `visibilitychange` to fire on the way out is a race the disguise
	 * loses, leaving the real name on the card.
	 *
	 * A desktop window title has no snapshot, so `focus_loss` can be honoured literally
	 * there — but off real OS focus rather than `tabHidden`. A window sitting behind another
	 * one is still `visibilityState === 'visible'`, so alt-tabbing away would otherwise
	 * leave "Potato Tomato Games" in the taskbar, which is the whole surface being hidden.
	 */
	let nativeIdentityTarget = $state<NativeIdentityTarget | null>(null);

	const nativeIdentity = $derived.by(() => {
		if (!browser || !privacyBootstrapReady || !nativeIdentityTarget) return null;
		const hidden = nativeIdentityTarget === 'task' ? true : tabHidden || !appWindowFocused;
		const disguised = shouldShowDecoyTab(
			privacyDisguiseMode,
			privacyEnabled,
			privacyUnlocked,
			hidden
		);
		return disguised
			? { label: decoyTitle, icon: decoyFavicon, disguised: true }
			: { label: REAL_APP_TITLE, icon: favicon, disguised: false };
	});

	function refreshPrivacyState() {
		const enabled = isPrivacyEnabled();
		privacyEnabled = enabled;
		privacyUnlocked = !enabled || isPrivacySessionUnlocked();
		decoyTitle = getDecoyTitleForSession();
		decoyFavicon = getDecoyFaviconUrl(getPrivacyDisguiseProvider(), getPrivacyDisguiseServiceId());
		privacyDisguiseMode = getPrivacyDisguiseMode();
	}

	setSettingsUiContext({
		openSettings: () => {
			if (isPrivacyEnabled() && !isPrivacySessionUnlocked()) return;
			settingsOpen = true;
		}
	});

	/**
	 * Do NOT call lockPrivacySession() on layout init: it clears sessionStorage and forces the gate on every
	 * full reload / HMR / error recovery, which feels like “constant refresh” and breaks SPA navigation.
	 * Unlock state comes only from sessionStorage + explicit lock (shortcut, tab-hidden flow below).
	 */
	if (browser) {
		syncPrivacyUnlockCookieWithSession();
		const enabled = isPrivacyEnabled();
		privacyEnabled = enabled;
		privacyUnlocked = !enabled || isPrivacySessionUnlocked();
		decoyTitle = getDecoyTitleForSession();
		decoyFavicon = getDecoyFaviconUrl(getPrivacyDisguiseProvider(), getPrivacyDisguiseServiceId());
		privacyDisguiseMode = getPrivacyDisguiseMode();
		privacyBootstrapReady = true;
	}

	let lockDelayTimer: ReturnType<typeof setTimeout> | null = null;
	/** Ignores sub-200ms `visibilityState === 'hidden'` blips (SPA / iframe quirks) before scheduling a lock. */
	let visibilityHiddenDebounce: ReturnType<typeof setTimeout> | null = null;

	function clearLockDelayTimer() {
		if (lockDelayTimer) {
			clearTimeout(lockDelayTimer);
			lockDelayTimer = null;
		}
	}

	function clearVisibilityHiddenDebounce() {
		if (visibilityHiddenDebounce) {
			clearTimeout(visibilityHiddenDebounce);
			visibilityHiddenDebounce = null;
		}
	}

	function applyPrivacyLock() {
		if (!isPrivacyEnabled()) return;
		settingsOpen = false;
		lockPrivacySession();
		privacyUnlocked = false;
	}

	function schedulePrivacyLockAfterHidden() {
		if (!isPrivacyEnabled()) return;
		clearLockDelayTimer();
		const delay = getPrivacyLockDelayMs();
		if (delay <= 0) {
			applyPrivacyLock();
			return;
		}
		lockDelayTimer = setTimeout(() => {
			lockDelayTimer = null;
			applyPrivacyLock();
		}, delay);
	}

	function onPrivacyKeydown(e: KeyboardEvent) {
		if (isPrivacyEnabled() && isPrivacySessionUnlocked()) {
			const sc = getPrivacyLockShortcut();
			if (sc && privacyLockShortcutMatches(e, sc)) {
				const t = e.target as HTMLElement | null;
				if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
				e.preventDefault();
				applyPrivacyLock();
				return;
			}
		}
		if (e.ctrlKey && e.shiftKey && (e.key === ',' || e.code === 'Comma')) {
			e.preventDefault();
			settingsOpen = true;
		}
	}

	function onAppWindowFocusForNativeIdentity(e: Event) {
		const detail = (e as CustomEvent<{ focused?: boolean }>).detail;
		appWindowFocused = detail?.focused ?? true;
	}

	function onWindowFocusForPrivacy() {
		if (document.visibilityState === 'visible') {
			clearLockDelayTimer();
		}
	}

	function onVisibilityChangeForPrivacy() {
		tabHidden = document.visibilityState !== 'visible';
		refreshPlayLimitLock();
		if (document.visibilityState === 'hidden') {
			clearVisibilityHiddenDebounce();
			visibilityHiddenDebounce = setTimeout(() => {
				visibilityHiddenDebounce = null;
				schedulePrivacyLockAfterHidden();
			}, 200);
		} else {
			clearVisibilityHiddenDebounce();
			clearLockDelayTimer();
		}
	}

	function onPrivacySettingsAppliedForTimers() {
		clearLockDelayTimer();
	}

	/** Client-side navigations must not inherit a pending “hidden” debounce from a blip during the transition. */
	afterNavigate(() => {
		if (!browser) return;
		clearVisibilityHiddenDebounce();
		/* Route chunks load lazily, so the set worth caching only settles per navigation. */
		cacheLoadedAppAssets();
	});

	$effect(() => {
		if (!browser || !isTauriApp()) return;
		void getNativeIdentityTarget().then((target) => {
			nativeIdentityTarget = target;
		});
	});

	$effect(() => {
		const identity = nativeIdentity;
		if (!identity) return;
		void syncNativeIdentity(identity.label, identity.icon, identity.disguised);
	});

	function refreshPlayLimitLock() {
		if (!browser) return;
		const exceeded = isGlobalDailyLimitExceeded();
		if (exceeded && !playLimitLocked) {
			playLimitLocked = true;
			if (!playLimitToastIssued) {
				playLimitToastIssued = true;
				toast.error('Daily playtime limit reached', {
					description:
						'Use “Disable time limit” on the overlay or change the cap in Settings → Analytics.'
				});
			}
		} else if (!exceeded) {
			playLimitLocked = false;
			playLimitToastIssued = false;
		}
	}

	onMount(() => {
		tabHidden = document.visibilityState !== 'visible';
		refreshPrivacyState();
		syncPrivacyUnlockCookieWithSession();
		refreshPlayLimitLock();

		/*
		 * The public site needs this worker most: it is what serves /browser-offline/ files
		 * out of IndexedDB and keeps the app shell reachable with no network, so a game
		 * downloaded in the browser is still playable after a reload. It used to be skipped
		 * there, which left browser downloads with nothing to play them back.
		 */
		if (isBrowserStorageSupported()) {
			void ensureOfflineServiceWorker()
				.then((ready) => {
					if (ready) cacheLoadedAppAssets();
				})
				.catch((err) => console.warn('Offline service worker registration failed:', err));
		}

		/* Android self-update. No-ops on every other target and when already current. */
		startAutoApkUpdate();

		const onPlayLimitsChanged = () => refreshPlayLimitLock();
		window.addEventListener('potato-tomato-play-limits-changed', onPlayLimitsChanged);

		const poll = window.setInterval(() => refreshPlayLimitLock(), 5000);

		/* Legacy key from removed shallow /login routing — clear so it cannot confuse navigation. */
		if (browser) {
			try {
				sessionStorage.removeItem('potato-tomato-privacy-return-url');
				sessionStorage.removeItem('potato-tomato-privacy-docs-cover');
			} catch {
				/* ignore */
			}
		}

		const detachMediaMute = attachGlobalMediaMute(document);
		let detachAppFocus: (() => void) | undefined;
		appWindowFocused = isAppWindowFocused();
		void attachAppWindowFocusTracking().then((unlisten) => {
			detachAppFocus = unlisten;
		});
		const detachGameStorageBridge = attachGameStorageBridge();

		let detachTray: (() => void) | undefined;
		if (shouldProbePullerBackend()) {
			void import('$lib/utils/offline-downloader-puller').then(
				async ({ syncPullerBaseUrlFromTauri, invalidatePullerAvailabilityCache }) => {
					await syncPullerBaseUrlFromTauri();
					invalidatePullerAvailabilityCache();
					invalidateOfflineBackendCache();
					dispatchOfflineStatusChanged();
				}
			);
		}
		if (isTauriApp()) {
			void attachDesktopTrayListeners().then((unlisten) => {
				detachTray = unlisten;
			});
			void syncDesktopTrayRecent();
			if (shouldShowTrayCloseHint()) {
				markTrayCloseHintShown();
				void getTrayLifecycleState().then((life) => {
					if (life.closeToTray) {
						toast.message('Runs in the tray', {
							description:
								'Closing the window keeps Potato Tomato in the notification area. Quit from the tray menu to exit.'
						});
					} else {
						toast.message('Closing quits the app', {
							description: life.trayAvailable
								? 'On GNOME/Silverblue the tray icon is usually hidden. Use Quit in the top bar, or enable close-to-tray in Settings → Games after installing an AppIndicator extension.'
								: 'No system tray was found. Closing the window fully quits Potato Tomato (and stops background downloads).'
						});
					}
				});
			}
		}

		const onGameImmersive = (e: Event) => {
			gameImmersive = !!(e as CustomEvent<{ immersive: boolean }>).detail?.immersive;
		};
		const onFullscreenChange = () => {
			gameImmersive = document.documentElement.hasAttribute('data-game-immersive');
		};

		window.addEventListener(GAME_IMMERSIVE_CHANGED, onGameImmersive);
		document.addEventListener('fullscreenchange', onFullscreenChange);
		document.addEventListener('webkitfullscreenchange', onFullscreenChange);

		window.addEventListener(APP_WINDOW_FOCUS_CHANGED, onAppWindowFocusForNativeIdentity);
		window.addEventListener('keydown', onPrivacyKeydown);
		window.addEventListener('focus', onWindowFocusForPrivacy);
		document.addEventListener('visibilitychange', onVisibilityChangeForPrivacy);
		window.addEventListener(
			'potato-tomato-privacy-settings-applied',
			onPrivacySettingsAppliedForTimers
		);

		const onFocusSyncTray = () => {
			if (isTauriApp()) void syncDesktopTrayRecent();
		};
		window.addEventListener('focus', onFocusSyncTray);

		return () => {
			window.removeEventListener('potato-tomato-play-limits-changed', onPlayLimitsChanged);
			clearInterval(poll);
			detachMediaMute();
			detachAppFocus?.();
			detachGameStorageBridge();
			detachTray?.();
			clearLockDelayTimer();
			clearVisibilityHiddenDebounce();
			window.removeEventListener(
				'potato-tomato-privacy-settings-applied',
				onPrivacySettingsAppliedForTimers
			);
			window.removeEventListener(APP_WINDOW_FOCUS_CHANGED, onAppWindowFocusForNativeIdentity);
			window.removeEventListener('keydown', onPrivacyKeydown);
			window.removeEventListener('focus', onWindowFocusForPrivacy);
			window.removeEventListener('focus', onFocusSyncTray);
			document.removeEventListener('visibilitychange', onVisibilityChangeForPrivacy);
			window.removeEventListener(GAME_IMMERSIVE_CHANGED, onGameImmersive);
			document.removeEventListener('fullscreenchange', onFullscreenChange);
			document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
		};
	});

	$effect(() => {
		if (!browser || !privacyBootstrapReady) return;
		const locked = privacyEnabled && !privacyUnlocked;
		document.documentElement.toggleAttribute('data-privacy-locked', locked);
		window.dispatchEvent(new CustomEvent('potato-tomato-privacy-locked', { detail: { locked } }));
	});
</script>

<ModeWatcher defaultMode="system" />
<Toaster closeButton position="top-center" />

<svelte:head>
	<title>{activeTitle}</title>
	<!-- `key` forces a new <link> when the tab icon swaps (browsers cache favicons aggressively). -->
	{#key activeFavicon}
		<link rel="icon" href={activeFavicon} type={activeFaviconType} sizes="any" />
		<link rel="shortcut icon" href={activeFavicon} type={activeFaviconType} />
	{/key}
</svelte:head>

{#if !isDevHarnessRoute && (!privacyEnabled || privacyUnlocked)}
	<Settings
		bind:open={settingsOpen}
		onApplied={() => {
			refreshPrivacyState();
			refreshPlayLimitLock();
			if (browser) {
				window.dispatchEvent(new CustomEvent('potato-tomato-privacy-settings-applied'));
			}
		}}
	/>
{/if}

{#if isDevHarnessRoute}
	<div class="min-h-screen bg-background">
		{#if children}
			{@render children()}
		{/if}
	</div>
{:else}
	<div class="min-h-screen bg-background">
		<!-- Do not gate the shell on privacyBootstrapReady: SSR sent an empty page before, which caused a full flash on hydrate. Title/favicon still wait on bootstrap via activeTitle/activeFavicon. -->
		<div
			class="min-h-screen"
			inert={privacyEnabled && !privacyUnlocked ? true : playLimitLocked ? true : undefined}
		>
			<TopBar
				hidden={gameImmersive}
				onLock={applyPrivacyLock}
				privacyReady={privacyEnabled && privacyUnlocked}
			/>
			{#if children}
				{@render children()}
			{/if}
		</div>
		{#if privacyEnabled && !privacyUnlocked}
			<PrivacyGate onUnlocked={refreshPrivacyState} />
		{:else if playLimitLocked}
			<PlayLimitGate />
		{/if}
	</div>
{/if}
