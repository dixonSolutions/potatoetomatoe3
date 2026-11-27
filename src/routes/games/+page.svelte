<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import {
		loadCatalogIndex,
		loadCatalogManifest,
		loadMoreCatalogShards,
		type CatalogLoadProgress,
		type GameIndexEntry
	} from '$lib/utils/games';
	import { canUseLocalStorage } from '$lib/utils/browser-storage';
	import {
		applyQualityFilter,
		compareByQuality,
		countHiddenByDefault,
		readQualityFilterPrefs,
		suggestionPool,
		writeQualityFilterPrefs
	} from '$lib/utils/catalog-quality';
	import { getPreferences } from '$lib/utils/preferences';
	import { getBrowseShuffleSeed, shuffleDeterministic } from '$lib/utils/play-recommendations';
	import GameTile from '$lib/components/game-card/GameTile.svelte';
	import * as Popover from '$lib/components/ui/popover';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import { Switch } from '$lib/components/ui/switch';
	import { Label } from '$lib/components/ui/label';
	import { recommendedGames } from '$lib/utils/home-feed-recommended';
	import Input from '$lib/components/ui/input/input.svelte';
	import * as Select from '$lib/components/ui/select';
	import Button from '$lib/components/ui/button/button.svelte';
	import { ArrowUpDown, Search, SlidersHorizontal } from 'lucide-svelte';
	import Fuse from 'fuse.js';
	import { likeGame, removePreference } from '$lib/utils/preferences';
	import {
		fetchDownloadedStatuses,
		fetchOfflineStatusesForIds,
		OFFLINE_STATUS_CHANGED
	} from '$lib/utils/offline-downloader';
	import { filterDownloadedGames } from '$lib/utils/game-availability';
	import { isNetworkOnline, subscribeNetworkStatus } from '$lib/utils/network-status';
	import { offlineFilterOn, setOfflineFilter } from '$lib/utils/offline-filter.svelte';
	import { WifiOff } from 'lucide-svelte';
	import { createWindowVirtualizer } from '@tanstack/svelte-virtual';

	type SortKey = 'quality' | 'name' | 'author' | 'category' | 'random';
	const SORT_KEYS: SortKey[] = ['quality', 'name', 'author', 'category', 'random'];
	const BROWSE_SORT_LS = 'potato-tomato-games-browse-sort';
	const SEARCH_DEBOUNCE_MS = 150;
	const ROW_ESTIMATE_PX = 240;
	/** Prefetch more shards when within this many rows of the loaded end. */
	const SCROLL_PREFETCH_ROWS = 3;
	const SHARDS_PER_SCROLL = 2;

	let games: GameIndexEntry[] = $state([]);
	let catalogCategories: string[] = $state([]);
	let catalogProgress = $state<CatalogLoadProgress | null>(null);
	let loading = $state(true);
	let searchQuery = $state('');
	let debouncedSearch = $state('');
	let selectedCategory = $state('all');
	let sortBy = $state<SortKey>('quality');
	/* Shards run best-first when the manifest says so; older indexes were A–Z. */
	let shardsQualityOrdered = $state(false);
	/* Tests, templates and games that do not launch stay out unless asked for. */
	let showAllGames = $state(false);
	/* Only games whose hosts are not known to be blocked by the NSW DoE filter. */
	let schoolNetworkOnly = $state(false);
	let sortReversed = $state(false);
	/* Any / Recommended / Favourites: combines with search and the other filters. */
	type ShowMode = 'any' | 'recommended' | 'favourites';
	const SHOW_MODES: ShowMode[] = ['any', 'recommended', 'favourites'];
	let show = $state<ShowMode>('any');
	/* Recommender order for the Recommended filter, computed once per visit. */
	let recommendedOrder = $state<Map<string, number> | null>(null);
	const RECOMMENDED_LIMIT = 400;
	let showDownloadedOnly = $state(false);
	let networkOnline = $state(true);
	let offlineStatusMap = $state<Record<string, { offline?: boolean; offlineThumbnail?: string }>>(
		{}
	);
	let fuse: Fuse<GameIndexEntry> | null = $state(null);
	const favouriteIds = new SvelteSet<string>();
	let columnCount = $state(4);

	/*
	 * CSS width of one card's square image at each breakpoint, matching the grid classes
	 * below (1/2/3/4 columns in a 1920px-max container).
	 */
	const CARD_IMAGE_SIZES =
		'(min-width: 1800px) 220px, (min-width: 1536px) 13vw, (min-width: 1280px) 15vw, (min-width: 1024px) 18vw, (min-width: 768px) 23vw, (min-width: 640px) 31vw, 46vw';

	function prefersOfflineCover(game: GameIndexEntry): boolean {
		return !networkOnline || Boolean(offlineStatusMap[game.id]?.offline);
	}

	function toggleFavourite(gameId: string) {
		if (favouriteIds.has(gameId)) {
			removePreference(gameId);
			favouriteIds.delete(gameId);
		} else {
			likeGame(gameId);
			favouriteIds.add(gameId);
		}
	}

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
			sortBy === 'quality'
				? 'Best first'
				: sortBy === 'name'
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
		if (canUseLocalStorage()) {
			try {
				localStorage.setItem(BROWSE_SORT_LS, v);
			} catch {
				/* ignore */
			}
		}
		const u = new URL($page.url.href);
		u.searchParams.set('sort', v);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() takes no query string; the path part is resolve('/games')
		void goto(`${resolve('/games')}${u.search}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
		/* Any order but the shards' own needs the full catalog for a correct global order. */
		if (v !== 'quality' && catalogProgress && !catalogProgress.complete) {
			void loadCatalogIndex(applyCatalogUpdate, { eager: true });
		}
	}

	function setQualityFilter(next: { showAll?: boolean; schoolNetworkOnly?: boolean }) {
		if (next.showAll !== undefined) showAllGames = next.showAll;
		if (next.schoolNetworkOnly !== undefined) schoolNetworkOnly = next.schoolNetworkOnly;
		writeQualityFilterPrefs({ showAll: showAllGames, schoolNetworkOnly });
	}

	function rebuildFuse(list: GameIndexEntry[]) {
		fuse = new Fuse(list, {
			keys: ['name', 'author', 'category'],
			threshold: 0.3,
			includeScore: true,
			minMatchCharLength: 2
		});
	}

	function applyCatalogUpdate(list: GameIndexEntry[], progress: CatalogLoadProgress) {
		games = list;
		catalogProgress = progress;
		if (loading) loading = false;
		/* Fuse is expensive over 13k rows — only build when the user is searching. */
		if (debouncedSearch.trim() || searchQuery.trim()) {
			rebuildFuse(list);
		} else {
			fuse = null;
		}
	}

	let loadingMoreShards = $state(false);

	async function prefetchShardsIfNeeded() {
		if (!browser || loadingMoreShards) return;
		if (catalogProgress?.complete) return;
		loadingMoreShards = true;
		try {
			await loadMoreCatalogShards(SHARDS_PER_SCROLL, applyCatalogUpdate);
		} finally {
			loadingMoreShards = false;
		}
	}

	async function refreshDownloadedStatuses() {
		/*
		 * Replace (do not merge): fetchDownloadedStatuses only returns active downloads.
		 * Spreading over the previous map left deleted games stuck as offline:true.
		 */
		offlineStatusMap = await fetchDownloadedStatuses(true);
	}

	function updateColumnCount() {
		if (typeof window === 'undefined') return;
		const w = window.innerWidth;
		if (w >= 1800) columnCount = 8;
		else if (w >= 1536) columnCount = 7;
		else if (w >= 1280) columnCount = 6;
		else if (w >= 1024) columnCount = 5;
		else if (w >= 768) columnCount = 4;
		else if (w >= 640) columnCount = 3;
		else columnCount = 2;
	}

	onMount(() => {
		networkOnline = isNetworkOnline();
		updateColumnCount();
		const onResize = () => updateColumnCount();
		window.addEventListener('resize', onResize);

		const detachNetwork = subscribeNetworkStatus((online) => {
			networkOnline = online;
		});

		const onOfflineStatusChanged = () => {
			void refreshDownloadedStatuses();
		};
		window.addEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);

		void (async () => {
			const params = $page.url.searchParams;
			searchQuery = params.get('q') || '';
			debouncedSearch = searchQuery;
			selectedCategory = params.get('category') || 'all';
			const urlShow = params.get('show') as ShowMode | null;
			show = urlShow && SHOW_MODES.includes(urlShow) ? urlShow : 'any';
			showDownloadedOnly = params.get('downloaded') === '1';
			const urlSort = params.get('sort') as SortKey | null;
			const fromLs = canUseLocalStorage()
				? (localStorage.getItem(BROWSE_SORT_LS) as SortKey | null)
				: null;
			sortBy =
				urlSort && SORT_KEYS.includes(urlSort)
					? urlSort
					: fromLs && SORT_KEYS.includes(fromLs)
						? fromLs
						: 'quality';
			sortReversed = params.get('reversed') === '1';
			const filterPrefs = readQualityFilterPrefs();
			showAllGames = params.get('all') === '1' || Boolean(filterPrefs.showAll);
			schoolNetworkOnly = params.get('school') === '1' || Boolean(filterPrefs.schoolNetworkOnly);

			const prefs = getPreferences();
			favouriteIds.clear();
			for (const id of prefs.liked) favouriteIds.add(id);

			void refreshDownloadedStatuses();

			try {
				/* First shard only — paint immediately; more shards load as you scroll. */
				await loadCatalogIndex(applyCatalogUpdate, { eager: false });
				const manifest = await loadCatalogManifest();
				catalogCategories = manifest.categories;
				shardsQualityOrdered = manifest.order === 'quality';
				/*
				 * Global search / other sorts need the full index eventually.
				 * Kick a quiet background fill only when the user already searched
				 * or picked a sort that is not the default best-first browse path.
				 */
				if (searchQuery.trim() || sortBy !== 'quality' || !shardsQualityOrdered) {
					void loadCatalogIndex(applyCatalogUpdate, { eager: true });
				}
			} catch (err) {
				console.error('Failed to load games catalog:', err);
			} finally {
				loading = false;
			}
		})();

		return () => {
			window.removeEventListener('resize', onResize);
			detachNetwork();
			window.removeEventListener(OFFLINE_STATUS_CHANGED, onOfflineStatusChanged);
		};
	});

	$effect(() => {
		const q = searchQuery;
		const t = setTimeout(() => {
			debouncedSearch = q;
		}, SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(t);
	});

	/* Searching the full library — ensure the rest of the catalog is loading. */
	$effect(() => {
		if (!browser) return;
		if (!debouncedSearch.trim()) return;
		if (catalogProgress?.complete) {
			if (!fuse) rebuildFuse(games);
			return;
		}
		void loadCatalogIndex(applyCatalogUpdate, { eager: true });
	});

	/*
	 * A narrow filter over a partly loaded catalog leaves a handful of rows and nothing to
	 * scroll, so scroll-driven shard loading never fires. Load the rest instead.
	 */
	let fullCatalogRequested = false;
	$effect(() => {
		if (!browser || loading || catalogProgress?.complete || fullCatalogRequested) return;
		if (!schoolNetworkOnly && selectedCategory === 'all') return;
		fullCatalogRequested = true;
		void loadCatalogIndex(applyCatalogUpdate, { eager: true });
	});

	let restrictToDownloaded = $derived(showDownloadedOnly || (!networkOnline && offlineFilterOn()));

	/* The Recommended filter ranks the whole catalog, so it loads the rest first. */
	let recommendedRequested = false;
	$effect(() => {
		if (!browser || show !== 'recommended' || recommendedRequested) return;
		recommendedRequested = true;
		void (async () => {
			const full = catalogProgress?.complete
				? games
				: await loadCatalogIndex(applyCatalogUpdate, { eager: true });
			const pool = suggestionPool(applyQualityFilter(full, readQualityFilterPrefs()));
			const ranked = await recommendedGames(pool, RECOMMENDED_LIMIT);
			recommendedOrder = new Map(ranked.map((g, i) => [g.id, i]));
		})();
	});

	function setShow(next: ShowMode) {
		show = next;
		const u = new URL($page.url.href);
		if (next === 'any') u.searchParams.delete('show');
		else u.searchParams.set('show', next);
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- resolve() takes no query string; the path part is resolve('/games')
		void goto(`${resolve('/games')}${u.search}`, {
			replaceState: true,
			keepFocus: true,
			noScroll: true
		});
	}

	function setCategory(next: string) {
		selectedCategory = next;
	}

	/* Filters that differ from the defaults, for the badge on the filter button. */
	let activeFilterCount = $derived(
		(show !== 'any' ? 1 : 0) +
			(selectedCategory !== 'all' ? 1 : 0) +
			(sortBy !== 'quality' || sortReversed ? 1 : 0) +
			(showDownloadedOnly ? 1 : 0) +
			(schoolNetworkOnly ? 1 : 0) +
			(showAllGames ? 1 : 0)
	);

	let filteredGames = $derived.by(() => {
		let results = games;

		if (show === 'favourites') {
			results = results.filter((game) => favouriteIds.has(game.id));
		} else if (show === 'recommended') {
			const order = recommendedOrder;
			results = order ? results.filter((game) => order.has(game.id)) : [];
		}

		if (restrictToDownloaded) {
			results = filterDownloadedGames(results, offlineStatusMap);
		}

		/*
		 * Favourites and downloads are the user's own picks: never hide those as tests or
		 * broken. The school-network filter still applies when it is on.
		 */
		results = applyQualityFilter(results, {
			showAll: showAllGames || show === 'favourites' || restrictToDownloaded,
			schoolNetworkOnly
		});

		if (debouncedSearch.trim() && fuse) {
			const searchResults = fuse.search(debouncedSearch);
			const searchIds = new Set(searchResults.map((r) => r.item.id));
			results = results.filter((game) => searchIds.has(game.id));
		}

		if (selectedCategory !== 'all') {
			results = results.filter(
				(game) => game.category?.toLowerCase() === selectedCategory.toLowerCase()
			);
		}

		/* Recommended keeps the recommender's order unless another sort was picked. */
		if (show === 'recommended' && sortBy === 'quality' && recommendedOrder) {
			const order = recommendedOrder;
			const ranked = [...results].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
			return sortReversed ? ranked.reverse() : ranked;
		}

		/* Shards are best-first — skip a full sort for the default browse path. */
		if (sortBy === 'quality' && !sortReversed && shardsQualityOrdered) {
			return results;
		}

		const sorted = [...results];
		switch (sortBy) {
			case 'quality':
				sorted.sort(compareByQuality);
				if (sortReversed) sorted.reverse();
				break;
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

	let categories = $derived([
		'all',
		...(catalogCategories.length
			? catalogCategories
			: [...new Set(games.map((g) => g.category).filter(Boolean))].sort())
	]);

	let rowCount = $derived(Math.ceil(filteredGames.length / columnCount) || 0);

	const rowVirtualizer = createWindowVirtualizer({
		count: 0,
		estimateSize: () => ROW_ESTIMATE_PX,
		overscan: 3
	});

	/*
	 * `$rowVirtualizer` is a store read. Reading it inside an effect subscribes to it, and
	 * `setOptions` then notifies that same store — so the effect re-ran itself until Svelte
	 * gave up with `effect_update_depth_exceeded`. Once that fires the component stops
	 * updating altogether, which is why Downloaded only / Show Favourites / the category
	 * and sort selects all appeared dead: the clicks landed, nothing re-rendered.
	 *
	 * Depend on `rowCount` alone; reach the virtualizer instance untracked.
	 */
	$effect(() => {
		const n = rowCount;
		untrack(() => {
			$rowVirtualizer.setOptions({ count: n });
		});
	});

	let virtualRows = $derived($rowVirtualizer.getVirtualItems());

	/* Rows are measured, so tile height can follow the column width. */
	function measureRow(node: HTMLElement) {
		untrack(() => $rowVirtualizer.measureElement(node));
		return {
			update() {
				untrack(() => $rowVirtualizer.measureElement(node));
			}
		};
	}
	let totalSize = $derived($rowVirtualizer.getTotalSize());

	$effect(() => {
		if (!browser) return;
		const rows = virtualRows;
		if (rows.length === 0) return;

		/* Near the end of loaded rows → fetch the next name-sorted shards. */
		const last = rows[rows.length - 1];
		if (last && rowCount - last.index <= SCROLL_PREFETCH_ROWS) {
			void prefetchShardsIfNeeded();
		}

		const ids = rows.flatMap((row) => {
			const start = row.index * columnCount;
			return filteredGames.slice(start, start + columnCount).map((g) => g.id);
		});
		if (ids.length === 0) return;
		const missing = ids.filter((id) => !(id in offlineStatusMap));
		if (missing.length === 0) return;
		let cancelled = false;
		const t = setTimeout(() => {
			void fetchOfflineStatusesForIds(missing).then((map) => {
				if (cancelled) return;
				const next = { ...offlineStatusMap };
				/*
				 * Mark every probed id, whatever the backend answered. The desktop backend returns
				 * a status for each id, so keying this on `id in map` left online-only games
				 * unmarked and re-probed every 80 ms for as long as the page was open (#61).
				 */
				for (const id of missing) {
					const status = map[id];
					next[id] =
						status && (status.offline || status.downloading || status.partialCache)
							? status
							: { offline: false };
				}
				offlineStatusMap = next;
			});
		}, 80);
		return () => {
			cancelled = true;
			clearTimeout(t);
		};
	});

	let downloadedCount = $derived(filterDownloadedGames(games, offlineStatusMap).length);
	/* Hidden rows sit at the end of the best-first index, so count them once it has loaded. */
	let hiddenCount = $derived(catalogProgress?.complete ? countHiddenByDefault(games) : 0);
	let catalogLoading = $derived(catalogProgress != null && catalogProgress.complete === false);
</script>

<div class="mx-auto w-full max-w-[1920px] px-3 py-4 sm:px-5 md:py-6">
	<div class="mb-4 flex items-center gap-2 md:mb-5">
		<div class="relative flex-1">
			<Search
				class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
				aria-hidden="true"
			/>
			<Input
				type="search"
				placeholder="Search games"
				aria-label="Search games"
				bind:value={searchQuery}
				class="h-10 pl-9"
			/>
		</div>
		<Popover.Root>
			<Popover.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant={activeFilterCount > 0 ? 'secondary' : 'outline'}
						size="icon"
						class="relative h-10 w-10 shrink-0"
						aria-label="Filters"
					>
						<SlidersHorizontal class="h-4 w-4" />
						{#if activeFilterCount > 0}
							<span
								class="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
								>{activeFilterCount}</span
							>
						{/if}
					</Button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content align="end" class="w-80 space-y-4">
				<ToggleGroup.Root
					type="single"
					variant="outline"
					value={show}
					onValueChange={(v) => {
						if (v && SHOW_MODES.includes(v as ShowMode)) setShow(v as ShowMode);
					}}
					class="w-full"
					aria-label="Show"
				>
					<ToggleGroup.Item value="any" class="flex-1">Any</ToggleGroup.Item>
					<ToggleGroup.Item value="recommended" class="flex-1">Recommended</ToggleGroup.Item>
					<ToggleGroup.Item value="favourites" class="flex-1">Favourites</ToggleGroup.Item>
				</ToggleGroup.Root>

				<div class="grid grid-cols-[1fr_auto] gap-2">
					<Select.Root
						type="single"
						value={selectedCategory}
						onValueChange={(v) => {
							if (v) setCategory(v);
						}}
					>
						<Select.Trigger class="col-span-2 w-full" aria-label="Category">
							{selectedCategoryValue.label}
						</Select.Trigger>
						<Select.Content>
							{#each categories as category (category)}
								<Select.Item value={category}>
									{category === 'all'
										? 'All categories'
										: category.charAt(0).toUpperCase() + category.slice(1)}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<Select.Root
						type="single"
						value={sortBy}
						onValueChange={(v) => {
							if (SORT_KEYS.includes(v as SortKey)) setSortBy(v as SortKey);
						}}
					>
						<Select.Trigger class="w-full" aria-label="Sort">
							{selectedSortValue.label}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="quality">Best first</Select.Item>
							<Select.Item value="name">Name (A–Z)</Select.Item>
							<Select.Item value="author">Author</Select.Item>
							<Select.Item value="category">Category</Select.Item>
							<Select.Item value="random">Shuffle</Select.Item>
						</Select.Content>
					</Select.Root>
					<Button
						variant="outline"
						size="icon"
						onclick={toggleSortDirection}
						disabled={sortBy === 'random'}
						aria-label={sortReversed ? 'Sort descending' : 'Sort ascending'}
					>
						<ArrowUpDown class="h-4 w-4 {sortReversed ? 'rotate-180' : ''}" />
					</Button>
				</div>

				<div class="space-y-3">
					<div class="flex items-center justify-between gap-3">
						<Label for="filter-downloaded">Downloaded only</Label>
						<Switch
							id="filter-downloaded"
							checked={restrictToDownloaded}
							onCheckedChange={(v) => {
								if (networkOnline) showDownloadedOnly = v;
								else {
									showDownloadedOnly = false;
									setOfflineFilter(v);
								}
							}}
						/>
					</div>
					<div class="flex items-center justify-between gap-3">
						<Label for="filter-school" title="Hide games whose sites the NSW school network blocks"
							>School network</Label
						>
						<Switch
							id="filter-school"
							checked={schoolNetworkOnly}
							onCheckedChange={(v) => setQualityFilter({ schoolNetworkOnly: v })}
						/>
					</div>
					<div class="flex items-center justify-between gap-3">
						<Label for="filter-all" title="Include tests and games that do not load"
							>Show hidden games</Label
						>
						<Switch
							id="filter-all"
							checked={showAllGames}
							onCheckedChange={(v) => setQualityFilter({ showAll: v })}
						/>
					</div>
				</div>
			</Popover.Content>
		</Popover.Root>
	</div>

	<div class="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
		{#if !networkOnline}
			<span class="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5" role="status">
				<WifiOff class="h-3.5 w-3.5" aria-hidden="true" />
				Offline · {downloadedCount} downloaded
			</span>
		{/if}
		{#if !loading}
			<span>{filteredGames.length.toLocaleString()} games</span>
		{/if}
		{#if catalogLoading}
			<span>· loading…</span>
		{/if}
		{#if hiddenCount > 0 && !showAllGames}
			<button
				type="button"
				class="underline-offset-2 hover:text-foreground hover:underline"
				onclick={() => setQualityFilter({ showAll: true })}
			>
				· {hiddenCount} hidden
			</button>
		{/if}
	</div>

	{#if loading || (show === 'recommended' && !recommendedOrder)}
		<div
			class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7"
			aria-busy="true"
			aria-label="Loading"
		>
			{#each [...Array(14).keys()] as i (i)}
				<div>
					<div class="aspect-square animate-pulse rounded-xl bg-muted"></div>
					<div class="mt-1.5 h-3 w-3/4 animate-pulse rounded bg-muted"></div>
				</div>
			{/each}
		</div>
	{:else if filteredGames.length === 0}
		<p class="py-12 text-center text-sm text-muted-foreground">
			{!networkOnline
				? 'No downloaded games yet'
				: show === 'favourites' && favouriteIds.size === 0
					? 'No favourites yet. Tap the heart on a game.'
					: 'No games match'}
		</p>
	{:else}
		<div style="height: {totalSize}px; width: 100%; position: relative;">
			{#each virtualRows as vRow (vRow.key)}
				{@const start = vRow.index * columnCount}
				{@const rowGames = filteredGames.slice(start, start + columnCount)}
				<div
					class="absolute top-0 left-0 w-full pb-4"
					style="transform: translateY({vRow.start}px);"
					data-index={vRow.index}
					use:measureRow
				>
					<div
						class="grid gap-3"
						style="grid-template-columns: repeat({columnCount}, minmax(0, 1fr));"
					>
						{#each rowGames as game (game.id)}
							<GameTile
								{game}
								sizes={CARD_IMAGE_SIZES}
								priority={vRow.index < 2}
								favourite={favouriteIds.has(game.id)}
								offline={Boolean(offlineStatusMap[game.id]?.offline)}
								preferOffline={prefersOfflineCover(game)}
								offlineThumbnailRel={offlineStatusMap[game.id]?.offlineThumbnail}
								onToggleFavourite={toggleFavourite}
							/>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
