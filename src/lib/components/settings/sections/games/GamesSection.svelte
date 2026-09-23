<script lang="ts">
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Kbd } from '$lib/components/ui/kbd';
	import { Switch } from '$lib/components/ui/switch';
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
		displayScaleHint,
		fetchDisplayScaleStatus,
		fetchFullSpeedStatus,
		fullSpeedHint,
		syncFullSpeedSetting,
		webkitTuningSupported,
		type DisplayScaleStatus,
		type FullSpeedStatus
	} from '$lib/utils/webkit-tuning';
	import SettingsAdvanced from '../../shared/SettingsAdvanced.svelte';
	import SettingsGroup from '../../shared/SettingsGroup.svelte';
	import SettingsRow from '../../shared/SettingsRow.svelte';
	import SettingsSelect from '../../shared/SettingsSelect.svelte';

	/*
	 * Playing: how a game opens and what sits over it. Everything here applies at once;
	 * there is nothing to Save.
	 */

	const PLAY_SOURCE_OPTIONS: { value: GamePlayMode; label: string; hint: string }[] = [
		{ value: 'online', label: 'Online', hint: 'The online copy loads first when both exist.' },
		{ value: 'offline', label: 'Offline', hint: 'A downloaded or bundled copy loads first.' }
	];

	const ACCESS_OPTIONS: { value: InGameMenuAccess; label: string; hint: string }[] = [
		{ value: 'button', label: 'A menu button', hint: 'A small, faint button in a corner.' },
		{
			value: 'hover',
			label: 'Hovering the edge',
			hint: 'Move the mouse to the edge by the corner. Touch keeps the button.'
		},
		{ value: 'both', label: 'Button and hover', hint: 'The button, and the edge opens it too.' }
	];

	const SIZE_OPTIONS: { value: InGameMenuButtonSize; label: string }[] = [
		{ value: 'auto', label: 'Auto' },
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

	let player = $state<GamePlayerSettings>({ ...DEFAULT_GAME_PLAYER_SETTINGS });
	let playSource = $state<GamePlayMode>('online');
	let pauseShortcut = $state<GamePauseShortcut>({ ...DEFAULT_GAME_PAUSE_SHORTCUT });
	let recordingPauseShortcut = $state(false);
	let fullscreenShortcut = $state<GameFullscreenShortcut>({
		...DEFAULT_GAME_FULLSCREEN_SHORTCUT
	});
	let recordingFullscreenShortcut = $state(false);
	/* Linux desktop app only: WebKitGTK tunings (src-tauri/src/game_frame_tuning.rs). */
	let tuningSupported = $state(false);
	let fullSpeedStatus = $state<FullSpeedStatus | null>(null);
	let displayStatus = $state<DisplayScaleStatus | null>(null);

	function savePlayer(patch: Partial<GamePlayerSettings>) {
		player = saveGamePlayerSettings(patch);
	}

	function onFullSpeedToggle(on: boolean) {
		savePlayer({ fullSpeedInPowerSaver: on });
		void syncFullSpeedSetting(on);
	}

	async function loadTuningStatus() {
		tuningSupported = await webkitTuningSupported();
		if (!tuningSupported) return;
		[fullSpeedStatus, displayStatus] = await Promise.all([
			fetchFullSpeedStatus(),
			fetchDisplayScaleStatus()
		]);
	}

	function onPlaySourceChange(value: GamePlayMode) {
		playSource = value;
		saveDefaultGamePlayMode(value);
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

	onMount(() => {
		player = getGamePlayerSettings();
		playSource = getDefaultGamePlayMode();
		pauseShortcut = getGamePauseShortcut();
		fullscreenShortcut = getGameFullscreenShortcut();
		void loadTuningStatus();
	});

	/** Capture the next non-modifier key while `recording` is on; Escape cancels. */
	function recordKey(
		recording: boolean,
		stop: () => void,
		accept: (s: GamePauseShortcut) => void
	): (() => void) | undefined {
		if (!recording) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				stop();
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			if (isModifierOnlyKeyboardCode(e.code)) return;
			accept({
				code: e.code,
				ctrlKey: e.ctrlKey,
				shiftKey: e.shiftKey,
				altKey: e.altKey,
				metaKey: e.metaKey
			});
			stop();
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	}

	$effect(() =>
		recordKey(
			recordingPauseShortcut,
			() => (recordingPauseShortcut = false),
			(next) => {
				if (!isValidGamePauseShortcut(next)) {
					toast.error('That shortcut is reserved (Ctrl+Shift+, opens settings).');
					return;
				}
				pauseShortcut = saveGamePauseShortcut(next);
				toast.success(`Pause shortcut set to ${formatGamePauseShortcutLabel(next)}`);
			}
		)
	);

	$effect(() =>
		recordKey(
			recordingFullscreenShortcut,
			() => (recordingFullscreenShortcut = false),
			(next) => {
				if (!isValidGameFullscreenShortcut(next)) {
					toast.error('That shortcut is already taken (pause, or Ctrl+Shift+, for settings).');
					return;
				}
				fullscreenShortcut = saveGameFullscreenShortcut(next);
				toast.success(`Fullscreen shortcut set to ${formatGameFullscreenShortcutLabel(next)}`);
			}
		)
	);
</script>

{#snippet recorder(opts: {
	label: string;
	recording: boolean;
	onToggle: () => void;
	resetLabel: string;
	onReset: () => void;
})}
	<Kbd class="h-8 min-w-12 px-2 text-xs">{opts.recording ? 'Press keys…' : opts.label}</Kbd>
	<Button
		type="button"
		variant={opts.recording ? 'secondary' : 'outline'}
		size="sm"
		aria-pressed={opts.recording}
		onclick={opts.onToggle}
	>
		{opts.recording ? 'Cancel' : 'Record'}
	</Button>
	<Button type="button" variant="ghost" size="sm" onclick={opts.onReset}>{opts.resetLabel}</Button>
{/snippet}

