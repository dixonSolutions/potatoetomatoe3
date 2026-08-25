<script lang="ts">
	import { page } from '$app/stores';
	import { afterNavigate } from '$app/navigation';
	import { base, resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import { onMount, tick } from 'svelte';
	import {
		loadGameMetadata,
		loadAllGames,
		getGamePlayerUrl,
		canPlayGameOffline,
		fixMalformedGamePlayerUrl,
		resolveGameThumbnailSrc,
		type GameMetadata,
		type GameIndexEntry
	} from '$lib/utils/games';
	import {
		getPreferences,
		likeGame,
		dislikeGame,
		removePreference,
		getGamePreference
	} from '$lib/utils/preferences';
	import {
		recordGamePlay,
		getRecommendationsForGamePage,
		recordPlaytimeMs,
		isTodayPlayLimitReached
	} from '$lib/utils/play-recommendations';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Card from '$lib/components/ui/card';
	import {
		Maximize,
		ArrowLeft,
		ThumbsUp,
		ThumbsDown,
		RotateCcw,
		ScrollText,
		Pause,
		Play,
		Download,
		Gamepad2
	} from 'lucide-svelte';
	import { getPrivacyPauseGameWhileLocked } from '$lib/utils/privacy-mode';
	import LazyGameFrame from '$lib/components/game-player/LazyGameFrame.svelte';
	import TouchConsole from '$lib/components/game-player/touch-console/TouchConsole.svelte';
	import OfflineControls from '$lib/components/game-player/OfflineControls.svelte';
	import PlayVersionSelector from '$lib/components/game-player/PlayVersionSelector.svelte';
	import PlayLogsDialog from '$lib/components/game-player/PlayLogsDialog.svelte';
	import { GAME_PLAY_MODE_CHANGED, getGamePlayMode } from '$lib/utils/game-play-mode';
	import {
		OFFLINE_STATUS_CHANGED,
		type OfflineStatusChangedDetail
	} from '$lib/utils/offline-downloader';
	import { describeOfflineBackend, getOfflineBackend } from '$lib/utils/offline-runtime';
	import { isPublicSiteDeployment, shouldProbePullerBackend } from '$lib/utils/offline-deployment';
	import { appendPlayLog } from '$lib/utils/play-diagnostics-log';
	import {
		applyPauseToGameIframe,
		dispatchGamePauseChanged,
		formatGamePauseShortcutLabel,
		gamePauseShortcutMatches,
		getGamePauseShortcut
	} from '$lib/utils/game-pause';
	import { filterDownloadedGames } from '$lib/utils/game-availability';
	import { isNetworkOnline, subscribeNetworkStatus } from '$lib/utils/network-status';
	import { iframeAllowForUrl } from '$lib/utils/games';
	import { canUseTouchBridge, resolveInjectable } from '$lib/utils/touch-input-dispatch';
	import { clearDirectLaunchFailed, markDirectLaunchFailed } from '$lib/utils/online-play-routing';
	import { readConsoleVisiblePref, writeConsoleVisiblePref } from '$lib/utils/touch-console';
	import { GamePlayerLayout } from '$lib/hooks/game-player-layout.svelte';
	import {
		toggleFullscreen as toggleElementFullscreen,
		isImmersiveElement,
		isPseudoFullscreen,
		exitPseudoFullscreen
	} from '$lib/utils/fullscreen';
	import { setGameImmersive } from '$lib/utils/game-immersive';
	import { toast } from 'svelte-sonner';

	let gameMetadata: GameMetadata | null = $state(null);
	let recommendedGames: GameIndexEntry[] = $state([]);
	let loading = $state(true);
	let error = $state('');
	let iframeElement = $state<HTMLIFrameElement | undefined>(undefined);
	let gameSurfaceEl = $state<HTMLDivElement | undefined>(undefined);
	let playerUrlRefreshPending = $state(false);
	let playerUrlRefreshGeneration = 0;
	let isGameFullscreen = $state(false);
	let userPreference = $state<'liked' | 'disliked' | null>(null);
	let networkOnline = $state(true);
	let offlineThumbRel = $state<string | undefined>(undefined);
	let gameIsOffline = $state(false);

	let gameId = $derived($page.params.gameId ?? '');

	function handleLike() {
		if (!gameId) return;
		likeGame(gameId);
		userPreference = 'liked';
	}

	function handleDislike() {
		if (!gameId) return;
		dislikeGame(gameId);
		userPreference = 'disliked';
	}

	function handleRemovePreference() {
		if (!gameId) return;
		removePreference(gameId);
		userPreference = null;
	}

	/** True after the user clicks Play — avoids loading the game bundle until then. */
	let gameSurfaceStarted = $state(false);
	let gamePlayerUrl = $state('');
	/** Bumps on full relaunch so the iframe remounts even when the URL is unchanged. */
	let playerRemountKey = $state(0);
	let logsOpen = $state(false);
	let logSnapshot = $state<string[]>([]);
	let offlineBackendLabel = $state('…');
	let gamePaused = $state(false);
	let pauseShortcutLabel = $state('`');
	let touchConsoleVisible = $state(false);
	let touchConsoleAvailable = $state(false);
	/** Frame started but never reported `load` — surfaces the retry hint below the player. */
	let frameStalled = $state(false);
	/** Last game id that finished (or started) a hard load — used to avoid wiping Console. */
	let loadedGameId = $state('');
	/**
	 * Always show Console on local/dev/Tauri. Do not gate on child chromeAvailable —
	 * that bind lagged false and hid the control entirely.
	 */
	let showConsoleButton = $derived(!isPublicSiteDeployment() || touchConsoleAvailable);

	/** Single writer for Console on/off — persists so remounts / reloads cannot snap back to Off. */
	function setTouchConsoleVisible(on: boolean, reason: string) {
		if (gameId) writeConsoleVisiblePref(gameId, on);
		if (touchConsoleVisible === on) return;
		touchConsoleVisible = on;
		appendPlayLog(
			'info',
			'ui',
			on ? 'Touch console on' : 'Touch console off',
			`game=${gameId} reason=${reason}`
		);
	}

	function restoreTouchConsolePref(id: string) {
		if (!readConsoleVisiblePref(id)) return;
		/*
		 * Restore the Console *preference* only — do not auto-start the iframe.
		 * Forcing gameSurfaceStarted here skipped LazyGameFrame's Play gesture, so
		 * WebKit/Unity often came up black; Pause then made recovery impossible.
		 */
		const alreadyOn = touchConsoleVisible;
		touchConsoleVisible = true;
		if (alreadyOn) return;
		appendPlayLog('info', 'ui', 'Touch console preference restored', `game=${id}`);
		if (gameSurfaceStarted) void ensureTouchCapablePlayUrl();
	}

	const playerLayout = new GamePlayerLayout();

	function posterUrlFor(game: GameIndexEntry | GameMetadata) {
		const preferOffline = !networkOnline || gameIsOffline;
		return resolveGameThumbnailSrc(game.thumbnail, {
			gameId: game.id,
			preferOffline,
			offlineThumbnailRel: offlineThumbRel
		});
	}

	async function refreshOfflineCoverStatus(id: string) {
		try {
			const { fetchGameOfflineStatus } = await import('$lib/utils/offline-downloader');
			const status = await fetchGameOfflineStatus(id, true);
			gameIsOffline = Boolean(status?.offline);
			offlineThumbRel = status?.offlineThumbnail;
		} catch {
			gameIsOffline = false;
			offlineThumbRel = undefined;
		}
	}

	function refreshPauseShortcutLabel() {
		pauseShortcutLabel = formatGamePauseShortcutLabel(getGamePauseShortcut());
	}

	function setGamePausedState(paused: boolean) {
		if (!gameSurfaceStarted && paused) return;
		gamePaused = paused;
		applyPauseToGameIframe(iframeElement, paused);
		dispatchGamePauseChanged(paused);
		if (!paused && iframeElement) {
			void import('$lib/utils/game-audio').then(({ unlockGameIframeAudio }) => {
				unlockGameIframeAudio(iframeElement);
				window.setTimeout(() => unlockGameIframeAudio(iframeElement), 200);
			});
		}
		appendPlayLog('info', 'ui', paused ? 'Game paused' : 'Game resumed', `game=${gameId}`);
	}

	function toggleGamePause() {
		if (!gameSurfaceStarted) {
			toast.message('Start the game first');
			return;
		}
		setGamePausedState(!gamePaused);
	}

	/**
	 * True when the console can already drive this frame from the parent document —
	 * a same-origin game (or same-origin nested shell) exposes a real canvas we can
	 * dispatch key events into. No proxy, no reload, no added latency.
	 */
	function consoleCanReachFrameDirectly(): boolean {
		const target = resolveInjectable(iframeElement ?? null);
		return Boolean(target?.canvas);
	}

	/**
	 * Make the console usable for the current frame, preferring the cheapest path:
	 *   1. direct DOM dispatch into a same-origin game document,
	 *   2. an existing inject/bridge URL (offline mirror or puller proxy already loaded),
	 *   3. the puller relay — only for genuinely cross-origin games, since it reloads
	 *      the game through a Node proxy.
	 */
	async function ensureTouchCapablePlayUrl(): Promise<boolean> {
		if (consoleCanReachFrameDirectly()) {
			appendPlayLog(
				'info',
				'ui',
				'Touch console using direct DOM dispatch (no proxy needed)',
				`game=${gameId} url=${gamePlayerUrl}`
			);
			return true;
		}
		if (canUseTouchBridge(gamePlayerUrl)) return true;

		const mode = gameId ? getGamePlayMode(gameId) : 'online';
		if (mode === 'offline') {
			await refreshPlayerUrl();
			if (canUseTouchBridge(gamePlayerUrl)) {
				gameSurfaceStarted = true;
				return true;
			}
			toast.error('Console needs an offline mirror with inject support for this game.');
			return false;
		}

		/*
		 * Tauri mobile has no sidecar, so every step below is a 12-second wait for a
		 * process that cannot start, ending in advice to run a pnpm command on a tablet.
		 * Fail fast and say what actually works there.
		 */
		if (!shouldProbePullerBackend()) {
			appendPlayLog(
				'info',
				'ui',
				'Touch console unavailable — third-party embed and no relay on this platform',
				`game=${gameId} url=${gamePlayerUrl}`
			);
			toast.error('Console cannot reach this game.', {
				description:
					'It runs on a third-party site. Touch the game directly, or download it for offline play.'
			});
			return false;
		}

		const {
			isPullerAvailable,
			syncPullerBaseUrlFromTauri,
			waitForPuller,
			invalidatePullerAvailabilityCache,
			pullerLiveGameUrl,
			pullerUnityPlayUrl
		} = await import('$lib/utils/offline-downloader-puller');
		const { invalidateOfflineBackendCache } = await import('$lib/utils/offline-runtime');
		await syncPullerBaseUrlFromTauri();
		invalidatePullerAvailabilityCache();
		invalidateOfflineBackendCache();
		/* isPullerAvailable falls back to Rust ensure_puller when WebKit loopback fetch fails. */
		const pullerUp =
			(await isPullerAvailable(true, { ignoreDeploymentGate: true })) ||
			(await waitForPuller(12_000));
		if (!pullerUp) {
			/* Offline mirror can still host the console without a live puller. */
			const { getOfflinePlayUrl } = await import('$lib/utils/offline-downloader');
			const offlineUrl = await getOfflinePlayUrl(gameId);
			if (offlineUrl && canUseTouchBridge(offlineUrl)) {
				gamePlayerUrl = offlineUrl;
				gameSurfaceStarted = true;
				toast.message('Puller down — using offline mirror for console');
				return true;
			}
			toast.error('Console needs the local puller for online play.', {
				description: 'Use Retry puller, restart the app, or run pnpm puller:start.'
			});
			return false;
		}

		const prev = gamePlayerUrl;
		await refreshPlayerUrl();
		if (!canUseTouchBridge(gamePlayerUrl)) {
			/*
			 * Unity iframe shells must use unity-play (CDN + inject). Non-Unity
			 * external shells (OpenFL/Lime on abinbins, etc.) use game-live.
			 * Catalog wrappers alone leave nested games without the touch bridge.
			 */
			let preferUnityPlay = gameMetadata?.engine === 'unity';
			if (!preferUnityPlay) {
				try {
					const { probeOnlineShellExternal } = await import('$lib/utils/browser-offline-download');
					preferUnityPlay = (await probeOnlineShellExternal(gameId)).unityLike;
				} catch {
					/* ignore */
				}
			}
			const proxyUrl = preferUnityPlay
				? pullerUnityPlayUrl(gameId, base)
				: pullerLiveGameUrl(gameId, base);
			if (proxyUrl !== gamePlayerUrl) {
				gamePlayerUrl = proxyUrl;
			}
		}
		if (!canUseTouchBridge(gamePlayerUrl)) {
			toast.error('Could not open a puller proxy URL for touch console.', {
				description: `Still on ${gamePlayerUrl || '(empty)'}`
			});
			return false;
		}
		if (gamePlayerUrl !== prev) {
			/*
			 * Do not bump playerRemountKey — remounting LazyGameFrame resets
			 * bind:started and hides the console overlay.
			 */
			gameSurfaceStarted = true;
			toast.message('Reloading through puller proxy for the console…');
		}
		return true;
	}

	function toggleTouchConsole() {
		if (touchConsoleVisible) {
			setTouchConsoleVisible(false, 'toggle');
			toast.message('Console · Off');
			return;
		}
		/*
		 * Flip ON synchronously — no await before the state write. Persist so any
		 * later loadGamePage / remount restores ON instead of snapping to Off.
		 * Starting the surface from this click preserves a user gesture for WebKit audio.
		 */
		gameSurfaceStarted = true;
		setTouchConsoleVisible(true, 'toggle');
		toast.message('Console · ON');
		void ensureTouchCapablePlayUrl().then((ok) => {
			/* Re-assert after async proxy work — never leave the button Off. */
			gameSurfaceStarted = true;
			setTouchConsoleVisible(true, 'toggle-reassert');
			void import('$lib/utils/game-audio').then(({ unlockGameIframeAudio }) => {
				unlockGameIframeAudio(iframeElement);
				window.setTimeout(() => unlockGameIframeAudio(iframeElement), 250);
				window.setTimeout(() => unlockGameIframeAudio(iframeElement), 1000);
			});
			if (!ok) {
				appendPlayLog('warn', 'ui', 'Touch console on but proxy incomplete', `game=${gameId}`);
				toast.error(
					'Console is ON, but the game frame still needs the puller or an offline mirror.',
					{
						description: 'Check Retry puller, or switch Play from → Offline if downloaded.'
					}
				);
				return;
			}
			appendPlayLog('info', 'ui', 'Touch console ready', `game=${gameId} url=${gamePlayerUrl}`);
		});
	}

	/** Play URLs served by the local puller relay rather than the game's own host. */
	function isRelayPlayUrl(url: string): boolean {
		return url.includes('/api/game-live/') || url.includes('/api/unity-play/');
	}

	/**
	 * Launch watchdog. A frame that never fires `load` used to stay black with no
	 * explanation; now a stalled direct launch is recorded so the next resolve escalates
	 * to the relay, and the user gets a one-click retry.
	 */
	function handleFrameLoadState(state: 'loading' | 'loaded' | 'stalled', url: string) {
		if (!gameId) return;
		if (state === 'loading') {
			frameStalled = false;
			return;
		}
		if (state === 'loaded') {
			frameStalled = false;
			clearDirectLaunchFailed(gameId);
			appendPlayLog('info', 'play-url', 'Game frame loaded', `game=${gameId} url=${url}`);
			return;
		}

		frameStalled = true;
		appendPlayLog(
			'warn',
			'play-url',
			'Game frame did not load in time',
			`game=${gameId} url=${url}`
		);

		const alreadyRelayed = isRelayPlayUrl(url);
		const canEscalate =
			!alreadyRelayed && shouldProbePullerBackend() && getGamePlayMode(gameId) !== 'offline';
		if (!canEscalate) {
			toast.error('This game is not loading.', {
				description: alreadyRelayed
					? 'The local relay is not responding — try Relaunch, or Retry puller.'
					: 'Try Relaunch, or switch Play from → Offline if you have it downloaded.'
			});
			return;
		}

		markDirectLaunchFailed(gameId);
		toast.error("This game didn't start.", {
			description: 'It can be retried through the local relay (slower, but more compatible).',
			action: {
				label: 'Retry via relay',
				onClick: () => void retryThroughRelay()
			}
		});
	}

	async function retryThroughRelay() {
		if (!gameId) return;
		markDirectLaunchFailed(gameId);
		appendPlayLog('info', 'ui', 'Retrying launch through the puller relay', `game=${gameId}`);
		/*
		 * Swap the URL only — bumping playerRemountKey would reset bind:started and drop
		 * the user back to the Play poster.
		 */
		await refreshPlayerUrl();
		gameSurfaceStarted = true;
		if (!isRelayPlayUrl(gamePlayerUrl)) {
			toast.error('Could not reach the local relay.', {
				description: 'Use Retry puller in Offline controls, or run pnpm puller:start.'
			});
		}
	}

	async function refreshPlayerUrl() {
		const id = gameId;
		if (!id) return;
		const generation = ++playerUrlRefreshGeneration;
		playerUrlRefreshPending = true;
		try {
			const nextUrl = await getGamePlayerUrl(id, gameMetadata);
			if (generation !== playerUrlRefreshGeneration || id !== gameId) return;
			gamePlayerUrl = nextUrl;
		} finally {
			if (generation === playerUrlRefreshGeneration) {
				playerUrlRefreshPending = false;
			}
		}
	}

	async function refreshOfflineBackendLabel() {
		try {
			const backend = await getOfflineBackend();
			offlineBackendLabel = describeOfflineBackend(backend);
		} catch {
			offlineBackendLabel = 'unknown';
		}
	}

	async function openPlayLogs() {
		await refreshOfflineBackendLabel();
		const mode = gameId ? getGamePlayMode(gameId) : '—';
		logSnapshot = [
			`gameId=${gameId || '—'}`,
			`network=${networkOnline ? 'online' : 'offline'}`,
			`playMode=${mode}`,
			`backend=${offlineBackendLabel}`,
			`started=${gameSurfaceStarted}`,
			`playerUrl=${gamePlayerUrl || '(empty)'}`,
			`engine=${gameMetadata?.engine ?? '—'}`
		];
		appendPlayLog('info', 'ui', 'Opened play diagnostics', `game=${gameId}`);
		logsOpen = true;
	}

	async function relaunchGameCompletely() {
		if (!gameId) return;
		appendPlayLog('info', 'ui', 'Relaunch game completely', `game=${gameId}`);
		setGamePausedState(false);
		setTouchConsoleVisible(false, 'relaunch');
		/* A manual relaunch is a fresh attempt — do not keep forcing the relay. */
		frameStalled = false;
		clearDirectLaunchFailed(gameId);
		gameSurfaceStarted = false;
		iframeElement = undefined;
		await refreshPlayerUrl();
		playerRemountKey += 1;
		toast.message('Game relaunched — press Play to start again');
	}

	/**
	 * @param soft When true, refresh URL/metadata only — never wipe Play / Console.
	 *             Same-game hard reloads also keep Console (session pref + loadedGameId).
	 */
	async function loadGamePage(id: string, opts?: { soft?: boolean }) {
		if (!id) {
			error = 'Game not found';
			loading = false;
			return;
		}

		const soft = Boolean(opts?.soft);
		const switchingGame = id !== loadedGameId;

		if (!soft && switchingGame) {
			loading = true;
			error = '';
			gameSurfaceStarted = false;
			gamePaused = false;
			touchConsoleVisible = false;
			gamePlayerUrl = '';
			frameStalled = false;
			recommendedGames = [];
		} else if (!soft) {
			/* Same game re-entry (onMount + afterNavigate race) — do not wipe Console. */
			error = '';
		}

		const meta = soft && gameMetadata && id === gameId ? gameMetadata : await loadGameMetadata(id);
		if (!soft || !gameMetadata) gameMetadata = meta;
		if (!meta) {
			error = 'Game not found';
		}

		networkOnline = isNetworkOnline();
		if (!networkOnline && meta && !(await canPlayGameOffline(id, meta))) {
			error =
				'This game is not available offline. Connect to the internet or download it for offline play first.';
		}

		if (!soft) userPreference = getGamePreference(id);

		if (!meta || error) {
			loading = false;
			return;
		}

		if (!soft && switchingGame && networkOnline) {
			recordGamePlay(id, meta.category, meta.author);
		}

		/*
		 * Resolve the playable URL before loading the full recommendation catalog.
		 * The catalog is useful below the fold, but must not delay the first game frame.
		 */
		gamePlayerUrl = await getGamePlayerUrl(id, meta);
		void refreshOfflineCoverStatus(id);
		loadedGameId = id;
		loading = false;

		/* Console preference survives remounts / double-loads / accidental hard refresh. */
		restoreTouchConsolePref(id);

		if (soft) return;

		void (async () => {
			const allGames = await loadAllGames();
			const prefs = getPreferences();
			let rec = getRecommendationsForGamePage(allGames, meta, id, prefs, 4);
			if (!networkOnline) {
				const { fetchDownloadedStatuses } = await import('$lib/utils/offline-downloader');
				const statusMap = await fetchDownloadedStatuses(true);
				rec = filterDownloadedGames(rec, statusMap);
			}
			if (gameId === id) recommendedGames = rec;
		})();
	}

	afterNavigate(({ to }) => {
		if (!browser || !to) return;
		const id = to.params?.gameId ?? '';
		if (!id) return;
		void loadGamePage(id);
	});

	onMount(() => {
		networkOnline = isNetworkOnline();
		refreshPauseShortcutLabel();
		// `afterNavigate` does not fire for the route's initial hydration. Load the
		// requested game here as well so direct links do not remain on "Loading game…".
		if (gameId) void loadGamePage(gameId);
		const detachNetwork = subscribeNetworkStatus((online) => {
			networkOnline = online;
			/*
			 * Never call loadGamePage here — WebKit fires online/offline often and even
			 * "soft" loads raced with Play/Console. Just refresh the play URL + cover.
			 */
			if (gameId) {
				void refreshPlayerUrl();
				void refreshOfflineCoverStatus(gameId);
			}
		});

		const onPrivacyLocked = (e: Event) => {
			const d = (e as CustomEvent<{ locked: boolean }>).detail;
			applyPrivacyPauseToIframe(d?.locked ?? false);
		};
		const onSettingsApplied = () => {
			refreshPauseShortcutLabel();
			applyPrivacyPauseToIframe(document.documentElement.hasAttribute('data-privacy-locked'));
		};
		const onGamePlayModeChanged = (e: Event) => {
			const d = (e as CustomEvent<{ gameId: string }>).detail;
			if (d?.gameId !== gameId) return;
			void refreshPlayerUrl();
		};
		const onOfflineStatusChanged = (e: Event) => {
			const detail = (e as CustomEvent<OfflineStatusChangedDetail>).detail;
			if (detail?.gameId && detail.gameId !== gameId) return;
			void refreshPlayerUrl();
			if (gameId) void refreshOfflineCoverStatus(gameId);
		};
		const onPauseHotkey = (e: KeyboardEvent) => {
			if (!gameSurfaceStarted) return;
			const t = e.target as HTMLElement | null;
			if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
			if (!gamePauseShortcutMatches(e)) return;
			e.preventDefault();
			e.stopPropagation();
			toggleGamePause();
		};
		const onEscapePseudoFullscreen = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			if (!gameSurfaceEl || !isPseudoFullscreen(gameSurfaceEl)) return;
			exitPseudoFullscreen(gameSurfaceEl);
			syncGameFullscreenState();
		};
		window.addEventListener('potato-tomato-privacy-locked', onPrivacyLocked);
		window.addEventListener('potato-tomato-privacy-settings-applied', onSettingsApplied);
		window.addEventListener(GAME_PLAY_MODE_CHANGED, onGamePlayModeChanged);
		window.addEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);
		window.addEventListener('keydown', onPauseHotkey, true);
		window.addEventListener('keydown', onEscapePseudoFullscreen, true);
		document.addEventListener('fullscreenchange', syncGameFullscreenState);
		document.addEventListener('webkitfullscreenchange', syncGameFullscreenState);

		return () => {
			detachNetwork();
			window.removeEventListener('potato-tomato-privacy-locked', onPrivacyLocked);
			window.removeEventListener('potato-tomato-privacy-settings-applied', onSettingsApplied);
			window.removeEventListener(GAME_PLAY_MODE_CHANGED, onGamePlayModeChanged);
			window.removeEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);
			window.removeEventListener('keydown', onPauseHotkey, true);
			window.removeEventListener('keydown', onEscapePseudoFullscreen, true);
			document.removeEventListener('fullscreenchange', syncGameFullscreenState);
			document.removeEventListener('webkitfullscreenchange', syncGameFullscreenState);
			if (gameSurfaceEl && isPseudoFullscreen(gameSurfaceEl)) {
				exitPseudoFullscreen(gameSurfaceEl);
			}
			playerLayout.destroy();
			setGameImmersive(false);
		};
	});

	$effect(() => {
		if (!gameSurfaceStarted) {
			if (gamePaused) gamePaused = false;
			return;
		}
		applyPauseToGameIframe(iframeElement, gamePaused);
	});

	function syncGameFullscreenState() {
		const immersive = isImmersiveElement(gameSurfaceEl ?? null);
		isGameFullscreen = immersive;
		setGameImmersive(immersive);
	}

	async function toggleFullscreen() {
		if (!gameSurfaceEl) return;
		await toggleElementFullscreen(gameSurfaceEl);
		syncGameFullscreenState();
	}

	function applyPrivacyPauseToIframe(locked: boolean) {
		if (!iframeElement) return;
		const pauseVisual = getPrivacyPauseGameWhileLocked();

		/*
		 * Always silence output on the privacy lock screen so cross-origin Unity/WebGL
		 * audio cannot leak through the disguise. Blanking is the only reliable parent-side
		 * control for cross-origin iframes; restore src on unlock to resume play.
		 */
		if (locked) {
			if (!iframeElement.dataset.privacySrc) {
				const current = iframeElement.getAttribute('src') || iframeElement.src || '';
				if (current && current !== 'about:blank') {
					iframeElement.dataset.privacySrc = current;
				}
			}
			if (iframeElement.getAttribute('src') !== 'about:blank') {
				iframeElement.setAttribute('src', 'about:blank');
			}
			if (pauseVisual) {
				iframeElement.style.visibility = 'hidden';
				iframeElement.setAttribute('aria-hidden', 'true');
			}
			return;
		}

		const restore = iframeElement.dataset.privacySrc;
		if (restore) {
			iframeElement.setAttribute('src', restore);
			delete iframeElement.dataset.privacySrc;
		}
		iframeElement.style.visibility = '';
		iframeElement.removeAttribute('aria-hidden');
	}

	$effect(() => {
		if (!iframeElement) return;
		void tick().then(() => {
			applyPrivacyPauseToIframe(document.documentElement.hasAttribute('data-privacy-locked'));
		});
	});

	$effect(() => {
		if (!gameSurfaceStarted || !gameId) return;
		const tickMs = 5000;
		const id = window.setInterval(() => {
			if (document.visibilityState !== 'visible' || !gameSurfaceStarted) return;
			if (isTodayPlayLimitReached(gameId)) {
				return;
			}
			recordPlaytimeMs(gameId, tickMs);
		}, tickMs);
		return () => clearInterval(id);
	});
