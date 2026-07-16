<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as ScrollArea from '$lib/components/ui/scroll-area';
	import { Badge } from '$lib/components/ui/badge';
	import type { TimelineEntry } from '$lib/dev-harness/timeline';

	let {
		entries = []
	}: {
		entries?: readonly TimelineEntry[];
	} = $props();

	const shown = $derived([...entries].reverse().slice(0, 80));

	function badgeVariant(
		level: TimelineEntry['level']
	): 'default' | 'secondary' | 'destructive' | 'outline' {
		if (level === 'error') return 'destructive';
		if (level === 'success') return 'default';
		if (level === 'warn') return 'outline';
		return 'secondary';
	}
</script>

<Card.Root class="flex min-h-0 flex-1 flex-col overflow-hidden">
	<Card.Header class="shrink-0 pb-2">
		<Card.Title class="text-base">Timeline</Card.Title>
		<Card.Description>Command and API activity for this session.</Card.Description>
	</Card.Header>
	<Card.Content class="min-h-0 flex-1 px-0 pb-0">
		<ScrollArea.Root class="h-full max-h-[min(70vh,560px)] px-4 pb-4">
			{#if shown.length === 0}
				<p class="text-sm text-muted-foreground">No operations yet.</p>
			{:else}
				<div class="space-y-3 pr-3">
					{#each shown as entry (entry.id)}
						<div class="space-y-1 border-b border-border/50 pb-3 last:border-0">
							<div class="flex flex-wrap items-center gap-2">
								<Badge variant={badgeVariant(entry.level)}>{entry.level}</Badge>
								<span class="text-xs text-muted-foreground">
									{new Date(entry.at).toLocaleTimeString()}
								</span>
								<span class="text-sm font-medium">{entry.label}</span>
							</div>
							{#if entry.detail}
								<pre
									class="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-muted-foreground"
								>{entry.detail}</pre>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</ScrollArea.Root>
	</Card.Content>
</Card.Root>
