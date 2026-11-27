<script lang="ts">
	import { onMount } from 'svelte';
	import { CheckCircle2, Download, RefreshCw } from 'lucide-svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Progress } from '$lib/components/ui/progress';
	import * as RadioGroup from '$lib/components/ui/radio-group';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import {
		applyUpdate,
		cancelUpdate,
		checkForUpdates,
		downloadUpdate,
		setUpdateSettings,
		updates,
		updatesInApp,
		type ApplyMode
	} from '$lib/utils/update-center.svelte';
	import {
		getTrayLifecycleState,
		setCloseToTrayEnabled,
		type TrayLifecycleState
	} from '$lib/utils/desktop-tray';
	import { isTauriApp, isTauriMobileBuild } from '$lib/utils/offline-deployment';
	import SettingsGroup from '../../shared/SettingsGroup.svelte';
	import SettingsRow from '../../shared/SettingsRow.svelte';

	/*
	 * Everything here applies at once; there is nothing to Save. Android updates in the app
	 * (src/lib/utils/update-center.svelte.ts); the Flatpak updates from its remote; the
	 * desktop app also gets what closing its window does.
	 */
	const inApp = $derived(updatesInApp(updates.platform));
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
		} finally {
			closeToTrayBusy = false;
		}
	}

	const status = $derived.by(() => {
		switch (updates.phase) {
			case 'checking':
				return 'Checking…';
			case 'up-to-date':
				return 'Up to date';
			case 'available':
				return updates.needsInstall
					? `${updates.latest ?? 'New version'} needs a new install`
					: `${updates.latest ?? 'New version'} available`;
			case 'downloading':
				return `Downloading ${updates.latest ?? 'update'} · ${Math.round(updates.progress)}%`;
			case 'staged':
				return updates.settings.applyMode === 'live'
					? `${updates.latest ?? 'Update'} ready`
					: `${updates.latest ?? 'Update'} ready · installs on next start`;
			case 'error':
				return updates.error || 'Could not check for updates';
			default:
				return 'Not checked yet';
		}
	});

	onMount(() => {
		if (desktop) {
			void getTrayLifecycleState(true).then((state) => {
				trayLife = state;
			});
		}
	});
</script>

<div class="space-y-6">
	{#if inApp}
		<SettingsGroup title="Updates" id="settings-section-updates">
			<div class="flex flex-col gap-3 px-4 py-3" data-testid="updates-status">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<div class="min-w-0">
						<p class="text-sm font-medium">Version {updates.installed ?? '—'}</p>
						<p
							class="flex items-center gap-1.5 text-sm text-muted-foreground"
							class:text-destructive={updates.phase === 'error'}
						>
							{#if updates.phase === 'up-to-date'}<CheckCircle2 class="size-3.5" />{/if}
							{status}
						</p>
					</div>
					{#if updates.phase === 'available'}
						<Button size="sm" onclick={() => void downloadUpdate()} data-testid="update-download">
							<Download class="size-4" />
							{updates.needsInstall ? 'Install' : 'Download'}
						</Button>
					{:else if updates.phase === 'downloading'}
						<Button
							size="sm"
							variant="outline"
							onclick={() => void cancelUpdate()}
							data-testid="update-cancel"
						>
							Cancel
						</Button>
					{:else if updates.phase === 'staged'}
						<Button size="sm" onclick={() => void applyUpdate()} data-testid="update-apply">
							Install now
						</Button>
					{:else}
						<Button
							size="sm"
							variant="outline"
							disabled={updates.phase === 'checking'}
							onclick={() => void checkForUpdates()}
							data-testid="update-check"
						>
							<RefreshCw class="size-4 {updates.phase === 'checking' ? 'animate-spin' : ''}" />
							Check
						</Button>
					{/if}
				</div>
				{#if updates.phase === 'downloading'}
					<Progress
						value={updates.progress}
						max={100}
						class="h-1.5"
						aria-label="Update download progress"
					/>
				{/if}
			</div>
			<SettingsRow label="Download on Wi-Fi" labelFor="update-wifi" inline>
				<Switch
					id="update-wifi"
					checked={updates.settings.wifi}
					onCheckedChange={(v) => setUpdateSettings({ wifi: Boolean(v) })}
				/>
			</SettingsRow>
			<SettingsRow label="Download on mobile data" labelFor="update-mobile" inline>
				<Switch
					id="update-mobile"
					checked={updates.settings.mobileData}
					onCheckedChange={(v) => setUpdateSettings({ mobileData: Boolean(v) })}
				/>
			</SettingsRow>
			<SettingsRow label="Update automatically" labelFor="update-auto" inline>
				<Switch
					id="update-auto"
					checked={updates.settings.automatic}
					onCheckedChange={(v) => setUpdateSettings({ automatic: Boolean(v) })}
				/>
			</SettingsRow>
			<SettingsRow label="Install updates">
				<RadioGroup.Root
					value={updates.settings.applyMode}
					onValueChange={(v) => setUpdateSettings({ applyMode: v as ApplyMode })}
					class="flex gap-4"
				>
					<div class="flex items-center gap-2">
						<RadioGroup.Item value="next-start" id="update-apply-next" />
						<Label for="update-apply-next" class="font-normal">On next start</Label>
					</div>
					<div class="flex items-center gap-2">
						<RadioGroup.Item value="live" id="update-apply-live" />
						<Label for="update-apply-live" class="font-normal">Right away</Label>
					</div>
				</RadioGroup.Root>
			</SettingsRow>
		</SettingsGroup>
	{:else if desktop}
		<SettingsGroup id="settings-section-updates">
			<SettingsRow label="Version" hint="Updates come from the Flatpak remote." inline>
				<span class="font-mono text-sm">{updates.installed ?? '—'}</span>
			</SettingsRow>
		</SettingsGroup>
	{/if}

	{#if trayLife}
		<SettingsGroup title={inApp ? 'Window' : undefined}>
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
