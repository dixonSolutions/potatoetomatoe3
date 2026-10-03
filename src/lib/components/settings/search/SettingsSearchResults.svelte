<script lang="ts">
	import { ChevronRight } from 'lucide-svelte';
	import { getSettingsSection } from '../settings-sections';
	import type { SettingsSectionId } from '../settings-section-ids';
	import type { SearchResultGroup } from './settings-search-types';

	/** Search hits under the section each one opens. */
	let {
		groups,
		onPick
	}: {
		groups: SearchResultGroup[];
		onPick: (section: SettingsSectionId, scrollTargetId: string) => void;
	} = $props();
</script>

{#if groups.length === 0}
	<p class="px-4 py-8 text-center text-sm text-muted-foreground">No settings match.</p>
{:else}
	<div class="space-y-4">
		{#each groups as group (group.section)}
			{@const def = getSettingsSection(group.section)}
			<section class="space-y-2">
				<h3 class="flex items-center gap-2 px-1 text-xs font-medium text-muted-foreground">
					<def.icon class="size-3.5" aria-hidden="true" />
					{def.title}
				</h3>
				<ul class="divide-y divide-border rounded-lg border bg-card" role="list">
					{#each group.hits as hit (hit.id)}
						<li>
							<button
								type="button"
								class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
								onclick={() => onPick(group.section, hit.scrollTargetId)}
							>
								<span class="min-w-0 flex-1 truncate">{hit.label}</span>
								<ChevronRight class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
							</button>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>
{/if}
