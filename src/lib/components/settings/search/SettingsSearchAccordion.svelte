<script lang="ts">
	import * as Accordion from '$lib/components/ui/accordion';
	import type { SearchResultSection } from './settings-search-types';

	let {
		results,
		accordionOpen = $bindable<string[]>([]),
		onPickSubsection
	}: {
		results: SearchResultSection[];
		accordionOpen?: string[];
		onPickSubsection: (panel: 'privacy' | 'audio' | 'analytics' | 'games', scrollTargetId: string) => void;
	} = $props();
</script>

<div
	class="max-h-[min(48vh,360px)] overflow-y-auto rounded-md border border-border/60 bg-muted/10 px-1"
>
	<Accordion.Root type="multiple" bind:value={accordionOpen}>
		{#each results as sec (sec.id)}
			<Accordion.Item value={sec.id} class="border-b border-border/50 last:border-b-0">
				<Accordion.Trigger class="px-3 py-3 text-sm font-medium">{sec.title}</Accordion.Trigger>
				<Accordion.Content class="px-1">
					<ul class="space-y-0.5 pb-2" role="list">
						{#each sec.matchingSubsections as sub (sub.id)}
							<li>
								<button
									type="button"
									class="w-full rounded-md px-3 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
									onclick={() => onPickSubsection(sec.panel, sub.scrollTargetId)}
								>
									{sub.label}
								</button>
							</li>
						{/each}
					</ul>
				</Accordion.Content>
			</Accordion.Item>
		{/each}
	</Accordion.Root>
</div>
