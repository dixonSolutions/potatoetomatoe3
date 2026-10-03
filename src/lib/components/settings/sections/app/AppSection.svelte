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
	import {
		getTrayLifecycleState,
		setCloseToTrayEnabled,
		type TrayLifecycleState
	} from '$lib/utils/desktop-tray';
	import {
		isTauriAndroidBuild,
		isTauriApp,
		isTauriMobileBuild
	} from '$lib/utils/offline-deployment';
	import { toast } from 'svelte-sonner';
	import SettingsGroup from '../../shared/SettingsGroup.svelte';
	import SettingsRow from '../../shared/SettingsRow.svelte';

	/*
	 * Everything here applies at once; there is nothing to Save. Android gets updates (the
	 * APK can install itself); the desktop app gets what closing its window does.
	 */
	const android = isTauriAndroidBuild();
	const desktop = isTauriApp() && !isTauriMobileBuild();

	let trayLife = $state<TrayLifecycleState | null>(null);
	let closeToTrayBusy = $state(false);

	async function onCloseToTrayToggle(checked: boolean) {
		closeToTrayBusy = true;
		try {
			const next = await setCloseToTrayEnabled(checked);
			trayLife = {
				...(trayLife ?? { trayAvailable: false, closeToTray: false }),
				closeToTray: next
			};
			toast.message(
				next
					? 'Closing the window will keep the app in the tray'
					: 'Closing the window will quit the app'
			);
		} finally {
			closeToTrayBusy = false;
		}
	}

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
		if (android) void refresh();
		if (desktop) {
			void getInstalledVersion().then((v) => (installed = v));
			void getTrayLifecycleState(true).then((state) => {
				trayLife = state;
			});
		}
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
	{#if android}
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
				This build can't install its own updates. A Flatpak updates with <code>flatpak update</code
				>.
			</p>
		{/if}
	{:else if desktop}
		<!-- The GitHub check above is for the APK; the desktop app updates through Flatpak. -->
		<SettingsGroup id="settings-section-updates-android">
			<SettingsRow label="This version" hint="A Flatpak updates with flatpak update." inline>
				<span class="font-mono text-sm">{installed ?? '—'}</span>
			</SettingsRow>
		</SettingsGroup>
	{/if}

	{#if trayLife}
		<SettingsGroup title={android ? 'Window' : undefined}>
			<SettingsRow
				id="settings-section-app-close-to-tray"
				label="Keep running in the tray"
				labelFor="app-close-to-tray"
				hint={trayLife.trayAvailable
					? 'Closing hides the window; Quit in the top bar ends the app.'
					: 'No system tray was found, so closing always quits.'}
				inline
			>
				<Switch
					id="app-close-to-tray"
					checked={trayLife.closeToTray}
					disabled={closeToTrayBusy || !trayLife.trayAvailable}
					onCheckedChange={(v) => void onCloseToTrayToggle(Boolean(v))}
				/>
			</SettingsRow>
		</SettingsGroup>
	{/if}
</div>
