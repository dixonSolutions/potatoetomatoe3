<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { SvelteSet } from 'svelte/reactivity';
	import { HardDrive, WifiOff, X } from 'lucide-svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { offlineFilterOn, setOfflineFilter } from '$lib/utils/offline-filter.svelte';
	import { loadCatalogIndex, type GameIndexEntry } from '$lib/utils/games';
	import GameRow from '$lib/components/game-card/GameRow.svelte';
	import {
		applyQualityFilter,
		readQualityFilterPrefs,
		suggestionPool
	} from '$lib/utils/catalog-quality';
	import { getPreferences, likeGame, removePreference } from '$lib/utils/preferences';
	import { getRecentlyPlayedGames, loadPlayAnalytics } from '$lib/utils/play-recommendations';
	import { buildHomeRows, ROW_SIZE, type FeedRow } from '$lib/utils/home-feed';
	import { recommendedGames } from '$lib/utils/home-feed-recommended';
	import { fetchDownloadedStatuses, OFFLINE_STATUS_CHANGED } from '$lib/utils/offline-downloader';
	import { filterDownloadedGames } from '$lib/utils/game-availability';
	import { isNetworkOnline, subscribeNetworkStatus } from '$lib/utils/network-status';

	/**
	 * Home: rows like the Roblox home (Continue, Favourites, Recommended for you, Today's
	 * picks, Top rated, the categories you play). Rows paint from the first catalog shard;
	 * Recommended fills in when the ranker is done. Offline, the Offline filter (on by default)
	 * limits every row to downloaded games; turned off, Home just says "Offline".
	 */

	let catalog: GameIndexEntry[] = $state([]);
	let recommended: GameIndexEntry[] = $state([]);
	let ready = $state(false);
	let networkOnline = $state(true);
	let offlineStatusMap = $state<Record<string, { offline?: boolean; offlineThumbnail?: string }>>(
		{}
	);
	const favouriteIds = new SvelteSet<string>();
	let generation = 0;

	const SKELETON_ROWS = 3;
	const SKELETON_TILES = 10;

	let offlineIds = $derived(
		new Set(
			Object.entries(offlineStatusMap)
				.filter(([, s]) => s.offline)
				.map(([id]) => id)
		)
	);
	let offlineThumbnails = $derived(
		Object.fromEntries(
			Object.entries(offlineStatusMap).map(([id, s]) => [id, s.offlineThumbnail])
		) as Record<string, string | undefined>
	);

	let filtering = $derived(!networkOnline && offlineFilterOn());

	function availableOnly(games: GameIndexEntry[]): GameIndexEntry[] {
		return filtering ? filterDownloadedGames(games, offlineStatusMap) : games;
	}

	let rows = $derived.by((): FeedRow<GameIndexEntry>[] => {
		if (catalog.length === 0) return [];
		void favouriteIds.size;
		const prefs = getPreferences();
		const playedIds = new Set(Object.keys(loadPlayAnalytics().perGame));
		const played = getRecentlyPlayedGames(
			catalog.filter((g) => playedIds.has(g.id)),
			prefs,
			ROW_SIZE * 2
		) as GameIndexEntry[];
		const byId = new Map(catalog.map((g) => [g.id, g]));
		const favourites = [...favouriteIds]
			.reverse()
			.map((id) => byId.get(id))
			.filter((g): g is GameIndexEntry => g !== undefined);
		const best = applyQualityFilter(catalog, readQualityFilterPrefs());
		const built = buildHomeRows({
			best: availableOnly(best),
			played: availableOnly(played),
			favourites: availableOnly(favourites),
			recommended: availableOnly(recommended)
		});
		if (!filtering) return built;
		/* Offline: the downloads themselves come first, then whatever rows still have games. */
		const downloads = filterDownloadedGames(catalog, offlineStatusMap);
		const shown = new Set(built.flatMap((r) => r.games.map((g) => g.id)));
		const rest = downloads.filter((g) => !shown.has(g.id));
		return rest.length > 0
			? [
					{ key: 'downloads', title: 'Downloads', games: rest, seeAll: '/games?downloaded=1' },
					...built
				]
			: built;
	});

	function toggleFavourite(gameId: string) {
		if (favouriteIds.has(gameId)) {
			removePreference(gameId);
			favouriteIds.delete(gameId);
		} else {
			likeGame(gameId);
			favouriteIds.add(gameId);
		}
	}

	async function refreshOfflineStatuses() {
		try {
			offlineStatusMap = await fetchDownloadedStatuses(true);
		} catch {
			/* Keep the last known map. */
		}
	}

	async function loadFeed() {
		if (!browser) return;
		const run = ++generation;
		networkOnline = isNetworkOnline();
		favouriteIds.clear();
		for (const id of getPreferences().liked) favouriteIds.add(id);
		void refreshOfflineStatuses();
		try {
			const full = await loadCatalogIndex((partial) => {
				if (run !== generation || partial.length === 0) return;
				if (!ready) {
					catalog = partial;
					ready = true;
				}
			});
			if (run !== generation) return;
			catalog = full;
			ready = true;
			const pool = suggestionPool(applyQualityFilter(full, readQualityFilterPrefs()));
			const played = new Set(Object.keys(loadPlayAnalytics().perGame));
			const recs = await recommendedGames(pool, ROW_SIZE, played);
			if (run !== generation) return;
			recommended = recs;
		} catch (err) {
			console.error('Home feed failed to load:', err);
			ready = true;
		}
	}

	onMount(() => {
		void loadFeed();
		const detachNetwork = subscribeNetworkStatus((online) => {
			networkOnline = online;
			void refreshOfflineStatuses();
		});
		let statusTimer: ReturnType<typeof setTimeout> | undefined;
		const onOfflineStatusChanged = () => {
			clearTimeout(statusTimer);
			statusTimer = setTimeout(() => void refreshOfflineStatuses(), 200);
		};
		window.addEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);
		return () => {
			detachNetwork();
			clearTimeout(statusTimer);
			window.removeEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);
		};
	});
