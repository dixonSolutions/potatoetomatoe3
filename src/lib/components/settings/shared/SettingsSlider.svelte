<script lang="ts">
	import { cn } from '$lib/utils.js';

	/** A range input with its current value printed beside it. */
	let {
		id,
		value,
		min,
		max,
		step = 1,
		disabled = false,
		label,
		display,
		onValueChange,
		class: className
	}: {
		id?: string;
		value: number;
		min: number;
		max: number;
		step?: number;
		disabled?: boolean;
		/** Accessible name when no visible label points at `id`. */
		label?: string;
		/** Text shown beside the track, e.g. "72%". */
		display: string;
		onValueChange: (next: number) => void;
		class?: string;
	} = $props();
</script>

<div class={cn('flex w-full items-center gap-3 sm:w-52', className)}>
	<input
		{id}
		type="range"
		{min}
		{max}
		{step}
		{value}
		{disabled}
		aria-label={label}
		class="h-2 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed disabled:opacity-50"
		oninput={(e) => onValueChange(Number((e.currentTarget as HTMLInputElement).value))}
	/>
	<span class="w-11 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{display}</span>
</div>
