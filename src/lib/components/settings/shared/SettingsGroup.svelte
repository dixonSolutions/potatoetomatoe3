<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A small heading over a card of rows. Leave `title` off for a section's lead group. */
	let {
		id,
		title,
		children
	}: {
		/** Anchor that search results scroll to. */
		id?: string;
		title?: string;
		children: Snippet;
	} = $props();
</script>

<section {id} class="scroll-mt-4 space-y-2">
	{#if title}
		<h3 class="px-1 text-xs font-medium tracking-wide text-muted-foreground">{title}</h3>
	{/if}
	<div class="divide-y divide-border rounded-lg border bg-card">
		{@render children()}
	</div>
</section>
