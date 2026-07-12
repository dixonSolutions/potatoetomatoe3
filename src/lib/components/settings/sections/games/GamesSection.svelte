<script lang="ts">
	import Label from '$lib/components/ui/label/label.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Select from '$lib/components/ui/select';
	import { sectionMatches } from '$lib/components/settings/search';
	import {
		getDefaultGamePlayMode,
		saveDefaultGamePlayMode,
		type GamePlayMode
	} from '$lib/utils/game-play-mode';
	import {
		DEFAULT_GAME_PAUSE_SHORTCUT,
		formatGamePauseShortcutLabel,
		getGamePauseShortcut,
		isValidGamePauseShortcut,
		saveGamePauseShortcut,
		type GamePauseShortcut
	} from '$lib/utils/game-pause';
	import { isModifierOnlyKeyboardCode } from '$lib/utils/privacy-mode';
	import {
		getTrayLifecycleState,
		setCloseToTrayEnabled,
		type TrayLifecycleState
	} from '$lib/utils/desktop-tray';
	import { isTauriApp } from '$lib/utils/offline-deployment';
	import { Switch } from '$lib/components/ui/switch';
	import { toast } from 'svelte-sonner';
	import { onMount } from 'svelte';

	let {
		searchQuery,
		busy = false,
		defaultPlayMode = $bindable<GamePlayMode>('online')
	}: {
		searchQuery: string;
		busy?: boolean;
		defaultPlayMode?: GamePlayMode;
	} = $props();

	const OPTIONS: { value: GamePlayMode; label: string; hint: string }[] = [
		{
			value: 'online',
			label: 'Online',
			hint: 'Use the online shell or CDN embed when both versions exist.'
		},
		{
			value: 'offline',
			label: 'Offline',
			hint: 'Prefer bundled or downloaded copies when available.'
		}
	];

	let pauseShortcut = $state<GamePauseShortcut>({ ...DEFAULT_GAME_PAUSE_SHORTCUT });
	let recordingPauseShortcut = $state(false);
	let trayLife = $state<TrayLifecycleState | null>(null);
	let closeToTrayBusy = $state(false);

	function onDefaultChange(value: string | undefined) {
		if (value !== 'online' && value !== 'offline') return;
		defaultPlayMode = value;
		saveDefaultGamePlayMode(value);
	}

	function resetPauseShortcut() {
		pauseShortcut = saveGamePauseShortcut({ ...DEFAULT_GAME_PAUSE_SHORTCUT });
		toast.message('Pause shortcut reset to `');
	}

	async function onCloseToTrayToggle(checked: boolean) {
		closeToTrayBusy = true;
		try {
			const next = await setCloseToTrayEnabled(checked);
			trayLife = { ...(trayLife ?? { trayAvailable: false, closeToTray: false }), closeToTray: next };
			toast.message(
				next
					? 'Closing the window will keep the app in the tray'
					: 'Closing the window will quit the app'
			);
		} finally {
			closeToTrayBusy = false;
		}
	}

	onMount(() => {
		pauseShortcut = getGamePauseShortcut();
		if (isTauriApp()) {
			void getTrayLifecycleState(true).then((s) => {
				trayLife = s;
			});
		}
	});

	$effect(() => {
		defaultPlayMode = getDefaultGamePlayMode();
	});

	$effect(() => {
		if (!recordingPauseShortcut) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				recordingPauseShortcut = false;
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			if (isModifierOnlyKeyboardCode(e.code)) return;
			const next: GamePauseShortcut = {
				code: e.code,
				ctrlKey: e.ctrlKey,
				shiftKey: e.shiftKey,
				altKey: e.altKey,
				metaKey: e.metaKey
			};
			if (!isValidGamePauseShortcut(next)) {
				toast.error('That shortcut is reserved (Ctrl+Shift+, opens settings).');
				recordingPauseShortcut = false;
				return;
			}
			pauseShortcut = saveGamePauseShortcut(next);
			recordingPauseShortcut = false;
			toast.success(`Pause shortcut set to ${formatGamePauseShortcutLabel(next)}`);
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	});
</script>

