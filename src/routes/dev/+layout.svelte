<script lang="ts">
	import { onMount } from 'svelte';
	import { syncPullerBaseUrlFromTauri } from '$lib/utils/offline-downloader-puller';
	import { appendPlayLog } from '$lib/utils/play-diagnostics-log';
	import {
		getHarnessModeFromEnv,
		getHarnessModeFromTauri
	} from '$lib/dev-harness/harness-guard';

	let { children } = $props();

	onMount(() => {
		void (async () => {
			await syncPullerBaseUrlFromTauri();
			const mode = getHarnessModeFromEnv() ?? (await getHarnessModeFromTauri());
			appendPlayLog(
				'info',
				'harness',
				'Dev harness shell ready',
				mode ? `mode=${mode}` : 'mode=route-direct'
			);
		})();
	});
</script>

<div class="flex min-h-screen flex-col">
	{@render children()}
</div>
