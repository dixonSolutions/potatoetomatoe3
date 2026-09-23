<script lang="ts">
	/**
	 * Glass action button — press = keydown, release = keyup (via callbacks).
	 *
	 * A button can be held for as long as the game needs (charge, sprint, crouch). Moving
	 * it is an explicit layout-edit mode rather than a 2s long press, which used to drop
	 * the held key and turn the button into a drag handle mid-game.
	 */
	let {
		label = 'A',
		/** What the key does in this game ("Jump"), shown small under the label. */
		caption = '',
		size = 52,
		/** Wider than `size` for pill controls (e.g. Space). Defaults to `size`. */
		width = undefined as number | undefined,
		opacity = 0.72,
		accent = 'green',
		disabled = false,
		editing = false,
		editMode = false,
		onPress,
		onRelease,
		onHoldEditStart,
		onHoldEditDrag,
		onHoldEditEnd
	}: {
		label?: string;
		caption?: string;
		size?: number;
		width?: number;
		opacity?: number;
		accent?: 'green' | 'blue' | 'red' | 'amber' | 'slate';
		disabled?: boolean;
		editing?: boolean;
		/** Layout-edit mode: a press drags the control instead of sending its key. */
		editMode?: boolean;
		onPress?: () => void;
		onRelease?: () => void;
		onHoldEditStart?: () => void;
		onHoldEditDrag?: (delta: { x: number; y: number }) => void;
		onHoldEditEnd?: (committed: boolean) => void;
	} = $props();

	const boxW = $derived(typeof width === 'number' && width > 0 ? width : size);
	const isPill = $derived(boxW > size * 1.15);

	let rootEl = $state<HTMLButtonElement | null>(null);
	let pointerId: number | null = null;
	let pressed = $state(false);

	let dragStart: { x: number; y: number } | null = null;
	let dragging = $state(false);

	const accentBorder = $derived(
		accent === 'green'
			? 'rgb(74 222 128 / 0.85)'
			: accent === 'blue'
				? 'rgb(96 165 250 / 0.85)'
				: accent === 'red'
					? 'rgb(248 113 113 / 0.85)'
					: accent === 'slate'
						? 'rgb(226 232 240 / 0.85)'
						: 'rgb(251 191 36 / 0.85)'
	);
	const accentFill = $derived(
		accent === 'green'
			? 'rgb(74 222 128 / 0.22)'
			: accent === 'blue'
				? 'rgb(96 165 250 / 0.22)'
				: accent === 'red'
					? 'rgb(248 113 113 / 0.22)'
					: accent === 'slate'
						? 'rgb(248 250 252 / 0.2)'
						: 'rgb(251 191 36 / 0.22)'
	);

	function onPointerDown(e: PointerEvent) {
		if (disabled) return;
		if (pointerId != null) return;
		if (e.button != null && e.button !== 0) return;
		pointerId = e.pointerId;
		try {
			rootEl?.setPointerCapture(e.pointerId);
		} catch {
			/* ignore */
		}
		e.preventDefault();
		e.stopPropagation();

		if (editMode) {
			dragStart = { x: e.clientX, y: e.clientY };
			dragging = true;
			onHoldEditStart?.();
			return;
		}
		pressed = true;
		onPress?.();
	}

	function onPointerMove(e: PointerEvent) {
		if (pointerId !== e.pointerId || !dragging || !dragStart) return;
		e.preventDefault();
		e.stopPropagation();
		onHoldEditDrag?.({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
	}

	function onPointerUp(e: PointerEvent) {
		if (pointerId !== e.pointerId) return;
		const wasDragging = dragging;
		const wasPressed = pressed;
		try {
			rootEl?.releasePointerCapture(e.pointerId);
		} catch {
			/* ignore */
		}
		pointerId = null;
		dragStart = null;
		dragging = false;
		pressed = false;
		if (wasDragging) {
			onHoldEditEnd?.(e.type !== 'pointercancel');
			return;
		}
		if (wasPressed) onRelease?.();
	}
</script>

<button
	bind:this={rootEl}
	type="button"
	class="pt-touch-btn touch-none select-none"
	class:pt-touch-btn--pressed={pressed}
	class:pt-touch-btn--editing={dragging || editing}
	class:pt-touch-btn--edit-mode={editMode}
	class:pt-touch-btn--pill={isPill}
	style={`width:${boxW}px;height:${size}px;opacity:${opacity};--pt-accent-border:${accentBorder};--pt-accent-fill:${accentFill};font-size:${Math.max(11, size * (isPill ? 0.28 : 0.32))}px;`}
	aria-label={`Action ${label}`}
	title={caption || undefined}
	{disabled}
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
>
	<span class="pt-touch-btn__label">{label}</span>
	{#if caption}
		<span class="pt-touch-btn__caption" style={`max-width:${boxW - 8}px;`}>{caption}</span>
	{/if}
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
		align-content: center;
		transition:
			transform 80ms ease,
			box-shadow 80ms ease;
	}
	.pt-touch-btn--pill {
		border-radius: 9999px;
		padding: 0 0.35em;
		letter-spacing: 0.04em;
	}
	.pt-touch-btn--pressed {
		transform: scale(0.94);
		box-shadow:
			0 2px 10px rgb(0 0 0 / 0.4),
			inset 0 1px 0 rgb(255 255 255 / 0.15);
	}
	.pt-touch-btn--edit-mode {
		cursor: move;
		outline: 2px dashed rgb(255 255 255 / 0.55);
		outline-offset: 3px;
	}
	.pt-touch-btn--editing {
		outline: 2px dashed rgb(255 85 102 / 0.9);
		outline-offset: 3px;
	}
	.pt-touch-btn__caption {
		display: block;
		margin-top: 1px;
		overflow: hidden;
		font-size: 8px;
		font-weight: 600;
		line-height: 1.1;
		letter-spacing: 0.01em;
		text-overflow: ellipsis;
		white-space: nowrap;
		opacity: 0.85;
		text-shadow: 0 1px 2px rgb(0 0 0 / 0.5);
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
