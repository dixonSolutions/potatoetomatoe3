<script lang="ts" generics="T extends string">
	import * as Select from '$lib/components/ui/select';
	import { cn } from '$lib/utils.js';

	/** A single-choice select whose trigger shows the chosen option's label. */
	let {
		value,
		options,
		onValueChange,
		disabled = false,
		id,
		label,
		class: className
	}: {
		value: T;
		options: readonly { value: T; label: string }[];
		onValueChange: (next: T) => void;
		disabled?: boolean;
		id?: string;
		/** Accessible name when no visible label points at `id`. */
		label?: string;
		class?: string;
	} = $props();

	function onChange(next: string | undefined) {
		const match = options.find((o) => o.value === next);
		if (match) onValueChange(match.value);
	}
</script>

<Select.Root type="single" {value} onValueChange={onChange} {disabled}>
	<Select.Trigger {id} aria-label={label} class={cn('w-full sm:w-52', className)}>
		<span class="truncate">{options.find((o) => o.value === value)?.label ?? 'Choose…'}</span>
	</Select.Trigger>
	<Select.Content>
		{#each options as opt (opt.value)}
			<Select.Item value={opt.value}>{opt.label}</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
