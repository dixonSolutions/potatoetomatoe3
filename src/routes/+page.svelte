<!-- Root `/`: server redirect in +page.server.ts when available; client fallback for SPA/static hosts. -->
<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';

	onMount(() => {
		if (browser) {
			void goto(`${base}/home`, { replaceState: true, noScroll: true });
		}
	});
</script>

<p class="sr-only">Redirecting to your feed…</p>
