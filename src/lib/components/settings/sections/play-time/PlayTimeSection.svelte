<script lang="ts">
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { ChevronRight } from 'lucide-svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Switch } from '$lib/components/ui/switch';
	import { loadCatalogManifest } from '$lib/utils/games';
	import {
		clearCategoryAffinities,
		getCategoryAffinityMap,
		getPlayLimits,
		getTodayTotalPlayMs,
		setCategoryAffinity,
		setPlayLimits
	} from '$lib/utils/play-recommendations';
	import SettingsAdvanced from '../../shared/SettingsAdvanced.svelte';
	import SettingsGroup from '../../shared/SettingsGroup.svelte';
	import SettingsRow from '../../shared/SettingsRow.svelte';
	import { SettingsDraftState } from '../../settings-draft.svelte';
	import { getSettingsShellContext, useSettingsDraft } from '../../settings-section-context';

	const shell = getSettingsShellContext();

	/** A category left at 0 means the same as one never set, so zeros are not kept. */
	function withoutZeros(map: Record<string, number>): Record<string, number> {
		const out: Record<string, number> = {};
		for (const [k, v] of Object.entries(map)) if (v) out[k] = v;
		return out;
	}

	const draft = new SettingsDraftState(() => {
		const limitMs = getPlayLimits().dailyGlobalLimitMs;
		return {
			limitEnabled: limitMs > 0,
			limitMinutes: limitMs > 0 ? Math.round(limitMs / 60_000) : 0,
			affinity: withoutZeros(getCategoryAffinityMap())
		};
	});

	useSettingsDraft({
		get pending() {
			return draft.pending;
		},
		save() {
			const { limitEnabled, limitMinutes, affinity } = draft.value;
			const limitChanged = draft.changed('limitEnabled') || draft.changed('limitMinutes');
			if (limitChanged && limitEnabled && (!Number.isFinite(limitMinutes) || limitMinutes < 1)) {
				return 'Set a daily limit of at least 1 minute, or turn the limit off.';
			}
			if (limitChanged) {
				setPlayLimits({
					dailyGlobalLimitMs: limitEnabled ? Math.round(limitMinutes) * 60_000 : 0
				});
				window.dispatchEvent(new CustomEvent('potato-tomato-play-limits-changed'));
			}
			if (draft.changed('affinity')) {
				clearCategoryAffinities();
				for (const [k, v] of Object.entries(affinity)) setCategoryAffinity(k, v);
			}
			draft.commit();
			shell?.applied();
			return null;
		},
		discard: () => draft.reset()
	});

	let categories = $state<string[]>([]);
	let loadingCategories = $state(true);

	onMount(async () => {
		if (!browser) return;
		try {
			const manifest = await loadCatalogManifest();
			categories = [...manifest.categories].sort((a, b) => a.localeCompare(b));
		} catch {
			categories = [];
		}
		loadingCategories = false;
	});

	function formatDuration(ms: number): string {
		if (ms < 1000) return '0m';
		const m = Math.floor(ms / 60000);
		const h = Math.floor(m / 60);
		if (h > 0) return `${h}h ${m % 60}m`;
		return `${m}m`;
	}

	function setLimitEnabled(on: boolean) {
		draft.patch(on ? { limitEnabled: true } : { limitEnabled: false, limitMinutes: 0 });
	}

	function setTaste(cat: string, value: number) {
		draft.set('affinity', withoutZeros({ ...draft.value.affinity, [cat]: value }));
	}

	function formatTaste(v: number): string {
		if (!v) return '0';
		return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
	}

	const playedToday = formatDuration(getTodayTotalPlayMs());
</script>

<div class="space-y-6">
	<SettingsGroup title="Daily limit">
		<SettingsRow
			id="settings-section-analytics-limit"
			label="Limit play time"
			labelFor="analytics-limit-enabled"
			hint={`Played today: ${playedToday}. At the limit the site locks until tomorrow (UTC).`}
			inline
		>
			<Switch
				id="analytics-limit-enabled"
				bind:checked={() => draft.value.limitEnabled, setLimitEnabled}
			/>
		</SettingsRow>
		{#if draft.value.limitEnabled}
			<SettingsRow label="Minutes per day" labelFor="analytics-global-limit" inline>
				<input
					id="analytics-global-limit"
					type="number"
					min="1"
					step="5"
					inputmode="numeric"
					bind:value={() => draft.value.limitMinutes, (v) => draft.set('limitMinutes', v)}
					class="flex h-9 w-24 rounded-md border border-input bg-background px-3 py-1 text-sm tabular-nums shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
				/>
			</SettingsRow>
		{/if}
	</SettingsGroup>

	<SettingsGroup title="Recommendations">
		<SettingsRow
			id="settings-section-analytics-more"
			label="Play time and picks"
			hint="Time per game, sessions, and a preview of what gets recommended."
			inline
		>
			<Button
				href={resolve('/play-analytics')}
				variant="outline"
				size="sm"
				onclick={() => shell?.close()}
			>
				Open
				<ChevronRight class="size-4" aria-hidden="true" />
			</Button>
		</SettingsRow>
	</SettingsGroup>

	<SettingsAdvanced
		title="Category taste"
		hint="Push categories up or down in recommendations."
		anchors={['settings-section-analytics-taste']}
	>
		<div id="settings-section-analytics-taste" class="scroll-mt-4 space-y-4 px-4 py-4">
			<div class="flex items-center justify-between gap-3">
				<p class="text-xs text-muted-foreground">Stays in this browser.</p>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={Object.keys(draft.value.affinity).length === 0}
					onclick={() => draft.set('affinity', {})}
				>
					Reset all
				</Button>
			</div>
			{#if loadingCategories}
				<p class="text-xs text-muted-foreground">Loading categories…</p>
			{:else if categories.length === 0}
				<p class="text-xs text-muted-foreground">No categories found yet.</p>
			{:else}
				<div class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
					{#each categories as cat (cat)}
						{@const value = draft.value.affinity[cat] ?? 0}
						<div class="space-y-1">
							<div class="flex justify-between gap-2 text-xs">
								<span class="truncate font-medium capitalize">{cat.replace(/-/g, ' ')}</span>
								<span class="text-muted-foreground tabular-nums">{formatTaste(value)}</span>
							</div>
							<input
								type="range"
								min="-1"
								max="1"
								step="0.05"
								{value}
								aria-label={`Taste for ${cat}`}
								class="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
								oninput={(e) => setTaste(cat, parseFloat(e.currentTarget.value))}
							/>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</SettingsAdvanced>
</div>
