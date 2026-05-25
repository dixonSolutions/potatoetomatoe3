<script lang="ts">
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Switch } from '$lib/components/ui/switch';
	import Label from '$lib/components/ui/label/label.svelte';
	import { loadAllGames, type GameMetadata } from '$lib/utils/games';
	import {
		getCategoryAffinityMap,
		setCategoryAffinity,
		getPlayLimits,
		setPlayLimits,
		getPlaySessionsList,
		getTotalPlaytimeMs,
		getTodayPlayMsForGame,
		getTodayTotalPlayMs,
		getTopRecommendedPreview,
		clearCategoryAffinities
	} from '$lib/utils/play-recommendations';
	import { getPreferences } from '$lib/utils/preferences';
	import { initRecommendationBackend, getRecommendationBackendName } from '$lib/utils/recommendation-tf';
	import { Cpu, Gauge, Heart, ThumbsDown, ThumbsUp } from 'lucide-svelte';

	let allGames: GameMetadata[] = $state([]);
	let categories = $state<string[]>([]);
	let affinity = $state<Record<string, number>>({});
	let backendLabel = $state<string>('…');
	let preview = $state<{ id: string; name: string; scoreApprox: number }[]>([]);
	let sessions = $state<
		{ gameId: string; sessions: number; lastPlayed: number; totalPlayMs: number }[]
	>([]);
	let globalLimitEnabled = $state(false);
	let globalLimitMinutes = $state(0);
	let limitSaveError = $state('');
	let loading = $state(true);

	$effect(() => {
		if (!globalLimitEnabled) globalLimitMinutes = 0;
	});

	function formatDuration(ms: number): string {
		if (ms < 1000) return '0m';
		const m = Math.floor(ms / 60000);
		const h = Math.floor(m / 60);
		if (h > 0) return `${h}h ${m % 60}m`;
		return `${m}m`;
	}

	function gameName(id: string): string {
		return allGames.find((g) => g.id === id)?.name ?? id;
	}

	function syncFromStorage() {
		affinity = getCategoryAffinityMap();
		const limits = getPlayLimits();
		globalLimitEnabled = limits.dailyGlobalLimitMs > 0;
		globalLimitMinutes =
			limits.dailyGlobalLimitMs > 0 ? Math.round(limits.dailyGlobalLimitMs / 60000) : 0;
		sessions = getPlaySessionsList();
	}

	function onAffinityChange(cat: string, ev: Event) {
		const v = parseFloat((ev.currentTarget as HTMLInputElement).value);
		setCategoryAffinity(cat, v);
		affinity = { ...getCategoryAffinityMap() };
	}

	function saveGlobalLimit() {
		limitSaveError = '';
		if (globalLimitEnabled) {
			if (!Number.isFinite(globalLimitMinutes) || globalLimitMinutes < 1) {
				limitSaveError = 'Set at least 1 minute per day, or turn the limit off.';
				return;
			}
			setPlayLimits({ dailyGlobalLimitMs: Math.round(globalLimitMinutes) * 60_000 });
		} else {
			setPlayLimits({ dailyGlobalLimitMs: 0 });
		}
		if (browser) {
			window.dispatchEvent(new CustomEvent('potato-tomato-play-limits-changed'));
		}
	}

	function resetCategoryTaste() {
		clearCategoryAffinities();
		affinity = {};
		for (const c of categories) affinity[c] = 0;
		affinity = { ...affinity };
	}

	onMount(async () => {
		if (!browser) return;
		await initRecommendationBackend();
		backendLabel = getRecommendationBackendName() ?? 'cpu';
		allGames = await loadAllGames();
		const uniq: Record<string, true> = {};
		for (const g of allGames) {
			if (g.category) uniq[g.category] = true;
		}
		categories = Object.keys(uniq).sort((a, b) => a.localeCompare(b));
		syncFromStorage();
		const aff = { ...affinity };
		for (const c of categories) {
			if (aff[c] === undefined) aff[c] = 0;
		}
		affinity = aff;
		const prefs = getPreferences();
		preview = await getTopRecommendedPreview(allGames, prefs, 12);
		loading = false;
	});
</script>

