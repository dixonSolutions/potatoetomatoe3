<script lang="ts">
	import Button from '$lib/components/ui/button/button.svelte';
	import { Kbd } from '$lib/components/ui/kbd';
	import { Switch } from '$lib/components/ui/switch';
	import * as Tabs from '$lib/components/ui/tabs';
	import { isLocalAppDeployment } from '$lib/utils/offline-deployment';
	import { isModifierOnlyKeyboardCode } from '$lib/utils/privacy-mode';
	import {
		DEFAULT_TOUCH_MAPPING,
		codesToLabel,
		getDefaultTouchLayout,
		loadTouchConsoleSettings,
		patchTouchConsoleSettings,
		saveTouchConsoleSettings,
		translateTouchLayout,
		type TouchAvailability,
		type TouchConsoleSettings,
		type TouchJoystickScheme,
		type TouchLayout,
		type TouchOrientation
	} from '$lib/utils/touch-console';
	import SettingsAdvanced from '../../shared/SettingsAdvanced.svelte';
	import SettingsGroup from '../../shared/SettingsGroup.svelte';
	import SettingsRow from '../../shared/SettingsRow.svelte';
	import SettingsSelect from '../../shared/SettingsSelect.svelte';
	import SettingsSlider from '../../shared/SettingsSlider.svelte';
	import { SettingsDraftState } from '../../settings-draft.svelte';
	import { getSettingsShellContext, useSettingsDraft } from '../../settings-section-context';
	import TouchConsolePreview from './TouchConsolePreview.svelte';

	const shell = getSettingsShellContext();
	const localAppForcesConsole = isLocalAppDeployment();

	/*
	 * Look, layout and keys wait for Save. Whether the console is on, when its button
	 * shows, auto-open and the joystick scheme apply at once: they were the switches
	 * people flipped and left, and waiting for Save made them look broken.
	 */
	const draft = new SettingsDraftState<TouchConsoleSettings>(loadTouchConsoleSettings);

	useSettingsDraft({
		get pending() {
			return draft.pending;
		},
		save() {
			recordingTarget = null;
			draft.value = saveTouchConsoleSettings(draft.value);
			draft.commit();
			shell?.applied();
			return null;
		},
		discard() {
			recordingTarget = null;
			draft.reset();
		}
	});

	type ImmediateField = 'enabled' | 'availability' | 'autoEnableOnTouchOnly' | 'joystickScheme';

	/** Store one of the apply-at-once fields without saving the other edits in the draft. */
	function applyNow(patch: Pick<Partial<TouchConsoleSettings>, ImmediateField>) {
		patchTouchConsoleSettings(patch);
		draft.commitFields(patch);
	}

	const AVAILABILITY: { value: TouchAvailability; label: string; hint: string }[] = [
		{ value: 'auto', label: 'Auto', hint: 'On phones and tablets, in games it can reach.' },
		{ value: 'always', label: 'Always', hint: 'On every game page, desktop too.' },
		{ value: 'off', label: 'Never', hint: 'Hidden until you change this.' }
	];

	const JOYSTICK_SCHEMES: { value: TouchJoystickScheme; label: string }[] = [
		{ value: 'arrows', label: 'Arrow keys' },
		{ value: 'wasd', label: 'WASD' }
	];

	const MAPPED_BUTTONS = [
		{ id: 'a', label: 'A' },
		{ id: 'b', label: 'B' },
		{ id: 'x', label: 'X' },
		{ id: 'y', label: 'Esc' },
		{ id: 'space', label: 'Space' }
	] as const;

	type MappedButtonId = (typeof MAPPED_BUTTONS)[number]['id'];

	/* ---- Layout ---- */

	let orientation = $state<TouchOrientation>('landscape');
	const layout = $derived(draft.value.layouts[orientation]);

	function setLayout(next: TouchLayout, which: TouchOrientation = orientation) {
		draft.set('layouts', { ...draft.value.layouts, [which]: next });
	}

	function setControlSize(id: string, size: number) {
		const current = draft.value.layouts[orientation];
		setLayout(
			id === 'joystick'
				? { ...current, joystick: { ...current.joystick, size } }
				: { ...current, buttons: current.buttons.map((b) => (b.id === id ? { ...b, size } : b)) }
		);
	}

	let drag = $state<{ id: string; startX: number; startY: number; origin: TouchLayout } | null>(
		null
	);

	function startDrag(id: string, e: PointerEvent) {
		e.preventDefault();
		drag = { id, startX: e.clientX, startY: e.clientY, origin: layout };
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
	}

	function moveDrag(e: PointerEvent, box: HTMLElement) {
		if (!drag) return;
		const rect = box.getBoundingClientRect();
		const dx = (e.clientX - drag.startX) / rect.width;
		const dy = (e.clientY - drag.startY) / rect.height;
		const origin = drag.origin;
		const clamp = (n: number) => Math.max(0, Math.min(0.92, n));
		if (drag.id === 'joystick') {
			setLayout({
				...origin,
				joystick: {
					...origin.joystick,
					xPct: clamp(origin.joystick.xPct + dx),
					yPct: clamp(origin.joystick.yPct + dy)
				}
			});
		} else if (drag.id === 'console') {
			setLayout(translateTouchLayout(origin, dx, dy));
		} else {
			const id = drag.id;
			setLayout({
				...origin,
				buttons: origin.buttons.map((b) =>
					b.id === id ? { ...b, xPct: clamp(b.xPct + dx), yPct: clamp(b.yPct + dy) } : b
				)
			});
		}
	}

	function endDrag() {
		drag = null;
	}

	function copyLandscapeToPortrait() {
		const landscape = draft.value.layouts.landscape;
		setLayout(
			{
				...landscape,
				console: { ...landscape.console, yPct: Math.max(landscape.console.yPct, 0.62) }
			},
			'portrait'
		);
	}

	/* ---- Keys ---- */

	let recordingTarget = $state<MappedButtonId | null>(null);

	function mappedCodes(id: MappedButtonId): string[] {
		return draft.value.mapping.buttons[id] ?? [];
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
			draft.set('mapping', {
				...draft.value.mapping,
				buttons: { ...draft.value.mapping.buttons, [target]: [e.code] }
			});
			recordingTarget = null;
		};
		window.addEventListener('keydown', onKey, true);
		return () => window.removeEventListener('keydown', onKey, true);
	});

	/** The joystick scheme applies at once, as its select does; the buttons wait for Save. */
	function resetKeys() {
		recordingTarget = null;
		applyNow({ joystickScheme: 'arrows' });
		draft.set('mapping', {
			...draft.value.mapping,
			buttons: structuredClone(DEFAULT_TOUCH_MAPPING.buttons)
		});
	}
