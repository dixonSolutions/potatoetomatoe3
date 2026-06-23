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
		type GameMetadata
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
	import { Maximize, ArrowLeft, X, ThumbsUp, ThumbsDown } from 'lucide-svelte';
	import { getPrivacyPauseGameWhileLocked } from '$lib/utils/privacy-mode';
	import LazyGameFrame from '$lib/components/game-player/LazyGameFrame.svelte';
	import OfflineControls from '$lib/components/game-player/OfflineControls.svelte';
	import PlayVersionSelector from '$lib/components/game-player/PlayVersionSelector.svelte';
	import { GAME_PLAY_MODE_CHANGED } from '$lib/utils/game-play-mode';
	import { OFFLINE_STATUS_CHANGED, type OfflineStatusChangedDetail } from '$lib/utils/offline-downloader';
	import { filterDownloadedGames } from '$lib/utils/game-availability';
	import { isNetworkOnline, subscribeNetworkStatus } from '$lib/utils/network-status';
	import { iframeAllowForUrl } from '$lib/utils/games';

	let gameMetadata: GameMetadata | null = $state(null);
	let recommendedGames: GameMetadata[] = $state([]);
	let loading = $state(true);
	let error = $state('');
	let iframeElement = $state<HTMLIFrameElement | undefined>(undefined);
	let showUbuntuBanner = $state(false);
	let bannerDismissed = $state(false);
	let userPreference = $state<'liked' | 'disliked' | null>(null);
	let networkOnline = $state(true);

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

	function posterUrlFor(game: GameMetadata) {
		return resolveGameThumbnailSrc(game.thumbnail);
	}

	async function refreshPlayerUrl() {
		const id = gameId;
		if (!id) return;
		gamePlayerUrl = await getGamePlayerUrl(id);
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
		gamePlayerUrl = '';

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

		const allGames = await loadAllGames();
		const prefs = getPreferences();

		if (gameMetadata) {
			if (networkOnline) {
				recordGamePlay(id, gameMetadata.category, gameMetadata.author);
			}
			let rec = getRecommendationsForGamePage(allGames, gameMetadata, id, prefs, 4);
			if (!networkOnline) {
				const { fetchAllOfflineStatuses } = await import('$lib/utils/offline-downloader');
				const statusMap = await fetchAllOfflineStatuses(true);
				rec = filterDownloadedGames(rec, statusMap);
			}
			recommendedGames = rec;
		}

		if (!error) {
			gamePlayerUrl = await getGamePlayerUrl(id);
		}
		loading = false;
	}

	afterNavigate(({ to }) => {
		if (!browser || !to) return;
		const id = to.params?.gameId ?? '';
		if (!id) return;
		void loadGamePage(id);
	});

	onMount(() => {
		networkOnline = isNetworkOnline();
		const detachNetwork = subscribeNetworkStatus((online) => {
			networkOnline = online;
			if (gameId) void loadGamePage(gameId);
		});

		const onPrivacyLocked = (e: Event) => {
			const d = (e as CustomEvent<{ locked: boolean }>).detail;
			applyPrivacyPauseToIframe(d?.locked ?? false);
		};
		const onSettingsApplied = () => {
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
		};
		window.addEventListener('potato-tomato-privacy-locked', onPrivacyLocked);
		window.addEventListener('potato-tomato-privacy-settings-applied', onSettingsApplied);
		window.addEventListener(GAME_PLAY_MODE_CHANGED, onGamePlayModeChanged);
		window.addEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);

		const isUbuntu = detectUbuntu();
		const dismissed = localStorage.getItem('ubuntuBannerDismissed') === 'true';
		showUbuntuBanner = !isUbuntu && !dismissed;

		return () => {
			detachNetwork();
			window.removeEventListener('potato-tomato-privacy-locked', onPrivacyLocked);
			window.removeEventListener('potato-tomato-privacy-settings-applied', onSettingsApplied);
			window.removeEventListener(GAME_PLAY_MODE_CHANGED, onGamePlayModeChanged);
			window.removeEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);
		};
	});

	function toggleFullscreen() {
		if (!gameSurfaceStarted || !iframeElement) return;

		if (document.fullscreenElement) {
			document.exitFullscreen();
		} else {
			iframeElement.requestFullscreen();
		}
	}

	function applyPrivacyPauseToIframe(locked: boolean) {
		if (!iframeElement) return;
		const pause = getPrivacyPauseGameWhileLocked();
		if (locked && pause) {
			iframeElement.style.visibility = 'hidden';
			iframeElement.setAttribute('aria-hidden', 'true');
		} else {
			iframeElement.style.visibility = '';
			iframeElement.removeAttribute('aria-hidden');
		}
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

<div class="container mx-auto px-4 py-8">
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
		<div class="mb-6">
			<a href={resolve('/home')}>
				<Button variant="ghost" class="mb-4">
					<ArrowLeft class="mr-2 h-4 w-4" />
					Back to home
				</Button>
			</a>
			<div class="flex items-start justify-between">
				<div class="flex-1">
					<h1 class="mb-2 text-3xl font-bold">{gameMetadata.name}</h1>
					<p class="mb-3 text-muted-foreground">By {gameMetadata.author}</p>
					<div class="flex gap-2">
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
				<Button onclick={toggleFullscreen} variant="outline" disabled={!gameSurfaceStarted}>
					<Maximize class="mr-2 h-4 w-4" />
					Fullscreen
				</Button>
			</div>
			<PlayVersionSelector {gameId} metadata={gameMetadata} onPlayUrlChange={refreshPlayerUrl} />
			<OfflineControls {gameId} onPlayUrlChange={refreshPlayerUrl} />
		</div>

		<div class="mb-8 overflow-hidden rounded-lg border bg-card shadow-lg">
			{#if showUbuntuBanner && !bannerDismissed}
				<div
					class="flex items-center justify-between bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-3 text-white"
				>
					<div class="flex items-center gap-3">
						<svg class="h-6 w-6" viewBox="0 0 24 24" fill="currentColor">
							<path
								d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
							/>
						</svg>
						<div>
							<span class="font-semibold">Try Linux Ubuntu today!</span>
							<span class="ml-2">Speed up your gaming performance with Linux</span>
						</div>
					</div>
					<div class="flex items-center gap-2">
						<a
							href="https://ubuntu.com/download/desktop"
							target="_blank"
							rel="noopener noreferrer"
							class="rounded-md bg-white px-4 py-1.5 font-medium text-blue-600 transition-colors hover:bg-gray-100"
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
			{#key gamePlayerUrl}
				<LazyGameFrame
					{gameId}
					gameUrl={fixMalformedGamePlayerUrl(
						gamePlayerUrl || `${base}/games/${gameId}/online/index.html`,
						gameId
					)}
					iframeAllow={iframeAllowForUrl(gamePlayerUrl)}
					posterUrl={posterUrlFor(gameMetadata)}
					title={gameMetadata.name}
					bind:started={gameSurfaceStarted}
					onIframeReady={(el) => {
						iframeElement = el ?? undefined;
					}}
				/>
			{/key}
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
										src={resolveGameThumbnailSrc(game.thumbnail)}
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
									<Card.Description class="text-sm">{game.description}</Card.Description>
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
