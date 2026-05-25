<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';

	/** /login is not used in normal navigation; send accidental visits to the personalized home. */
	onMount(() => {
		goto('/home', { replaceState: true, noScroll: true });
	});
</script>

<div class="min-h-[30vh] bg-background" aria-hidden="true"></div>
