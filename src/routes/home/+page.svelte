<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { base, resolve } from '$app/paths';
	import { loadAllGames, resolveGameThumbnailSrc, type GameMetadata } from '$lib/utils/games';
	import { getPreferences, likeGame, removePreference } from '$lib/utils/preferences';
	import {
		getHomeRecommendations,
		getHomeRecommendationsAsync,
		getRecentlyPlayedGames,
		getLocalDisplayStats,
		getPlaySessions
	} from '$lib/utils/play-recommendations';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Heart, ThumbsUp, Users, ChevronRight, WifiOff } from 'lucide-svelte';
	import { fetchAllOfflineStatuses, OFFLINE_STATUS_CHANGED } from '$lib/utils/offline-downloader';
	import { filterDownloadedGames } from '$lib/utils/game-availability';
	import { isNetworkOnline, subscribeNetworkStatus } from '$lib/utils/network-status';

	let allGames: GameMetadata[] = $state([]);
	let continueGames: GameMetadata[] = $state([]);
	let recommendedGames: GameMetadata[] = $state([]);
	let featuredGames: GameMetadata[] = $state([]);
	/** Games list fetched; recommendations may still be computing. */
	let libraryReady = $state(false);
	let feedReady = $state(false);
	let favouriteIds = $state<string[]>([]);
	let networkOnline = $state(true);
	let offlineStatusMap = $state<Record<string, { offline?: boolean }>>({});

	const continueSkeletonCount = 12;
	const recommendedSkeletonCount = 6;
	const featuredSkeletonCount = 8;

	function thumbUrl(game: GameMetadata) {
		return resolveGameThumbnailSrc(game.thumbnail);
	}

	function placeholderDataUrl() {
		return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="256" height="256"%3E%3Crect fill="%23222" width="256" height="256"/%3E%3Ctext fill="%23666" font-family="sans-serif" font-size="20" x="50%25" y="50%25" text-anchor="middle" dominant-baseline="middle"%3ENo Image%3C/text%3E%3C/svg%3E';
	}

	function statsFor(game: GameMetadata) {
		const sessions = getPlaySessions(game.id);
		return getLocalDisplayStats(game.id, sessions);
	}

	function toggleFavourite(gameId: string, event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();
		if (favouriteIds.includes(gameId)) {
			removePreference(gameId);
			favouriteIds = favouriteIds.filter((id) => id !== gameId);
		} else {
			likeGame(gameId);
			favouriteIds = [...favouriteIds, gameId];
		}
	}

	function applyOfflineLibraryFilter(games: GameMetadata[]): GameMetadata[] {
		if (networkOnline) return games;
		return filterDownloadedGames(games, offlineStatusMap);
	}

	async function loadFeed() {
		if (!browser) return;
		libraryReady = false;
		feedReady = false;
		try {
			networkOnline = isNetworkOnline();
			allGames = await loadAllGames();
			offlineStatusMap = await fetchAllOfflineStatuses(true);
			const prefs = getPreferences();
			favouriteIds = [...prefs.liked];

			continueGames = applyOfflineLibraryFilter(getRecentlyPlayedGames(allGames, prefs, 28));
			libraryReady = true;

			const continueIds = new Set(continueGames.map((g) => g.id));

			let rec = await getHomeRecommendationsAsync(allGames, prefs, 14);
			rec = rec.filter((g) => !continueIds.has(g.id));
			if (rec.length < 10) {
				rec = await getHomeRecommendationsAsync(allGames, prefs, 14);
			}
			if (rec.length === 0) {
				rec = getHomeRecommendations(allGames, prefs, 14);
			}
			recommendedGames = applyOfflineLibraryFilter(rec);

			const used = new Set([...continueGames, ...recommendedGames].map((g) => g.id));
			featuredGames = applyOfflineLibraryFilter(
				allGames
					.filter((g) => !used.has(g.id))
					.sort((a, b) => a.name.localeCompare(b.name))
					.slice(0, 16)
			);

			if (featuredGames.length < 8 && networkOnline) {
				const need = 8 - featuredGames.length;
				const extra = allGames.filter((g) => !featuredGames.some((f) => f.id === g.id)).slice(0, need);
				featuredGames = [...featuredGames, ...extra].slice(0, 16);
			}
			feedReady = true;
		} catch {
			libraryReady = true;
			feedReady = true;
		}
	}

	onMount(() => {
		networkOnline = isNetworkOnline();
		const detachNetwork = subscribeNetworkStatus((online) => {
			networkOnline = online;
			void loadFeed();
		});
		const onOfflineStatusChanged = () => {
			void loadFeed();
		};
		window.addEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);
		return () => {
			detachNetwork();
			window.removeEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);
		};
	});

	$effect(() => {
		if (!browser) return;
		const path = $page.url.pathname;
		if (path !== '/home' && !path.endsWith('/home')) return;
		void loadFeed();
	});
	let downloadedCount = $derived(filterDownloadedGames(allGames, offlineStatusMap).length);
