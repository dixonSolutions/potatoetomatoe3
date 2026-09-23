<script lang="ts">
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import Button from '$lib/components/ui/button/button.svelte';
	import { buttonVariants } from '$lib/components/ui/button/index.js';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import { Kbd } from '$lib/components/ui/kbd';
	import { Switch } from '$lib/components/ui/switch';
	import { cn } from '$lib/utils.js';
	import {
		MAX_PRIVACY_LOCK_DELAY_MS,
		changePrivacyPassword,
		conflictsWithSettingsShortcut,
		disablePrivacyMode,
		enablePrivacyMode,
		formatPrivacyLockShortcutLabel,
		getPrivacyDisguiseMode,
		getPrivacyDisguiseProvider,
		getPrivacyDisguiseServiceId,
		getPrivacyLockDelayMs,
		getPrivacyLockShortcut,
		getPrivacyPauseGameWhileLocked,
		isModifierOnlyKeyboardCode,
		isPrivacyEnabled,
		savePrivacyDisguiseMode,
		savePrivacyDisguiseSelection,
		savePrivacyLockDelayMs,
		savePrivacyLockShortcut,
		savePrivacyPauseGameWhileLocked,
		type PrivacyLockShortcut
	} from '$lib/utils/privacy-mode';
	import {
		PRIVACY_DISGUISE_PROVIDERS,
		getServicesForProvider,
		resolveDisguiseService
	} from '$lib/utils/privacy-disguise-registry';
	import type { PrivacyDisguiseMode, PrivacyDisguiseProvider } from '$lib/utils/site-settings';
	import SettingsAdvanced from '../../shared/SettingsAdvanced.svelte';
	import SettingsGroup from '../../shared/SettingsGroup.svelte';
	import SettingsRow from '../../shared/SettingsRow.svelte';
	import SettingsSelect from '../../shared/SettingsSelect.svelte';
	import { SettingsDraftState } from '../../settings-draft.svelte';
	import { getSettingsShellContext, useSettingsDraft } from '../../settings-section-context';

	const shell = getSettingsShellContext();

	const LOCK_DELAY_OPTIONS = [
		{ label: 'Immediately', value: '0' },
		{ label: '3 seconds', value: '3' },
		{ label: '5 seconds', value: '5' },
		{ label: '10 seconds', value: '10' },
		{ label: '30 seconds', value: '30' },
		{ label: '1 minute', value: '60' },
		{ label: '2 minutes', value: '120' }
	] as const;

	/** A stored delay that is not one of the options shows as the closest one. */
	function nearestLockDelay(ms: number): string {
		const sec = Math.round(ms / 1000);
		const values = LOCK_DELAY_OPTIONS.map((o) => Number(o.value));
		const nearest = values.reduce((best, v) =>
			Math.abs(v - sec) < Math.abs(best - sec) ? v : best
		);
		return String(nearest);
	}

	let enabled = $state(isPrivacyEnabled());

	const draft = new SettingsDraftState(() => ({
		disguise: getPrivacyDisguiseMode() as PrivacyDisguiseMode,
		provider: getPrivacyDisguiseProvider() as PrivacyDisguiseProvider,
		service: getPrivacyDisguiseServiceId(),
		lockDelay: nearestLockDelay(getPrivacyLockDelayMs()),
		pauseGame: getPrivacyPauseGameWhileLocked(),
		lockShortcut: getPrivacyLockShortcut() as PrivacyLockShortcut | null
	}));

	useSettingsDraft({
		get pending() {
			return enabled ? draft.pending : 0;
		},
		save() {
			const v = draft.value;
			if (draft.changed('disguise')) savePrivacyDisguiseMode(v.disguise);
			if (draft.changed('provider') || draft.changed('service')) {
				if (!savePrivacyDisguiseSelection(v.provider, v.service)) return 'Choose a valid service.';
			}
			if (draft.changed('lockDelay')) {
				const sec = Math.max(
					0,
					Math.min(parseInt(v.lockDelay, 10) || 0, MAX_PRIVACY_LOCK_DELAY_MS / 1000)
				);
				savePrivacyLockDelayMs(sec * 1000);
			}
			if (draft.changed('pauseGame')) savePrivacyPauseGameWhileLocked(v.pauseGame);
			if (draft.changed('lockShortcut')) savePrivacyLockShortcut(v.lockShortcut);
			draft.commit();
			shell?.applied();
			return null;
		},
		discard() {
			recordingShortcut = false;
			shortcutError = '';
			draft.reset();
		}
	});

	/* ---- Disguise ---- */

	const activeService = $derived(resolveDisguiseService(draft.value.provider, draft.value.service));
	const activeProvider = $derived(
		PRIVACY_DISGUISE_PROVIDERS.find((p) => p.id === draft.value.provider) ??
			PRIVACY_DISGUISE_PROVIDERS[0]
	);
	const serviceOptions = $derived(getServicesForProvider(draft.value.provider));

	const DISGUISE_OPTIONS = $derived<{ value: PrivacyDisguiseMode; label: string; hint: string }[]>([
		{ value: 'off', label: 'Off', hint: 'The tab keeps this site’s title and icon.' },
		{
			value: 'focus_loss',
			label: 'In the background',
			hint: `Shows ${activeService.label} when you switch away, and while locked.`
		},
		{ value: 'always', label: 'Always', hint: `Always shows ${activeService.label}.` }
	]);

	function onProviderChange(next: string | undefined) {
		if (next !== 'google' && next !== 'microsoft') return;
		const services = getServicesForProvider(next);
		const service = services.some((s) => s.id === draft.value.service)
			? draft.value.service
			: (services[0]?.id ?? 'docs');
		draft.patch({ provider: next, service });
	}

	/* ---- Lock shortcut ---- */

	let recordingShortcut = $state(false);
	let shortcutError = $state('');

	$effect(() => {
		if (!recordingShortcut) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				recordingShortcut = false;
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			if (isModifierOnlyKeyboardCode(e.code)) return;
			const next: PrivacyLockShortcut = {
				code: e.code,
				ctrlKey: e.ctrlKey,
				shiftKey: e.shiftKey,
				altKey: e.altKey,
				metaKey: e.metaKey
			};
			recordingShortcut = false;
			if (conflictsWithSettingsShortcut(next)) {
				shortcutError = 'Ctrl+Shift+, is kept for opening settings.';
				return;
			}
			shortcutError = '';
			draft.set('lockShortcut', next);
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	});

	/* ---- Turning privacy mode on and off ---- */

	let busy = $state(false);
	let enableOpen = $state(false);
	let newPassword = $state('');
	let enableError = $state('');
	let disableOpen = $state(false);

	function onEnabledToggle(next: boolean) {
		if (next && !enabled) {
			newPassword = '';
			enableError = '';
			enableOpen = true;
		} else if (!next && enabled) {
			disableOpen = true;
		}
	}

	async function submitEnable() {
		enableError = '';
		if (newPassword.length < 4) {
			enableError = 'Use at least 4 characters.';
			return;
		}
		busy = true;
		try {
			await enablePrivacyMode(newPassword);
			const v = draft.value;
			savePrivacyDisguiseSelection(v.provider, v.service);
			savePrivacyLockDelayMs((parseInt(v.lockDelay, 10) || 0) * 1000);
			savePrivacyDisguiseMode(v.disguise);
			savePrivacyLockShortcut(v.lockShortcut);
			draft.commit();
			enabled = true;
			newPassword = '';
			enableOpen = false;
			shell?.applied();
		} catch {
			enableError = 'Could not turn on privacy mode.';
		} finally {
			busy = false;
		}
	}

	function confirmDisable() {
		disablePrivacyMode();
		enabled = false;
		disableOpen = false;
		recordingShortcut = false;
		shortcutError = '';
		changeCurrent = '';
		changeNew = '';
		changeConfirm = '';
		changeError = '';
		changeMessage = '';
		draft.reset();
		shell?.applied();
	}

	/* ---- Change password ---- */

	let changeCurrent = $state('');
	let changeNew = $state('');
	let changeConfirm = $state('');
	let changeError = $state('');
	let changeMessage = $state('');

	async function submitChangePassword(e: Event) {
		e.preventDefault();
		changeError = '';
		changeMessage = '';
		if (changeNew.length < 4) {
			changeError = 'New password needs at least 4 characters.';
			return;
		}
		if (changeNew !== changeConfirm) {
			changeError = 'New passwords do not match.';
			return;
		}
		busy = true;
		try {
			const ok = await changePrivacyPassword(changeCurrent, changeNew);
			if (!ok) {
				changeError = 'Current password is incorrect.';
				return;
			}
			changeCurrent = '';
			changeNew = '';
			changeConfirm = '';
			changeMessage = 'Password updated.';
		} finally {
			busy = false;
		}
	}

	const inputClass =
		'bg-background text-foreground border-input placeholder:text-muted-foreground focus-visible:ring-ring/50';
