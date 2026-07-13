<script lang="ts">
	/**
	 * Glass action button — press = keydown, release = keyup (via callbacks).
	 */
	let {
		label = 'A',
		size = 52,
		opacity = 0.72,
		accent = 'green',
		disabled = false,
		editing = false,
		onPress,
		onRelease,
		onHoldEditStart,
		onHoldEditDrag,
		onHoldEditEnd
	}: {
		label?: string;
		size?: number;
		opacity?: number;
		accent?: 'green' | 'blue' | 'red' | 'amber';
		disabled?: boolean;
		editing?: boolean;
		onPress?: () => void;
		onRelease?: () => void;
		onHoldEditStart?: () => void;
		onHoldEditDrag?: (delta: { x: number; y: number }) => void;
		onHoldEditEnd?: (committed: boolean) => void;
	} = $props();

	let rootEl = $state<HTMLButtonElement | null>(null);
	let pointerId = $state<number | null>(null);
	let pressed = $state(false);

	let holdTimer: ReturnType<typeof setTimeout> | null = null;
	let holdStart: { x: number; y: number } | null = null;
	let holdEditing = $state(false);
	let holdMoved = false;

	const accentBorder = $derived(
		accent === 'green'
			? 'rgb(74 222 128 / 0.85)'
			: accent === 'blue'
				? 'rgb(96 165 250 / 0.85)'
				: accent === 'red'
					? 'rgb(248 113 113 / 0.85)'
					: 'rgb(251 191 36 / 0.85)'
	);
	const accentFill = $derived(
		accent === 'green'
			? 'rgb(74 222 128 / 0.22)'
			: accent === 'blue'
				? 'rgb(96 165 250 / 0.22)'
				: accent === 'red'
					? 'rgb(248 113 113 / 0.22)'
					: 'rgb(251 191 36 / 0.22)'
	);

	function clearHold() {
		if (holdTimer != null) {
			clearTimeout(holdTimer);
			holdTimer = null;
		}
	}

	function onPointerDown(e: PointerEvent) {
		if (disabled) return;
		if (pointerId != null) return;
		if (e.button != null && e.button !== 0) return;
		pointerId = e.pointerId;
		holdStart = { x: e.clientX, y: e.clientY };
		holdMoved = false;
		holdEditing = false;
		pressed = true;
		try {
			rootEl?.setPointerCapture(e.pointerId);
		} catch {
			/* ignore */
		}
		e.preventDefault();
		e.stopPropagation();

		clearHold();
		holdTimer = setTimeout(() => {
			holdTimer = null;
			if (pointerId == null || holdMoved) return;
			holdEditing = true;
			pressed = false;
			onRelease?.();
			onHoldEditStart?.();
		}, 2000);

		onPress?.();
	}

	function onPointerMove(e: PointerEvent) {
		if (pointerId !== e.pointerId || !holdStart) return;
		const dx = e.clientX - holdStart.x;
		const dy = e.clientY - holdStart.y;
		if (!holdEditing && Math.hypot(dx, dy) > 10) {
			holdMoved = true;
			clearHold();
		}
		if (holdEditing || editing) {
			e.preventDefault();
			e.stopPropagation();
			onHoldEditDrag?.({ x: dx, y: dy });
		}
	}

	function onPointerUp(e: PointerEvent) {
		if (pointerId !== e.pointerId) return;
		const wasHoldEdit = holdEditing;
		const wasPressed = pressed;
		clearHold();
		try {
			rootEl?.releasePointerCapture(e.pointerId);
		} catch {
			/* ignore */
		}
		pointerId = null;
		holdStart = null;
		holdEditing = false;
		pressed = false;
		if (wasPressed && !wasHoldEdit) onRelease?.();
		onHoldEditEnd?.(wasHoldEdit);
	}
</script>

<button
	bind:this={rootEl}
	type="button"
	class="pt-touch-btn touch-none select-none"
	class:pt-touch-btn--pressed={pressed}
	class:pt-touch-btn--editing={holdEditing || editing}
	style={`width:${size}px;height:${size}px;opacity:${opacity};--pt-accent-border:${accentBorder};--pt-accent-fill:${accentFill};font-size:${Math.max(12, size * 0.32)}px;`}
	aria-label={`Action ${label}`}
	disabled={disabled}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
>
	<span class="pt-touch-btn__label">{label}</span>
</button>

<style>
	.pt-touch-btn {
		pointer-events: auto;
		border-radius: 9999px;
		border: 1.5px solid var(--pt-accent-border);
		background: var(--pt-accent-fill);
		color: #fff;
		font-weight: 700;
		letter-spacing: 0.02em;
		box-shadow:
			0 6px 18px rgb(0 0 0 / 0.35),
			inset 0 1px 0 rgb(255 255 255 / 0.25);
		-webkit-backdrop-filter: blur(14px) saturate(150%);
		backdrop-filter: blur(14px) saturate(150%);
		display: grid;
		place-items: center;
		transition:
			transform 80ms ease,
			box-shadow 80ms ease;
	}
	.pt-touch-btn--pressed {
		transform: scale(0.94);
		box-shadow:
			0 2px 10px rgb(0 0 0 / 0.4),
			inset 0 1px 0 rgb(255 255 255 / 0.15);
	}
	.pt-touch-btn--editing {
		outline: 2px dashed rgb(255 85 102 / 0.9);
		outline-offset: 3px;
	}
	.pt-touch-btn__label {
		text-shadow: 0 1px 2px rgb(0 0 0 / 0.45);
		line-height: 1;
	}
	.pt-touch-btn:disabled {
		opacity: 0.4;
		pointer-events: none;
	}
</style>