<div class="space-y-6">
	<SettingsGroup>
		<SettingsRow
			id="settings-section-games-auto-fullscreen"
			label="Open games in fullscreen"
			labelFor="games-auto-fullscreen"
			hint="Games fill the screen as soon as they start."
			inline
		>
			<Switch
				id="games-auto-fullscreen"
				checked={player.autoFullscreen}
				onCheckedChange={(v) => savePlayer({ autoFullscreen: Boolean(v) })}
			/>
		</SettingsRow>
		<SettingsRow
			id="settings-section-games-menu"
			label="In-game menu"
			hint={ACCESS_OPTIONS.find((o) => o.value === player.menuAccess)?.hint}
		>
			<SettingsSelect
				label="Show the in-game menu with"
				value={player.menuAccess}
				options={ACCESS_OPTIONS}
				onValueChange={(v) => savePlayer({ menuAccess: v })}
			/>
		</SettingsRow>
		<SettingsRow
			id="settings-section-games-default-mode"
			label="Play source"
			hint={PLAY_SOURCE_OPTIONS.find((o) => o.value === playSource)?.hint}
		>
			<SettingsSelect
				label="Play source"
				value={playSource}
				options={PLAY_SOURCE_OPTIONS}
				onValueChange={onPlaySourceChange}
			/>
		</SettingsRow>
	</SettingsGroup>

	{#if tuningSupported}
		<SettingsGroup title="Performance">
			<SettingsRow
				id="settings-section-games-full-speed"
				label="Full frame rate in power saver"
				labelFor="games-full-speed"
				hint={fullSpeedHint(player.fullSpeedInPowerSaver, fullSpeedStatus)}
				inline
			>
				<Switch
					id="games-full-speed"
					checked={player.fullSpeedInPowerSaver}
					onCheckedChange={(v) => onFullSpeedToggle(Boolean(v))}
				/>
			</SettingsRow>
		</SettingsGroup>
	{/if}

	<SettingsGroup title="Shortcuts">
		<SettingsRow
			id="settings-section-games-pause-shortcut"
			label="Pause and resume"
			hint="Works while a game is open, except in a text field."
		>
			{@render recorder({
				label: formatGamePauseShortcutLabel(pauseShortcut),
				recording: recordingPauseShortcut,
				onToggle: () => (recordingPauseShortcut = !recordingPauseShortcut),
				resetLabel: 'Reset to `',
				onReset: resetPauseShortcut
			})}
		</SettingsRow>
		<SettingsRow
			id="settings-section-games-fullscreen-shortcut"
			label="Fullscreen shortcut"
			labelFor="games-fullscreen-shortcut"
			hint={player.fullscreenShortcutEnabled
				? 'Toggles fullscreen while a game is open, except in a text field.'
				: 'Off by default: many games use F, and the in-game menu does this.'}
			inline
		>
			<Switch
				id="games-fullscreen-shortcut"
				checked={player.fullscreenShortcutEnabled}
				onCheckedChange={(v) => onFullscreenShortcutToggle(Boolean(v))}
			/>
			{#snippet below()}
				{#if player.fullscreenShortcutEnabled}
					<div class="flex flex-wrap items-center gap-2">
						{@render recorder({
							label: formatGameFullscreenShortcutLabel(fullscreenShortcut),
							recording: recordingFullscreenShortcut,
							onToggle: () => (recordingFullscreenShortcut = !recordingFullscreenShortcut),
							resetLabel: 'Reset to F',
							onReset: resetFullscreenShortcut
						})}
					</div>
				{/if}
			{/snippet}
		</SettingsRow>
	</SettingsGroup>

	<SettingsAdvanced
		title="Menu button"
		hint="Size and corner of the in-game menu button."
		anchors={['settings-section-games-menu-button']}
	>
		<SettingsRow
			id="settings-section-games-menu-button"
			label="Size"
			hint="Auto is small with a mouse and medium on touch."
		>
			<SettingsSelect
				label="Menu button size"
				value={player.menuButtonSize}
				options={SIZE_OPTIONS}
				onValueChange={(v) => savePlayer({ menuButtonSize: v })}
			/>
		</SettingsRow>
		<SettingsRow label="Corner" hint="Where the button sits, and where hovering opens the menu.">
			<SettingsSelect
				label="Menu corner"
				value={player.menuCorner}
				options={CORNER_OPTIONS}
				onValueChange={(v) => savePlayer({ menuCorner: v })}
			/>
		</SettingsRow>
	</SettingsAdvanced>

	{#if tuningSupported}
		<SettingsAdvanced
			title="Game resolution"
			hint="How games draw on a display with fractional scaling."
			anchors={['settings-section-games-display-scale']}
		>
			<SettingsRow
				id="settings-section-games-display-scale"
				label="Render games at your display's scale (faster)"
				labelFor="games-display-scale"
				hint={displayScaleHint(displayStatus)}
				inline
			>
				<Switch
					id="games-display-scale"
					checked={player.renderAtDisplayScale}
					onCheckedChange={(v) => savePlayer({ renderAtDisplayScale: Boolean(v) })}
				/>
			</SettingsRow>
		</SettingsAdvanced>
	{/if}
</div>
