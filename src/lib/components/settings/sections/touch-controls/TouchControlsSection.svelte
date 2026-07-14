<script lang="ts">
	import Label from '$lib/components/ui/label/label.svelte';
	import Button from '$lib/components/ui/button/button.svelte';
	import { Switch } from '$lib/components/ui/switch';
	import * as Select from '$lib/components/ui/select';
	import * as Tabs from '$lib/components/ui/tabs';
	import { sectionMatches } from '$lib/components/settings/search';
	import TouchConsolePreview from './TouchConsolePreview.svelte';
	import { toast } from 'svelte-sonner';
	import { isModifierOnlyKeyboardCode } from '$lib/utils/privacy-mode';
	import {
		DEFAULT_TOUCH_MAPPING,
		codesToLabel,
		getDefaultTouchLayout,
		loadTouchConsoleSettings,
		translateTouchLayout,
		type TouchAvailability,
		type TouchConsoleSettings,
		type TouchDirection,
		type TouchKeyMapping,
		type TouchLayout,
		type TouchOrientation
	} from '$lib/utils/touch-console';

	let {
		searchQuery,
		busy = false,
		settings = $bindable(loadTouchConsoleSettings())
	}: {
		searchQuery: string;
		busy?: boolean;
		settings?: TouchConsoleSettings;
	} = $props();

	let orientationTab = $state<TouchOrientation>('landscape');
	let recordingTarget = $state<'up' | 'down' | 'left' | 'right' | 'a' | 'b' | 'x' | 'y' | null>(
		null
	);
	let previewDrag = $state<{
		id: string;
		startX: number;
		startY: number;
		origin: TouchLayout;
	} | null>(null);

	const AVAILABILITY: { value: TouchAvailability; label: string; hint: string }[] = [
		{
			value: 'auto',
			label: 'Auto (mobile)',
			hint: 'Show the toggle on compact/mobile viewports and when a game is injectable.'
		},
		{
			value: 'always',
			label: 'Always',
			hint: 'Always show the touch-controls toggle on game pages (desktop included).'
		},
		{
			value: 'off',
			label: 'Off',
			hint: 'Hide the overlay entirely until you turn it back on here.'
		}
	];

	function persistPatch(patch: Partial<TouchConsoleSettings>, message?: string) {
		settings = { ...settings, ...patch, version: 1 };
		if (message) toast.message(message);
	}

	function currentLayout(): TouchLayout {
		return settings.layouts[orientationTab];
	}

	function updateLayout(next: TouchLayout, message?: string) {
		settings = {
			...settings,
			layouts: { ...settings.layouts, [orientationTab]: next }
		};
		if (message) toast.message(message);
	}

	function onSizeChange(kind: 'joystick' | string, size: number) {
		const layout = structuredClone(currentLayout());
		if (kind === 'joystick') {
			layout.joystick.size = size;
		} else {
			layout.buttons = layout.buttons.map((b) => (b.id === kind ? { ...b, size } : b));
		}
		updateLayout(layout);
	}

	function startPreviewDrag(id: string, e: PointerEvent) {
		e.preventDefault();
		const origin = structuredClone(currentLayout());
		previewDrag = { id, startX: e.clientX, startY: e.clientY, origin };
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
	}

	function movePreviewDrag(e: PointerEvent, box: HTMLElement) {
		if (!previewDrag) return;
		const rect = box.getBoundingClientRect();
		const dxPct = (e.clientX - previewDrag.startX) / rect.width;
		const dyPct = (e.clientY - previewDrag.startY) / rect.height;
		const next = structuredClone(previewDrag.origin);
		const clamp = (n: number) => Math.max(0, Math.min(0.92, n));
		if (previewDrag.id === 'joystick') {
			next.joystick.xPct = clamp(previewDrag.origin.joystick.xPct + dxPct);
			next.joystick.yPct = clamp(previewDrag.origin.joystick.yPct + dyPct);
		} else if (previewDrag.id === 'console') {
			const translated = translateTouchLayout(previewDrag.origin, dxPct, dyPct);
			next.console = translated.console;
			next.joystick = translated.joystick;
			next.buttons = translated.buttons;
		} else {
			next.buttons = next.buttons.map((b) => {
				if (b.id !== previewDrag!.id) return b;
				const ob = previewDrag!.origin.buttons.find((x) => x.id === b.id)!;
				return { ...b, xPct: clamp(ob.xPct + dxPct), yPct: clamp(ob.yPct + dyPct) };
			});
		}
		settings = {
			...settings,
			layouts: { ...settings.layouts, [orientationTab]: next }
		};
	}

	function endPreviewDrag() {
		if (!previewDrag) return;
		updateLayout(settings.layouts[orientationTab], 'Layout updated');
		previewDrag = null;
	}

	function mappingCodes(target: NonNullable<typeof recordingTarget>): string[] {
		if (target === 'up' || target === 'down' || target === 'left' || target === 'right') {
			return settings.mapping.directions[target];
		}
		return settings.mapping.buttons[target] ?? [];
	}

	function setMappingCodes(target: NonNullable<typeof recordingTarget>, codes: string[]) {
		const mapping: TouchKeyMapping = structuredClone(settings.mapping);
		if (target === 'up' || target === 'down' || target === 'left' || target === 'right') {
			mapping.directions[target as TouchDirection] = codes;
		} else {
			mapping.buttons[target] = codes;
		}
		settings = { ...settings, mapping };
		toast.success(`${target.toUpperCase()} → ${codesToLabel(codes)}`);
	}

	$effect(() => {
		if (!recordingTarget) return;
		const target = recordingTarget;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				recordingTarget = null;
				return;
			}
			e.preventDefault();
			e.stopPropagation();
			if (isModifierOnlyKeyboardCode(e.code)) return;
			setMappingCodes(target, [e.code]);
			recordingTarget = null;
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	});
</script>

