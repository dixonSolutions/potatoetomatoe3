<script lang="ts">
	import Label from '$lib/components/ui/label/label.svelte';
	import { sectionMatches } from '$lib/components/settings/search';
	import {
		getDefaultGamePlayMode,
		saveDefaultGamePlayMode,
		type GamePlayMode
	} from '$lib/utils/game-play-mode';

	let {
		searchQuery,
		busy = false,
		defaultPlayMode = $bindable<GamePlayMode>('online')
	}: {
		searchQuery: string;
		busy?: boolean;
		defaultPlayMode?: GamePlayMode;
	} = $props();

	const OPTIONS: { value: GamePlayMode; label: string; hint: string }[] = [
		{
			value: 'online',
			label: 'Online',
			hint: 'Use the online shell or CDN embed when both versions exist.'
		},
		{
			value: 'offline',
			label: 'Offline',
			hint: 'Prefer bundled or downloaded copies when available.'
		}
	];

	function onDefaultChange(value: string) {
		if (value !== 'online' && value !== 'offline') return;
		defaultPlayMode = value;
		saveDefaultGamePlayMode(value);
	}

	$effect(() => {
		defaultPlayMode = getDefaultGamePlayMode();
	});
</script>

<div class="space-y-6">
	{#if sectionMatches(searchQuery, 'games play online offline default version unity download')}
		<div id="settings-section-games-default-mode" class="scroll-mt-32 space-y-2">
			<Label for="default-game-play-mode">Default play source</Label>
			<p class="text-xs text-muted-foreground">
				When a game offers both online and offline copies, which version loads first. You can still switch per
				game on its detail page.
			</p>
			<select
				id="default-game-play-mode"
				value={defaultPlayMode}
				onchange={(e) => onDefaultChange(e.currentTarget.value)}
				class="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
				disabled={busy}
			>
				{#each OPTIONS as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
			<p class="text-xs text-muted-foreground">
				{OPTIONS.find((o) => o.value === defaultPlayMode)?.hint ?? ''}
			</p>
		</div>
	{/if}

	{#if searchQuery.trim() && !sectionMatches(searchQuery, 'games play online offline default version unity download')}
		<p class="py-6 text-center text-xs text-muted-foreground">No options match your search.</p>
	{/if}
</div>
