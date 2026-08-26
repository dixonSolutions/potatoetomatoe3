<script lang="ts">
	/**
	 * Android-only version indicator for the top bar.
	 *
	 * Shows the running version at a glance, and turns into an update button carrying a
	 * badge of how many releases behind this build is. Renders nothing anywhere else —
	 * Flatpak updates are system-managed and the public site has no version to report.
	 */
	import Button from '$lib/components/ui/button/button.svelte';
	import { Download, Loader2 } from 'lucide-svelte';
	import { onMount } from 'svelte';
	import {
		fetchLatestApkRelease,
		getInstalledVersion,
		versionsBehind,
		type LatestApkRelease
	} from '$lib/utils/app-update';
	import { runApkUpdate } from '$lib/utils/auto-apk-update';
	import { isTauriAndroidBuild } from '$lib/utils/offline-deployment';

	let { compact = false }: { compact?: boolean } = $props();

	let installed = $state<string | null>(null);
	let latest = $state<LatestApkRelease | null>(null);
	let updating = $state(false);

	let behind = $derived(installed && latest ? versionsBehind(installed, latest.versionName) : 0);
	let show = $derived(isTauriAndroidBuild() && Boolean(installed));

	onMount(() => {
		if (!isTauriAndroidBuild()) return;
		void getInstalledVersion().then((v) => (installed = v));
		/*
		 * Best-effort: a filtered network or a rate-limited GitHub API just means no badge.
		 * The version label still renders, which is the part that always works offline.
		 */
		void fetchLatestApkRelease()
			.then((r) => (latest = r))
			.catch(() => {});
	});

	async function updateNow() {
		if (!latest || updating) return;
		updating = true;
		try {
			await runApkUpdate(latest);
		} catch {
			/* runApkUpdate already surfaced this in its toast. */
		} finally {
			updating = false;
		}
	}
</script>

{#if show}
	{#if behind > 0}
		<Button
			onclick={() => void updateNow()}
			disabled={updating}
			variant="outline"
			size={compact ? 'icon' : 'sm'}
			class="relative"
			aria-label={`Update to ${latest?.versionName} — ${behind} ${behind === 1 ? 'release' : 'releases'} behind`}
			title={`Installed ${installed} · latest ${latest?.versionName}`}
		>
			{#if updating}
				<Loader2 class="h-4 w-4 animate-spin" />
			{:else}
				<Download class="h-4 w-4" />
			{/if}
			{#if !compact}
				<span class="ml-2">Update</span>
			{/if}
			{#if !updating}
				<span
					class="text-destructive-foreground absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold"
					aria-hidden="true"
				>
					{behind > 9 ? '9+' : behind}
				</span>
			{/if}
		</Button>
	{:else}
		<span
			class="hidden text-xs whitespace-nowrap text-muted-foreground sm:inline"
			title="Installed version"
		>
			v{installed}
		</span>
	{/if}
{/if}