</script>

<div class="min-h-screen bg-background text-foreground">
	<div class="mx-auto w-full max-w-[1920px] px-3 py-4 sm:px-5 md:py-6">
		<header class="mb-4 flex items-center gap-2 md:mb-6">
			<h1 class="text-xl font-bold tracking-tight md:text-2xl">Home</h1>
			{#if filtering}
				<span
					class="inline-flex items-center text-muted-foreground"
					role="status"
					title="No internet"
					aria-label="No internet"
					data-testid="offline-icon"
				>
					<WifiOff class="h-4 w-4" aria-hidden="true" />
				</span>
				<Button
					size="sm"
					variant="secondary"
					class="ml-auto h-7 rounded-full px-3 text-xs"
					aria-pressed="true"
					data-testid="offline-filter"
					onclick={() => setOfflineFilter(false)}
				>
					<HardDrive class="h-3.5 w-3.5" aria-hidden="true" />
					Downloads
					<X class="h-3.5 w-3.5" aria-label="Show all games" />
				</Button>
			{:else if !networkOnline}
				<span class="text-sm text-muted-foreground" role="status">Offline</span>
				<Button
					size="sm"
					variant="outline"
					class="ml-auto h-7 rounded-full px-3 text-xs"
					aria-pressed="false"
					data-testid="offline-filter"
					onclick={() => setOfflineFilter(true)}
				>
					<HardDrive class="h-3.5 w-3.5" aria-hidden="true" />
					Downloads
				</Button>
			{/if}
		</header>

		{#if !ready}
			<div aria-busy="true" aria-label="Loading">
				{#each [...Array(SKELETON_ROWS).keys()] as r (r)}
					<div class="mb-7 md:mb-9">
						<div class="mb-2 h-6 w-36 animate-pulse rounded-md bg-muted"></div>
						<div class="flex gap-3 overflow-hidden">
							{#each [...Array(SKELETON_TILES).keys()] as i (i)}
								<div class="w-[36vw] max-w-40 shrink-0 sm:w-38 sm:max-w-none lg:w-44">
									<div class="aspect-square animate-pulse rounded-xl bg-muted"></div>
									<div class="mt-1.5 h-3 w-3/4 animate-pulse rounded bg-muted"></div>
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{:else if rows.length === 0}
			<p class="py-16 text-center text-sm text-muted-foreground">
				{filtering ? 'No downloaded games yet.' : 'No games yet.'}
			</p>
		{:else}
			{#each rows as row, i (row.key)}
				<GameRow
					id={row.key}
					title={row.title}
					games={row.games}
					seeAll={row.seeAll
						? `${resolve('/games')}${row.seeAll.slice('/games'.length)}`
						: undefined}
					priority={i < 2}
					{favouriteIds}
					{offlineIds}
					preferOffline={!networkOnline}
					{offlineThumbnails}
					onToggleFavourite={toggleFavourite}
				/>
			{/each}
		{/if}
	</div>
</div>
