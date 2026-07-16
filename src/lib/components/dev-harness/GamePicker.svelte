<script lang="ts">
	import * as Select from '$lib/components/ui/select';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import type { HarnessTestGame } from '$lib/dev-harness/test-games';
	import type { GameOfflineStatus } from '$lib/utils/offline-downloader-puller';

	let {
		games,
		selectedId = $bindable(''),
		statuses = {},
		onSelect
	}: {
		games: readonly HarnessTestGame[];
		selectedId?: string;
		statuses?: Record<string, GameOfflineStatus>;
		onSelect?: (id: string) => void;
	} = $props();

	const selected = $derived(games.find((g) => g.id === selectedId) ?? null);
	const triggerLabel = $derived.by(() => {
		if (!selected) return 'Select a test game';
		const st = statuses[selected.id];
		const flags = [
			st?.offline ? 'offline' : null,
			st?.downloading ? 'downloading' : null
		].filter(Boolean);
		return flags.length
			? `${selected.name} · ${flags.join(', ')}`
			: selected.name;
	});

	function choose(id: string | undefined) {
		if (!id) return;
		selectedId = id;
		onSelect?.(id);
	}
</script>

<div class="space-y-2">
	<Label for="harness-game-picker">Test game</Label>
	<Select.Root type="single" value={selectedId} onValueChange={choose}>
		<Select.Trigger id="harness-game-picker" class="w-full">
			{triggerLabel}
		</Select.Trigger>
		<Select.Content class="max-h-72">
			{#each games as game (game.id)}
				{@const st = statuses[game.id]}
				<Select.Item value={game.id} label={game.name}>
					<span class="flex flex-col gap-0.5 py-0.5 text-left">
						<span class="font-medium">{game.name}</span>
						<span class="text-xs text-muted-foreground">
							{game.engine}/{game.pullStrategy}
							{#if st?.offline}
								· offline
							{/if}
							{#if st?.downloading}
								· downloading
							{/if}
						</span>
					</span>
				</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
	{#if selected}
		<div class="flex flex-wrap items-center gap-1.5">
			<Badge variant="secondary">{selected.category}</Badge>
			<Badge variant="outline">{selected.sourcePortal}</Badge>
			<Badge variant="outline">{selected.engine}</Badge>
			<Badge variant="outline">{selected.pullStrategy}</Badge>
		</div>
		<p class="text-xs text-muted-foreground">
			<span class="font-mono">{selected.id}</span>
			· {selected.notes}
		</p>
	{/if}
</div>
