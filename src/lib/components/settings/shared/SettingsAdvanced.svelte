<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ChevronRight } from 'lucide-svelte';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { getSettingsShellContext } from '../settings-section-context';

	/**
	 * Settings most people never touch, folded away. It opens itself when a search hit
	 * points at one of its `anchors`, so search can still reach what it hides.
	 */
	let {
		title,
		hint,
		anchors = [],
		open = $bindable(false),
		children
	}: {
		title: string;
		hint?: string;
		anchors?: string[];
		open?: boolean;
		children: Snippet;
	} = $props();

	const shell = getSettingsShellContext();

	$effect(() => {
		const target = shell?.revealId;
		if (target && anchors.includes(target)) open = true;
	});
</script>

<Collapsible.Root bind:open class="rounded-lg border bg-card">
	<Collapsible.Trigger
		class="group flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
	>
		<div class="min-w-0 flex-1 space-y-1">
			<p class="text-sm leading-snug font-medium">{title}</p>
			{#if hint}
				<p class="text-xs text-muted-foreground">{hint}</p>
			{/if}
		</div>
		<ChevronRight
			class="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
			aria-hidden="true"
		/>
	</Collapsible.Trigger>
	<Collapsible.Content class="divide-y divide-border border-t">
		{@render children()}
	</Collapsible.Content>
</Collapsible.Root>
