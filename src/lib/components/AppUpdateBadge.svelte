<script lang="ts">
	/**
	 * Top-bar update badge — Android only, and only while there is an update to act on.
	 * Tapping it opens Settings → App at Updates; it never downloads or installs anything
	 * itself, and there is no badge, toast or notification on the web or in the Flatpak.
	 */
	import Button from '$lib/components/ui/button/button.svelte';
	import { ArrowDownToLine } from 'lucide-svelte';
	import { getSettingsUiContext } from '$lib/settings-ui-context';
	import { showsUpdateBadge, updates } from '$lib/utils/update-center.svelte';

	let { compact = false }: { compact?: boolean } = $props();

	const settingsUi = getSettingsUiContext();
	const show = $derived(showsUpdateBadge(updates.platform, updates.phase));
	const label = $derived(
		updates.phase === 'staged'
			? 'Update ready'
			: updates.phase === 'downloading'
				? `Downloading update ${Math.round(updates.progress)}%`
				: `Update ${updates.latest ?? ''} available`.replace('  ', ' ')
	);
</script>

{#if show}
	<Button
		variant="outline"
		size={compact ? 'icon' : 'sm'}
		class="relative"
		aria-label={label}
		title={label}
		data-testid="app-update-badge"
		onclick={() =>
			settingsUi?.openSettings({ section: 'app', targetId: 'settings-section-updates' })}
	>
		<ArrowDownToLine class="size-4" />
		{#if !compact}<span>Update</span>{/if}
		<span
			class="absolute -top-1 -right-1 size-2.5 rounded-full bg-primary ring-2 ring-background"
			aria-hidden="true"
		></span>
	</Button>
{/if}
