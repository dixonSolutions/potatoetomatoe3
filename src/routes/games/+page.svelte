<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { loadAllGames, resolveGameThumbnailSrc, type GameMetadata } from '$lib/utils/games';
	import { getPreferences } from '$lib/utils/preferences';
	import { getBrowseShuffleSeed, shuffleDeterministic } from '$lib/utils/play-recommendations';
	import * as Card from '$lib/components/ui/card';
	import Input from '$lib/components/ui/input/input.svelte';
	import * as Select from '$lib/components/ui/select';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Heart, ArrowUpDown, HardDrive } from 'lucide-svelte';
	import Fuse from 'fuse.js';
	import { likeGame, removePreference } from '$lib/utils/preferences';
	import {
		fetchAllOfflineStatuses,
		OFFLINE_STATUS_CHANGED
	} from '$lib/utils/offline-downloader';
	import { filterDownloadedGames } from '$lib/utils/game-availability';
	import { isNetworkOnline, subscribeNetworkStatus } from '$lib/utils/network-status';
	import { WifiOff } from 'lucide-svelte';

	type SortKey = 'name' | 'author' | 'category' | 'random';
	const BROWSE_SORT_LS = 'potato-tomato-games-browse-sort';

	let games: GameMetadata[] = $state([]);
	let loading = $state(true);
	let searchQuery = $state('');
	let selectedCategory = $state('all');
	let sortBy = $state<SortKey>('name');
	let sortReversed = $state(false);
	let showFavouritesOnly = $state(false);
	let showDownloadedOnly = $state(false);
	let networkOnline = $state(true);
	let offlineStatusMap = $state<Record<string, { offline?: boolean }>>({});
	let fuse: Fuse<GameMetadata> | null = null;
	let favouriteIds = $state<Set<string>>(new Set());

	function toggleFavourite(gameId: string, event: MouseEvent) {
		event.preventDefault();
		event.stopPropagation();

		if (favouriteIds.has(gameId)) {
			removePreference(gameId);
			favouriteIds.delete(gameId);
		} else {
			likeGame(gameId);
			favouriteIds.add(gameId);
		}
		favouriteIds = new Set(favouriteIds); // Trigger reactivity
	}

	// Pagination - load one row at a time (4 games on desktop)
	const GAMES_PER_ROW = 4;
	const INITIAL_ROWS = 6; // Start with 6 rows (24 games)
	let displayedCount = $state(INITIAL_ROWS * GAMES_PER_ROW);
	let loadMoreTrigger = $state<HTMLDivElement | undefined>(undefined);

	// Derived values for Select components
	let selectedCategoryValue = $derived({
		value: selectedCategory,
		label:
			selectedCategory === 'all'
				? 'All Categories'
				: selectedCategory.charAt(0).toUpperCase() + selectedCategory.slice(1)
	});

	let selectedSortValue = $derived({
		value: sortBy,
		label:
			sortBy === 'name'
				? 'Name (A–Z)'
				: sortBy === 'author'
					? 'Author'
					: sortBy === 'category'
						? 'Category'
						: 'Shuffle (random)'
	});

	function toggleSortDirection() {
		if (sortBy === 'random') return;
		sortReversed = !sortReversed;
	}

	function setSortBy(v: SortKey) {
		sortBy = v;
		if (typeof localStorage !== 'undefined') {
			try {
				localStorage.setItem(BROWSE_SORT_LS, v);
			} catch {
				/* ignore */
			}
		}
		const u = new URL($page.url.href);
		u.searchParams.set('sort', v);
		void goto(`${u.pathname}${u.search}`, { replaceState: true, keepFocus: true, noScroll: true });
	}

	async function refreshOfflineStatuses() {
		offlineStatusMap = await fetchAllOfflineStatuses(true);
	}

	onMount(() => {
		networkOnline = isNetworkOnline();
		const detachNetwork = subscribeNetworkStatus((online) => {
			networkOnline = online;
		});

		const onOfflineStatusChanged = () => {
			void refreshOfflineStatuses();
		};
		window.addEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);

		void (async () => {
			const params = $page.url.searchParams;
			searchQuery = params.get('q') || '';
			selectedCategory = params.get('category') || 'all';
			const urlSort = params.get('sort') as SortKey | null;
			const allowed: SortKey[] = ['name', 'author', 'category', 'random'];
			const fromLs =
				typeof localStorage !== 'undefined'
					? (localStorage.getItem(BROWSE_SORT_LS) as SortKey | null)
					: null;
			sortBy =
				urlSort && allowed.includes(urlSort)
					? urlSort
					: fromLs && allowed.includes(fromLs)
						? fromLs
						: 'name';
			sortReversed = params.get('reversed') === '1';

			games = await loadAllGames();
			await refreshOfflineStatuses();

			const prefs = getPreferences();
			favouriteIds = new Set(prefs.liked);

			fuse = new Fuse(games, {
				keys: ['name', 'description', 'author', 'category'],
				threshold: 0.3,
				includeScore: true,
				minMatchCharLength: 2
			});

			loading = false;
		})();

		return () => {
			detachNetwork();
			window.removeEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);
		};
	});

	// Progressive loading: observe sentinel; re-subscribe when count advances so the closure stays correct
	$effect(() => {
		const el = loadMoreTrigger;
		const max = filteredGames.length;
		void displayedCount;
		if (!el || typeof IntersectionObserver === 'undefined' || max === 0) return;

		const obs = new IntersectionObserver(
			(entries) => {
				if (!entries[0]?.isIntersecting) return;
				displayedCount = Math.min(displayedCount + GAMES_PER_ROW, max);
			},
			{ rootMargin: '600px', threshold: 0 }
		);
		obs.observe(el);
		return () => obs.disconnect();
	});

	// Reset displayed count when filters change
	$effect(() => {
		// Watch for filter changes
		searchQuery;
		selectedCategory;
		sortBy;
		sortReversed;
		showFavouritesOnly;
		showDownloadedOnly;
		networkOnline;
		displayedCount = INITIAL_ROWS * GAMES_PER_ROW;
	});

	let restrictToDownloaded = $derived(!networkOnline || showDownloadedOnly);

	let filteredGames = $derived.by(() => {
		let results = games;

		// Apply favourites filter first
		if (showFavouritesOnly) {
			results = results.filter((game) => favouriteIds.has(game.id));
		}

		if (restrictToDownloaded) {
			results = filterDownloadedGames(results, offlineStatusMap);
		}

		// Apply fuzzy search if query exists
		if (searchQuery.trim() && fuse) {
			const searchResults = fuse.search(searchQuery);
			const searchIds = new Set(searchResults.map((r) => r.item.id));
			results = results.filter((game) => searchIds.has(game.id));
		}

		// Apply category filter
		if (selectedCategory !== 'all') {
			results = results.filter(
				(game) => game.category?.toLowerCase() === selectedCategory.toLowerCase()
			);
		}

		// Apply sorting
		const sorted = [...results];
		switch (sortBy) {
			case 'name':
				sorted.sort((a, b) =>
					sortReversed ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)
				);
				break;
			case 'author':
				sorted.sort((a, b) =>
					sortReversed ? b.author.localeCompare(a.author) : a.author.localeCompare(b.author)
				);
				break;
			case 'category':
				sorted.sort((a, b) => {
					const catA = a.category || '';
					const catB = b.category || '';
					return sortReversed ? catB.localeCompare(catA) : catA.localeCompare(catB);
				});
				break;
			case 'random':
				return shuffleDeterministic(sorted, getBrowseShuffleSeed());
		}

		return sorted;
	});

	let categories = $derived(['all', ...new Set(games.map((g) => g.category).filter(Boolean))]);

	let displayedGames = $derived(filteredGames.slice(0, displayedCount));
	let hasMore = $derived(displayedCount < filteredGames.length);
	let downloadedCount = $derived(
		filterDownloadedGames(games, offlineStatusMap).length
	);
