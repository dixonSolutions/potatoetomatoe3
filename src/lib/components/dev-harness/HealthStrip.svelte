<script lang="ts">
	import { onMount } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import {
		fetchPullerHealth,
		fetchPullerJobs,
		getPullerBaseUrl,
		syncPullerBaseUrlFromTauri,
		type PullerHealth,
		type PullerJobsSnapshot
	} from '$lib/utils/offline-downloader-puller';
	import { appendPlayLog } from '$lib/utils/play-diagnostics-log';

	let {
		pollMs = 2500,
		gameId = ''
	}: {
		pollMs?: number;
		gameId?: string;
	} = $props();

	let health = $state<PullerHealth | null>(null);
	let jobs = $state<PullerJobsSnapshot | null>(null);
	let baseUrl = $state('');
	let lastError = $state('');

	async function refresh() {
		await syncPullerBaseUrlFromTauri();
		baseUrl = getPullerBaseUrl();
		const next = await fetchPullerHealth();
		health = next;
		jobs = await fetchPullerJobs();
		if (!next?.ok) {
			lastError = 'Puller health unavailable';
			appendPlayLog(
				'warn',
				'puller-health',
				'Health probe failed',
				gameId ? `game=${gameId} base=${baseUrl}` : `base=${baseUrl}`
			);
		} else {
			lastError = '';
		}
	}

	onMount(() => {
		void refresh();
		const id = window.setInterval(() => void refresh(), pollMs);
		return () => window.clearInterval(id);
	});
</script>

<Card.Root class="py-3">
	<Card.Content class="flex flex-wrap items-center gap-2 px-4 py-0">
		{#if health?.ok}
			<Badge variant="default">Puller online</Badge>
		{:else}
			<Badge variant="destructive">{lastError || 'Puller offline'}</Badge>
		{/if}
		<span class="font-mono text-xs text-muted-foreground">{baseUrl || '…'}</span>
		{#if health?.ok}
			<Badge variant="secondary">catalog {health.catalogGameCount ?? '?'}</Badge>
			<Badge variant="outline">downloads {health.activeDownloads ?? 0}</Badge>
			<Badge variant="outline">live {health.liveSessions ?? jobs?.liveSessions ?? 0}</Badge>
			{#if jobs?.active?.length}
				<Badge variant="outline">active: {jobs.active.join(', ')}</Badge>
			{/if}
		{/if}
	</Card.Content>
</Card.Root>
