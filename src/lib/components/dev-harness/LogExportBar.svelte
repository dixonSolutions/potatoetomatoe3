<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';
	import { formatPlayLogForCopy, clearPlayLog } from '$lib/utils/play-diagnostics-log';
	import { formatTimelineForExport, type TimelineEntry } from '$lib/dev-harness/timeline';

	let {
		gameId = '',
		snapshotLines = [],
		timeline = [],
		filename = 'harness-log.txt'
	}: {
		gameId?: string;
		snapshotLines?: string[];
		timeline?: readonly TimelineEntry[];
		filename?: string;
	} = $props();

	function buildText(): string {
		const parts: string[] = [];
		if (snapshotLines.length) {
			parts.push('=== Snapshot ===', ...snapshotLines, '');
		}
		if (timeline.length) {
			parts.push('=== Timeline ===', formatTimelineForExport(timeline), '');
		}
		parts.push('=== Play log ===', formatPlayLogForCopy(gameId) || '(empty)');
		return parts.join('\n');
	}

	async function copyAll() {
		try {
			await navigator.clipboard.writeText(buildText());
			toast.success('Diagnostics copied');
		} catch {
			toast.error('Could not copy');
		}
	}

	function downloadAll() {
		const blob = new Blob([buildText()], { type: 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
		toast.success('Diagnostics downloaded');
	}

	function clearAll() {
		clearPlayLog(gameId);
		toast.message('Play log cleared');
	}
</script>

<div class="flex flex-wrap gap-2">
	<Button type="button" size="sm" variant="secondary" onclick={copyAll}>Copy logs</Button>
	<Button type="button" size="sm" variant="secondary" onclick={downloadAll}>Download</Button>
	<Button type="button" size="sm" variant="outline" onclick={clearAll}>Clear play log</Button>
</div>
