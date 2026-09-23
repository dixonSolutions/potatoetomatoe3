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
	import {
		DEFAULT_GAME_FULLSCREEN_SHORTCUT,
		formatGameFullscreenShortcutLabel,
		getGameFullscreenShortcut,
		isValidGameFullscreenShortcut,
		saveGameFullscreenShortcut,
		setGameFullscreenShortcutEnabled,
		type GameFullscreenShortcut
	} from '$lib/utils/game-fullscreen';
	import {
		DEFAULT_GAME_PLAYER_SETTINGS,
		getGamePlayerSettings,
		saveGamePlayerSettings,
		type GamePlayerSettings,
		type InGameMenuAccess,
		type InGameMenuButtonSize,
		type InGameMenuCorner
	} from '$lib/utils/game-player-settings';
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

	const ACCESS_OPTIONS: { value: InGameMenuAccess; label: string; hint: string }[] = [
		{
			value: 'button',
			label: 'Menu button',
			hint: 'A small, faint button in a corner of the game. Tap or click it to open the menu.'
		},
		{
			value: 'hover',
			label: 'Hover at the edge',
			hint: 'Nothing over the game. Move the mouse to the edge by the chosen corner to reveal the menu. Touch screens still get the button.'
		},
		{
			value: 'both',
			label: 'Button and hover',
			hint: 'The button, and the menu also opens when the mouse reaches that edge.'
		}
	];

	const SIZE_OPTIONS: { value: InGameMenuButtonSize; label: string }[] = [
		{ value: 'auto', label: 'Auto (small with a mouse, medium on touch)' },
		{ value: 'small', label: 'Small' },
		{ value: 'medium', label: 'Medium' },
		{ value: 'large', label: 'Large' }
	];

	const CORNER_OPTIONS: { value: InGameMenuCorner; label: string }[] = [
		{ value: 'top-left', label: 'Top left' },
		{ value: 'top-right', label: 'Top right' },
		{ value: 'bottom-left', label: 'Bottom left' },
		{ value: 'bottom-right', label: 'Bottom right' }
	];

	/* Search keywords per block; the "nothing matches" note checks all of them. */
	const KW = {
		playSource: 'game play online offline default version unity download',
		fullscreen: 'open games fullscreen full screen auto automatic immersive start',
		menu: 'in-game menu button hover corner position size overlay edge touch fullscreen exit',
		pause: 'pause resume shortcut backtick hotkey keyboard game',
		fullscreenKey: 'fullscreen full screen shortcut hotkey keyboard game f key',
		tray: 'tray close quit background gnome silverblue desktop'
	} as const;
	/* "while playing" names the whole group, so it shows every block in it. */
	const groupHit = $derived(sectionMatches(searchQuery, 'while playing'));
	const show = $derived({
		playSource: sectionMatches(searchQuery, KW.playSource),
		fullscreen: groupHit || sectionMatches(searchQuery, KW.fullscreen),
		menu: groupHit || sectionMatches(searchQuery, KW.menu),
		pause: groupHit || sectionMatches(searchQuery, KW.pause),
		fullscreenKey: groupHit || sectionMatches(searchQuery, KW.fullscreenKey),
		tray: sectionMatches(searchQuery, KW.tray)
	});
	const showPlayer = $derived(show.fullscreen || show.menu || show.pause || show.fullscreenKey);

	let player = $state<GamePlayerSettings>({ ...DEFAULT_GAME_PLAYER_SETTINGS });
	let pauseShortcut = $state<GamePauseShortcut>({ ...DEFAULT_GAME_PAUSE_SHORTCUT });
	let recordingPauseShortcut = $state(false);
	let fullscreenShortcut = $state<GameFullscreenShortcut>({
		...DEFAULT_GAME_FULLSCREEN_SHORTCUT
	});
	let recordingFullscreenShortcut = $state(false);
	let trayLife = $state<TrayLifecycleState | null>(null);
	let closeToTrayBusy = $state(false);

	function onDefaultChange(value: string | undefined) {
		if (value !== 'online' && value !== 'offline') return;
		defaultPlayMode = value;
		saveDefaultGamePlayMode(value);
	}

	function savePlayer(patch: Partial<GamePlayerSettings>) {
		player = saveGamePlayerSettings(patch);
	}

	function resetPauseShortcut() {
		pauseShortcut = saveGamePauseShortcut({ ...DEFAULT_GAME_PAUSE_SHORTCUT });
		toast.message('Pause shortcut reset to `');
	}

	function resetFullscreenShortcut() {
		fullscreenShortcut = saveGameFullscreenShortcut({ ...DEFAULT_GAME_FULLSCREEN_SHORTCUT });
		toast.message('Fullscreen shortcut reset to F');
	}

	function onFullscreenShortcutToggle(on: boolean) {
		player = { ...player, fullscreenShortcutEnabled: setGameFullscreenShortcutEnabled(on) };
		recordingFullscreenShortcut = false;
		if (on && !isValidGameFullscreenShortcut(fullscreenShortcut)) {
			/* The saved key is taken (pause moved onto it meanwhile): pick another one now. */
			recordingFullscreenShortcut = true;
			toast.message(
				`${formatGameFullscreenShortcutLabel(fullscreenShortcut)} is taken — press a new key`
			);
		}
	}

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

	onMount(() => {
		player = getGamePlayerSettings();
		pauseShortcut = getGamePauseShortcut();
		fullscreenShortcut = getGameFullscreenShortcut();
		if (isTauriApp()) {
			void getTrayLifecycleState(true).then((s) => {
				trayLife = s;
			});
		}
	});

	$effect(() => {
		const next = getDefaultGamePlayMode();
		if (defaultPlayMode !== next) defaultPlayMode = next;
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

	$effect(() => {
		if (!recordingFullscreenShortcut) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				recordingFullscreenShortcut = false;
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			if (isModifierOnlyKeyboardCode(e.code)) return;
			const next: GameFullscreenShortcut = {
				code: e.code,
				ctrlKey: e.ctrlKey,
				shiftKey: e.shiftKey,
				altKey: e.altKey,
				metaKey: e.metaKey
			};
			if (!isValidGameFullscreenShortcut(next)) {
				toast.error('That shortcut is already taken (pause, or Ctrl+Shift+, for settings).');
				recordingFullscreenShortcut = false;
				return;
			}
			fullscreenShortcut = saveGameFullscreenShortcut(next);
			recordingFullscreenShortcut = false;
			toast.success(`Fullscreen shortcut set to ${formatGameFullscreenShortcutLabel(next)}`);
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	});
</script>

{#snippet shortcutRecorder(opts: {
	label: string;
	recording: boolean;
	onToggleRecording: () => void;
	resetLabel: string;
	onReset: () => void;
})}
	<div class="flex flex-wrap items-center gap-2">
		<span
			class="inline-flex min-w-16 items-center justify-center rounded-md border border-dashed px-3 py-1.5 font-mono text-xs tabular-nums {opts.recording
				? 'border-primary bg-muted/40'
				: ''}"
		>
			{opts.recording ? 'Press keys…' : opts.label}
		</span>
		<Button
			type="button"
			variant={opts.recording ? 'secondary' : 'outline'}
			size="sm"
			disabled={busy}
			aria-pressed={opts.recording}
			onclick={opts.onToggleRecording}
		>
			{opts.recording ? 'Cancel' : 'Record shortcut'}
		</Button>
		<Button type="button" variant="ghost" size="sm" disabled={busy} onclick={opts.onReset}>
			{opts.resetLabel}
		</Button>
	</div>
{/snippet}

