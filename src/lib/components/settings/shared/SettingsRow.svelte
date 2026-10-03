<script lang="ts">
	import type { Snippet } from 'svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import { cn } from '$lib/utils.js';

	/**
	 * One setting: label and a one-line hint on the left, the control on the right.
	 * On a phone the control drops under the label, except `inline` rows (a switch),
	 * which stay side by side because the control is small.
	 */
	let {
		id,
		label,
		hint,
		labelFor,
		inline = false,
		children,
		below
	}: {
		/** Anchor that search results scroll to. */
		id?: string;
		label: string;
		hint?: string | Snippet;
		/** Id of the control, so tapping the label reaches it. */
		labelFor?: string;
		inline?: boolean;
		/** The control. */
		children?: Snippet;
		/** Full-width content under the row (extra fields, a list, a preview). */
		below?: Snippet;
	} = $props();
</script>

<div {id} class="scroll-mt-4 px-4 py-3 first:rounded-t-lg last:rounded-b-lg">
	<div
		class={cn(
			'flex gap-x-6 gap-y-2',
			inline ? 'items-center justify-between' : 'flex-col sm:flex-row sm:items-center'
		)}
	>
		<div class="min-w-0 flex-1 space-y-1">
			{#if labelFor}
				<Label for={labelFor} class="leading-snug">{label}</Label>
			{:else}
				<p class="text-sm leading-snug font-medium">{label}</p>
			{/if}
			{#if typeof hint === 'string'}
				<p class="text-xs text-muted-foreground">{hint}</p>
			{:else if hint}
				<p class="text-xs text-muted-foreground">{@render hint()}</p>
			{/if}
		</div>
		{#if children}
			<div class={cn('flex shrink-0 items-center gap-2', !inline && 'w-full sm:w-auto')}>
				{@render children()}
			</div>
		{/if}
	</div>
	{#if below}
		<div class="mt-3">{@render below()}</div>
	{/if}
</div>
