<script lang="ts">
	import { Switch } from '$lib/components/ui/switch';
	import Button from '$lib/components/ui/button/button.svelte';
	import Input from '$lib/components/ui/input/input.svelte';
	import Label from '$lib/components/ui/label/label.svelte';
	import {
		DECOY_TITLES,
		formatPrivacyLockShortcutLabel,
		type PrivacyLockShortcut
	} from '$lib/utils/privacy-mode';
	import type { PrivacyDisguiseMode } from '$lib/utils/site-settings';
	import { sectionMatches } from '$lib/components/settings/search';

	let {
		searchQuery,
		busy = false,
		disguiseChoice = $bindable<PrivacyDisguiseMode>('focus_loss'),
		tabTitleChoice = $bindable<string>(DECOY_TITLES[0]),
		lockDelayStr = $bindable('0'),
		pauseGameWhileLocked = $bindable(false),
		lockShortcutDraft = $bindable<PrivacyLockShortcut | null>(null),
		recordingLockShortcut = $bindable(false),
		changeCurrent = $bindable(''),
		changeNew = $bindable(''),
		changeConfirm = $bindable(''),
		message = '',
		error = '',
		inputClass = '',
		onStartRecordingShortcut,
		onShortcutClearError,
		onRequestDisablePrivacy,
		onSubmitChangePassword
	}: {
		searchQuery: string;
		busy?: boolean;
		disguiseChoice?: PrivacyDisguiseMode;
		tabTitleChoice?: string;
		lockDelayStr?: string;
		pauseGameWhileLocked?: boolean;
		lockShortcutDraft?: PrivacyLockShortcut | null;
		recordingLockShortcut?: boolean;
		changeCurrent?: string;
		changeNew?: string;
		changeConfirm?: string;
		message?: string;
		error?: string;
		inputClass?: string;
		onStartRecordingShortcut?: () => void;
		onShortcutClearError?: () => void;
		onRequestDisablePrivacy?: () => void;
		onSubmitChangePassword?: (e: Event) => void;
	} = $props();

	const LOCK_DELAY_OPTIONS = [
		{ label: 'Immediately', value: 0 },
		{ label: '3 seconds', value: 3 },
		{ label: '5 seconds', value: 5 },
		{ label: '10 seconds', value: 10 },
		{ label: '30 seconds', value: 30 },
		{ label: '1 minute', value: 60 },
		{ label: '2 minutes', value: 120 }
	] as const;

	const DISGUISE_OPTIONS: { label: string; value: PrivacyDisguiseMode; hint: string }[] = [
		{
			label: 'Off',
			value: 'off',
			hint: 'Always use this site’s tab title and icon (even when privacy mode locks the session).'
		},
		{
			label: 'When tab is in the background',
			value: 'focus_loss',
			hint: 'Use the Google Docs tab title and icon when you switch away, and while the session is locked.'
		},
		{
			label: 'Always',
			value: 'always',
			hint: 'Always show the Google Docs tab title and icon whenever privacy mode is on.'
		}
	];

	function shouldShowMessage(m: string): boolean {
		const t = m.trim().toLowerCase();
		if (t.includes('privacy mode is on') || t.includes('privacy mode is off')) return false;
		return m.length > 0;
	}
</script>

