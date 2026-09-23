<script lang="ts">
	import { page } from '$app/stores';
	import { afterNavigate, goto } from '$app/navigation';
	import { base, resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import { onMount, tick, untrack } from 'svelte';
	import {
		loadGameMetadata,
		loadAllGames,
		getGamePlayerUrl,
		playRouteOfUrl,
		playRoutesExhausted,
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
		isTodayPlayLimitReached,
		isGlobalDailyLimitExceeded
	} from '$lib/utils/play-recommendations';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Card from '$lib/components/ui/card';
	import { ArrowLeft, ThumbsUp, ThumbsDown, Play, Download } from 'lucide-svelte';
	import { getPrivacyPauseGameWhileLocked } from '$lib/utils/privacy-mode';
	import LazyGameFrame from '$lib/components/game-player/LazyGameFrame.svelte';
	import GameToolbar from '$lib/components/game-player/GameToolbar.svelte';
	import InGameMenu from '$lib/components/game-player/in-game-menu/InGameMenu.svelte';
	import TouchConsole from '$lib/components/game-player/touch-console/TouchConsole.svelte';
	import { preloadGameBrowserProfile } from '$lib/utils/game-storage-bridge';
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
	import {
		formatGameFullscreenShortcutLabel,
		gameFullscreenShortcutMatches,
		getActiveGameFullscreenShortcut
	} from '$lib/utils/game-fullscreen';
	import {
		enterGameFullscreen,
		exitGameFullscreen,
		noteDocumentFullscreenChange,
		upgradeGameFullscreenOnGesture
	} from '$lib/utils/game-fullscreen-mode';
	import {
		GAME_PLAYER_SETTINGS_CHANGED,
		getGamePlayerSettings,
		menuButtonMetrics,
		showsMenuButton,
		type GamePlayerSettings
	} from '$lib/utils/game-player-settings';
	import {
		POINTER_LOCK_GUARD_FLAG,
		parsePointerLockMessage,
		watchDocumentPointerLock,
		type PointerLockState
	} from '$lib/utils/pointer-lock';
	import {
		KEY_PROFILE_CHANGED,
		detectedControls,
		readCachedKeyProfile,
		withControlsHint,
		type KeyProfile
	} from '$lib/utils/key-profile';
	import { filterDownloadedGames } from '$lib/utils/game-availability';
	import { isNetworkOnline, subscribeNetworkStatus } from '$lib/utils/network-status';
	import { iframeAllowForUrl } from '$lib/utils/games';
	import { canUseTouchBridge, resolveInjectable } from '$lib/utils/touch-input-dispatch';
	import {
		clearDirectLaunchFailed,
		isFrameBlockedHost,
		isUnframeableInApp,
		markPlayRouteFailed
	} from '$lib/utils/online-play-routing';
	import { gameFrameSpokeSince, nativeGameFramesActive } from '$lib/utils/native-game-frames';
	import { openExternalUrl } from '$lib/utils/open-external';
	import { takeWebviewCrashOfGame, webviewCrashOnLoad } from '$lib/utils/webview-crash';
	import { readConsoleVisiblePref, writeConsoleVisiblePref } from '$lib/utils/touch-console';
	import { GamePlayerLayout } from '$lib/hooks/game-player-layout.svelte';
	import { isImmersiveElement } from '$lib/utils/fullscreen';
	import { setGameImmersive } from '$lib/utils/game-immersive';
	import { toast } from 'svelte-sonner';
	import {
		applyQualityFilter,
		readQualityFilterPrefs,
		suggestionPool
	} from '$lib/utils/catalog-quality';
	import { warmGameLaunchFromMetadata } from '$lib/utils/network-warmup';

	let gameMetadata: GameMetadata | null = $state(null);
	/* Open the embed host's connection while the play URL is still being resolved. */
	$effect(() => warmGameLaunchFromMetadata(gameMetadata));
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

	/**
	 * True once the game frame has been given its URL. Games start by themselves as soon as
	 * the play URL is resolved; LazyGameFrame sets this, and it drops back to false only
	 * while switching games or relaunching.
	 */
	let gameSurfaceStarted = $state(false);
	let gamePlayerUrl = $state('');
	/**
	 * The first play URL for this game is resolved (and the saves had their head start).
	 * The player shows the cover before this; the frame is only handed a URL after it.
	 */
	let playUrlReady = $state(false);
	/** Bumps on full relaunch so the iframe remounts even when the URL is unchanged. */
	let playerRemountKey = $state(0);
	let logsOpen = $state(false);
	let logSnapshot = $state<string[]>([]);
	let offlineBackendLabel = $state('…');
	let gamePaused = $state(false);
	let pauseShortcutLabel = $state('`');
	/** Empty while the (opt-in) fullscreen shortcut is off, so no button advertises a key. */
	let fullscreenShortcutLabel = $state('');
	let touchConsoleVisible = $state(false);
	let touchConsoleAvailable = $state(false);
	/** Controls menu: detected keys with what they do, plus every key for accessibility. */
	let controlsMenuOpen = $state(false);
	let playerSettings = $state<GamePlayerSettings>(getGamePlayerSettings());
	let inGameMenuOpen = $state(false);
	/** Play version + offline copy, folded under the toolbar's More menu. */
	let playOptionsOpen = $state(false);
	/** Game id auto-fullscreen already ran for — once per visit, so leaving it sticks. */
	let autoFullscreenFor = '';
	/*
	 * Touch cannot hover, so the in-game menu keeps its button on touch devices. A coarse
	 * primary pointer says so up front; a touch seen on the page says so on hybrids.
	 */
	let coarsePointer = $state(false);
	let touchSeen = $state(false);
	let touchDevice = $derived(coarsePointer || touchSeen);
	/*
	 * A game that starts by itself must not start behind the lock screen or the daily-limit
	 * gate: both used to hold it back simply by being in the way of the Play button.
	 */
	let privacyLocked = $state(false);
	let playLimitHold = $state(false);
	/* One hint per kind per visit: an FPS locks and unlocks on every pause. */
	let pointerLockHintShown = false;
	let stuckCursorHintShown = false;
	/** Where "Back to games" goes: the list the player came from, else all games. */
	let cameFromList = false;
	/* The console's top-anchored panels start below a top-corner menu button. */
	let inGameMenuTopInset = $derived.by(() => {
		if (!isGameFullscreen || !playerSettings.menuCorner.startsWith('top')) return 0;
		if (!showsMenuButton(playerSettings.menuAccess, touchDevice)) return 0;
		return menuButtonMetrics(playerSettings.menuButtonSize, touchDevice).hit + 12;
	});
	/** Live key profile — decides whether Controls has anything to show. */
	let keyProfile = $state<KeyProfile | null>(null);
	let controlsDetected = $derived.by(() => {
		if (!keyProfile) return false;
		const profile = withControlsHint(keyProfile, gameMetadata?.description ?? '');
		return detectedControls(profile).some((c) => c.kind === 'gameplay');
	});
	/** Last game id that finished (or started) a hard load — used to avoid wiping Console. */
	let loadedGameId = $state('');
	/**
	 * The game whose page the desktop app reloaded after it crashed WebKit's web process.
	 * Its frame is held back behind a notice: starting it again would crash again.
	 */
	let crashedGameId = $state('');
	let crashNotice = $derived(Boolean(gameId) && crashedGameId === gameId);
	/**
	 * Always show Console on local/dev/Tauri. Do not gate on child chromeAvailable —
	 * that bind lagged false and hid the control entirely.
	 */
	let showConsoleButton = $derived(!isPublicSiteDeployment() || touchConsoleAvailable);

	/*
	 * Android has no relay (the desktop app plays X-Frame-Options hosts through its
	 * in-process one). Framing them yields chrome-error://chromewebdata/ — a dead black
	 * box with no explanation. Offer the system browser instead of a frame that cannot load.
	 */
	let unframeableEmbedUrl = $derived.by(() => {
		const meta: GameMetadata | null = gameMetadata;
		if (!meta) return '';
		return meta.onlineEmbedUrl?.trim() || meta.remotePlayUrl?.trim() || '';
	});
	let cannotFrameInApp = $derived(
		isUnframeableInApp({
			localApp: !isPublicSiteDeployment(),
			pullerSupported: shouldProbePullerBackend(),
			frameBlockedHost: isFrameBlockedHost(unframeableEmbedUrl)
		})
	);
	let unframeableHost = $derived.by(() => {
		try {
			return new URL(unframeableEmbedUrl).hostname;
		} catch {
			return 'This game’s host';
		}
	});

	/** The player chose to try the game that crashed once more. */
	function playAfterCrash() {
		appendPlayLog('info', 'ui', 'Starting the game again after it crashed', `game=${gameId}`);
		crashedGameId = '';
	}

	async function openGameInBrowser() {
		if (!unframeableEmbedUrl) return;
		try {
			await openExternalUrl(unframeableEmbedUrl);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Could not open this game in the browser');
		}
	}

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
		 * Restore the Console *preference* only. The frame starts by itself once the play
		 * URL is known; forcing gameSurfaceStarted from here would start it before that.
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
		const fullscreenKey = getActiveGameFullscreenShortcut();
		fullscreenShortcutLabel = fullscreenKey ? formatGameFullscreenShortcutLabel(fullscreenKey) : '';
	}

	function refreshPlayerSettings() {
		playerSettings = getGamePlayerSettings();
		refreshPauseShortcutLabel();
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
	 * True when the public site can put a game back on its own origin: a hosted play-proxy
	 * worker (`PUBLIC_PLAY_PROXY_URL`) is configured for this build.
	 */
	async function publicSiteRelayReachable(): Promise<boolean> {
		const proxy = (import.meta.env.PUBLIC_PLAY_PROXY_URL as string | undefined)?.trim();
		return Boolean(proxy);
	}

	/**
	 * Make the console usable for the current frame, preferring the cheapest path:
	 *   1. direct DOM dispatch into a same-origin game document,
	 *   2. a bridge already inside the game frame — the desktop app and Android put one into
	 *      every game frame natively, and offline copies and app-made shells carry one,
	 *   3. on the public site, a hosted relay that puts the game back on this origin.
	 * A game playing from its own host is never reloaded through a proxy just for this.
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
			toast.error('Console needs an offline copy with the in-game bridge for this game.');
			return false;
		}

		if (isPublicSiteDeployment() && (await publicSiteRelayReachable())) {
			await refreshPlayerUrl();
			if (canUseTouchBridge(gamePlayerUrl)) {
				gameSurfaceStarted = true;
				appendPlayLog(
					'info',
					'ui',
					'Touch console using same-origin relay on the public site',
					`game=${gameId} url=${gamePlayerUrl}`
				);
				return true;
			}
		}
		appendPlayLog(
			'info',
			'ui',
			'Touch console unavailable — third-party embed and no bridge in its frame',
			`game=${gameId} url=${gamePlayerUrl}`
		);
		toast.error('Console cannot reach this game.', {
			description:
				'It runs on a third-party site. Touch the game directly, or download it for offline play.'
		});
		return false;
	}

	function toggleTouchConsole() {
		if (touchConsoleVisible) {
			setTouchConsoleVisible(false, 'toggle');
			toast.message('Console disabled');
			return;
		}
		/*
		 * Flip ON synchronously — no await before the state write. Persist so any
		 * later loadGamePage / remount restores ON instead of snapping to Off.
		 * Starting the surface from this click preserves a user gesture for WebKit audio.
		 */
		gameSurfaceStarted = true;
		setTouchConsoleVisible(true, 'toggle');
		toast.message('Console enabled');
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
				/* ensureTouchCapablePlayUrl already said why. */
				appendPlayLog('warn', 'ui', 'Touch console on but cannot reach the game', `game=${gameId}`);
				return;
			}
			appendPlayLog('info', 'ui', 'Touch console ready', `game=${gameId} url=${gamePlayerUrl}`);
		});
	}

	/** When the current frame started loading, for the watchdog's proof-of-life check. */
	let launchStartedAt = 0;
	/** The play URL a relaunch is already moving away from — one failure, one step. */
	let escalatingFrom = '';

	/** Waiting for the current game frame to load or give up — see `afterGameFrameSettles`. */
	let frameSettleWaiters: (() => void)[] = [];

	function settleGameFrame() {
		const waiters = frameSettleWaiters;
		frameSettleWaiters = [];
		for (const resolve of waiters) resolve();
	}

	/**
	 * Resolves once the game frame has loaded or stalled (at most `capMs`), then at the next
	 * idle moment. The recommendations need all 28 catalog shards, and fetched during a launch
	 * they compete with the game's own download on a slow link — for cards below the fold.
	 */
	function afterGameFrameSettles(capMs = 8000): Promise<void> {
		return new Promise((resolve) => {
			const idle = () => {
				/* WebKitGTK has no requestIdleCallback. */
				if (typeof window.requestIdleCallback === 'function') {
					window.requestIdleCallback(() => resolve(), { timeout: 3000 });
				} else {
					setTimeout(resolve, 500);
				}
			};
			const cap = setTimeout(() => {
				frameSettleWaiters = frameSettleWaiters.filter((w) => w !== done);
				idle();
			}, capMs);
			const done = () => {
				clearTimeout(cap);
				idle();
			};
			frameSettleWaiters.push(done);
		});
	}

	function isAppOriginUrl(url: string): boolean {
		try {
			return new URL(url, window.location.href).origin === window.location.origin;
		} catch {
			return false;
		}
	}

	/**
	 * Launch watchdog. It walks the game's route chain on its own — direct → app-made
	 * shell → the desktop app's in-process relay → a puller only if one is already running
	 * (`resolveOnlinePlayRoute`) — whenever a frame never fires `load`, or loads without
	 * ever running a script (a host refusing to be framed, an error page, a Flash file).
	 * The user hears about it only when every route has failed.
	 */
	function handleFrameLoadState(state: 'loading' | 'loaded' | 'stalled', url: string) {
		if (!gameId) return;
		if (state === 'loading') {
			launchStartedAt = Date.now();
			escalatingFrom = '';
			return;
		}
		settleGameFrame();
		if (state === 'loaded') {
			appendPlayLog('info', 'play-url', 'Game frame loaded', `game=${gameId} url=${url}`);
			void confirmFrameRan(gameId, url, launchStartedAt || Date.now());
			return;
		}
		if (frameIsRunning(gameId, launchStartedAt || Date.now())) {
			/*
			 * `load` waits for every subresource; one slow ad or analytics request holds it
			 * back while the game itself is already playing. Relaunching that would restart
			 * a running game on a worse route.
			 */
			appendPlayLog(
				'info',
				'play-url',
				'Game frame still loading, but the game is running — leaving it',
				`game=${gameId} url=${url}`
			);
			return;
		}
		appendPlayLog(
			'warn',
			'play-url',
			'Game frame did not load in time',
			`game=${gameId} url=${url}`
		);
		void tryNextPlayRoute('stalled');
	}

	/** The frame's document is up: it said hello, or (same-origin) it has parsed a body. */
	function frameIsRunning(id: string, since: number): boolean {
		if (gameFrameSpokeSince(id, since)) return true;
		try {
			const doc = iframeElement?.contentDocument;
			return Boolean(doc && doc.readyState !== 'loading' && doc.body?.childElementCount);
		} catch {
			return false;
		}
	}

	/**
	 * A frame whose document should have run the bridge — a game's own page on desktop,
	 * where it is injected natively, or a relay page — and stayed silent never ran at all.
	 * `load` fires for a refused frame just the same, so this is the only way to see it.
	 */
	async function confirmFrameRan(id: string, url: string, since: number) {
		const kind = playRouteOfUrl(url);
		const expectsWord =
			kind === 'relay' || (kind === 'direct' && nativeGameFramesActive() && !isAppOriginUrl(url));
		if (!expectsWord) return;
		await new Promise((resolve) => setTimeout(resolve, 1500));
		if (id !== gameId || url !== gamePlayerUrl) return;
		if (gameFrameSpokeSince(id, since)) return;
		appendPlayLog(
			'warn',
			'play-url',
			'Game frame loaded but never ran a script (blocked, error page, or not a page)',
			`game=${id} url=${url}`
		);
		await tryNextPlayRoute('blank');
	}

	/** Relaunch the game on the next route of its chain. */
	async function tryNextPlayRoute(reason: 'stalled' | 'blank') {
		const id = gameId;
		if (!id) return;
		const failedUrl = gamePlayerUrl;
		if (!failedUrl || escalatingFrom === failedUrl) return;
		escalatingFrom = failedUrl;
		const kind = playRouteOfUrl(failedUrl);
		if (!kind || getGamePlayMode(id) === 'offline') {
			/* An offline copy, or a URL no route produced: nothing to fall back to. */
			appendPlayLog('warn', 'play-url', `Game frame failed (${reason})`, `game=${id}`);
			toast.error('This game is not loading.', {
				description: 'Try Relaunch, or switch Play from → Online.'
			});
			return;
		}
		markPlayRouteFailed(id, kind);
		appendPlayLog(
			'info',
			'play-url',
			`Play route ${kind} failed (${reason}) — trying the next one`,
			`game=${id} url=${failedUrl}`
		);
		const nextUrl = await getGamePlayerUrl(id, gameMetadata);
		if (id !== gameId || gamePlayerUrl !== failedUrl) return;
		if (playRoutesExhausted(id) || nextUrl === failedUrl) {
			/* Leave the frame as it is — a slow game may still come up. */
			notifyNoPlayRouteLeft(reason);
			return;
		}
		/*
		 * Swap the URL only — bumping playerRemountKey would reset bind:started and drop
		 * the user back to the Play poster.
		 */
		gamePlayerUrl = nextUrl;
		gameSurfaceStarted = true;
	}

	/** Every route failed: say so once, and offer the game's own page in the browser. */
	function notifyNoPlayRouteLeft(reason: string) {
		appendPlayLog(
			'warn',
			'play-url',
			'No play route left for this game',
			`game=${gameId} reason=${reason}`
		);
		const page = unframeableEmbedUrl;
		const browser = page.startsWith('https://')
			? { label: 'Open in browser', onClick: () => void openGameInBrowser() }
			: undefined;
		if (reason === 'stalled') {
			toast.error('This game is slow to start.', {
				description: browser
					? 'It may still load here. If not, it may play in your browser.'
					: 'It may still load. If not, try Relaunch.',
				action: browser
			});
			return;
		}
		toast.error("This game can't run inside the app.", {
			description: browser
				? 'Its host blocks being played in other apps. It may still play in your browser.'
				: 'Try Relaunch, or switch Play from → Offline if you have it downloaded.',
			action: browser
		});
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
		/* A manual relaunch is a fresh attempt: every route of the chain is tried again. */
		clearDirectLaunchFailed(gameId);
		gameSurfaceStarted = false;
		iframeElement = undefined;
		await refreshPlayerUrl();
		playerRemountKey += 1;
		/*
		 * Set after the remount so the fresh LazyGameFrame mounts already started, inside
		 * the click that asked for the restart (a gesture WebKitGTK audio can use).
		 */
		gameSurfaceStarted = true;
		toast.message('Game restarted');
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
			/* The surface is about to unmount; leave fullscreen with it, not after it. */
			if (isGameFullscreen) void leaveFullscreen();
			autoFullscreenFor = '';
			inGameMenuOpen = false;
			playOptionsOpen = false;
			pointerLockHintShown = false;
			stuckCursorHintShown = false;
			loading = true;
			error = '';
			gameSurfaceStarted = false;
			gamePaused = false;
			touchConsoleVisible = false;
			gamePlayerUrl = '';
			playUrlReady = false;
			crashedGameId = '';
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
		 * Read the game's saves alongside the play URL, so the frame's storage bridge can
		 * boot from them synchronously. The frame starts the moment loading ends; the read
		 * normally finishes long before the URL does, and the cap below only stops a hung
		 * backend from holding the game back. Late saves still arrive (the bridge pulls them
		 * and reloads the frame once), so a bounded wait is all this is worth.
		 */
		const profileReady = preloadGameBrowserProfile(id);

		/*
		 * Show the page and the game's cover now: resolving the play URL can take a while
		 * (probing a relay, an offline copy), and a spinner over the cover in the player —
		 * already fullscreen — reads as the game starting, where a blank "Loading game…"
		 * page read as nothing happening. The frame itself waits for `playUrlReady`.
		 */
		loading = false;

		/*
		 * Resolve the playable URL before loading the full recommendation catalog.
		 * The catalog is useful below the fold, but must not delay the first game frame.
		 */
		gamePlayerUrl = await getGamePlayerUrl(id, meta);
		await Promise.race([profileReady, new Promise((done) => setTimeout(done, 600))]);
		/*
		 * Back from a crash of this very game (the app reloaded the page): hold the frame
		 * behind a notice rather than start it — and crash — again.
		 */
		const crash = await takeWebviewCrashOfGame(id);
		if (id !== gameId) return;
		if (crash) {
			crashedGameId = id;
			appendPlayLog(
				'warn',
				'play-url',
				'This game crashed the player; the app reloaded without starting it again',
				`game=${id} reason=${crash.reason}`
			);
		}
		playUrlReady = true;
		void refreshOfflineCoverStatus(id);
		loadedGameId = id;

		/* Console preference survives remounts / double-loads / accidental hard refresh. */
		restoreTouchConsolePref(id);

		if (soft) return;

		void (async () => {
			await afterGameFrameSettles();
			if (gameId !== id) return;
			/* Same rules as Home: no tests or broken games, and suggestions from the strong tiers. */
			const allGames = suggestionPool(
				applyQualityFilter(await loadAllGames(), readQualityFilterPrefs())
			);
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

	afterNavigate(({ from, to }) => {
		if (!browser || !to) return;
		const id = to.params?.gameId ?? '';
		if (!id) return;
		/* Came here from a list inside the app: "Back to games" can simply go back to it. */
		cameFromList = Boolean(from?.route?.id && from.route.id !== '/games/[gameId]');
		void loadGamePage(id);
	});

	onMount(() => {
		/* Ask early whether this page load is the app coming back from a crash. */
		void webviewCrashOnLoad();
		networkOnline = isNetworkOnline();
		refreshPlayerSettings();
		privacyLocked = document.documentElement.hasAttribute('data-privacy-locked');
		playLimitHold = isGlobalDailyLimitExceeded();
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
			privacyLocked = d?.locked ?? false;
			applyPrivacyPauseToIframe(d?.locked ?? false);
		};
		const onSettingsApplied = () => {
			refreshPauseShortcutLabel();
			applyPrivacyPauseToIframe(document.documentElement.hasAttribute('data-privacy-locked'));
		};
		const onPlayLimitsChanged = () => {
			playLimitHold = isGlobalDailyLimitExceeded();
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
		/*
		 * Opt-in only (Settings → Playing): a bare `F` belongs to the game, and the in-game
		 * menu is the way in and out of fullscreen. Never fires while typing in a field.
		 */
		const onFullscreenHotkey = (e: KeyboardEvent) => {
			const shortcut = getActiveGameFullscreenShortcut();
			if (!shortcut) return;
			const t = e.target as HTMLElement | null;
			if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
			if (!gameFullscreenShortcutMatches(e, shortcut)) return;
			e.preventDefault();
			e.stopPropagation();
			void toggleFullscreen();
		};
		/*
		 * Esc is deliberately not bound here: many games open their pause menu with it.
		 * Browsers still leave their own fullscreen on Esc; the game keeps filling the
		 * window, and the in-game menu's Exit fullscreen returns to the page.
		 */
		const onFullscreenChange = () => {
			noteDocumentFullscreenChange();
			syncGameFullscreenState();
		};
		const onFirstTouch = (e: PointerEvent) => {
			if (e.pointerType === 'touch') touchSeen = true;
		};
		const coarseQuery = window.matchMedia?.('(pointer: coarse)');
		const onCoarseChange = () => (coarsePointer = Boolean(coarseQuery?.matches));
		onCoarseChange();
		const onPointerLockMessage = (e: MessageEvent) => {
			if (e.source === window) return;
			const state = parsePointerLockMessage(e.data);
			if (state) onPointerLockState(state);
		};
		/* The page's own document: nothing locks it today, but a same-origin game could. */
		const detachPagePointerGuard = watchDocumentPointerLock(document, onPointerLockState);

		window.addEventListener('potato-tomato-privacy-locked', onPrivacyLocked);
		window.addEventListener('potato-tomato-privacy-settings-applied', onSettingsApplied);
		window.addEventListener('potato-tomato-play-limits-changed', onPlayLimitsChanged);
		window.addEventListener(GAME_PLAYER_SETTINGS_CHANGED, refreshPlayerSettings);
		window.addEventListener(GAME_PLAY_MODE_CHANGED, onGamePlayModeChanged);
		window.addEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);
		window.addEventListener('keydown', onPauseHotkey, true);
		window.addEventListener('keydown', onFullscreenHotkey, true);
		window.addEventListener('pointerdown', onFirstTouch, true);
		window.addEventListener('message', onPointerLockMessage);
		coarseQuery?.addEventListener?.('change', onCoarseChange);
		document.addEventListener('fullscreenchange', onFullscreenChange);
		document.addEventListener('webkitfullscreenchange', onFullscreenChange);

		return () => {
			detachNetwork();
			detachPagePointerGuard();
			window.removeEventListener('potato-tomato-privacy-locked', onPrivacyLocked);
			window.removeEventListener('potato-tomato-privacy-settings-applied', onSettingsApplied);
			window.removeEventListener('potato-tomato-play-limits-changed', onPlayLimitsChanged);
			window.removeEventListener(GAME_PLAYER_SETTINGS_CHANGED, refreshPlayerSettings);
			window.removeEventListener(GAME_PLAY_MODE_CHANGED, onGamePlayModeChanged);
			window.removeEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);
			window.removeEventListener('keydown', onPauseHotkey, true);
			window.removeEventListener('keydown', onFullscreenHotkey, true);
			window.removeEventListener('pointerdown', onFirstTouch, true);
			window.removeEventListener('message', onPointerLockMessage);
			coarseQuery?.removeEventListener?.('change', onCoarseChange);
			document.removeEventListener('fullscreenchange', onFullscreenChange);
			document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
			/* Leaving the page leaves fullscreen: restore the window and the browser chrome. */
			void exitGameFullscreen(gameSurfaceEl);
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
		if (!immersive && inGameMenuOpen) inGameMenuOpen = false;
	}

	/** Must run inside the click that asked for it: browsers need the gesture. */
	async function enterFullscreen() {
		if (!gameSurfaceEl) return;
		const done = enterGameFullscreen(gameSurfaceEl);
		/* The surface fills the window synchronously; the browser chrome follows. */
		syncGameFullscreenState();
		await done;
		syncGameFullscreenState();
	}

	/** Back to the windowed page — the player stays on the game. */
	async function leaveFullscreen() {
		const done = exitGameFullscreen(gameSurfaceEl);
		syncGameFullscreenState();
		await done;
		syncGameFullscreenState();
	}

	async function toggleFullscreen() {
		if (isGameFullscreen) await leaveFullscreen();
		else await enterFullscreen();
	}

	/*
	 * Open fullscreen as soon as the player appears ("Open games in fullscreen", on by
	 * default) — with the cover and spinner while the game starts, so the click that
	 * opened the game is still fresh enough for the browser to allow real fullscreen.
	 * Once per visit: a player who leaves fullscreen stays out of it for this game,
	 * restarts included. Without a fresh gesture the game fills the window and the
	 * browser chrome goes on the next press on the in-game menu.
	 */
	$effect(() => {
		if (loading || error || !gameSurfaceEl || !gameId || cannotFrameInApp || crashNotice) return;
		/* Not over the lock screen or the daily-limit gate; it happens once they clear. */
		if (privacyLocked || playLimitHold) return;
		if (!playerSettings.autoFullscreen || autoFullscreenFor === gameId) return;
		autoFullscreenFor = gameId;
		untrack(() => {
			if (!isGameFullscreen) void enterFullscreen();
		});
	});

	/** Any press on the in-game menu: spend the gesture on audio and real fullscreen. */
	function onInGameMenuGesture() {
		upgradeGameFullscreenOnGesture(gameSurfaceEl);
		void import('$lib/utils/game-audio').then(({ unlockGameIframeAudio }) =>
			unlockGameIframeAudio(iframeElement)
		);
	}

	/** Give the keyboard back to the game after its chrome was used. */
	function focusGameFrame() {
		const frame = iframeElement;
		if (!frame) return;
		try {
			frame.focus();
			frame.contentWindow?.focus();
		} catch {
			/* cross-origin focus can throw on older engines */
		}
	}

	async function backToGames() {
		await leaveFullscreen();
		if (cameFromList && history.length > 1) {
			history.back();
			return;
		}
		await goto(resolve('/games'));
	}

	function onPointerLockState(state: PointerLockState) {
		if (state === 'released') {
			toast.message('Cursor unlocked', { duration: 2000 });
			return;
		}
		if (state === 'locked' && !pointerLockHintShown) {
			pointerLockHintShown = true;
			toast.message('Site locked the cursor — double-click twice to unlock', {
				duration: 5000
			});
		} else if (state === 'stuck' && !stuckCursorHintShown && !pointerLockHintShown) {
			stuckCursorHintShown = true;
			toast.message('Cursor hidden by the game — double-click twice to show it', {
				duration: 5000
			});
		}
	}

	/*
	 * Same-origin frames served without the bridge (so without its pointer lock guard) get
	 * the parent's copy. Checked on every load: the bridge sets its flag at the top of the
	 * document, long before `load`. Cross-origin frames throw here and rely on the bridge.
	 */
	$effect(() => {
		const frame = iframeElement;
		if (!frame) return;
		let detach = () => {};
		const attach = () => {
			detach();
			detach = () => {};
			try {
				const win = frame.contentWindow as (Window & Record<string, unknown>) | null;
				const doc = frame.contentDocument;
				if (!win || !doc || win[POINTER_LOCK_GUARD_FLAG]) return;
				detach = watchDocumentPointerLock(doc, onPointerLockState);
			} catch {
				/* cross-origin */
			}
		};
		frame.addEventListener('load', attach);
		return () => {
			frame.removeEventListener('load', attach);
			detach();
		};
	});

	/* What the game reads, as the console's detection reports it — for the Controls button. */
	$effect(() => {
		const id = gameId;
		if (!id || !browser) return;
		keyProfile = readCachedKeyProfile(id);
		const onProfile = (e: Event) => {
			const profile = (e as CustomEvent<KeyProfile>).detail;
			if (profile?.gameId === id) keyProfile = profile;
		};
		window.addEventListener(KEY_PROFILE_CHANGED, onProfile);
		return () => window.removeEventListener(KEY_PROFILE_CHANGED, onProfile);
	});

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
				<GameToolbar
					started={gameSurfaceStarted}
					paused={gamePaused}
					{pauseShortcutLabel}
					fullscreen={isGameFullscreen}
					{fullscreenShortcutLabel}
					consoleAvailable={showConsoleButton}
					consoleOn={touchConsoleVisible}
					controlsAvailable={controlsDetected}
					controlsOpen={controlsMenuOpen}
					bind:playOptionsOpen
					onTogglePause={toggleGamePause}
					onRestart={() => void relaunchGameCompletely()}
					onToggleFullscreen={() => void toggleFullscreen()}
					onToggleConsole={toggleTouchConsole}
					onToggleControls={() => (controlsMenuOpen = !controlsMenuOpen)}
					onOpenLogs={() => void openPlayLogs()}
				/>
			</div>
			<!-- Folded under More → kept mounted, so a download in progress keeps its state. -->
			<div class={playOptionsOpen ? '' : 'hidden'} data-testid="play-options">
				<PlayVersionSelector {gameId} metadata={gameMetadata} onPlayUrlChange={refreshPlayerUrl} />
				<OfflineControls {gameId} metadata={gameMetadata} onPlayUrlChange={refreshPlayerUrl} />
			</div>
		</div>

		{#if isPublicSiteDeployment()}
			<div
				class="mb-5 flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between"
			>
				<div class="min-w-0">
					<p class="font-medium">Playing in the browser</p>
					<p class="text-sm text-muted-foreground">
						Offline downloads are saved in this browser and work for games hosted here. Titles that
						run on a third-party site, and full disk mirrors, still need the Linux app.
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
				{#if cannotFrameInApp}
					<div
						class="flex h-full min-h-56 flex-col items-center justify-center gap-3 px-6 py-10 text-center"
						role="status"
					>
						<p class="text-base font-semibold">This game can't play inside the app</p>
						<p class="max-w-md text-sm text-muted-foreground">
							{unframeableHost} refuses to be embedded, and this build has no local relay to work around
							it. Open it in your browser instead — the touch console won't be available there.
						</p>
						<Button size="sm" onclick={() => void openGameInBrowser()}>Open in browser</Button>
					</div>
				{:else if crashNotice}
					<div
						class="flex h-full min-h-56 flex-col items-center justify-center gap-3 px-6 py-10 text-center"
						role="alert"
						data-testid="game-crashed-notice"
					>
						<p class="text-base font-semibold">This game crashed the player</p>
						<p class="max-w-md text-sm text-muted-foreground">
							The app reloaded instead of starting it again.{unframeableEmbedUrl.startsWith(
								'https://'
							)
								? ' It may run in your browser.'
								: ''}
						</p>
						<div class="flex flex-wrap justify-center gap-2">
							{#if unframeableEmbedUrl.startsWith('https://')}
								<Button size="sm" onclick={() => void openGameInBrowser()}>Open in browser</Button>
							{/if}
							<Button size="sm" variant="outline" onclick={playAfterCrash}>Play here anyway</Button>
						</div>
					</div>
				{:else}
					{#key playerRemountKey}
						<LazyGameFrame
							{gameId}
							gameUrl={playUrlReady
								? fixMalformedGamePlayerUrl(
										gamePlayerUrl || `${base}/games/${gameId}/online/index.html`,
										gameId
									)
								: ''}
							iframeAllow={iframeAllowForUrl(gamePlayerUrl)}
							posterUrl={posterUrlFor(gameMetadata)}
							title={gameMetadata.name}
							fillContainer={isGameFullscreen || playerLayout.isCompact}
							startDisabled={!gameSurfaceStarted &&
								(playerUrlRefreshPending || privacyLocked || playLimitHold)}
							bind:started={gameSurfaceStarted}
							onIframeReady={(el) => {
								const next = el ?? undefined;
								if (iframeElement !== next) iframeElement = next;
							}}
							onLoadStateChange={handleFrameLoadState}
						/>
					{/key}
				{/if}
			</div>
			<!-- Overlay only — Console on/off lives in the toolbar and the in-game menu. -->
			<TouchConsole
				iframe={iframeElement ?? null}
				{gameId}
				playerUrl={gamePlayerUrl}
				isPortrait={playerLayout.isPortrait}
				paused={gamePaused}
				started={gameSurfaceStarted}
				visible={touchConsoleVisible}
				bind:chromeAvailable={touchConsoleAvailable}
				bind:menuOpen={controlsMenuOpen}
				controlsHint={gameMetadata.description}
				topInset={inGameMenuTopInset}
				onRequestShow={() => {
					gameSurfaceStarted = true;
					setTouchConsoleVisible(true, 'auto-show');
				}}
			/>
			{#if isGameFullscreen}
				<InGameMenu
					bind:open={inGameMenuOpen}
					corner={playerSettings.menuCorner}
					access={playerSettings.menuAccess}
					buttonSize={playerSettings.menuButtonSize}
					touch={touchDevice}
					paused={gamePaused}
					consoleAvailable={showConsoleButton}
					consoleOn={touchConsoleVisible}
					controlsAvailable={controlsDetected && gameSurfaceStarted}
					onGesture={onInGameMenuGesture}
					onTogglePause={toggleGamePause}
					onRestart={() => void relaunchGameCompletely()}
					onToggleConsole={toggleTouchConsole}
					onOpenControls={() => (controlsMenuOpen = true)}
					onExitFullscreen={() => void leaveFullscreen()}
					onBack={() => void backToGames()}
					onClosed={focusGameFrame}
				/>
			{/if}
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