</script>

<div class="mx-auto w-full max-w-[1920px] px-3 py-4 sm:px-5 sm:py-6">
	{#if loading}
		<div class="py-12 text-center">
			<p class="text-muted-foreground">Loading game...</p>
		</div>
	{:else if error || !gameMetadata}
		<div class="py-12 text-center">
			<h2 class="mb-4 text-2xl font-bold">Game Not Found</h2>
			<p class="mb-4 text-muted-foreground">{error}</p>
			<a href={resolve('/home')}>
				<Button variant="outline">
					<ArrowLeft class="mr-2 h-4 w-4" />
					Back to home
				</Button>
			</a>
		</div>
	{:else}
		<div class="mb-4 sm:mb-6">
			<a href={resolve('/home')}>
				<Button variant="ghost" class="mb-3 sm:mb-4" size="sm">
					<ArrowLeft class="mr-2 h-4 w-4" />
					Back to home
				</Button>
			</a>
			<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div class="min-w-0 flex-1">
					<h1 class="mb-1 text-2xl font-bold sm:mb-2 sm:text-3xl">{gameMetadata.name}</h1>
					<p class="mb-3 text-sm text-muted-foreground sm:text-base">By {gameMetadata.author}</p>
					<div class="flex flex-wrap gap-2">
						{#if userPreference === 'liked'}
							<Button variant="default" size="sm" onclick={handleRemovePreference}>
								<ThumbsUp class="mr-2 h-4 w-4 fill-current" />
								Favourited
							</Button>
						{:else}
							<Button variant="outline" size="sm" onclick={handleLike}>
								<ThumbsUp class="mr-2 h-4 w-4" />
								Favourite
							</Button>
						{/if}

						{#if userPreference === 'disliked'}
							<Button variant="destructive" size="sm" onclick={handleRemovePreference}>
								<ThumbsDown class="mr-2 h-4 w-4 fill-current" />
								Disliked
							</Button>
						{:else}
							<Button variant="outline" size="sm" onclick={handleDislike}>
								<ThumbsDown class="mr-2 h-4 w-4" />
								Dislike
							</Button>
						{/if}
					</div>
				</div>
				<div
					class="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end"
				>
					<Button
						onclick={() => void openPlayLogs()}
						variant="outline"
						size="sm"
						class="w-full sm:w-auto"
					>
						<ScrollText class="mr-2 h-4 w-4" />
						View logs
					</Button>
					<Button
						onclick={toggleGamePause}
						variant={gamePaused ? 'default' : 'outline'}
						size="sm"
						class="w-full sm:w-auto"
						disabled={!gameSurfaceStarted}
						aria-pressed={gamePaused}
						title={`Pause / resume (${pauseShortcutLabel})`}
					>
						{#if gamePaused}
							<Play class="mr-2 h-4 w-4 fill-current" />
							Resume
						{:else}
							<Pause class="mr-2 h-4 w-4" />
							Pause
						{/if}
						<span class="ml-1 font-mono text-[10px] opacity-70">{pauseShortcutLabel}</span>
					</Button>
					{#if showConsoleButton}
						<button
							type="button"
							data-testid="touch-console-toggle"
							onclick={toggleTouchConsole}
							aria-pressed={touchConsoleVisible}
							title={touchConsoleVisible
								? 'Touch console is ON — click to hide'
								: gameSurfaceStarted
									? 'Touch console is OFF — click to show'
									: 'Start the game and show touch console'}
							class="inline-flex h-8 w-full shrink-0 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors sm:w-auto {touchConsoleVisible
								? 'border border-emerald-400 bg-emerald-600 text-white ring-2 ring-emerald-400/70 hover:bg-emerald-500'
								: 'border border-dashed border-input bg-background shadow-xs hover:bg-accent hover:text-accent-foreground'}"
						>
							<Gamepad2 class="h-4 w-4" />
							{touchConsoleVisible ? 'Console · ON' : 'Console · Off'}
						</button>
					{/if}
					<Button
						onclick={() => void relaunchGameCompletely()}
						variant="outline"
						size="sm"
						class="w-full sm:w-auto"
					>
						<RotateCcw class="mr-2 h-4 w-4" />
						Relaunch
					</Button>
					<Button
						onclick={toggleFullscreen}
						variant="outline"
						size="sm"
						class="w-full sm:w-auto"
						aria-pressed={isGameFullscreen}
					>
						<Maximize class="mr-2 h-4 w-4" />
						{isGameFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
					</Button>
				</div>
			</div>
			<PlayVersionSelector {gameId} metadata={gameMetadata} onPlayUrlChange={refreshPlayerUrl} />
			{#if !isPublicSiteDeployment()}
				<OfflineControls {gameId} metadata={gameMetadata} onPlayUrlChange={refreshPlayerUrl} />
			{/if}
		</div>

		{#if isPublicSiteDeployment()}
			<div
				class="mb-5 flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between"
			>
				<div class="min-w-0">
					<p class="font-medium">Browser preview: online play only</p>
					<p class="text-sm text-muted-foreground">
						Download the Linux app for offline mirrors, touch controls, and local saves.
					</p>
				</div>
				<Button href={resolve('/download')} class="shrink-0">
					<Download class="mr-2 size-4" />
					Download the app
				</Button>
			</div>
		{/if}

		<PlayLogsDialog bind:open={logsOpen} {gameId} snapshotLines={logSnapshot} />

		<div
			bind:this={gameSurfaceEl}
			class="game-player-surface relative mb-6 flex flex-col overflow-hidden rounded-lg border bg-card shadow-lg sm:mb-8"
			style={!isGameFullscreen && playerLayout.isCompact ? playerLayout.surfaceStyle : undefined}
		>
			{#if isGameFullscreen}
				<div
					class="absolute top-2 left-2 z-20 flex flex-wrap justify-start gap-1 sm:top-3 sm:left-3"
				>
					<Button
						variant="secondary"
						size="sm"
						class="shadow-md backdrop-blur-sm"
						onclick={() => void openPlayLogs()}
						aria-label="View logs"
					>
						<ScrollText class="mr-2 h-4 w-4" />
						Logs
					</Button>
					<Button
						variant="secondary"
						size="sm"
						class="shadow-md backdrop-blur-sm"
						onclick={toggleGamePause}
						disabled={!gameSurfaceStarted}
						aria-label={gamePaused ? 'Resume game' : 'Pause game'}
					>
						{#if gamePaused}
							<Play class="mr-2 h-4 w-4 fill-current" />
							Resume
						{:else}
							<Pause class="mr-2 h-4 w-4" />
							Pause
						{/if}
					</Button>
					{#if showConsoleButton}
						<button
							type="button"
							data-testid="touch-console-toggle-fs"
							onclick={toggleTouchConsole}
							aria-pressed={touchConsoleVisible}
							aria-label={touchConsoleVisible
								? 'Console on — hide touch console'
								: 'Console off — show touch console'}
							class="inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium shadow-md transition-colors {touchConsoleVisible
								? 'border border-emerald-400 bg-emerald-600 text-white ring-2 ring-emerald-400/80 hover:bg-emerald-500'
								: 'border border-transparent bg-secondary text-secondary-foreground backdrop-blur-sm hover:bg-secondary/80'}"
						>
							<Gamepad2 class="h-4 w-4" />
							{touchConsoleVisible ? 'Console · ON' : 'Console · Off'}
						</button>
					{/if}
					<Button
						variant="secondary"
						size="sm"
						class="shadow-md backdrop-blur-sm"
						onclick={() => void relaunchGameCompletely()}
						aria-label="Relaunch game"
					>
						<RotateCcw class="mr-2 h-4 w-4" />
						Relaunch
					</Button>
					<Button
						variant="secondary"
						size="sm"
						class="shadow-md backdrop-blur-sm"
						onclick={toggleFullscreen}
						aria-label="Exit fullscreen"
					>
						<Maximize class="mr-2 h-4 w-4" />
						Exit
					</Button>
				</div>
			{/if}
			{#if gamePaused && gameSurfaceStarted}
				<div
					class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/80 px-4 text-center backdrop-blur-[2px]"
					role="dialog"
					aria-label="Game paused"
				>
					<p class="text-lg font-semibold">Paused</p>
					<p class="text-sm text-muted-foreground">
						Press <kbd class="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs"
							>{pauseShortcutLabel}</kbd
						>
						or Resume to continue
					</p>
					<Button size="sm" onclick={toggleGamePause}>
						<Play class="mr-2 h-4 w-4 fill-current" />
						Resume
					</Button>
				</div>
			{/if}
			<div class="game-player-surface__frame relative min-h-0 w-full flex-1">
				<!--
					Key only on explicit relaunch. Including gamePlayerUrl in the key remounted
					the frame on every console/proxy URL upgrade and reset bind:started → false,
					so Console appeared stuck Off and the overlay never showed.
				-->
				{#key playerRemountKey}
					<LazyGameFrame
						{gameId}
						gameUrl={fixMalformedGamePlayerUrl(
							gamePlayerUrl || `${base}/games/${gameId}/online/index.html`,
							gameId
						)}
						iframeAllow={iframeAllowForUrl(gamePlayerUrl)}
						posterUrl={posterUrlFor(gameMetadata)}
						title={gameMetadata.name}
						fillContainer={isGameFullscreen || playerLayout.isCompact}
						startDisabled={playerUrlRefreshPending && !gameSurfaceStarted}
						bind:started={gameSurfaceStarted}
						onIframeReady={(el) => {
							const next = el ?? undefined;
							if (iframeElement !== next) iframeElement = next;
						}}
						onLoadStateChange={handleFrameLoadState}
					/>
				{/key}
			</div>
			{#if frameStalled && gameSurfaceStarted}
				<div
					class="flex flex-col gap-2 border-t bg-amber-500/10 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
					role="status"
				>
					<div class="min-w-0">
						<p class="font-medium">This game hasn't loaded yet.</p>
						<p class="text-muted-foreground">
							{#if isRelayPlayUrl(gamePlayerUrl)}
								The local relay is not responding. Try Relaunch, or check Retry puller.
							{:else if shouldProbePullerBackend()}
								Its host may be blocking the app. Retrying through the local relay usually works.
							{:else}
								Its host may be slow or blocking the app. Try Relaunch, or switch Play from →
								Offline if you have it downloaded.
							{/if}
						</p>
					</div>
					<div class="flex shrink-0 gap-2">
						{#if !isRelayPlayUrl(gamePlayerUrl) && shouldProbePullerBackend()}
							<Button size="sm" onclick={() => void retryThroughRelay()}>Retry via relay</Button>
						{/if}
						<Button size="sm" variant="outline" onclick={() => void relaunchGameCompletely()}>
							Relaunch
						</Button>
					</div>
				</div>
			{/if}
			<!-- Overlay only — Console on/off lives in the page toolbar with Pause / Fullscreen. -->
			<TouchConsole
				iframe={iframeElement ?? null}
				{gameId}
				playerUrl={gamePlayerUrl}
				isPortrait={playerLayout.isPortrait}
				paused={gamePaused}
				started={gameSurfaceStarted}
				visible={touchConsoleVisible}
				bind:chromeAvailable={touchConsoleAvailable}
				onRequestShow={() => {
					gameSurfaceStarted = true;
					setTouchConsoleVisible(true, 'auto-show');
				}}
			/>
		</div>

		<div class="mb-8">
			<h2 class="mb-2 text-xl font-semibold">About this game</h2>
			<p class="text-muted-foreground">{gameMetadata.description}</p>
		</div>

		{#if recommendedGames.length > 0}
			<section class="py-8">
				<h2 class="mb-6 text-2xl font-bold">Recommended Games</h2>
				<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-4">
					{#each recommendedGames as game (game.id)}
						<a
							href={resolve(`/games/${game.id}`)}
							data-sveltekit-preload-data="tap"
							class="group block"
						>
							<Card.Root class="overflow-hidden transition-all hover:scale-105 hover:shadow-lg">
								<div class="aspect-square overflow-hidden bg-muted">
									<img
										src={posterUrlFor(game)}
										alt={game.name}
										loading="lazy"
										decoding="async"
										class="h-full w-full object-cover transition-transform group-hover:scale-110"
										onerror={(e) => {
											(e.currentTarget as HTMLImageElement).src =
												'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="256" height="256"%3E%3Crect fill="%23ddd" width="256" height="256"/%3E%3Ctext fill="%23999" font-family="sans-serif" font-size="24" x="50%25" y="50%25" text-anchor="middle" dominant-baseline="middle"%3ENo Image%3C/text%3E%3C/svg%3E';
										}}
									/>
								</div>
								<Card.Header>
									<Card.Title class="text-base">{game.name}</Card.Title>
									{#if 'description' in game && game.description}
										<Card.Description class="text-sm">{game.description}</Card.Description>
									{/if}
								</Card.Header>
								<Card.Footer class="flex justify-between text-xs text-muted-foreground">
									<span>By {game.author}</span>
									<span class="rounded-full bg-primary/10 px-2 py-1 text-primary"
										>{game.category}</span
									>
								</Card.Footer>
							</Card.Root>
						</a>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</div>
