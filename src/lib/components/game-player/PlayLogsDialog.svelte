<script lang="ts">
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { ScrollText, Copy, Trash2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { onMount } from 'svelte';
	import {
		PLAY_LOG_CHANGED,
		clearPlayLog,
		formatPlayLogForCopy,
		getPlayLogEntries,
		type PlayLogEntry
	} from '$lib/utils/play-diagnostics-log';

	let {
		open = $bindable(false),
		snapshotLines = [],
		gameId = ''
	}: {
		open?: boolean;
		/** Extra context lines shown above the ring buffer (play URL, backend, etc.). */
		snapshotLines?: string[];
		gameId?: string;
	} = $props();

	let entries = $state<PlayLogEntry[]>([]);

	function refresh() {
		entries = [...getPlayLogEntries(gameId)].reverse();
	}

	onMount(() => {
		refresh();
		const onChange = () => refresh();
		window.addEventListener(PLAY_LOG_CHANGED, onChange);
		return () => window.removeEventListener(PLAY_LOG_CHANGED, onChange);
	});

	$effect(() => {
		if (open) refresh();
	});

	async function copyAll() {
		const header = snapshotLines.length ? `=== Snapshot ===\n${snapshotLines.join('\n')}\n\n=== Log ===\n` : '';
		const text = header + formatPlayLogForCopy(gameId);
		try {
			await navigator.clipboard.writeText(text || '(empty)');
			toast.success('Logs copied');
		} catch {
			toast.error('Could not copy logs');
		}
	}

	function clearAll() {
		clearPlayLog(gameId);
		refresh();
		toast.message('Logs cleared');
	}

	function levelClass(level: PlayLogEntry['level']): string {
		if (level === 'error') return 'text-destructive';
		if (level === 'warn') return 'text-amber-600 dark:text-amber-400';
		return 'text-muted-foreground';
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[85vh] flex-col gap-3 sm:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<ScrollText class="h-4 w-4" />
				Play diagnostics
			</Dialog.Title>
			<Dialog.Description>
				Recent play URL resolution, offline download, and relaunch events for this session.
			</Dialog.Description>
		</Dialog.Header>

		{#if snapshotLines.length > 0}
			<div class="rounded-md border bg-muted/40 p-3">
				<p class="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Snapshot</p>
				<pre class="max-h-28 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed">{snapshotLines.join('\n')}</pre>
			</div>
		{/if}

		<div class="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/20 p-3">
			{#if entries.length === 0}
				<p class="text-sm text-muted-foreground">No log entries yet. Play or download a game to generate diagnostics.</p>
			{:else}
				<ul class="space-y-2 font-mono text-[11px] leading-relaxed">
					{#each entries as entry (entry.id)}
						<li class="border-b border-border/50 pb-2 last:border-0">
							<div class="flex flex-wrap gap-x-2 gap-y-0.5">
								<span class="text-muted-foreground">{new Date(entry.at).toLocaleTimeString()}</span>
								<span class={levelClass(entry.level)}>{entry.level.toUpperCase()}</span>
								<span class="text-foreground/80">[{entry.scope}]</span>
								<span>{entry.message}</span>
							</div>
							{#if entry.detail}
								<pre class="mt-1 whitespace-pre-wrap break-all text-muted-foreground">{entry.detail}</pre>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<Dialog.Footer class="flex-col gap-2 sm:flex-row sm:justify-between">
			<div class="flex gap-2">
				<Button size="sm" variant="outline" onclick={copyAll}>
					<Copy class="mr-2 h-4 w-4" />
					Copy
				</Button>
				<Button size="sm" variant="ghost" onclick={clearAll}>
					<Trash2 class="mr-2 h-4 w-4" />
					Clear
				</Button>
			</div>
			<Button size="sm" variant="secondary" onclick={() => (open = false)}>Close</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