</script>

<div class="container mx-auto px-4 py-12">
	{#if !networkOnline}
		<div
			class="mb-6 flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
			role="status"
		>
			<WifiOff class="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
			<div>
				<p class="font-medium text-foreground">You are offline</p>
				<p class="text-muted-foreground">
					Showing {downloadedCount} downloaded {downloadedCount === 1 ? 'game' : 'games'} you can
					play without internet.
				</p>
			</div>
		</div>
	{/if}

	<div class="mb-8">
		<h1 class="mb-4 text-4xl font-bold">All games</h1>
		<p class="max-w-2xl text-muted-foreground">
			Full library in default A–Z order or a session-stable shuffle. Thumbnails load in batches as
			you scroll.
		</p>
	</div>

	<div class="mb-8 flex flex-col gap-4 sm:flex-row">
		<Input
			type="text"
			placeholder="Search games..."
			bind:value={searchQuery}
			class="w-full sm:flex-1"
		/>

		<Button
			variant={restrictToDownloaded ? 'default' : 'outline'}
			onclick={() => {
				if (!networkOnline) return;
				showDownloadedOnly = !showDownloadedOnly;
			}}
			disabled={!networkOnline}
			class="w-full sm:w-auto"
			title={!networkOnline ? 'Downloaded filter is required while offline' : undefined}
		>
			<HardDrive class="mr-2 h-4 w-4" />
			{restrictToDownloaded ? 'Downloaded' : 'Downloaded only'}
		</Button>

		<Button
			variant={showFavouritesOnly ? 'default' : 'outline'}
			onclick={() => (showFavouritesOnly = !showFavouritesOnly)}
			class="w-full sm:w-auto"
		>
			<Heart class="mr-2 h-4 w-4 {showFavouritesOnly ? 'fill-current' : ''}" />
			{showFavouritesOnly ? 'Favourites' : 'Show Favourites'}
		</Button>

		<Select.Root
			type="single"
			value={selectedCategory}
			onValueChange={(v) => {
				if (v) selectedCategory = v;
			}}
		>
			<Select.Trigger class="w-full sm:w-48">
				{selectedCategoryValue.label}
			</Select.Trigger>
			<Select.Content>
				{#each categories as category}
					<Select.Item value={category}>
						{category === 'all'
							? 'All Categories'
							: category.charAt(0).toUpperCase() + category.slice(1)}
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>

		<div class="flex w-full gap-2 sm:w-auto">
			<Select.Root
				type="single"
				value={sortBy}
				onValueChange={(v) => {
					if (v === 'name' || v === 'author' || v === 'category' || v === 'random') setSortBy(v);
				}}
			>
				<Select.Trigger class="flex-1 sm:w-44">
					{selectedSortValue.label}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="name">Name (A–Z)</Select.Item>
					<Select.Item value="author">Author</Select.Item>
					<Select.Item value="category">Category</Select.Item>
					<Select.Item value="random">Shuffle (random)</Select.Item>
				</Select.Content>
			</Select.Root>

			<Button
				variant="outline"
				size="icon"
				onclick={toggleSortDirection}
				disabled={sortBy === 'random'}
				title={sortBy === 'random'
					? 'Not used for shuffle'
					: sortReversed
						? 'Sort descending'
						: 'Sort ascending'}
			>
				<ArrowUpDown class="h-4 w-4 {sortReversed ? 'rotate-180' : ''}" />
			</Button>
		</div>
	</div>

	{#if loading}
		<div class="py-12 text-center">
			<p class="text-muted-foreground">Loading games...</p>
		</div>
	{:else if filteredGames.length === 0}
		<div class="py-12 text-center">
			<p class="text-muted-foreground">
				{!networkOnline
					? 'No downloaded games available offline yet'
					: searchQuery || selectedCategory !== 'all'
						? 'No games match your filters'
						: 'No games available yet'}
			</p>
		</div>
	{:else}
		<div class="mb-4 text-sm text-muted-foreground">
			Showing {displayedGames.length} of {filteredGames.length} games
		</div>

		<div class="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
			{#each displayedGames as game (game.id)}
				<div class="group relative block">
					<a href={resolve(`/games/${game.id}`)} data-sveltekit-preload-data="hover" class="block">
						<Card.Root class="overflow-hidden transition-all hover:scale-105 hover:shadow-lg">
							<div class="relative aspect-square overflow-hidden bg-muted">
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
								<button
									onclick={(e) => toggleFavourite(game.id, e)}
									class="absolute top-2 right-2 z-10 rounded-full bg-background/80 p-2 backdrop-blur-sm transition-colors hover:bg-background"
									title={favouriteIds.has(game.id) ? 'Remove from favourites' : 'Add to favourites'}
								>
									<Heart
										class="h-5 w-5 {favouriteIds.has(game.id)
											? 'fill-red-500 text-red-500'
											: 'text-muted-foreground'}"
									/>
								</button>
								{#if offlineStatusMap[game.id]?.offline}
									<div
										class="absolute top-2 left-2 z-10 flex items-center gap-1 rounded-full bg-background/80 px-2 py-1 text-[10px] font-medium backdrop-blur-sm"
										title="Downloaded for offline play"
									>
										<HardDrive class="h-3 w-3" />
										Offline
									</div>
								{/if}
							</div>
							<Card.Header>
								<Card.Title>{game.name}</Card.Title>
								<Card.Description>{game.description}</Card.Description>
							</Card.Header>
							<Card.Footer class="flex justify-between text-xs text-muted-foreground">
								<span>By {game.author}</span>
								<span class="rounded-full bg-primary/10 px-2 py-1 text-primary"
									>{game.category}</span
								>
							</Card.Footer>
						</Card.Root>
					</a>
				</div>
			{/each}
		</div>

		{#if hasMore}
			<div bind:this={loadMoreTrigger} class="py-12"></div>
		{/if}
	{/if}
</div>