<div class="space-y-6">
	{#if sectionMatches(searchQuery, 'game play online offline default version unity download')}
		<div id="settings-section-games-default-mode" class="scroll-mt-32 space-y-2">
			<Label>Default play source</Label>
			<p class="text-xs text-muted-foreground">
				When a game offers both online and offline copies, which version loads first. You can still switch per
				game on its detail page.
			</p>
			<Select.Root
				type="single"
				value={defaultPlayMode}
				onValueChange={onDefaultChange}
				disabled={busy}
			>
				<Select.Trigger class="w-full">
					{OPTIONS.find((o) => o.value === defaultPlayMode)?.label ?? 'Choose…'}
				</Select.Trigger>
				<Select.Content>
					{#each OPTIONS as opt}
						<Select.Item value={opt.value}>{opt.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<p class="text-xs text-muted-foreground">
				{OPTIONS.find((o) => o.value === defaultPlayMode)?.hint ?? ''}
			</p>
		</div>
	{/if}

	{#if sectionMatches(searchQuery, 'pause resume shortcut backtick hotkey keyboard game')}
		<div id="settings-section-games-pause-shortcut" class="scroll-mt-32 space-y-3">
			<div>
				<p class="text-sm font-medium">Pause / resume shortcut</p>
				<p class="text-xs text-muted-foreground">
					While a game is playing, press this key to pause or resume (like the console key in Xonotic). Default
					is the backtick <span class="font-mono">`</span>. Ignored while typing in a field.
				</p>
			</div>
			<div
				class="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm {recordingPauseShortcut
					? 'border-primary bg-muted/40'
					: ''}"
			>
				<span class="font-mono text-xs tabular-nums">
					{recordingPauseShortcut
						? 'Press keys… (Esc to cancel)'
						: formatGamePauseShortcutLabel(pauseShortcut)}
				</span>
			</div>
			<div class="flex flex-wrap gap-2">
				<Button
					type="button"
					variant={recordingPauseShortcut ? 'secondary' : 'outline'}
					size="sm"
					disabled={busy}
					onclick={() => {
						recordingPauseShortcut = true;
					}}
				>
					{recordingPauseShortcut ? 'Listening…' : 'Record shortcut'}
				</Button>
				<Button type="button" variant="ghost" size="sm" disabled={busy} onclick={resetPauseShortcut}>
					Reset to `
				</Button>
			</div>
		</div>
	{/if}

	{#if trayLife && sectionMatches(searchQuery, 'tray close quit background gnome silverblue desktop')}
		<div
			id="settings-section-games-close-to-tray"
			class="scroll-mt-32 flex items-start justify-between gap-4 rounded-md bg-muted/30 p-4"
		>
			<div class="min-w-0 space-y-1">
				<Label for="games-close-to-tray" class="text-sm font-medium">Keep running in tray when closing</Label>
				<p class="text-xs text-muted-foreground">
					{#if !trayLife.trayAvailable}
						No system tray was detected. Closing the window always quits. On Fedora Silverblue / GNOME, install
						an AppIndicator extension if you want a tray icon.
					{:else}
						When on, closing the window hides to the tray (puller keeps running). When off, close fully quits —
						recommended on GNOME/Silverblue where tray icons are often invisible. Use <strong>Quit</strong> in
						the top bar anytime.
					{/if}
				</p>
			</div>
			<Switch
				id="games-close-to-tray"
				checked={trayLife.closeToTray}
				disabled={busy || closeToTrayBusy || !trayLife.trayAvailable}
				onCheckedChange={(v) => {
					void onCloseToTrayToggle(Boolean(v));
				}}
				aria-label="Keep running in tray when closing"
			/>
		</div>
	{/if}

	{#if searchQuery.trim() && !sectionMatches(searchQuery, 'game play online offline default version unity download') && !sectionMatches(searchQuery, 'pause resume shortcut backtick hotkey keyboard game') && !sectionMatches(searchQuery, 'tray close quit background gnome silverblue desktop')}
		<p class="py-6 text-center text-xs text-muted-foreground">No options match your search.</p>
	{/if}
</div>
