<script lang="ts">
	import { Gamepad2, GripHorizontal } from 'lucide-svelte';
	import { Switch } from '$lib/components/ui/switch';
	import TouchButton from '$lib/components/game-player/touch-console/TouchButton.svelte';
	import TouchJoystick from '$lib/components/game-player/touch-console/TouchJoystick.svelte';
	import type { TouchLayout, TouchOrientation } from '$lib/utils/touch-console';

	let {
		layout,
		opacity,
		scale,
		orientation,
		onStartDrag,
		onMoveDrag,
		onEndDrag
	}: {
		layout: TouchLayout;
		opacity: number;
		scale: number;
		orientation: TouchOrientation;
		onStartDrag?: (id: string, event: PointerEvent) => void;
		onMoveDrag?: (event: PointerEvent, surface: HTMLElement) => void;
		onEndDrag?: () => void;
	} = $props();

	function buttonAccent(id: string): 'green' | 'blue' | 'red' | 'amber' {
		if (id === 'a') return 'green';
		if (id === 'b') return 'blue';
		if (id === 'x') return 'red';
		return 'amber';
	}
</script>

<div
	class={`relative w-full overflow-hidden rounded-lg border bg-gradient-to-br from-slate-900 to-slate-800 ${
		orientation === 'portrait' ? 'mx-auto aspect-[3/4] max-w-sm' : 'aspect-video'
	}`}
	role="presentation"
	onpointermove={(event) => onMoveDrag?.(event, event.currentTarget)}
	onpointerup={onEndDrag}
	onpointercancel={onEndDrag}
>
	<div
		class="pointer-events-none absolute rounded-[26px] border border-white/20 bg-white/[0.04] shadow-[0_10px_40px_rgb(0_0_0_/0.35)]"
		style={`left:${layout.console.xPct * 100}%;top:${layout.console.yPct * 100}%;width:${layout.console.widthPct * 100}%;height:${layout.console.heightPct * 100}%;opacity:${opacity};`}
	>
		<div class="absolute top-2 left-1/2 flex h-7 w-14 -translate-x-1/2 items-center justify-center rounded-full border border-white/25 bg-white/10 text-white/80">
			<GripHorizontal class="size-4" aria-hidden="true" />
		</div>
	</div>
	<div
		class="absolute z-10 cursor-move rounded-[26px]"
		style={`left:${layout.console.xPct * 100}%;top:${layout.console.yPct * 100}%;width:${layout.console.widthPct * 100}%;height:${layout.console.heightPct * 100}%;`}
		aria-label="Drag console preview"
		role="button"
		tabindex="0"
		onpointerdown={(event) => onStartDrag?.('console', event)}
	></div>

	<div
		class="pointer-events-none absolute"
		style={`left:${layout.joystick.xPct * 100}%;top:${layout.joystick.yPct * 100}%;`}
	>
		<TouchJoystick
			size={Math.round(layout.joystick.size * scale)}
			deadzone={layout.joystick.deadzone}
			opacity={opacity}
			onVector={() => undefined}
		/>
	</div>
	<div
		class="absolute z-10 cursor-move"
		style={`left:${layout.joystick.xPct * 100}%;top:${layout.joystick.yPct * 100}%;width:${Math.round(layout.joystick.size * scale)}px;height:${Math.round(layout.joystick.size * scale)}px;`}
		aria-label="Drag joystick preview"
		role="button"
		tabindex="0"
		onpointerdown={(event) => onStartDrag?.('joystick', event)}
	></div>

	{#each layout.buttons as button (button.id)}
		<div
			class="pointer-events-none absolute"
			style={`left:${button.xPct * 100}%;top:${button.yPct * 100}%;`}
		>
			<TouchButton
				label={button.label}
				size={Math.round(button.size * scale)}
				opacity={opacity}
				accent={buttonAccent(button.id)}
				onPress={() => undefined}
				onRelease={() => undefined}
			/>
		</div>
		<div
			class="absolute z-10 cursor-move"
			style={`left:${button.xPct * 100}%;top:${button.yPct * 100}%;width:${Math.round(button.size * scale)}px;height:${Math.round(button.size * scale)}px;`}
			aria-label={`Drag ${button.label} preview`}
			role="button"
			tabindex="0"
			onpointerdown={(event) => onStartDrag?.(button.id, event)}
		></div>
	{/each}

	<div class="pointer-events-none absolute top-3 right-3 flex items-center gap-2 rounded-xl border border-white/25 bg-background/70 px-3 py-2 text-foreground shadow-md backdrop-blur-md">
		<Gamepad2 class="size-4 text-blue-500" aria-hidden="true" />
		<Switch checked={true} class="h-6 w-11 data-[state=checked]:bg-blue-500" aria-label="Touch controls preview" />
	</div>
</div>
