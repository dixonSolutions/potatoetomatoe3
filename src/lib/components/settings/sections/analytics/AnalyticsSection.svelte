<script lang="ts">
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import { Switch } from '$lib/components/ui/switch';
	import { loadAllGames } from '$lib/utils/games';
	import { getTodayTotalPlayMs } from '$lib/utils/play-recommendations';
	import { sectionMatches } from '$lib/components/settings/search';
	import { Gauge, Heart, ThumbsDown, ThumbsUp } from 'lucide-svelte';

	let {
		searchQuery,
		busy = false,
		limitEnabled = $bindable(false),
		limitMinutes = $bindable(0),
		affinity = $bindable<Record<string, number>>({}),
		message = '',
		error = '',
		onReady
	}: {
		searchQuery: string;
		busy?: boolean;
		limitEnabled?: boolean;
		limitMinutes?: number;
		affinity?: Record<string, number>;
		message?: string;
		error?: string;
		onReady?: () => void;
	} = $props();
	let categories = $state<string[]>([]);
	let loading = $state(true);

	$effect(() => {
		if (!limitEnabled) limitMinutes = 0;
	});

	function formatDuration(ms: number): string {
		if (ms < 1000) return '0m';
		const m = Math.floor(ms / 60000);
		const h = Math.floor(m / 60);
		if (h > 0) return `${h}h ${m % 60}m`;
		return `${m}m`;
	}

	function mergeAffinityKeys(next: Record<string, number>): Record<string, number> {
		const out = { ...next };
		for (const c of categories) {
			if (out[c] === undefined) out[c] = 0;
		}
		return out;
	}

	function onAffinityChange(cat: string, ev: Event) {
		const v = parseFloat((ev.currentTarget as HTMLInputElement).value);
		const next = { ...affinity, [cat]: v };
		affinity = next;
	}

	function resetCategoryTaste() {
		const cleared: Record<string, number> = {};
		for (const c of categories) {
			cleared[c] = 0;
		}
		affinity = cleared;
	}

	function shouldShowMessage(m: string): boolean {
		const t = m.trim().toLowerCase();
		if (t.includes('privacy mode is on') || t.includes('privacy mode is off')) return false;
		return m.length > 0;
	}

	onMount(async () => {
		if (!browser) {
			loading = false;
			queueMicrotask(() => onReady?.());
			return;
		}
		const games = await loadAllGames();
		const uniq: Record<string, true> = {};
		for (const g of games) {
			if (g.category) uniq[g.category] = true;
		}
		categories = Object.keys(uniq).sort((a, b) => a.localeCompare(b));
		affinity = mergeAffinityKeys(affinity);
		loading = false;
		queueMicrotask(() => onReady?.());
	});
</script>

<div class="space-y-6">
	{#if sectionMatches(searchQuery, 'daily playtime limit cap minutes today tracked recommendation toggle optional')}
		<div id="settings-section-analytics-limit" class="scroll-mt-32 space-y-3">
			<div class="flex items-center gap-2">
				<Gauge class="h-4 w-4 shrink-0 opacity-80" aria-hidden="true" />
				<Label for="analytics-limit-enabled">Daily playtime limit</Label>
			</div>
			<p class="text-xs text-muted-foreground">
				Total play tracked today: <strong class="text-foreground">{formatDuration(getTodayTotalPlayMs())}</strong>
				(UTC day). When enabled, the site locks after you reach the cap until the next UTC day or you change the
				limit.
			</p>
			<div
				class="flex items-start justify-between gap-4 rounded-md border p-4"
				role="group"
				aria-label="Daily playtime limit"
			>
				<div class="min-w-0 space-y-1">
					<p class="text-sm font-medium">Limit daily playtime</p>
					<p class="text-xs text-muted-foreground">Off by default. When on, set how many minutes you allow per day.</p>
				</div>
				<Switch
					id="analytics-limit-enabled"
					bind:checked={limitEnabled}
					disabled={busy}
					aria-label="Limit daily playtime"
				/>
			</div>
			{#if limitEnabled}
				<div class="flex flex-wrap items-end gap-3">
					<div class="space-y-1">
						<Label for="analytics-global-limit">Minutes per day (required)</Label>
						<input
							id="analytics-global-limit"
							type="number"
							min="1"
							step="5"
							bind:value={limitMinutes}
							disabled={busy}
							class="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full min-w-[10rem] max-w-xs rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50"
						/>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	{#if sectionMatches(searchQuery, 'category taste recommendation slider thumbs boost down-rank')}
		<div id="settings-section-analytics-taste" class="scroll-mt-32 space-y-3">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div class="flex items-center gap-2">
					<Heart class="h-4 w-4 shrink-0 opacity-80" aria-hidden="true" />
					<p class="text-sm font-medium">Category taste</p>
				</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={busy || loading || categories.length === 0}
					onclick={resetCategoryTaste}
				>
					Reset sliders
				</Button>
			</div>
			<p class="text-xs text-muted-foreground">
				<ThumbsUp class="inline h-3.5 w-3.5" aria-hidden="true" /> boosts recommendations in that category;
				<ThumbsDown class="inline h-3.5 w-3.5" aria-hidden="true" /> down-ranks it. Data stays in this browser.
			</p>
			{#if loading}
				<p class="text-xs text-muted-foreground">Loading categories…</p>
			{:else if categories.length === 0}
				<p class="text-xs text-muted-foreground">No categories found yet.</p>
			{:else}
				<div class="max-h-[min(40vh,280px)] space-y-3 overflow-y-auto pr-1">
					{#each categories as cat (cat)}
						<div class="space-y-1">
							<div class="flex justify-between text-xs">
								<span class="font-medium capitalize">{cat}</span>
								<span class="text-muted-foreground tabular-nums">{affinity[cat]?.toFixed(2) ?? '0.00'}</span>
							</div>
							<input
								type="range"
								min="-1"
								max="1"
								step="0.05"
								value={affinity[cat] ?? 0}
								disabled={busy}
								class="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed disabled:opacity-50"
								aria-label={`Taste for ${cat}`}
								oninput={(e) => onAffinityChange(cat, e)}
							/>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	{#if sectionMatches(searchQuery, 'playtime statistics table per-game sessions full page')}
		<p
			id="settings-section-analytics-more"
			class="scroll-mt-32 text-xs leading-relaxed text-muted-foreground"
		>
			<a
				href={resolve('/play-analytics')}
				class="font-medium text-foreground underline-offset-4 hover:underline"
			>
				Open full playtime &amp; algorithm page
			</a>
			for inference backend, recommendation preview, and per-game activity.
		</p>
	{/if}

	{#if searchQuery.trim() && !sectionMatches(searchQuery, 'daily playtime limit cap minutes today tracked recommendation toggle optional') && !sectionMatches(searchQuery, 'category taste recommendation slider thumbs boost down-rank') && !sectionMatches(searchQuery, 'playtime statistics table per-game sessions full page')}
		<p class="py-6 text-center text-xs text-muted-foreground">No options match your search.</p>
	{/if}

	{#if shouldShowMessage(message)}
		<p class="text-sm text-muted-foreground">{message}</p>
	{/if}
	{#if error}
		<p class="text-sm text-destructive">{error}</p>
	{/if}
</div>
