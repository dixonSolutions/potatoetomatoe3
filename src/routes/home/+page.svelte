<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { loadCatalogIndex, resolveGameThumbnailSrc, type GameIndexEntry } from '$lib/utils/games';
	import { getPreferences, likeGame, removePreference } from '$lib/utils/preferences';
	import {
		getBrowseShuffleSeed,
		getHomeRecommendations,
		getHomeRecommendationsAsync,
		getRecentlyPlayedGames,
		shuffleDeterministic
	} from '$lib/utils/play-recommendations';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Heart, ChevronRight, WifiOff } from 'lucide-svelte';
	import { fetchDownloadedStatuses, OFFLINE_STATUS_CHANGED } from '$lib/utils/offline-downloader';
	import { filterDownloadedGames } from '$lib/utils/game-availability';
	import { isNetworkOnline, subscribeNetworkStatus } from '$lib/utils/network-status';

	let allGames: GameIndexEntry[] = $state([]);
	let continueGames: GameIndexEntry[] = $state([]);
	let recommendedGames: GameIndexEntry[] = $state([]);
	let featuredGames: GameIndexEntry[] = $state([]);
	/** Games list fetched; recommendations may still be computing. */
	let libraryReady = $state(false);
	let feedReady = $state(false);
	let favouriteIds = $state<string[]>([]);
	let networkOnline = $state(true);
	let offlineStatusMap = $state<Record<string, { offline?: boolean; offlineThumbnail?: string }>>(
		{}
	);
	let loadGeneration = 0;

	const continueSkeletonCount = 12;
	const recommendedSkeletonCount = 6;
	const featuredSkeletonCount = 8;

	function thumbUrl(game: GameIndexEntry) {
		const status = offlineStatusMap[game.id];
		const preferOffline = !networkOnline || Boolean(status?.offline);
		return resolveGameThumbnailSrc(game.thumbnail, {
			gameId: game.id,
			preferOffline,
			offlineThumbnailRel: status?.offlineThumbnail
		});
	}

	function placeholderDataUrl() {
		return 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="256" height="256"%3E%3Crect fill="%23222" width="256" height="256"/%3E%3Ctext fill="%23666" font-family="sans-serif" font-size="20" x="50%25" y="50%25" text-anchor="middle" dominant-baseline="middle"%3ENo Image%3C/text%3E%3C/svg%3E';
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

	function applyOfflineLibraryFilter(games: GameIndexEntry[]): GameIndexEntry[] {
		if (networkOnline) return games;
		return filterDownloadedGames(games, offlineStatusMap);
	}

	async function refreshOfflineStatuses() {
		try {
			offlineStatusMap = await fetchDownloadedStatuses(true);
			if (!networkOnline) {
				continueGames = applyOfflineLibraryFilter(continueGames);
				recommendedGames = applyOfflineLibraryFilter(recommendedGames);
				featuredGames = applyOfflineLibraryFilter(featuredGames);
			}
		} catch {
			/* Keep the last known map — never block the feed on puller blips. */
		}
	}

	async function loadFeed(options?: { soft?: boolean }) {
		if (!browser) return;
		const soft = Boolean(options?.soft) && libraryReady && allGames.length > 0;
		const generation = ++loadGeneration;
		/* Never flash the skeleton again once we have painted real cards (dev $page thrash). */
		if (!soft && !libraryReady) {
			feedReady = false;
		}
		try {
			networkOnline = isNetworkOnline();
			const prefs = getPreferences();
			favouriteIds = [...prefs.liked];

			/* Catalog first — never wait on puller status before painting the home grid. */
			const statusPromise = refreshOfflineStatuses();

			/*
			 * The progress callback fires once per catalog shard — 27 of them. Rebuilding
			 * Continue on every one meant 27 passes of getRecentlyPlayedGames, each of which
			 * indexes and (when history is thin) shuffles and scores the whole 13k-row
			 * catalog on the main thread. On a low-end tablet that is seconds of jank while
			 * the page is nominally "loaded". Paint Continue once off the first shard, then
			 * once more from the complete index below; shards in between only fill the grid.
			 */
			let continuePainted = false;
			allGames = await loadCatalogIndex((partial) => {
				if (generation !== loadGeneration) return;
				if (partial.length === 0) return;
				allGames = partial;
				if (!continuePainted) {
					continuePainted = true;
					continueGames = applyOfflineLibraryFilter(getRecentlyPlayedGames(partial, prefs, 28));
					libraryReady = true;
				}
			});
			if (generation !== loadGeneration) return;

			continueGames = applyOfflineLibraryFilter(getRecentlyPlayedGames(allGames, prefs, 28));
			libraryReady = true;

			const continueIds = new Set(continueGames.map((g) => g.id));

			/* Recommendations are nice-to-have — paint Continue first, then fill the rest. */
			void (async () => {
				try {
					let rec = await getHomeRecommendationsAsync(allGames, prefs, 14);
					if (generation !== loadGeneration) return;
					rec = rec.filter((g) => !continueIds.has(g.id));
					if (rec.length < 10) {
						rec = await getHomeRecommendationsAsync(allGames, prefs, 14);
						if (generation !== loadGeneration) return;
					}
					if (rec.length === 0) {
						rec = getHomeRecommendations(allGames, prefs, 14);
					}
					recommendedGames = applyOfflineLibraryFilter(rec);

					const used = new Set([...continueGames, ...recommendedGames].map((g) => g.id));
					featuredGames = applyOfflineLibraryFilter(
						shuffleDeterministic(
							allGames.filter((g) => !used.has(g.id)),
							getBrowseShuffleSeed() ^ 0xfed1
						).slice(0, 16)
					);

					if (featuredGames.length < 8 && networkOnline) {
						const need = 8 - featuredGames.length;
						const extra = allGames
							.filter((g) => !featuredGames.some((f) => f.id === g.id))
							.slice(0, need);
						featuredGames = [...featuredGames, ...extra].slice(0, 16);
					}
					feedReady = true;
				} catch {
					recommendedGames = applyOfflineLibraryFilter(getHomeRecommendations(allGames, prefs, 14));
					feedReady = true;
				}
			})();

			await statusPromise;
			if (generation !== loadGeneration) return;
			if (!networkOnline) {
				continueGames = applyOfflineLibraryFilter(getRecentlyPlayedGames(allGames, prefs, 28));
			}
		} catch (err) {
			console.error('Home feed failed to load:', err);
			if (generation !== loadGeneration) return;
			libraryReady = true;
			feedReady = true;
		}
	}

	onMount(() => {
		networkOnline = isNetworkOnline();
		/* This page only mounts on /home — do not key off $page (dev invalidations reset the skeleton). */
		void loadFeed();

		const detachNetwork = subscribeNetworkStatus((online) => {
			networkOnline = online;
			void loadFeed({ soft: true });
		});
		let statusTimer: ReturnType<typeof setTimeout> | undefined;
		const onOfflineStatusChanged = () => {
			clearTimeout(statusTimer);
			statusTimer = setTimeout(() => {
				void refreshOfflineStatuses();
			}, 200);
		};
		window.addEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);
		return () => {
			detachNetwork();
			clearTimeout(statusTimer);
			window.removeEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);
		};
	});

	let downloadedCount = $derived(filterDownloadedGames(allGames, offlineStatusMap).length);