<div class="space-y-6">
	{#if show.playSource}
		<div id="settings-section-games-default-mode" class="scroll-mt-32 space-y-2">
			<Label>Default play source</Label>
			<p class="text-xs text-muted-foreground">
				When a game offers both online and offline copies, which version loads first. You can still
				switch per game on its detail page.
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
					{#each OPTIONS as opt (opt.value)}
						<Select.Item value={opt.value}>{opt.label}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<p class="text-xs text-muted-foreground">
				{OPTIONS.find((o) => o.value === defaultPlayMode)?.hint ?? ''}
			</p>
		</div>
	{/if}

	{#if showPlayer}
		<section
			id="settings-section-games-player"
			class="scroll-mt-32 space-y-5 rounded-lg border p-4"
			aria-labelledby="settings-games-player-title"
		>
			<div>
				<h3 id="settings-games-player-title" class="text-sm font-semibold">While playing</h3>
				<p class="text-xs text-muted-foreground">
					Fullscreen, the in-game menu, and keys that act on the game.
				</p>
			</div>

			{#if show.fullscreen}
				<div
					id="settings-section-games-auto-fullscreen"
					class="flex scroll-mt-32 items-start justify-between gap-4"
				>
					<div class="min-w-0 space-y-1">
						<Label for="games-auto-fullscreen" class="text-sm font-medium"
							>Open games in fullscreen</Label
						>
						<p class="text-xs text-muted-foreground">
							Games fill the screen as soon as they start. Use the in-game menu to leave fullscreen
							or go back to the games.
						</p>
					</div>
					<Switch
						id="games-auto-fullscreen"
						checked={player.autoFullscreen}
						disabled={busy}
						onCheckedChange={(v) => savePlayer({ autoFullscreen: Boolean(v) })}
					/>
				</div>
			{/if}

			{#if show.menu}
				<div id="settings-section-games-menu" class="scroll-mt-32 space-y-3">
					<div>
						<p class="text-sm font-medium">In-game menu</p>
						<p class="text-xs text-muted-foreground">
							The only thing over a fullscreen game: Pause, Restart, Console, Controls, Exit
							fullscreen and Back to games.
						</p>
					</div>
					<div class="space-y-2">
						<div class="flex items-center justify-between gap-3">
							<Label class="text-sm font-normal text-muted-foreground">Show it with</Label>
							<Select.Root
								type="single"
								value={player.menuAccess}
								onValueChange={(v) => v && savePlayer({ menuAccess: v as InGameMenuAccess })}
								disabled={busy}
							>
								<Select.Trigger class="w-44 shrink-0" aria-label="Show in-game menu with">
									{ACCESS_OPTIONS.find((o) => o.value === player.menuAccess)?.label}
								</Select.Trigger>
								<Select.Content>
									{#each ACCESS_OPTIONS as opt (opt.value)}
										<Select.Item value={opt.value}>{opt.label}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
						<p class="text-xs text-muted-foreground">
							{ACCESS_OPTIONS.find((o) => o.value === player.menuAccess)?.hint ?? ''}
						</p>
						<div class="flex items-center justify-between gap-3">
							<Label class="text-sm font-normal text-muted-foreground">Button size</Label>
							<Select.Root
								type="single"
								value={player.menuButtonSize}
								onValueChange={(v) =>
									v && savePlayer({ menuButtonSize: v as InGameMenuButtonSize })}
								disabled={busy}
							>
								<Select.Trigger class="w-44 shrink-0" aria-label="Menu button size">
									{player.menuButtonSize === 'auto'
										? 'Auto'
										: SIZE_OPTIONS.find((o) => o.value === player.menuButtonSize)?.label}
								</Select.Trigger>
								<Select.Content>
									{#each SIZE_OPTIONS as opt (opt.value)}
										<Select.Item value={opt.value}>{opt.label}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
						<div class="flex items-center justify-between gap-3">
							<Label class="text-sm font-normal text-muted-foreground">Corner</Label>
							<Select.Root
								type="single"
								value={player.menuCorner}
								onValueChange={(v) => v && savePlayer({ menuCorner: v as InGameMenuCorner })}
								disabled={busy}
							>
								<Select.Trigger class="w-44 shrink-0" aria-label="Menu corner">
									{CORNER_OPTIONS.find((o) => o.value === player.menuCorner)?.label}
								</Select.Trigger>
								<Select.Content>
									{#each CORNER_OPTIONS as opt (opt.value)}
										<Select.Item value={opt.value}>{opt.label}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					</div>
				</div>
			{/if}

			{#if show.pause}
				<div id="settings-section-games-pause-shortcut" class="scroll-mt-32 space-y-2">
					<div>
						<p class="text-sm font-medium">Pause / resume shortcut</p>
						<p class="text-xs text-muted-foreground">
							Pauses or resumes the game (like the console key in Xonotic). Default is the backtick
							<span class="font-mono">`</span>. Ignored while typing in a field.
						</p>
					</div>
					{@render shortcutRecorder({
						label: formatGamePauseShortcutLabel(pauseShortcut),
						recording: recordingPauseShortcut,
						onToggleRecording: () => (recordingPauseShortcut = !recordingPauseShortcut),
						resetLabel: 'Reset to `',
						onReset: resetPauseShortcut
					})}
				</div>
			{/if}

			{#if show.fullscreenKey}
				<div id="settings-section-games-fullscreen-shortcut" class="scroll-mt-32 space-y-2">
					<div class="flex items-start justify-between gap-4">
						<div class="min-w-0 space-y-1">
							<Label for="games-fullscreen-shortcut" class="text-sm font-medium"
								>Fullscreen shortcut</Label
							>
							<p class="text-xs text-muted-foreground">
								Off by default — plenty of games use <span class="font-mono">F</span> themselves, and
								the in-game menu enters and leaves fullscreen. When on, the key toggles fullscreen except
								while typing in a field.
							</p>
						</div>
						<Switch
							id="games-fullscreen-shortcut"
							checked={player.fullscreenShortcutEnabled}
							disabled={busy}
							onCheckedChange={(v) => onFullscreenShortcutToggle(Boolean(v))}
						/>
					</div>
					{#if player.fullscreenShortcutEnabled}
						{@render shortcutRecorder({
							label: formatGameFullscreenShortcutLabel(fullscreenShortcut),
							recording: recordingFullscreenShortcut,
							onToggleRecording: () => (recordingFullscreenShortcut = !recordingFullscreenShortcut),
							resetLabel: 'Reset to F',
							onReset: resetFullscreenShortcut
						})}
					{/if}
				</div>
			{/if}
		</section>
	{/if}

	{#if trayLife && show.tray}
		<div
			id="settings-section-games-close-to-tray"
			class="flex scroll-mt-32 items-start justify-between gap-4 rounded-md bg-muted/30 p-4"
		>
			<div class="min-w-0 space-y-1">
				<Label for="games-close-to-tray" class="text-sm font-medium"
					>Keep running in tray when closing</Label
				>
				<p class="text-xs text-muted-foreground">
					{#if !trayLife.trayAvailable}
						No system tray was detected. Closing the window always quits. On Fedora Silverblue /
						GNOME, install an AppIndicator extension if you want a tray icon.
					{:else}
						When on, closing the window hides to the tray (puller keeps running). When off, close
						fully quits — recommended on GNOME/Silverblue where tray icons are often invisible. Use <strong
							>Quit</strong
						> in the top bar anytime.
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

	{#if searchQuery.trim() && !show.playSource && !showPlayer && !(trayLife && show.tray)}
		<p class="py-6 text-center text-xs text-muted-foreground">No options match your search.</p>
	{/if}
</div>