<div
	class="space-y-6 xl:grid xl:grid-cols-[minmax(20rem,0.9fr)_minmax(0,1.1fr)] xl:items-start xl:gap-8 xl:space-y-0"
>
	<div
		id="settings-section-touch-preview"
		class="space-y-3 xl:sticky xl:top-0 xl:z-20 xl:rounded-lg xl:border xl:bg-card xl:p-4 xl:shadow-sm"
	>
		<div>
			<p class="text-sm font-medium">Live preview</p>
			<p class="text-xs text-muted-foreground">
				This preview uses the same joystick and action-button components as the in-game console.
				Unsaved size, scale, opacity, and layout changes appear here immediately.
			</p>
		</div>
		<div class="flex items-center gap-2">
			<Tabs.Root
				value={orientationTab}
				onValueChange={(v) => {
					if (v === 'landscape' || v === 'portrait') orientationTab = v;
				}}
			>
				<Tabs.List class="grid w-full grid-cols-2">
					<Tabs.Trigger value="landscape">Landscape</Tabs.Trigger>
					<Tabs.Trigger value="portrait">Portrait</Tabs.Trigger>
				</Tabs.List>
			</Tabs.Root>
		</div>
		<TouchConsolePreview
			layout={currentLayout()}
			opacity={settings.opacity}
			scale={settings.scale}
			orientation={orientationTab}
			onStartDrag={startPreviewDrag}
			onMoveDrag={(e, box) => movePreviewDrag(e, box)}
			onEndDrag={endPreviewDrag}
		/>
	</div>

	<div class="space-y-6">
		{#if sectionMatches(searchQuery, 'touch enable overlay mobile gamepad console joystick virtual controller')}
			<div
				id="settings-section-touch-enabled"
				class="flex scroll-mt-32 items-start justify-between gap-4 rounded-md bg-muted/30 p-4"
			>
				<div class="min-w-0 space-y-1">
					<Label for="touch-enabled" class="text-sm font-medium">Enable touch console</Label>
					<p class="text-xs text-muted-foreground">
						Glass on-screen joystick and buttons for mobile play. Inputs are injected only into
						same-origin or proxied Unity play iframes (offline mirror, local puller + Pages
						service-worker relay, or play proxy). Online portal shells that only wrap an external
						embed cannot receive controls.
					</p>
				</div>
				<Switch
					id="touch-enabled"
					checked={settings.enabled}
					disabled={busy}
					onCheckedChange={(v) =>
						persistPatch({ enabled: Boolean(v) }, v ? 'Touch console on' : 'Touch console off')}
					aria-label="Enable touch console"
				/>
			</div>
		{/if}

		{#if sectionMatches(searchQuery, 'touch availability auto always off mobile desktop')}
			<div id="settings-section-touch-availability" class="scroll-mt-32 space-y-2">
				<Label>When to show the toggle</Label>
				<p class="text-xs text-muted-foreground">The in-game Gamepad button toggles the overlay.</p>
				<Select.Root
					type="single"
					value={settings.availability}
					onValueChange={(v) => {
						if (v === 'auto' || v === 'always' || v === 'off') {
							persistPatch({ availability: v });
						}
					}}
					disabled={busy}
				>
					<Select.Trigger class="w-full">
						{AVAILABILITY.find((o) => o.value === settings.availability)?.label ?? 'Choose…'}
					</Select.Trigger>
					<Select.Content>
						{#each AVAILABILITY as opt (opt.value)}
							<Select.Item value={opt.value}>{opt.label}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<p class="text-xs text-muted-foreground">
					{AVAILABILITY.find((o) => o.value === settings.availability)?.hint ?? ''}
				</p>
			</div>
		{/if}

		{#if sectionMatches(searchQuery, 'touch auto enable default keyboard screen touch-only tablet')}
			<div
				id="settings-section-touch-auto-enable"
				class="flex items-start justify-between gap-4 rounded-md bg-muted/30 p-4"
			>
				<div class="min-w-0 space-y-1">
					<Label for="touch-auto-enable" class="text-sm font-medium"
						>Auto-enable on touch-only devices</Label
					>
					<p class="text-xs text-muted-foreground">
						Open the console by default on screen-first devices where the browser reports touch
						input, a coarse pointer, and no hover-capable input. Devices with keyboards keep it off
						until enabled.
					</p>
				</div>
				<Switch
					id="touch-auto-enable"
					checked={settings.autoEnableOnTouchOnly}
					disabled={busy}
					onCheckedChange={(v) =>
						persistPatch(
							{ autoEnableOnTouchOnly: Boolean(v) },
							v ? 'Touch console auto-enable on' : 'Touch console auto-enable off'
						)}
					aria-label="Auto-enable touch console on touch-only devices"
				/>
			</div>
		{/if}

		{#if sectionMatches(searchQuery, 'touch opacity scale size haptics vibration appearance')}
			<div id="settings-section-touch-appearance" class="scroll-mt-32 space-y-4">
				<div>
					<p class="text-sm font-medium">Appearance</p>
					<p class="text-xs text-muted-foreground">
						Opacity, overall scale, and optional haptic taps.
					</p>
				</div>
				<div class="space-y-2">
					<Label for="touch-opacity">Opacity ({Math.round(settings.opacity * 100)}%)</Label>
					<input
						id="touch-opacity"
						type="range"
						min="20"
						max="100"
						step="1"
						value={Math.round(settings.opacity * 100)}
						disabled={busy}
						class="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed disabled:opacity-50"
						oninput={(e) =>
							persistPatch({ opacity: Number((e.currentTarget as HTMLInputElement).value) / 100 })}
					/>
				</div>
				<div class="space-y-2">
					<Label for="touch-scale">Scale ({Math.round(settings.scale * 100)}%)</Label>
					<input
						id="touch-scale"
						type="range"
						min="60"
						max="160"
						step="5"
						value={Math.round(settings.scale * 100)}
						disabled={busy}
						class="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed disabled:opacity-50"
						oninput={(e) =>
							persistPatch({ scale: Number((e.currentTarget as HTMLInputElement).value) / 100 })}
					/>
				</div>
				<div class="flex items-start justify-between gap-4 rounded-md bg-muted/30 p-4">
					<div class="min-w-0 space-y-1">
						<Label for="touch-haptics" class="text-sm font-medium">Haptic feedback</Label>
						<p class="text-xs text-muted-foreground">
							Short vibration on button press (where supported).
						</p>
					</div>
					<Switch
						id="touch-haptics"
						checked={settings.haptics}
						disabled={busy}
						onCheckedChange={(v) => persistPatch({ haptics: Boolean(v) })}
						aria-label="Haptic feedback"
					/>
				</div>
			</div>
		{/if}

		{#if sectionMatches(searchQuery, 'touch layout landscape portrait position size drag preview reset copy')}
			<div id="settings-section-touch-layout" class="scroll-mt-32 space-y-3">
				<div>
					<p class="text-sm font-medium">Layout</p>
					<p class="text-xs text-muted-foreground">
						Drag controls in the preview (no hold needed). Separate profiles for landscape and
						portrait. In-game, hold a control for 2 seconds to reposition.
					</p>
				</div>

				<div class="space-y-2">
					<p class="text-xs font-medium text-muted-foreground">
						{orientationTab === 'portrait' ? 'Portrait' : 'Landscape'} control sizes
					</p>
					<Label for="joy-size-{orientationTab}">
						Joystick size ({currentLayout().joystick.size}px)
					</Label>
					<input
						id="joy-size-{orientationTab}"
						type="range"
						min="60"
						max="160"
						step="2"
						value={currentLayout().joystick.size}
						disabled={busy}
						class="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
						oninput={(e) =>
							onSizeChange('joystick', Number((e.currentTarget as HTMLInputElement).value))}
					/>
				</div>
				{#each currentLayout().buttons as btn (btn.id)}
					<div class="space-y-2">
						<Label for="btn-size-{orientationTab}-{btn.id}">Button {btn.label} ({btn.size}px)</Label
						>
						<input
							id="btn-size-{orientationTab}-{btn.id}"
							type="range"
							min="36"
							max="96"
							step="2"
							value={btn.size}
							disabled={busy}
							class="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary"
							oninput={(e) =>
								onSizeChange(btn.id, Number((e.currentTarget as HTMLInputElement).value))}
						/>
					</div>
				{/each}

				<div class="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={busy}
						onclick={() => {
							const copied = structuredClone(settings.layouts.landscape);
							copied.console.yPct = Math.max(copied.console.yPct, 0.62);
							settings = {
								...settings,
								layouts: { ...settings.layouts, portrait: copied }
							};
							toast.message('Copied landscape → portrait');
						}}
					>
						Copy landscape → portrait
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={busy}
						onclick={() => {
							settings = {
								...settings,
								layouts: {
									...settings.layouts,
									[orientationTab]: getDefaultTouchLayout(orientationTab)
								}
							};
							toast.message(`Reset ${orientationTab} layout`);
						}}
					>
						Reset {orientationTab}
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						disabled={busy}
						onclick={() => {
							settings = {
								...settings,
								layouts: {
									landscape: getDefaultTouchLayout('landscape'),
									portrait: getDefaultTouchLayout('portrait')
								}
							};
							toast.message('Reset both layouts');
						}}
					>
						Reset all layouts
					</Button>
				</div>
			</div>
		{/if}

		{#if sectionMatches(searchQuery, 'touch mapping keys remap arrows wasd space enter escape button binding')}
			<div id="settings-section-touch-mapping" class="scroll-mt-32 space-y-3">
				<div>
					<p class="text-sm font-medium">Key mapping</p>
					<p class="text-xs text-muted-foreground">
						Default is Arrows + WASD for the stick, Space / Enter / Shift / Esc for A / B / X / Y.
						Record a new key for any action.
					</p>
				</div>

				<div class="space-y-2">
					{#each ['up', 'down', 'left', 'right'] as const as dir (dir)}
						<div
							class="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2"
						>
							<span class="w-14 text-xs font-medium text-muted-foreground uppercase">{dir}</span>
							<span class="flex-1 font-mono text-xs tabular-nums">
								{recordingTarget === dir
									? 'Press a key… (Esc cancel)'
									: codesToLabel(mappingCodes(dir))}
							</span>
							<Button
								type="button"
								variant={recordingTarget === dir ? 'secondary' : 'outline'}
								size="sm"
								disabled={busy}
								onclick={() => (recordingTarget = dir)}
							>
								{recordingTarget === dir ? 'Listening…' : 'Record'}
							</Button>
						</div>
					{/each}
					{#each ['a', 'b', 'x', 'y'] as const as btn (btn)}
						<div
							class="flex flex-wrap items-center gap-2 rounded-md border border-dashed px-3 py-2"
						>
							<span class="w-14 text-xs font-medium text-muted-foreground uppercase">Btn {btn}</span
							>
							<span class="flex-1 font-mono text-xs tabular-nums">
								{recordingTarget === btn
									? 'Press a key… (Esc cancel)'
									: codesToLabel(mappingCodes(btn))}
							</span>
							<Button
								type="button"
								variant={recordingTarget === btn ? 'secondary' : 'outline'}
								size="sm"
								disabled={busy}
								onclick={() => (recordingTarget = btn)}
							>
								{recordingTarget === btn ? 'Listening…' : 'Record'}
							</Button>
						</div>
					{/each}
				</div>

				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={busy}
					onclick={() => {
						settings = { ...settings, mapping: structuredClone(DEFAULT_TOUCH_MAPPING) };
						toast.message(
							`Mapping reset to ${codesToLabel(DEFAULT_TOUCH_MAPPING.directions.up)} / Space…`
						);
					}}
				>
					Reset mapping defaults
				</Button>
			</div>
		{/if}

		{#if searchQuery.trim() && !sectionMatches(searchQuery, 'touch enable overlay mobile gamepad console joystick virtual controller') && !sectionMatches(searchQuery, 'touch availability auto always off mobile desktop') && !sectionMatches(searchQuery, 'touch auto enable default keyboard screen touch-only tablet') && !sectionMatches(searchQuery, 'touch opacity scale size haptics vibration appearance') && !sectionMatches(searchQuery, 'touch layout landscape portrait position size drag preview reset copy') && !sectionMatches(searchQuery, 'touch mapping keys remap arrows wasd space enter escape button binding')}
			<p class="py-6 text-center text-xs text-muted-foreground">No options match your search.</p>
		{/if}
	</div>
</div>