</script>

<div class="space-y-6">
	<SettingsGroup>
		<SettingsRow
			id="settings-section-touch-enabled"
			label="Touch console"
			labelFor="touch-enabled"
			hint={localAppForcesConsole
				? 'Always available in the app.'
				: 'Works in games that run through this app, not in outside embeds.'}
			inline
		>
			<Switch
				id="touch-enabled"
				checked={localAppForcesConsole ? true : draft.value.enabled}
				disabled={localAppForcesConsole}
				onCheckedChange={(v) => applyNow({ enabled: Boolean(v) })}
			/>
		</SettingsRow>
		<SettingsRow
			id="settings-section-touch-availability"
			label="Show the console button"
			hint={AVAILABILITY.find((o) => o.value === draft.value.availability)?.hint}
		>
			<SettingsSelect
				label="Show the console button"
				value={draft.value.availability}
				options={AVAILABILITY}
				onValueChange={(v) => applyNow({ availability: v })}
			/>
		</SettingsRow>
		<SettingsRow
			id="settings-section-touch-auto-enable"
			label="Open on touch-only devices"
			labelFor="touch-auto-enable"
			hint="Starts open where there is no keyboard or mouse."
			inline
		>
			<Switch
				id="touch-auto-enable"
				checked={draft.value.autoEnableOnTouchOnly}
				onCheckedChange={(v) => applyNow({ autoEnableOnTouchOnly: Boolean(v) })}
			/>
		</SettingsRow>
	</SettingsGroup>

	<SettingsGroup id="settings-section-touch-appearance" title="Look">
		<SettingsRow label="Opacity" labelFor="touch-opacity">
			<SettingsSlider
				id="touch-opacity"
				min={20}
				max={100}
				value={Math.round(draft.value.opacity * 100)}
				display={`${Math.round(draft.value.opacity * 100)}%`}
				onValueChange={(v) => draft.set('opacity', v / 100)}
			/>
		</SettingsRow>
		<SettingsRow label="Size" labelFor="touch-scale">
			<SettingsSlider
				id="touch-scale"
				min={60}
				max={160}
				step={5}
				value={Math.round(draft.value.scale * 100)}
				display={`${Math.round(draft.value.scale * 100)}%`}
				onValueChange={(v) => draft.set('scale', v / 100)}
			/>
		</SettingsRow>
		<SettingsRow
			label="Vibrate on press"
			labelFor="touch-haptics"
			hint="Where the device supports it."
			inline
		>
			<Switch
				id="touch-haptics"
				bind:checked={() => draft.value.haptics, (v) => draft.set('haptics', v)}
			/>
		</SettingsRow>
	</SettingsGroup>

	<div class="space-y-2">
		<h3 class="px-1 text-xs font-medium tracking-wide text-muted-foreground">More</h3>
		<SettingsAdvanced
			title="Layout"
			hint="Drag the controls into place, for each orientation."
			anchors={['settings-section-touch-layout', 'settings-section-touch-preview']}
		>
			<div id="settings-section-touch-layout" class="scroll-mt-4 space-y-4 px-4 py-4">
				<Tabs.Root
					value={orientation}
					onValueChange={(v) => {
						if (v === 'landscape' || v === 'portrait') orientation = v;
					}}
				>
					<Tabs.List class="grid w-full grid-cols-2 sm:w-64">
						<Tabs.Trigger value="landscape">Landscape</Tabs.Trigger>
						<Tabs.Trigger value="portrait">Portrait</Tabs.Trigger>
					</Tabs.List>
				</Tabs.Root>

				<div id="settings-section-touch-preview" class="max-w-xl scroll-mt-4">
					<TouchConsolePreview
						{layout}
						opacity={draft.value.opacity}
						scale={draft.value.scale}
						{orientation}
						onStartDrag={startDrag}
						onMoveDrag={moveDrag}
						onEndDrag={endDrag}
					/>
					<p class="mt-2 text-xs text-muted-foreground">
						In a game, hold a control for 2 seconds to move it.
					</p>
				</div>

				<div class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
					<div class="space-y-1">
						<p class="text-xs font-medium">Joystick</p>
						<SettingsSlider
							class="sm:w-full"
							label="Joystick size"
							min={60}
							max={160}
							step={2}
							value={layout.joystick.size}
							display={`${layout.joystick.size}px`}
							onValueChange={(v) => setControlSize('joystick', v)}
						/>
					</div>
					{#each layout.buttons as btn (btn.id)}
						<div class="space-y-1">
							<p class="text-xs font-medium">{btn.label}</p>
							<SettingsSlider
								class="sm:w-full"
								label={`${btn.label} size`}
								min={36}
								max={96}
								step={2}
								value={btn.size}
								display={`${btn.size}px`}
								onValueChange={(v) => setControlSize(btn.id, v)}
							/>
						</div>
					{/each}
				</div>

				<div class="flex flex-wrap gap-2">
					<Button type="button" variant="outline" size="sm" onclick={copyLandscapeToPortrait}>
						Copy landscape to portrait
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onclick={() => setLayout(getDefaultTouchLayout(orientation))}
					>
						Reset {orientation}
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onclick={() =>
							draft.set('layouts', {
								landscape: getDefaultTouchLayout('landscape'),
								portrait: getDefaultTouchLayout('portrait')
							})}
					>
						Reset both
					</Button>
				</div>
			</div>
		</SettingsAdvanced>

		<SettingsAdvanced
			title="Keys"
			hint="What the joystick and buttons press."
			anchors={['settings-section-touch-mapping']}
		>
			<div id="settings-section-touch-mapping" class="scroll-mt-4">
				<SettingsRow label="Joystick" hint="Applies at once.">
					<SettingsSelect
						label="Joystick keys"
						value={draft.value.joystickScheme ?? 'arrows'}
						options={JOYSTICK_SCHEMES}
						onValueChange={(v) => applyNow({ joystickScheme: v })}
					/>
				</SettingsRow>
			</div>
			{#each MAPPED_BUTTONS as btn (btn.id)}
				<SettingsRow label={`${btn.label} button`} inline>
					<Kbd class="h-8 min-w-12 px-2 text-xs">
						{recordingTarget === btn.id ? 'Press a key…' : codesToLabel(mappedCodes(btn.id))}
					</Kbd>
					<Button
						type="button"
						variant={recordingTarget === btn.id ? 'secondary' : 'outline'}
						size="sm"
						class="w-20"
						aria-pressed={recordingTarget === btn.id}
						onclick={() => (recordingTarget = recordingTarget === btn.id ? null : btn.id)}
					>
						{recordingTarget === btn.id ? 'Cancel' : 'Record'}
					</Button>
				</SettingsRow>
			{/each}
			<div class="px-4 py-3">
				<Button type="button" variant="ghost" size="sm" onclick={resetKeys}>Reset keys</Button>
			</div>
		</SettingsAdvanced>
	</div>
</div>
