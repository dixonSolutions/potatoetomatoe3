<script lang="ts">
	/**
	 * The player's controls above the game when it is not fullscreen: one compact row of
	 * icon buttons, each named by its tooltip. Console and Controls appear only when they can
	 * do something for this game; logs and the play version / offline copy live under More,
	 * because they are for when something is wrong, not for playing.
	 */
	import Button from '$lib/components/ui/button/button.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import {
		Ellipsis,
		Gamepad2,
		Keyboard,
		Maximize,
		Minimize2,
		Pause,
		Play,
		RotateCcw
	} from 'lucide-svelte';

	let {
		started = false,
		paused = false,
		pauseShortcutLabel = '',
		fullscreen = false,
		/** Empty while the fullscreen shortcut is switched off — then no key is advertised. */
		fullscreenShortcutLabel = '',
		consoleAvailable = false,
		consoleOn = false,
		controlsAvailable = false,
		controlsOpen = false,
		playOptionsOpen = $bindable(false),
		onTogglePause,
		onRestart,
		onToggleFullscreen,
		onToggleConsole,
		onToggleControls,
		onOpenLogs
	}: {
		started?: boolean;
		paused?: boolean;
		pauseShortcutLabel?: string;
		fullscreen?: boolean;
		fullscreenShortcutLabel?: string;
		consoleAvailable?: boolean;
		consoleOn?: boolean;
		controlsAvailable?: boolean;
		controlsOpen?: boolean;
		/** The play version / offline copy panel under the toolbar. */
		playOptionsOpen?: boolean;
		onTogglePause: () => void;
		onRestart: () => void;
		onToggleFullscreen: () => void;
		onToggleConsole: () => void;
		onToggleControls: () => void;
		onOpenLogs: () => void;
	} = $props();

	function withKey(label: string, key: string): string {
		return key ? `${label} (${key})` : label;
	}
</script>

{#snippet action(opts: {
	label: string;
	tip: string;
	icon: typeof Pause;
	onclick: () => void;
	pressed?: boolean;
	disabled?: boolean;
	testid?: string;
	tone?: 'default' | 'on';
	iconClass?: string;
})}
	{@const Icon = opts.icon}
	<Tooltip.Root>
		<Tooltip.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="ghost"
					size="icon"
					class="size-9 shrink-0 {opts.tone === 'on'
						? 'bg-emerald-600 text-white hover:bg-emerald-500 hover:text-white'
						: opts.pressed
							? 'bg-accent text-accent-foreground'
							: ''}"
					aria-label={opts.label}
					aria-pressed={opts.pressed}
					disabled={opts.disabled}
					data-testid={opts.testid}
					onclick={opts.onclick}
				>
					<Icon class="size-[18px] {opts.iconClass ?? ''}" />
				</Button>
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Content side="bottom" sideOffset={6}>{opts.tip}</Tooltip.Content>
	</Tooltip.Root>
{/snippet}

<Tooltip.Provider delayDuration={250}>
	<div
		class="flex shrink-0 items-center gap-0.5 self-start rounded-xl border bg-card p-1 shadow-xs"
		role="toolbar"
		aria-label="Game controls"
		data-testid="game-toolbar"
	>
		{@render action({
			label: paused ? 'Resume' : 'Pause',
			tip: withKey(paused ? 'Resume' : 'Pause', pauseShortcutLabel),
			icon: paused ? Play : Pause,
			iconClass: paused ? 'fill-current' : '',
			onclick: onTogglePause,
			pressed: paused,
			disabled: !started,
			testid: 'pause-game'
		})}
		{@render action({
			label: 'Restart the game',
			tip: 'Restart',
			icon: RotateCcw,
			onclick: onRestart,
			testid: 'relaunch-game'
		})}
		{@render action({
			label: fullscreen ? 'Exit fullscreen' : 'Fullscreen',
			tip: withKey(fullscreen ? 'Exit fullscreen' : 'Fullscreen', fullscreenShortcutLabel),
			icon: fullscreen ? Minimize2 : Maximize,
			onclick: onToggleFullscreen,
			pressed: fullscreen,
			testid: 'game-fullscreen-toggle'
		})}
		{#if consoleAvailable}
			{@render action({
				label: consoleOn ? 'Console on' : 'Console off',
				tip: consoleOn ? 'Touch console: on' : 'Touch console: off',
				icon: Gamepad2,
				onclick: onToggleConsole,
				pressed: consoleOn,
				tone: consoleOn ? 'on' : 'default',
				testid: 'touch-console-toggle'
			})}
		{/if}
		{#if controlsAvailable}
			{@render action({
				label: 'Controls',
				tip: 'Controls — what this game’s keys do',
				icon: Keyboard,
				onclick: onToggleControls,
				pressed: controlsOpen,
				disabled: !started,
				testid: 'controls-menu-toggle'
			})}
		{/if}
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon"
						class="size-9 shrink-0"
						aria-label="More"
						data-testid="game-more-menu"
					>
						<Ellipsis class="size-[18px]" />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" class="w-56">
				<DropdownMenu.CheckboxItem bind:checked={playOptionsOpen} data-testid="play-options-toggle">
					Play version &amp; offline copy
				</DropdownMenu.CheckboxItem>
				<DropdownMenu.Item inset onSelect={onOpenLogs} data-testid="view-logs">
					View logs
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>
</Tooltip.Provider>
