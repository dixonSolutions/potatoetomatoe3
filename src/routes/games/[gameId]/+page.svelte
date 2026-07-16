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
		X,
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
	import { isPublicSiteDeployment } from '$lib/utils/offline-deployment';
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
	import { canUseTouchBridge } from '$lib/utils/touch-input-dispatch';
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
	let isGameFullscreen = $state(false);
	let showUbuntuBanner = $state(false);
	let bannerDismissed = $state(false);
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

	function detectUbuntu(): boolean {
		if (typeof navigator === 'undefined') return false;
		const userAgent = navigator.userAgent.toLowerCase();
		return userAgent.includes('ubuntu');
	}

	function dismissBanner() {
		bannerDismissed = true;
		// Store dismissal in localStorage
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('ubuntuBannerDismissed', 'true');
		}
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
	 * Online + console must use the puller proxy (inject/bridge in the game document).
	 * Offline uses mirrored HTML with inject already applied — no proxy switch.
	 */
	async function ensureTouchCapablePlayUrl(): Promise<boolean> {
		if (canUseTouchBridge(gamePlayerUrl)) return true;

		const mode = gameId ? getGamePlayMode(gameId) : 'online';
		if (mode === 'offline') {
			const prev = gamePlayerUrl;
			await refreshPlayerUrl();
			if (canUseTouchBridge(gamePlayerUrl)) {
				if (gamePlayerUrl !== prev) playerRemountKey += 1;
				return true;
			}
			toast.error('Console needs an offline mirror with inject support for this game.');
			return false;
		}

		const {
			isPullerAvailable,
			syncPullerBaseUrlFromTauri,
			waitForPuller,
			pullerLiveGameUrl,
			pullerUnityPlayUrl
		} = await import('$lib/utils/offline-downloader-puller');
		await syncPullerBaseUrlFromTauri();
		const pullerUp = (await isPullerAvailable(true)) || (await waitForPuller(12_000));
		if (!pullerUp) {
			toast.error('Console needs the local puller for online play.', {
				description: 'Restart the app or run pnpm puller:start, then try again.'
			});
			return false;
		}

		const prev = gamePlayerUrl;
		await refreshPlayerUrl();
		if (!canUseTouchBridge(gamePlayerUrl)) {
			const proxyUrl =
				gameMetadata?.engine === 'unity'
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
			playerRemountKey += 1;
			toast.message('Reloading through puller proxy for the console…');
		}
		return true;
	}

	async function toggleTouchConsole() {
		if (!touchConsoleAvailable) return;
		if (!gameSurfaceStarted) {
			toast.message('Start the game first');
			return;
		}
		if (touchConsoleVisible) {
			touchConsoleVisible = false;
			appendPlayLog('info', 'ui', 'Touch console off', `game=${gameId}`);
			return;
		}
		const ok = await ensureTouchCapablePlayUrl();
		if (!ok) return;
		touchConsoleVisible = true;
		appendPlayLog('info', 'ui', 'Touch console on', `game=${gameId} url=${gamePlayerUrl}`);
	}

	async function refreshPlayerUrl() {
		const id = gameId;
		if (!id) return;
		gamePlayerUrl = await getGamePlayerUrl(id, gameMetadata);
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
		touchConsoleVisible = false;
		gameSurfaceStarted = false;
		iframeElement = undefined;
		await refreshPlayerUrl();
		playerRemountKey += 1;
		toast.message('Game relaunched — press Play to start again');
	}

	async function loadGamePage(id: string) {
		if (!id) {
			error = 'Game not found';
			loading = false;
			return;
		}
		loading = true;
		error = '';
		gameSurfaceStarted = false;
		gamePaused = false;
		touchConsoleVisible = false;
		gamePlayerUrl = '';
		recommendedGames = [];

		gameMetadata = await loadGameMetadata(id);
		if (!gameMetadata) {
			error = 'Game not found';
		}

		networkOnline = isNetworkOnline();
		if (!networkOnline && gameMetadata && !(await canPlayGameOffline(id, gameMetadata))) {
			error =
				'This game is not available offline. Connect to the internet or download it for offline play first.';
		}

		userPreference = getGamePreference(id);

		if (!gameMetadata || error) {
			loading = false;
			return;
		}

		if (networkOnline) {
			recordGamePlay(id, gameMetadata.category, gameMetadata.author);
		}

		/*
		 * Resolve the playable URL before loading the full recommendation catalog.
		 * The catalog is useful below the fold, but must not delay the first game frame.
		 */
		gamePlayerUrl = await getGamePlayerUrl(id);
		void refreshOfflineCoverStatus(id);
		loading = false;

		void (async () => {
			const allGames = await loadAllGames();
			const prefs = getPreferences();
			let rec = getRecommendationsForGamePage(allGames, gameMetadata, id, prefs, 4);
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
			if (gameId) void loadGamePage(gameId);
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

		const isUbuntu = detectUbuntu();
		const dismissed = localStorage.getItem('ubuntuBannerDismissed') === 'true';
		showUbuntuBanner = !isUbuntu && !dismissed;

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
			gamePaused = false;
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

<div class="container mx-auto px-3 py-4 sm:px-4 sm:py-8">
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
					{#if touchConsoleAvailable}
						<Button
							type="button"
							onclick={() => void toggleTouchConsole()}
							variant={touchConsoleVisible ? 'default' : 'outline'}
							size="sm"
							class={touchConsoleVisible
								? 'w-full border-emerald-400 bg-emerald-600 text-white ring-2 ring-emerald-400/70 hover:bg-emerald-500 sm:w-auto'
								: 'w-full border-dashed sm:w-auto'}
							disabled={!gameSurfaceStarted}
							aria-pressed={touchConsoleVisible}
							title={touchConsoleVisible
								? 'Touch console is ON — click to hide'
								: 'Touch console is OFF — click to show'}
						>
							<Gamepad2 class="mr-2 h-4 w-4" />
							{touchConsoleVisible ? 'Console · ON' : 'Console · Off'}
						</Button>
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
				<OfflineControls
					{gameId}
					metadata={gameMetadata}
					playStarted={gameSurfaceStarted}
					onPlayUrlChange={refreshPlayerUrl}
				/>
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
					{#if touchConsoleAvailable}
						<Button
							type="button"
							variant={touchConsoleVisible ? 'default' : 'secondary'}
							size="sm"
							class={touchConsoleVisible
								? 'border-emerald-400 bg-emerald-600 text-white shadow-md ring-2 ring-emerald-400/80 hover:bg-emerald-500'
								: 'shadow-md backdrop-blur-sm'}
							onclick={() => void toggleTouchConsole()}
							disabled={!gameSurfaceStarted}
							aria-pressed={touchConsoleVisible}
							aria-label={touchConsoleVisible
								? 'Console on — hide touch console'
								: 'Console off — show touch console'}
						>
							<Gamepad2 class="mr-2 h-4 w-4" />
							{touchConsoleVisible ? 'Console · ON' : 'Console · Off'}
						</Button>
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
			{#if showUbuntuBanner && !bannerDismissed}
				<div
					class="flex flex-col gap-3 bg-gradient-to-r from-blue-600 to-purple-600 px-4 py-3 text-white sm:flex-row sm:items-center sm:justify-between sm:px-6"
				>
					<div class="flex items-start gap-3 sm:items-center">
						<svg class="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="currentColor">
							<path
								d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
							/>
						</svg>
						<div class="min-w-0 text-sm sm:text-base">
							<span class="font-semibold">Try Linux Ubuntu today!</span>
							<span class="mt-0.5 block sm:mt-0 sm:ml-2 sm:inline"
								>Speed up your gaming performance with Linux</span
							>
						</div>
					</div>
					<div class="flex shrink-0 items-center gap-2 self-end sm:self-auto">
						<a
							href="https://ubuntu.com/download/desktop"
							target="_blank"
							rel="noopener noreferrer"
							class="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-blue-600 transition-colors hover:bg-gray-100 sm:px-4"
						>
							Learn More
						</a>
						<button
							onclick={dismissBanner}
							class="rounded p-1 transition-colors hover:bg-white/20"
							aria-label="Dismiss banner"
						>
							<X class="h-5 w-5" />
						</button>
					</div>
				</div>
			{/if}
			<div class="game-player-surface__frame relative min-h-0 w-full flex-1">
				{#key `${gamePlayerUrl}::${playerRemountKey}`}
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
						bind:started={gameSurfaceStarted}
						onIframeReady={(el) => {
							iframeElement = el ?? undefined;
						}}
					/>
				{/key}
			</div>
			<!-- Overlay only — Console on/off lives in the page toolbar with Pause / Fullscreen. -->
			<TouchConsole
				iframe={iframeElement ?? null}
				{gameId}
				playerUrl={gamePlayerUrl}
				isPortrait={playerLayout.isPortrait}
				paused={gamePaused}
				started={gameSurfaceStarted}
				bind:visible={touchConsoleVisible}
				bind:chromeAvailable={touchConsoleAvailable}
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
