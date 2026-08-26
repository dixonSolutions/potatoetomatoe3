<script lang="ts">
	import Button from '$lib/components/ui/button/button.svelte';
	import { Switch } from '$lib/components/ui/switch';
	import { Label } from '$lib/components/ui/label';
	import { sectionMatches } from '$lib/components/settings/search';
	import {
		fetchLatestApkRelease,
		getInstalledVersion,
		versionsBehind,
		type LatestApkRelease
	} from '$lib/utils/app-update';
	import {
		isAutoUpdateEnabled,
		runApkUpdate,
		setAutoUpdateEnabled
	} from '$lib/utils/auto-apk-update';
	import { canSelfInstall } from '$lib/utils/app-update';
	import { openExternalUrl } from '$lib/utils/open-external';
	import { Download, Loader2, RefreshCw, CheckCircle2 } from 'lucide-svelte';
	import { onMount } from 'svelte';

	let {
		searchQuery,
		busy = false
	}: {
		searchQuery: string;
		busy?: boolean;
	} = $props();

	let loading = $state(true);
	let updating = $state(false);
	let latest = $state<LatestApkRelease | null>(null);
	let installed = $state<string | null>(null);
	let error = $state('');

	let behind = $derived(installed && latest ? versionsBehind(installed, latest.versionName) : 0);
	let ready = $derived(Boolean(latest) && behind > 0);

	function formatSize(bytes: number): string {
		if (!bytes) return '';
		return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '';
		try {
			return new Date(iso).toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric'
			});
		} catch {
			return '';
		}
	}

	/** Fetch both sides of the comparison so the panel opens already answered. */
	async function refresh() {
		loading = true;
		error = '';
		try {
			installed = await getInstalledVersion();
			latest = await fetchLatestApkRelease();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not reach GitHub Releases';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void refresh();
	});

	async function updateNow() {
		if (!latest || updating) return;
		if (!canSelfInstall()) {
			await openExternalUrl(latest.releaseUrl).catch(() => {});
			return;
		}
		updating = true;
		try {
			await runApkUpdate(latest);
		} catch {
			/* runApkUpdate surfaces failures in its own toast. */
		} finally {
			updating = false;
		}
	}
</script>

<div class="space-y-4">
	{#if sectionMatches(searchQuery, 'update apk android download release github about version automatic latest installed')}
		<section id="settings-section-updates-android" class="space-y-3">
			<div>
				<h3 class="text-sm font-medium">App update</h3>
				<p class="mt-1 text-xs text-muted-foreground">
					{#if canSelfInstall()}
						Updates download in the background and open the installer when ready. Android always
						asks you to confirm the install — that prompt can't be skipped.
					{:else}
						This build can't install its own updates — a Flatpak is updated by
						<code>flatpak update</code>. The version below is still checked against GitHub Releases.
					{/if}
				</p>
			</div>

			<div class="space-y-2 rounded-lg border p-3">
				<div class="flex items-baseline justify-between gap-3">
					<span class="text-xs text-muted-foreground">Active version</span>
					<span class="font-mono text-sm font-medium">{installed ?? '—'}</span>
				</div>
				<div class="flex items-baseline justify-between gap-3">
					<span class="text-xs text-muted-foreground">Latest on GitHub</span>
					<span class="font-mono text-sm font-medium">
						{#if loading}
							checking…
						{:else if latest}
							{latest.versionName}
						{:else}
							unknown
						{/if}
					</span>
				</div>
				{#if latest}
					<p class="text-xs text-muted-foreground">
						{latest.apkName}{#if latest.apkSize}
							· {formatSize(latest.apkSize)}{/if}{#if latest.publishedAt}
							· released {formatDate(latest.publishedAt)}{/if}
					</p>
					<!--
						Not an <a target="_blank">. In the Tauri Android WebView that navigates the app's
						own view away from tauri.localhost with no way back — the same trap the APK
						download hit. openExternalUrl hands the URL to the OS browser instead.
					-->
					<button
						type="button"
						class="inline-block text-xs underline underline-offset-2"
						onclick={() => void openExternalUrl(latest!.releaseUrl).catch(() => {})}
					>
						View release notes
					</button>
				{/if}
			</div>

			{#if !loading && latest}
				{#if ready}
					<p class="text-xs font-medium text-amber-600 dark:text-amber-500">
						Ready to download — {behind}
						{behind === 1 ? 'release' : 'releases'} behind.
					</p>
				{:else}
					<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
						<CheckCircle2 class="size-3.5" /> You're on the latest version.
					</p>
				{/if}
			{/if}

			<div class="flex flex-wrap gap-2">
				<Button
					size="sm"
					onclick={() => void updateNow()}
					disabled={busy || updating || loading || !ready}
				>
					{#if updating}
						<Loader2 class="mr-2 size-4 animate-spin" />
						Updating…
					{:else}
						<Download class="mr-2 size-4" />
						{#if !ready}
							Up to date
						{:else if canSelfInstall()}
							Download {latest?.versionName}
						{:else}
							View {latest?.versionName} release
						{/if}
					{/if}
				</Button>
				<Button
					size="sm"
					variant="outline"
					onclick={() => void refresh()}
					disabled={busy || loading || updating}
				>
					<RefreshCw class="mr-2 size-4 {loading ? 'animate-spin' : ''}" />
					Check again
				</Button>
			</div>

			{#if canSelfInstall()}
				<div class="flex items-center justify-between gap-3 pt-1">
					<Label for="auto-apk-update" class="text-xs font-normal">
						Download updates automatically
					</Label>
					<Switch
						id="auto-apk-update"
						checked={isAutoUpdateEnabled()}
						disabled={busy}
						onCheckedChange={(v) => setAutoUpdateEnabled(v)}
					/>
				</div>
			{/if}

			{#if error}
				<p class="text-xs text-destructive">{error}</p>
			{/if}
		</section>
	{/if}
</div>
