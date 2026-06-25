<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { browser } from '$app/environment';
	import { base } from '$app/paths';
	import { isBrowserStorageSupported } from '$lib/utils/offline-downloader';
	/** `?url` keeps SSR and client `href` identical (plain URL); default SVG import becomes a data URL on the client only and triggers hydration warnings. */
	import favicon from '$lib/assets/favicon.svg?url';
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
	import type { PrivacyDisguiseMode } from '$lib/utils/site-settings';
	import { attachGlobalMediaMute } from '$lib/utils/audio-mute';
	import { attachGameStorageBridge } from '$lib/utils/game-storage-bridge';

	let { data, children } = $props();

	/** SSR uses settings + unlock cookie so the first document request matches privacy state (no flash of full UI while locked). */
	let privacyEnabled = $state(!!data.ssrPrivacyHead.privacyModeEnabled);
	let privacyUnlocked = $state(
		!data.ssrPrivacyHead.privacyModeEnabled || !!data.ssrPrivacyHead.privacySessionUnlocked
	);
	let settingsOpen = $state(false);
	let decoyTitle = $state('Google Docs');
	let decoyFavicon = $state(favicon);
	let privacyDisguiseMode = $state<PrivacyDisguiseMode>('focus_loss');
	/** Tab in background — used when disguise mode is "focus loss" (Google Docs tab while away). */
	/** Assume visible for first paint to match SSR; real state applied in onMount (tab hidden is client-only). */
	let tabHidden = $state(false);
	let privacyBootstrapReady = $state(false);
	let playLimitLocked = $state(false);
	let playLimitToastIssued = $state(false);

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
			if (data.ssrPrivacyHead.decoyTitle) {
				return data.ssrPrivacyHead.decoyTitle;
			}
			return REAL_APP_TITLE;
		}
		/* Match SSR until bootstrap runs — avoids title/favicon hydration mismatches. */
		if (!privacyBootstrapReady) {
			if (data.ssrPrivacyHead.decoyTitle) {
				return data.ssrPrivacyHead.decoyTitle;
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
			if (data.ssrPrivacyHead.decoyTitle) {
				return data.ssrPrivacyHead.decoyFavicon ?? decoyFavicon;
			}
			return favicon;
		}
		if (!privacyBootstrapReady) {
			if (data.ssrPrivacyHead.decoyTitle) {
				return data.ssrPrivacyHead.decoyFavicon ?? decoyFavicon;
			}
			return favicon;
		}
		if (shouldShowDecoyTab(privacyDisguiseMode, privacyEnabled, privacyUnlocked, tabHidden)) {
			return decoyFavicon;
		}
		return favicon;
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
	});

	function refreshPlayLimitLock() {
		if (!browser) return;
		const exceeded = isGlobalDailyLimitExceeded();
		if (exceeded && !playLimitLocked) {
			playLimitLocked = true;
			if (!playLimitToastIssued) {
				playLimitToastIssued = true;
				toast.error('Daily playtime limit reached', {
					description: 'The site is locked until the next UTC day or you change the limit in Settings → Analytics.'
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

		if (isBrowserStorageSupported()) {
			void navigator.serviceWorker
				.register(`${base}/offline-sw.js`, { scope: `${base}/` })
				.catch((err) => console.warn('Offline service worker registration failed:', err));
		}

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
		const detachGameStorageBridge = attachGameStorageBridge();

		window.addEventListener('keydown', onPrivacyKeydown);
		window.addEventListener('focus', onWindowFocusForPrivacy);
		document.addEventListener('visibilitychange', onVisibilityChangeForPrivacy);
		window.addEventListener('potato-tomato-privacy-settings-applied', onPrivacySettingsAppliedForTimers);

		return () => {
			window.removeEventListener('potato-tomato-play-limits-changed', onPlayLimitsChanged);
			clearInterval(poll);
			detachMediaMute();
			detachGameStorageBridge();
			clearLockDelayTimer();
			clearVisibilityHiddenDebounce();
			window.removeEventListener('potato-tomato-privacy-settings-applied', onPrivacySettingsAppliedForTimers);
			window.removeEventListener('keydown', onPrivacyKeydown);
			window.removeEventListener('focus', onWindowFocusForPrivacy);
			document.removeEventListener('visibilitychange', onVisibilityChangeForPrivacy);
		};
	});

	$effect(() => {
		if (!browser || !privacyBootstrapReady) return;
		const locked = privacyEnabled && !privacyUnlocked;
		document.documentElement.toggleAttribute('data-privacy-locked', locked);
		window.dispatchEvent(
			new CustomEvent('potato-tomato-privacy-locked', { detail: { locked } })
		);
	});

</script>

<ModeWatcher defaultMode="dark" />
<Toaster closeButton position="top-center" />

<svelte:head>
	<title>{activeTitle}</title>
	<!-- `key` forces a new <link> when the tab icon swaps (browsers cache favicons aggressively). -->
	{#key activeFavicon}
		<link rel="icon" href={activeFavicon} type="image/svg+xml" sizes="any" />
		<link rel="shortcut icon" href={activeFavicon} type="image/svg+xml" />
	{/key}
</svelte:head>

{#if !privacyEnabled || privacyUnlocked}
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

<div class="min-h-screen bg-background">
	<!-- Do not gate the shell on privacyBootstrapReady: SSR sent an empty page before, which caused a full flash on hydrate. Title/favicon still wait on bootstrap via activeTitle/activeFavicon. -->
	<div
		class="min-h-screen"
		inert={privacyEnabled && !privacyUnlocked ? true : playLimitLocked ? true : undefined}
	>
		<TopBar />
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