</script>

{#snippet serviceIcon(src: string)}
	<img {src} alt="" class="size-4 shrink-0 object-contain" width="16" height="16" />
{/snippet}

<div class="space-y-6">
	<SettingsGroup>
		<SettingsRow
			id="settings-section-pm-enabled"
			label="Privacy mode"
			labelFor="pm-enabled"
			hint={enabled
				? 'On. The site locks with your password when you leave.'
				: 'Lock the site with a password when you leave, and disguise the tab.'}
			inline
		>
			<Switch id="pm-enabled" bind:checked={() => enabled, onEnabledToggle} disabled={busy} />
		</SettingsRow>
	</SettingsGroup>

	{#if enabled}
		<SettingsGroup title="Lock">
			<SettingsRow
				id="settings-section-pm-lock-delay"
				label="Lock after leaving"
				hint="How long you can be away before the password screen."
			>
				<SettingsSelect
					label="Lock after leaving"
					value={draft.value.lockDelay}
					options={LOCK_DELAY_OPTIONS}
					onValueChange={(v) => draft.set('lockDelay', v)}
					disabled={busy}
				/>
			</SettingsRow>

			<SettingsRow id="settings-section-pm-lock-shortcut" label="Lock shortcut">
				{#snippet hint()}
					{#if shortcutError}
						<span class="text-destructive" role="alert">{shortcutError}</span>
					{:else}
						Locks at once, from anywhere except a text field.
					{/if}
				{/snippet}
				<Kbd class="h-8 min-w-12 px-2 text-xs">
					{recordingShortcut
						? 'Press keys…'
						: formatPrivacyLockShortcutLabel(draft.value.lockShortcut)}
				</Kbd>
				<Button
					type="button"
					variant={recordingShortcut ? 'secondary' : 'outline'}
					size="sm"
					disabled={busy}
					aria-pressed={recordingShortcut}
					onclick={() => {
						shortcutError = '';
						recordingShortcut = !recordingShortcut;
					}}
				>
					{recordingShortcut ? 'Cancel' : 'Record'}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={busy || draft.value.lockShortcut === null}
					onclick={() => {
						shortcutError = '';
						draft.set('lockShortcut', null);
					}}
				>
					Clear
				</Button>
			</SettingsRow>

			<SettingsRow
				id="settings-section-pm-pause-game"
				label="Pause game while locked"
				labelFor="pm-pause-game"
				hint="Best effort: some games keep running."
				inline
			>
				<Switch
					id="pm-pause-game"
					bind:checked={() => draft.value.pauseGame, (v) => draft.set('pauseGame', v)}
					disabled={busy}
				/>
			</SettingsRow>
		</SettingsGroup>

		<SettingsGroup title="Disguise">
			<SettingsRow
				id="settings-section-pm-disguise"
				label="Disguise the tab"
				hint={DISGUISE_OPTIONS.find((o) => o.value === draft.value.disguise)?.hint}
			>
				<SettingsSelect
					label="Disguise the tab"
					value={draft.value.disguise}
					options={DISGUISE_OPTIONS}
					onValueChange={(v) => draft.set('disguise', v)}
					disabled={busy}
				/>
			</SettingsRow>

			<SettingsRow
				id="settings-section-pm-disguise-settings"
				label="Look like"
				hint={`The lock screen and tab copy ${activeService.label} (“${activeService.tabTitles[0]}”).`}
			>
				<div class="grid w-full grid-cols-2 gap-2 sm:w-auto">
					<Select.Root
						type="single"
						value={draft.value.provider}
						onValueChange={onProviderChange}
						disabled={busy}
					>
						<Select.Trigger class="w-full sm:w-36" aria-label="Provider">
							<span class="flex min-w-0 items-center gap-2">
								{@render serviceIcon(activeProvider.providerLogo)}
								<span class="truncate">{activeProvider.label}</span>
							</span>
						</Select.Trigger>
						<Select.Content>
							{#each PRIVACY_DISGUISE_PROVIDERS as p (p.id)}
								<Select.Item value={p.id}>
									<span class="flex items-center gap-2">
										{@render serviceIcon(p.providerLogo)}
										{p.label}
									</span>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<Select.Root
						type="single"
						value={draft.value.service}
						onValueChange={(v) => {
							if (v) draft.set('service', v);
						}}
						disabled={busy}
					>
						<Select.Trigger class="w-full sm:w-36" aria-label="Service">
							<span class="flex min-w-0 items-center gap-2">
								{@render serviceIcon(activeService.serviceIcon)}
								<span class="truncate">{activeService.label}</span>
							</span>
						</Select.Trigger>
						<Select.Content>
							{#each serviceOptions as svc (svc.id)}
								<Select.Item value={svc.id}>
									<span class="flex items-center gap-2">
										{@render serviceIcon(svc.serviceIcon)}
										{svc.label}
									</span>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</SettingsRow>
		</SettingsGroup>

		<SettingsAdvanced
			title="Change password"
			hint="Needs the current one."
			anchors={['settings-section-pm-change-password']}
		>
			<form
				id="settings-section-pm-change-password"
				class="grid scroll-mt-4 gap-3 px-4 py-4 sm:grid-cols-3"
				onsubmit={submitChangePassword}
			>
				<div class="space-y-2">
					<Label for="pm-ch-cur">Current</Label>
					<Input
						id="pm-ch-cur"
						type="password"
						bind:value={changeCurrent}
						autocomplete="current-password"
						class={inputClass}
					/>
				</div>
				<div class="space-y-2">
					<Label for="pm-ch-new">New</Label>
					<Input
						id="pm-ch-new"
						type="password"
						bind:value={changeNew}
						autocomplete="new-password"
						class={inputClass}
					/>
				</div>
				<div class="space-y-2">
					<Label for="pm-ch-conf">Confirm new</Label>
					<Input
						id="pm-ch-conf"
						type="password"
						bind:value={changeConfirm}
						autocomplete="new-password"
						class={inputClass}
					/>
				</div>
				<div class="flex flex-wrap items-center gap-3 sm:col-span-3">
					<Button type="submit" variant="secondary" size="sm" disabled={busy}>
						Update password
					</Button>
					{#if changeError}
						<p class="text-xs text-destructive" role="alert">{changeError}</p>
					{:else if changeMessage}
						<p class="text-xs text-muted-foreground" role="status">{changeMessage}</p>
					{/if}
				</div>
			</form>
		</SettingsAdvanced>
	{/if}
</div>

<Dialog.Root
	bind:open={enableOpen}
	onOpenChange={(o) => {
		if (!o) {
			newPassword = '';
			enableError = '';
		}
	}}
>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Turn on privacy mode</Dialog.Title>
			<Dialog.Description>
				Choose a password. You will need it to get back in after the site locks.
			</Dialog.Description>
		</Dialog.Header>
		<form
			class="space-y-2 py-2"
			onsubmit={(e) => {
				e.preventDefault();
				void submitEnable();
			}}
		>
			<Label for="pm-enable-pw">Password</Label>
			<Input
				id="pm-enable-pw"
				type="password"
				bind:value={newPassword}
				autocomplete="new-password"
				class={inputClass}
			/>
			{#if enableError}
				<p class="text-sm text-destructive" role="alert">{enableError}</p>
			{/if}
		</form>
		<Dialog.Footer class="gap-2 sm:gap-2">
			<Button type="button" variant="outline" onclick={() => (enableOpen = false)}>Cancel</Button>
			<Button type="button" onclick={() => void submitEnable()} disabled={busy}>Turn on</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={disableOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Turn off privacy mode?</AlertDialog.Title>
			<AlertDialog.Description>
				The site will no longer ask for your password.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class={cn(buttonVariants({ variant: 'destructive' }))}
				onclick={confirmDisable}
			>
				Turn off
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