</script>

<div class="min-h-screen bg-background text-foreground">
	<div class="container mx-auto px-3 sm:px-4 py-6 md:py-8 max-w-[1600px]">
		{#if !networkOnline}
			<div
				class="mb-6 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
				role="status"
			>
				<WifiOff class="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
				<div>
					<p class="font-medium text-foreground">You are offline</p>
					<p class="text-muted-foreground">
						Home rows show only your {downloadedCount} downloaded
						{downloadedCount === 1 ? 'game' : 'games'}.
					</p>
				</div>
			</div>
		{/if}

		<header class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8 md:mb-10">
			<div>
				<h1 class="text-2xl md:text-3xl font-bold tracking-tight">For you</h1>
				<p class="text-sm text-muted-foreground mt-1 max-w-xl">
					Personalized rows from your local play history and favourites — TensorFlow.js scoring runs
					on-device (WebGPU when available). Nothing is sent to a server.
				</p>
			</div>
			<div class="flex flex-wrap gap-2 shrink-0">
				<a href={resolve('/play-analytics')} class="text-sm">
					<Button variant="outline" class="gap-2">Playtime &amp; algorithm</Button>
				</a>
				<a href={resolve('/games')} class="text-sm">
					<Button variant="secondary" class="gap-2">
						All games
						<ChevronRight class="h-4 w-4" />
					</Button>
				</a>
			</div>
		</header>

		{#if !libraryReady}
			<div class="space-y-10 md:space-y-12" aria-busy="true" aria-label="Loading feed">
				<section class="mb-10 md:mb-12">
					<div class="h-7 w-40 max-w-[50%] rounded-md bg-muted animate-pulse mb-3"></div>
					<div
						class="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-11 gap-1.5 sm:gap-2"
					>
						{#each [...Array(continueSkeletonCount).keys()] as i (i)}
							<div class="rounded-xl overflow-hidden border border-border/40 bg-card/50">
								<div class="aspect-square bg-muted animate-pulse"></div>
								<div class="px-1 py-2 space-y-1.5">
									<div class="h-3 bg-muted rounded animate-pulse"></div>
									<div class="h-2.5 w-2/3 bg-muted/80 rounded animate-pulse"></div>
								</div>
							</div>
						{/each}
					</div>
				</section>
				<section class="mb-10 md:mb-12">
					<div class="h-7 w-48 max-w-[55%] rounded-md bg-muted animate-pulse mb-3"></div>
					<div
						class="flex gap-3 md:gap-4 overflow-hidden pb-3"
					>
						{#each [...Array(recommendedSkeletonCount).keys()] as i (i)}
							<div class="shrink-0 w-[min(280px,78vw)] sm:w-[260px] md:w-[280px]">
								<div class="rounded-xl overflow-hidden border border-border/40 bg-card/50">
									<div class="aspect-video bg-muted animate-pulse"></div>
									<div class="p-2.5 space-y-2">
										<div class="h-4 bg-muted rounded animate-pulse"></div>
										<div class="h-3 w-4/5 bg-muted/80 rounded animate-pulse"></div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				</section>
				<section>
					<div class="h-7 w-44 max-w-[50%] rounded-md bg-muted animate-pulse mb-3"></div>
					<div class="flex gap-3 overflow-hidden pb-3">
						{#each [...Array(featuredSkeletonCount).keys()] as i (i)}
							<div class="shrink-0 w-[min(200px,42vw)] sm:w-[200px]">
								<div class="rounded-xl overflow-hidden border border-border/40 bg-card/50">
									<div class="aspect-square bg-muted animate-pulse"></div>
									<div class="p-2 space-y-1.5">
										<div class="h-3 bg-muted rounded animate-pulse"></div>
										<div class="h-2.5 w-3/4 bg-muted/80 rounded animate-pulse"></div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				</section>
			</div>
		{:else if allGames.length === 0}
			<p class="text-sm text-muted-foreground py-16 text-center">No games in the library yet.</p>
		{:else}
			<section class="mb-10 md:mb-12" aria-labelledby="home-continue-heading">
				<div class="flex items-end justify-between gap-3 mb-3">
					<h2
						id="home-continue-heading"
						class="text-lg md:text-xl font-semibold inline-flex items-center gap-1.5"
					>
						Continue
						<ChevronRight class="h-5 w-5 text-muted-foreground opacity-80" aria-hidden="true" />
					</h2>
					<a
						href={resolve('/games')}
						class="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
					>
						All
						<ChevronRight class="h-3.5 w-3.5" />
					</a>
				</div>
				<div
					class="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-11 gap-1.5 sm:gap-2"
				>
					{#each continueGames as game (game.id)}
						{@const s = statsFor(game)}
						<a
							href={resolve(`/games/${game.id}`)}
							data-sveltekit-preload-data="hover"
							class="group block rounded-xl overflow-hidden bg-card border border-border/50 hover:border-border transition-colors shadow-sm"
						>
							<div class="aspect-square bg-muted relative overflow-hidden rounded-t-xl">
								<img
									src={thumbUrl(game)}
									alt=""
									loading="lazy"
									decoding="async"
									class="h-full w-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
									onerror={(e) => {
										const el = e.currentTarget as HTMLImageElement;
										el.src = placeholderDataUrl();
									}}
								/>
							</div>
							<div class="px-1 pb-1.5 pt-1 min-h-[3.25rem]">
								<p class="text-[11px] sm:text-xs font-medium leading-tight line-clamp-2">{game.name}</p>
								<p
									class="text-[10px] text-muted-foreground tabular-nums mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0"
								>
									<span class="inline-flex items-center gap-0.5">
										<ThumbsUp class="h-3 w-3 shrink-0 opacity-85" aria-hidden="true" />
										{s.ratingPct}%
									</span>
									<span class="inline-flex items-center gap-0.5">
										<Users class="h-3 w-3 shrink-0 opacity-85" aria-hidden="true" />
										{s.activeLabel}
									</span>
								</p>
							</div>
						</a>
					{/each}
				</div>
			</section>

			<section
				class="mb-10 md:mb-12"
				aria-labelledby="home-recommended-heading"
				aria-busy={!feedReady}
			>
				<div class="flex items-end justify-between gap-3 mb-3">
					<h2
						id="home-recommended-heading"
						class="text-lg md:text-xl font-semibold inline-flex items-center gap-1.5"
					>
						Recommended
						<ChevronRight class="h-5 w-5 text-muted-foreground opacity-80" aria-hidden="true" />
					</h2>
					<a
						href={resolve('/games')}
						class="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 shrink-0"
					>
						See all
						<ChevronRight class="h-3.5 w-3.5" />
					</a>
				</div>
				{#if !feedReady}
					<div class="flex gap-3 md:gap-4 overflow-hidden pb-3" aria-hidden="true">
						{#each [...Array(recommendedSkeletonCount).keys()] as i (i)}
							<div class="shrink-0 w-[min(280px,78vw)] sm:w-[260px] md:w-[280px]">
								<div class="rounded-xl overflow-hidden border border-border/40 bg-card/50">
									<div class="aspect-video bg-muted animate-pulse"></div>
									<div class="p-2.5 space-y-2">
										<div class="h-4 bg-muted rounded animate-pulse"></div>
										<div class="h-3 w-4/5 bg-muted/80 rounded animate-pulse"></div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{:else if recommendedGames.length === 0}
					<p class="text-sm text-muted-foreground py-4">No recommendations yet — play a few games to tune your feed.</p>
				{:else}
					<div
						class="flex gap-3 md:gap-4 overflow-x-auto pb-3 snap-x snap-mandatory scroll-smooth [-webkit-overflow-scrolling:touch] [scrollbar-width:thin]"
					>
						{#each recommendedGames as game (game.id)}
							{@const s = statsFor(game)}
							<div
								class="snap-start shrink-0 w-[min(280px,78vw)] sm:w-[260px] md:w-[280px] group"
							>
								<a href={resolve(`/games/${game.id}`)} data-sveltekit-preload-data="hover" class="block">
									<div
										class="relative rounded-xl overflow-hidden bg-muted border border-border/60 shadow-sm hover:shadow-md transition-shadow"
									>
										<div class="aspect-video bg-muted relative">
											<img
												src={thumbUrl(game)}
												alt=""
												loading="lazy"
												decoding="async"
												class="h-full w-full object-cover"
												onerror={(e) => {
													const el = e.currentTarget as HTMLImageElement;
													el.src = placeholderDataUrl();
												}}
											/>
											<button
												type="button"
												onclick={(e) => toggleFavourite(game.id, e)}
												class="absolute top-2 right-2 p-1.5 rounded-full bg-background/85 backdrop-blur-sm hover:bg-background border border-border/50 z-10"
												aria-label={favouriteIds.includes(game.id) ? 'Remove from favourites' : 'Favourite'}
											>
												<Heart
													class="h-4 w-4 {favouriteIds.includes(game.id)
														? 'fill-red-500 text-red-500'
														: 'text-muted-foreground'}"
												/>
											</button>
										</div>
										<div class="p-2.5 space-y-1">
											<p class="font-medium text-sm leading-snug line-clamp-2">{game.name}</p>
											<div
												class="flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums"
											>
												<span class="inline-flex items-center gap-0.5">
													<ThumbsUp class="h-3 w-3 opacity-80" aria-hidden="true" />
													{s.ratingPct}% rating
												</span>
												<span class="inline-flex items-center gap-0.5">
													<Users class="h-3 w-3 opacity-80" aria-hidden="true" />
													{s.activeLabel}
												</span>
											</div>
										</div>
									</div>
								</a>
							</div>
						{/each}
					</div>
				{/if}
			</section>

			<section aria-labelledby="home-more-heading" aria-busy={!feedReady}>
				<div class="flex items-end justify-between gap-3 mb-3">
					<h2
						id="home-more-heading"
						class="text-lg md:text-xl font-semibold inline-flex items-center gap-1.5"
					>
						More to explore
						<ChevronRight class="h-5 w-5 text-muted-foreground opacity-80" aria-hidden="true" />
					</h2>
					<a
						href={resolve('/games')}
						class="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
					>
						Browse
						<ChevronRight class="h-3.5 w-3.5" />
					</a>
				</div>
				{#if !feedReady}
					<div class="flex gap-3 overflow-hidden pb-3" aria-hidden="true">
						{#each [...Array(featuredSkeletonCount).keys()] as i (i)}
							<div class="shrink-0 w-[min(200px,42vw)] sm:w-[200px]">
								<div class="rounded-xl overflow-hidden border border-border/40 bg-card/50">
									<div class="aspect-square bg-muted animate-pulse"></div>
									<div class="p-2 space-y-1.5">
										<div class="h-3 bg-muted rounded animate-pulse"></div>
										<div class="h-2.5 w-3/4 bg-muted/80 rounded animate-pulse"></div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{:else}
				<div
					class="flex gap-3 overflow-x-auto pb-3 snap-x snap-mandatory scroll-smooth [scrollbar-width:thin]"
				>
					{#each featuredGames as game (game.id)}
						{@const s = statsFor(game)}
						<div class="snap-start shrink-0 w-[min(200px,42vw)] sm:w-[200px] group">
							<a href={resolve(`/games/${game.id}`)} data-sveltekit-preload-data="hover" class="block">
								<div
									class="rounded-xl overflow-hidden border border-border/60 bg-card hover:shadow-md transition-shadow"
								>
									<div class="aspect-square bg-muted relative rounded-t-xl overflow-hidden">
										<img
											src={thumbUrl(game)}
											alt=""
											loading="lazy"
											decoding="async"
											class="h-full w-full object-cover"
											onerror={(e) => {
												const el = e.currentTarget as HTMLImageElement;
												el.src = placeholderDataUrl();
											}}
										/>
										<button
											type="button"
											onclick={(e) => toggleFavourite(game.id, e)}
											class="absolute top-1.5 right-1.5 p-1 rounded-full bg-background/85 backdrop-blur-sm z-10"
											aria-label={favouriteIds.includes(game.id) ? 'Remove from favourites' : 'Favourite'}
										>
											<Heart
												class="h-3.5 w-3.5 {favouriteIds.includes(game.id)
													? 'fill-red-500 text-red-500'
													: 'text-muted-foreground'}"
											/>
										</button>
									</div>
									<div class="p-2 space-y-0.5">
										<p class="text-xs font-medium line-clamp-2 leading-snug">{game.name}</p>
										<div class="text-[10px] text-muted-foreground flex gap-2 tabular-nums">
											<span class="inline-flex items-center gap-0.5">
												<ThumbsUp class="h-3 w-3" />
												{s.ratingPct}%
											</span>
											<span>{s.activeLabel}</span>
										</div>
									</div>
								</div>
							</a>
						</div>
					{/each}
				</div>
				{/if}
			</section>
		{/if}
	</div>
</div>
