<script lang="ts">
	import { onMount } from 'svelte';
	import { CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Switch } from '$lib/components/ui/switch';
	import {
		canSelfInstall,
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
	import { openExternalUrl } from '$lib/utils/open-external';
	import SettingsGroup from '../../shared/SettingsGroup.svelte';
	import SettingsRow from '../../shared/SettingsRow.svelte';

	/* Everything here applies at once; there is nothing to Save. */

	let loading = $state(true);
	let updating = $state(false);
	let latest = $state<LatestApkRelease | null>(null);
	let installed = $state<string | null>(null);
	let error = $state('');
	let autoUpdate = $state(isAutoUpdateEnabled());

	const behind = $derived(installed && latest ? versionsBehind(installed, latest.versionName) : 0);
	const ready = $derived(Boolean(latest) && behind > 0);

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

	const latestDetails = $derived(
		latest
			? [
					latest.apkName,
					formatSize(latest.apkSize),
					latest.publishedAt ? `released ${formatDate(latest.publishedAt)}` : ''
				]
					.filter(Boolean)
					.join(' · ')
			: undefined
	);

	/** Fetch both sides of the comparison so the section opens already answered. */
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

<div class="space-y-6">
	<SettingsGroup id="settings-section-updates-android">
		<SettingsRow label="This version" inline>
			<span class="font-mono text-sm">{installed ?? '—'}</span>
		</SettingsRow>
		<SettingsRow label="Latest on GitHub" hint={latestDetails} inline>
			<span class="font-mono text-sm">
				{#if loading}
					checking…
				{:else if latest}
					{latest.versionName}
				{:else}
					unknown
				{/if}
			</span>
		</SettingsRow>
		<div class="flex flex-wrap items-center gap-2 px-4 py-3">
			<Button size="sm" onclick={() => void updateNow()} disabled={updating || loading || !ready}>
				{#if updating}
					<Loader2 class="size-4 animate-spin" />
					Updating…
				{:else}
					<Download class="size-4" />
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
				disabled={loading || updating}
			>
				<RefreshCw class="size-4 {loading ? 'animate-spin' : ''}" />
				Check again
			</Button>
			{#if latest}
				<!--
					Not an <a target="_blank">. In the Tauri Android WebView that navigates the app's
					own view away from tauri.localhost with no way back — the same trap the APK
					download hit. openExternalUrl hands the URL to the OS browser instead.
				-->
				<Button
					size="sm"
					variant="link"
					class="px-1"
					onclick={() => void openExternalUrl(latest!.releaseUrl).catch(() => {})}
				>
					Release notes
				</Button>
			{/if}
			<div class="basis-full text-xs">
				{#if error}
					<p class="text-destructive">{error}</p>
				{:else if !loading && latest}
					{#if ready}
						<p class="font-medium text-amber-600 dark:text-amber-500">
							{behind}
							{behind === 1 ? 'release' : 'releases'} behind.
						</p>
					{:else}
						<p class="flex items-center gap-1.5 text-muted-foreground">
							<CheckCircle2 class="size-3.5" /> You're on the latest version.
						</p>
					{/if}
				{/if}
			</div>
		</div>
	</SettingsGroup>

	{#if canSelfInstall()}
		<SettingsGroup title="Updates">
			<SettingsRow
				label="Download updates automatically"
				labelFor="auto-apk-update"
				hint="Android still asks before it installs."
				inline
			>
				<Switch
					id="auto-apk-update"
					bind:checked={
						() => autoUpdate,
						(v) => {
							autoUpdate = v;
							setAutoUpdateEnabled(v);
						}
					}
				/>
			</SettingsRow>
		</SettingsGroup>
	{:else}
		<p class="px-1 text-xs text-muted-foreground">
			This build can't install its own updates. A Flatpak updates with <code>flatpak update</code>.
		</p>
	{/if}
</div>
