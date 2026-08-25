<script lang="ts">
	import Button from '$lib/components/ui/button/button.svelte';
	import { sectionMatches } from '$lib/components/settings/search';
	import {
		fetchLatestApkRelease,
		openApkDownload,
		type LatestApkRelease
	} from '$lib/utils/app-update';
	import { Download, Loader2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	let {
		searchQuery,
		busy = false
	}: {
		searchQuery: string;
		busy?: boolean;
	} = $props();

	let checking = $state(false);
	let latest = $state<LatestApkRelease | null>(null);
	let error = $state('');

	async function downloadLatestApk() {
		if (busy || checking) return;
		checking = true;
		error = '';
		try {
			const release = await fetchLatestApkRelease();
			latest = release;
			/* Awaited: the native handoff can fail, and a dropped rejection is exactly
			   how this step used to fail silently. */
			await openApkDownload(release.apkUrl);
			toast.message(`Downloading ${release.apkName}`, {
				description: `Release ${release.versionName} (${release.tag}) — check your notifications`
			});
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'Could not fetch the latest APK';
			error = msg;
			toast.error(msg);
		} finally {
			checking = false;
		}
	}
</script>

<div class="space-y-4">
	{#if sectionMatches(searchQuery, 'update apk android download release github about version')}
		<section id="settings-section-updates-android" class="space-y-3">
			<div>
				<h3 class="text-sm font-medium">Android update</h3>
				<p class="mt-1 text-xs text-muted-foreground">
					Download the latest Potato Tomato APK from this project’s GitHub Releases. Install it
					manually after the download finishes.
				</p>
			</div>
			<Button size="sm" onclick={() => void downloadLatestApk()} disabled={busy || checking}>
				{#if checking}
					<Loader2 class="mr-2 size-4 animate-spin" />
					Finding latest APK…
				{:else}
					<Download class="mr-2 size-4" />
					Download latest APK
				{/if}
			</Button>
			{#if latest}
				<p class="text-xs text-muted-foreground">
					Latest: {latest.versionName} ({latest.tag}) — {latest.apkName}
				</p>
			{/if}
			{#if error}
				<p class="text-xs text-destructive">{error}</p>
			{/if}
		</section>
	{/if}
</div>
