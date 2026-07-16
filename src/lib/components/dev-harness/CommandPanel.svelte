<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import * as Collapsible from '$lib/components/ui/collapsible';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { ChevronDown } from 'lucide-svelte';

	let {
		placeholder = 'command…',
		helpLines = [],
		presets = [],
		onSubmit
	}: {
		placeholder?: string;
		helpLines?: string[];
		presets?: { label: string; command: string }[];
		onSubmit: (command: string) => void | Promise<void>;
	} = $props();

	let input = $state('');
	let busy = $state(false);
	let helpOpen = $state(false);

	async function run(command: string) {
		const trimmed = command.trim();
		if (!trimmed || busy) return;
		busy = true;
		try {
			await onSubmit(trimmed);
			input = '';
		} finally {
			busy = false;
		}
	}
</script>

<Card.Root>
	<Card.Header class="pb-3">
		<Card.Title class="text-base">Manual commands</Card.Title>
		<Card.Description>Allowlisted actions only — no free-form shell or eval.</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-3">
		<form
			class="flex gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				void run(input);
			}}
		>
			<div class="min-w-0 flex-1 space-y-1.5">
				<Label for="harness-command-input" class="sr-only">Command</Label>
				<Input
					id="harness-command-input"
					class="font-mono text-sm"
					{placeholder}
					bind:value={input}
					disabled={busy}
					autocomplete="off"
					spellcheck={false}
				/>
			</div>
			<Button type="submit" size="default" disabled={busy || !input.trim()}>
				Run
			</Button>
		</form>
		{#if presets.length}
			<div class="flex flex-wrap gap-1.5">
				{#each presets as preset (preset.command)}
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={busy}
						onclick={() => void run(preset.command)}
					>
						{preset.label}
					</Button>
				{/each}
			</div>
		{/if}
		{#if helpLines.length}
			<Collapsible.Root bind:open={helpOpen}>
				<Collapsible.Trigger
					class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
				>
					<ChevronDown
						class="h-3.5 w-3.5 transition-transform {helpOpen ? 'rotate-180' : ''}"
					/>
					Command help
				</Collapsible.Trigger>
				<Collapsible.Content class="mt-2">
					<ul class="list-inside list-disc space-y-0.5 font-mono text-xs text-muted-foreground">
						{#each helpLines as line (line)}
							<li>{line}</li>
						{/each}
					</ul>
				</Collapsible.Content>
			</Collapsible.Root>
		{/if}
	</Card.Content>
</Card.Root>