</script>

<div class="min-h-screen bg-background text-foreground">
	<div class="mx-auto w-full max-w-[1920px] px-3 py-5 sm:px-5 md:py-6">
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

		<header
			class="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between md:mb-10"
		>
			<h1 class="text-2xl font-bold tracking-tight md:text-3xl">For you</h1>
			<div class="flex shrink-0 flex-wrap gap-2">
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
					<div class="mb-3 h-7 w-40 max-w-[50%] animate-pulse rounded-md bg-muted"></div>
					<div
						class="grid grid-cols-4 gap-1.5 sm:grid-cols-6 sm:gap-2 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-11"
					>
						{#each [...Array(continueSkeletonCount).keys()] as i (i)}
							<div class="overflow-hidden rounded-xl border border-border/40 bg-card/50">
								<div class="aspect-square animate-pulse bg-muted"></div>
								<div class="space-y-1.5 px-1 py-2">
									<div class="h-3 animate-pulse rounded bg-muted"></div>
									<div class="h-2.5 w-2/3 animate-pulse rounded bg-muted/80"></div>
								</div>
							</div>
						{/each}
					</div>
				</section>
				<section class="mb-10 md:mb-12">
					<div class="mb-3 h-7 w-48 max-w-[55%] animate-pulse rounded-md bg-muted"></div>
					<div class="flex gap-3 overflow-hidden pb-3 md:gap-4">
						{#each [...Array(recommendedSkeletonCount).keys()] as i (i)}
							<div class="w-[min(280px,78vw)] shrink-0 sm:w-[260px] md:w-[280px]">
								<div class="overflow-hidden rounded-xl border border-border/40 bg-card/50">
									<div class="aspect-video animate-pulse bg-muted"></div>
									<div class="space-y-2 p-2.5">
										<div class="h-4 animate-pulse rounded bg-muted"></div>
										<div class="h-3 w-4/5 animate-pulse rounded bg-muted/80"></div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				</section>
				<section>
					<div class="mb-3 h-7 w-44 max-w-[50%] animate-pulse rounded-md bg-muted"></div>
					<div class="flex gap-3 overflow-hidden pb-3">
						{#each [...Array(featuredSkeletonCount).keys()] as i (i)}
							<div class="w-[min(200px,42vw)] shrink-0 sm:w-[200px]">
								<div class="overflow-hidden rounded-xl border border-border/40 bg-card/50">
									<div class="aspect-square animate-pulse bg-muted"></div>
									<div class="space-y-1.5 p-2">
										<div class="h-3 animate-pulse rounded bg-muted"></div>
										<div class="h-2.5 w-3/4 animate-pulse rounded bg-muted/80"></div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				</section>
			</div>
		{:else if allGames.length === 0}
			<p class="py-16 text-center text-sm text-muted-foreground">No games in the library yet.</p>
		{:else}
			<section class="mb-10 md:mb-12" aria-labelledby="home-continue-heading">
				<div class="mb-3 flex items-end justify-between gap-3">
					<h2
						id="home-continue-heading"
						class="inline-flex items-center gap-1.5 text-lg font-semibold md:text-xl"
					>
						Continue
						<ChevronRight class="h-5 w-5 text-muted-foreground opacity-80" aria-hidden="true" />
					</h2>
					<a
						href={resolve('/games')}
						class="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
					>
						All
						<ChevronRight class="h-3.5 w-3.5" />
					</a>
				</div>
				<div
					class="grid grid-cols-4 gap-1.5 sm:grid-cols-6 sm:gap-2 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-11"
				>
					{#each continueGames as game (game.id)}
						<a
							href={resolve(`/games/${game.id}`)}
							data-sveltekit-preload-data="hover"
							class="group block overflow-hidden rounded-xl border border-border/50 bg-card shadow-sm transition-colors hover:border-border"
						>
							<div class="relative aspect-square overflow-hidden rounded-t-xl bg-muted">
								<img
									src={thumbUrl(game)}
									alt=""
									loading="lazy"
									decoding="async"
									class="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
									onerror={(e) => {
										const el = e.currentTarget as HTMLImageElement;
										el.src = placeholderDataUrl();
									}}
								/>
							</div>
							<div class="px-1 pt-1 pb-1.5">
								<p class="line-clamp-2 text-[11px] leading-tight font-medium sm:text-xs">
									{game.name}
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
				<div class="mb-3 flex items-end justify-between gap-3">
					<h2
						id="home-recommended-heading"
						class="inline-flex items-center gap-1.5 text-lg font-semibold md:text-xl"
					>
						Recommended
						<ChevronRight class="h-5 w-5 text-muted-foreground opacity-80" aria-hidden="true" />
					</h2>
					<a
						href={resolve('/games')}
						class="inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
					>
						See all
						<ChevronRight class="h-3.5 w-3.5" />
					</a>
				</div>
				{#if !feedReady}
					<div class="flex gap-3 overflow-hidden pb-3 md:gap-4" aria-hidden="true">
						{#each [...Array(recommendedSkeletonCount).keys()] as i (i)}
							<div class="w-[min(280px,78vw)] shrink-0 sm:w-[260px] md:w-[280px]">
								<div class="overflow-hidden rounded-xl border border-border/40 bg-card/50">
									<div class="aspect-video animate-pulse bg-muted"></div>
									<div class="space-y-2 p-2.5">
										<div class="h-4 animate-pulse rounded bg-muted"></div>
										<div class="h-3 w-4/5 animate-pulse rounded bg-muted/80"></div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{:else if recommendedGames.length === 0}
					<p class="py-4 text-sm text-muted-foreground">
						No recommendations yet — play a few games to tune your feed.
					</p>
				{:else}
					<div
						class="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-3 [-webkit-overflow-scrolling:touch] [scrollbar-width:thin] md:gap-4"
					>
						{#each recommendedGames as game (game.id)}
							<div class="group w-[min(280px,78vw)] shrink-0 snap-start sm:w-[260px] md:w-[280px]">
								<a
									href={resolve(`/games/${game.id}`)}
									data-sveltekit-preload-data="hover"
									class="block"
								>
									<div
										class="relative overflow-hidden rounded-xl border border-border/60 bg-muted shadow-sm transition-shadow hover:shadow-md"
									>
										<div class="relative aspect-video bg-muted">
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
												class="absolute top-2 right-2 z-10 rounded-full border border-border/50 bg-background/85 p-1.5 backdrop-blur-sm hover:bg-background"
												aria-label={favouriteIds.includes(game.id)
													? 'Remove from favourites'
													: 'Favourite'}
											>
												<Heart
													class="h-4 w-4 {favouriteIds.includes(game.id)
														? 'fill-red-500 text-red-500'
														: 'text-muted-foreground'}"
												/>
											</button>
										</div>
										<div class="p-2.5">
											<p class="line-clamp-2 text-sm leading-snug font-medium">{game.name}</p>
										</div>
									</div>
								</a>
							</div>
						{/each}
					</div>
				{/if}
			</section>

			<section aria-labelledby="home-more-heading" aria-busy={!feedReady}>
				<div class="mb-3 flex items-end justify-between gap-3">
					<h2
						id="home-more-heading"
						class="inline-flex items-center gap-1.5 text-lg font-semibold md:text-xl"
					>
						More to explore
						<ChevronRight class="h-5 w-5 text-muted-foreground opacity-80" aria-hidden="true" />
					</h2>
					<a
						href={resolve('/games')}
						class="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
					>
						Browse
						<ChevronRight class="h-3.5 w-3.5" />
					</a>
				</div>
				{#if !feedReady}
					<div class="flex gap-3 overflow-hidden pb-3" aria-hidden="true">
						{#each [...Array(featuredSkeletonCount).keys()] as i (i)}
							<div class="w-[min(200px,42vw)] shrink-0 sm:w-[200px]">
								<div class="overflow-hidden rounded-xl border border-border/40 bg-card/50">
									<div class="aspect-square animate-pulse bg-muted"></div>
									<div class="space-y-1.5 p-2">
										<div class="h-3 animate-pulse rounded bg-muted"></div>
										<div class="h-2.5 w-3/4 animate-pulse rounded bg-muted/80"></div>
									</div>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div
						class="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth pb-3 [scrollbar-width:thin]"
					>
						{#each featuredGames as game (game.id)}
							<div class="group w-[min(200px,42vw)] shrink-0 snap-start sm:w-[200px]">
								<a
									href={resolve(`/games/${game.id}`)}
									data-sveltekit-preload-data="hover"
									class="block"
								>
									<div
										class="overflow-hidden rounded-xl border border-border/60 bg-card transition-shadow hover:shadow-md"
									>
										<div class="relative aspect-square overflow-hidden rounded-t-xl bg-muted">
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
												class="absolute top-1.5 right-1.5 z-10 rounded-full bg-background/85 p-1 backdrop-blur-sm"
												aria-label={favouriteIds.includes(game.id)
													? 'Remove from favourites'
													: 'Favourite'}
											>
												<Heart
													class="h-3.5 w-3.5 {favouriteIds.includes(game.id)
														? 'fill-red-500 text-red-500'
														: 'text-muted-foreground'}"
												/>
											</button>
										</div>
										<div class="p-2">
											<p class="line-clamp-2 text-xs leading-snug font-medium">{game.name}</p>
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