<div class="space-y-6">
	{#if sectionMatches(searchQuery, 'disguise google docs tab title icon background lock screen')}
		<div id="settings-section-pm-disguise" class="scroll-mt-32 space-y-2">
			<Label for="pm-disguise">Disguise</Label>
			<p class="text-xs text-muted-foreground">
				When to show the Google Docs tab title and icon. Lock delay still controls when the passcode screen
				appears.
			</p>
			<select
				id="pm-disguise"
				bind:value={disguiseChoice}
				class="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
				disabled={busy}
			>
				{#each DISGUISE_OPTIONS as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>
			<p class="text-xs text-muted-foreground">
				{DISGUISE_OPTIONS.find((o) => o.value === disguiseChoice)?.hint ?? ''}
			</p>
		</div>
	{/if}

	{#if sectionMatches(searchQuery, 'tab title document untitled disguised browser')}
		<div id="settings-section-pm-tab-title" class="scroll-mt-32 space-y-2">
			<Label for="pm-tab-title">Tab title when disguised</Label>
			<p class="text-xs text-muted-foreground">Shown in the browser tab when disguise is active.</p>
			<select
				id="pm-tab-title"
				bind:value={tabTitleChoice}
				class="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
				disabled={busy}
			>
				{#each DECOY_TITLES as t}
					<option value={t}>{t}</option>
				{/each}
			</select>
		</div>
	{/if}

	{#if sectionMatches(searchQuery, 'lock delay seconds away passcode immediately focus')}
		<div id="settings-section-pm-lock-delay" class="scroll-mt-32 space-y-2">
			<Label for="pm-lock-delay">Lock delay</Label>
			<p class="text-xs text-muted-foreground">
				How long you can be away before the passcode screen appears. “Immediately” locks as soon as you leave
				the tab or window loses focus.
			</p>
			<select
				id="pm-lock-delay"
				bind:value={lockDelayStr}
				class="border-input bg-background ring-offset-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
				disabled={busy}
			>
				{#each LOCK_DELAY_OPTIONS as opt}
					<option value={String(opt.value)}>{opt.label}</option>
				{/each}
			</select>
		</div>
	{/if}

	{#if sectionMatches(searchQuery, 'keyboard shortcut hotkey lock privacy')}
		<div id="settings-section-pm-lock-shortcut" class="scroll-mt-32 space-y-3">
			<div>
				<p class="text-sm font-medium">Lock shortcut</p>
				<p class="text-xs text-muted-foreground">
					While privacy mode is on and the session is unlocked, press this combination anywhere on the site to
					show the passcode screen immediately (same as locking). Ignored when typing in a field. Ctrl+Shift+,
					stays reserved for opening settings.
				</p>
			</div>
			<div
				class="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm {recordingLockShortcut
					? 'border-primary bg-muted/40'
					: ''}"
			>
				<span class="font-mono text-xs tabular-nums">
					{recordingLockShortcut
						? 'Press keys… (Esc to cancel)'
						: formatPrivacyLockShortcutLabel(lockShortcutDraft)}
				</span>
			</div>
			<div class="flex flex-wrap gap-2">
				<Button
					type="button"
					variant={recordingLockShortcut ? 'secondary' : 'outline'}
					size="sm"
					disabled={busy}
					onclick={() => onStartRecordingShortcut?.()}
				>
					{recordingLockShortcut ? 'Listening…' : 'Record shortcut'}
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={busy || lockShortcutDraft === null}
					onclick={() => {
						lockShortcutDraft = null;
						onShortcutClearError?.();
					}}
				>
					Clear
				</Button>
			</div>
		</div>
	{/if}

	{#if sectionMatches(searchQuery, 'pause game iframe overlay screen hide')}
		<div
			id="settings-section-pm-pause-game"
			class="scroll-mt-32 flex items-start justify-between gap-4 rounded-md border p-4"
		>
			<div class="min-w-0 space-y-1">
				<Label for="pm-pause-game" class="text-sm font-medium">Pause game while privacy screen is shown</Label>
				<p class="text-xs text-muted-foreground">
					Hides the game iframe under the lock overlay so it is less likely to keep running in the foreground.
					Cross-origin games may still use CPU; this is best-effort.
				</p>
			</div>
			<Switch
				id="pm-pause-game"
				bind:checked={pauseGameWhileLocked}
				disabled={busy}
				aria-label="Pause game while privacy screen is shown"
			/>
		</div>
	{/if}

	{#if sectionMatches(searchQuery, 'turn off disable privacy remove passcode protection')}
		<div
			id="settings-section-pm-turn-off"
			class="scroll-mt-32 space-y-2 rounded-md border border-destructive/30 p-4"
		>
			<p class="text-sm font-medium text-destructive">Turn off privacy mode</p>
			<p class="text-xs text-muted-foreground">Removes passcode protection for this site.</p>
			<Button type="button" variant="destructive" onclick={() => onRequestDisablePrivacy?.()} disabled={busy}>
				Turn off
			</Button>
		</div>
	{/if}

	{#if sectionMatches(searchQuery, 'change password current new update')}
		<form
			id="settings-section-pm-change-password"
			class="scroll-mt-32 space-y-3 border-t pt-4"
			onsubmit={onSubmitChangePassword}
		>
			<p class="text-sm font-medium">Change password</p>
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
				<Input id="pm-ch-new" type="password" bind:value={changeNew} autocomplete="new-password" class={inputClass} />
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
			<Button type="submit" variant="secondary" disabled={busy}>Update password</Button>
		</form>
	{/if}

	{#if searchQuery.trim() && !sectionMatches(searchQuery, 'disguise google docs tab title icon background lock screen') && !sectionMatches(searchQuery, 'tab title document untitled disguised browser') && !sectionMatches(searchQuery, 'lock delay seconds away passcode immediately focus') && !sectionMatches(searchQuery, 'keyboard shortcut hotkey lock privacy') && !sectionMatches(searchQuery, 'pause game iframe overlay screen hide') && !sectionMatches(searchQuery, 'turn off disable privacy remove passcode protection') && !sectionMatches(searchQuery, 'change password current new update')}
		<p class="py-6 text-center text-xs text-muted-foreground">No options match your search.</p>
	{/if}

	{#if shouldShowMessage(message)}
		<p class="text-sm text-muted-foreground">{message}</p>
	{/if}
	{#if error}
		<p class="text-sm text-destructive">{error}</p>
	{/if}
</div>