<div class="min-h-screen bg-background text-foreground">
	<div class="container mx-auto px-3 sm:px-4 py-8 max-w-4xl space-y-10">
		<header class="space-y-2">
			<p class="text-sm text-muted-foreground">
				<a href={resolve('/home')} class="underline-offset-4 hover:underline">← Back to For you</a>
			</p>
			<h1 class="text-2xl md:text-3xl font-bold tracking-tight">Playtime &amp; algorithm</h1>
			<p class="text-muted-foreground text-sm max-w-2xl">
				Everything stays in your browser. Recommendations use TensorFlow.js matrix scoring on WebGPU when
				available; weights combine your play history, favourites, category taste, and recency.
			</p>
		</header>

		<section class="rounded-xl border bg-card p-4 md:p-6 space-y-3" aria-labelledby="tf-backend-heading">
			<h2 id="tf-backend-heading" class="text-lg font-semibold inline-flex items-center gap-2">
				<Cpu class="h-5 w-5 opacity-80" aria-hidden="true" />
				Inference backend
			</h2>
			<p class="text-sm text-muted-foreground">
				Active backend: <span class="font-mono text-foreground">{backendLabel}</span>
				(WebGPU → WebGL → CPU fallback.)
			</p>
		</section>

		<section class="rounded-xl border bg-card p-4 md:p-6 space-y-4" aria-labelledby="limits-heading">
			<h2 id="limits-heading" class="text-lg font-semibold inline-flex items-center gap-2">
				<Gauge class="h-5 w-5 opacity-80" aria-hidden="true" />
				Daily playtime limit
			</h2>
			<p class="text-sm text-muted-foreground">
				Total play tracked today: <strong class="text-foreground">{formatDuration(getTodayTotalPlayMs())}</strong>
			</p>
			<div
				class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between rounded-lg border p-4"
				role="group"
				aria-label="Daily limit toggle"
			>
				<div class="space-y-1 min-w-0">
					<p class="text-sm font-medium">Limit daily playtime</p>
					<p class="text-xs text-muted-foreground">Off by default. When on, set minutes per day (required).</p>
				</div>
				<Switch bind:checked={globalLimitEnabled} aria-label="Limit daily playtime" />
			</div>
			<div class="flex flex-wrap items-end gap-3">
				{#if globalLimitEnabled}
					<div class="flex flex-col gap-1 text-sm">
						<Label for="pa-limit-min">Minutes per day</Label>
						<input
							id="pa-limit-min"
							type="number"
							min="1"
							step="5"
							class="border rounded-md px-3 py-2 bg-background w-40 border-input"
							bind:value={globalLimitMinutes}
						/>
					</div>
				{/if}
				<Button type="button" onclick={saveGlobalLimit}>Save limit</Button>
			</div>
			{#if limitSaveError}
				<p class="text-sm text-destructive">{limitSaveError}</p>
			{/if}
		</section>

		<section class="rounded-xl border bg-card p-4 md:p-6 space-y-4" aria-labelledby="categories-heading">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h2 id="categories-heading" class="text-lg font-semibold inline-flex items-center gap-2">
					<Heart class="h-5 w-5 opacity-80" aria-hidden="true" />
					Category taste
				</h2>
				<Button type="button" variant="outline" size="sm" onclick={resetCategoryTaste}>
					Reset sliders
				</Button>
			</div>
			<p class="text-sm text-muted-foreground">
				<ThumbsUp class="inline h-4 w-4" /> boosts recommendations in that category;
				<ThumbsDown class="inline h-4 w-4" /> down-ranks it.
			</p>
			<div class="space-y-4 max-h-[420px] overflow-y-auto pr-1">
				{#each categories as cat (cat)}
					<div class="space-y-1">
						<div class="flex justify-between text-sm">
							<span class="font-medium capitalize">{cat}</span>
							<span class="text-muted-foreground tabular-nums">{affinity[cat]?.toFixed(2) ?? '0.00'}</span>
						</div>
						<input
							type="range"
							min="-1"
							max="1"
							step="0.05"
							value={affinity[cat] ?? 0}
							class="w-full accent-primary"
							oninput={(e) => onAffinityChange(cat, e)}
						/>
					</div>
				{/each}
			</div>
		</section>

		<section class="rounded-xl border bg-card p-4 md:p-6 space-y-4" aria-labelledby="preview-heading">
			<h2 id="preview-heading" class="text-lg font-semibold">What the algorithm favours now</h2>
			{#if loading}
				<p class="text-sm text-muted-foreground">Loading preview…</p>
			{:else if preview.length === 0}
				<p class="text-sm text-muted-foreground">Play a few titles to build a profile.</p>
			{:else}
				<ol class="list-decimal list-inside space-y-1 text-sm">
					{#each preview as row (row.id)}
						<li>
							<a href={resolve(`/games/${row.id}`)} class="underline-offset-4 hover:underline font-medium">{row.name}</a>
							<span class="text-muted-foreground"> — rank score ~{row.scoreApprox}</span>
						</li>
					{/each}
				</ol>
			{/if}
		</section>

		<section class="rounded-xl border bg-card p-4 md:p-6 space-y-4 overflow-x-auto" aria-labelledby="table-heading">
			<h2 id="table-heading" class="text-lg font-semibold">Per-game activity</h2>
			<table class="w-full text-sm text-left border-collapse">
				<thead>
					<tr class="border-b text-muted-foreground">
						<th class="py-2 pr-4 font-medium">Game</th>
						<th class="py-2 pr-4 font-medium">Sessions</th>
						<th class="py-2 pr-4 font-medium">Total time</th>
						<th class="py-2 font-medium">Today</th>
					</tr>
				</thead>
				<tbody>
					{#each sessions as row (row.gameId)}
						<tr class="border-b border-border/60">
							<td class="py-2 pr-4">
								<a href={resolve(`/games/${row.gameId}`)} class="hover:underline">{gameName(row.gameId)}</a>
							</td>
							<td class="py-2 pr-4 tabular-nums">{row.sessions}</td>
							<td class="py-2 pr-4 tabular-nums">{formatDuration(getTotalPlaytimeMs(row.gameId))}</td>
							<td class="py-2 tabular-nums">{formatDuration(getTodayPlayMsForGame(row.gameId))}</td>
						</tr>
					{/each}
				</tbody>
			</table>
			{#if sessions.length === 0}
				<p class="text-sm text-muted-foreground">No sessions recorded yet.</p>
			{/if}
		</section>
	</div>
</div>
