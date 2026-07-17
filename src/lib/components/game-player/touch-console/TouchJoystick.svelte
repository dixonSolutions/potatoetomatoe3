<script lang="ts">
	/**
	 * Glass virtual joystick — Pointer Events, no dependencies.
	 * Emits a normalized vector {x,y} in [-1,1] (y positive = down).
	 */
	let {
		size = 112,
		deadzone = 0.18,
		opacity = 0.72,
		disabled = false,
		editing = false,
		onVector,
		onHoldEditStart,
		onHoldEditDrag,
		onHoldEditEnd
	}: {
		size?: number;
		deadzone?: number;
		opacity?: number;
		disabled?: boolean;
		editing?: boolean;
		onVector?: (v: { x: number; y: number }) => void;
		onHoldEditStart?: () => void;
		onHoldEditDrag?: (delta: { x: number; y: number }) => void;
		onHoldEditEnd?: (committed: boolean) => void;
	} = $props();

	let rootEl = $state<HTMLDivElement | null>(null);
	let pointerId = $state<number | null>(null);
	let thumbX = $state(0);
	let thumbY = $state(0);
	let active = $state(false);

	let holdTimer: ReturnType<typeof setTimeout> | null = null;
	let holdStart: { x: number; y: number } | null = null;
	let holdEditing = $state(false);
	let holdMoved = false;

	const radius = $derived(size / 2);
	const thumbSize = $derived(Math.max(36, size * 0.42));
	const maxTravel = $derived(radius - thumbSize / 2);

	function clearHold() {
		if (holdTimer != null) {
			clearTimeout(holdTimer);
			holdTimer = null;
		}
	}

	function emitZero() {
		thumbX = 0;
		thumbY = 0;
		active = false;
		onVector?.({ x: 0, y: 0 });
	}

	function updateFromClient(clientX: number, clientY: number) {
		if (!rootEl) return;
		const rect = rootEl.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + rect.height / 2;
		let dx = clientX - cx;
		let dy = clientY - cy;
		const dist = Math.hypot(dx, dy);
		if (dist > maxTravel && dist > 0) {
			dx = (dx / dist) * maxTravel;
			dy = (dy / dist) * maxTravel;
		}
		thumbX = dx;
		thumbY = dy;
		const nx = maxTravel > 0 ? dx / maxTravel : 0;
		const ny = maxTravel > 0 ? dy / maxTravel : 0;
		const mag = Math.hypot(nx, ny);
		if (mag < deadzone) {
			onVector?.({ x: 0, y: 0 });
		} else {
			const scale = (mag - deadzone) / (1 - deadzone);
			const inv = mag > 0 ? scale / mag : 0;
			onVector?.({ x: nx * inv, y: ny * inv });
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
		active = true;
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
			emitZero();
			onHoldEditStart?.();
		}, 2000);

		if (!holdEditing) updateFromClient(e.clientX, e.clientY);
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
			return;
		}
		e.preventDefault();
		e.stopPropagation();
		updateFromClient(e.clientX, e.clientY);
	}

	function onPointerUp(e: PointerEvent) {
		if (pointerId !== e.pointerId) return;
		const wasHoldEdit = holdEditing;
		clearHold();
		try {
			rootEl?.releasePointerCapture(e.pointerId);
		} catch {
			/* ignore */
		}
		pointerId = null;
		holdStart = null;
		holdEditing = false;
		emitZero();
		onHoldEditEnd?.(wasHoldEdit);
	}
</script>

<div
	bind:this={rootEl}
	data-testid="touch-joystick"
	class="pt-touch-joystick touch-none select-none"
	class:pt-touch-joystick--active={active}
	class:pt-touch-joystick--editing={holdEditing || editing}
	style={`width:${size}px;height:${size}px;opacity:${opacity};`}
	role="application"
	aria-label="Virtual joystick"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
>
	<div class="pt-touch-joystick__base" aria-hidden="true"></div>
	<div
		class="pt-touch-joystick__thumb"
		aria-hidden="true"
		style={`width:${thumbSize}px;height:${thumbSize}px;transform:translate(${thumbX}px, ${thumbY}px);`}
	></div>
</div>

<style>
	.pt-touch-joystick {
		position: relative;
		pointer-events: auto;
		border-radius: 9999px;
		display: grid;
		place-items: center;
		isolation: isolate;
	}
	.pt-touch-joystick__base {
		position: absolute;
		inset: 0;
		border-radius: 9999px;
		background: rgb(255 255 255 / 0.06);
		border: 1px solid rgb(255 255 255 / 0.22);
		box-shadow:
			0 8px 24px rgb(0 0 0 / 0.35),
			inset 0 1px 0 rgb(255 255 255 / 0.28);
		-webkit-backdrop-filter: blur(16px) saturate(160%);
		backdrop-filter: blur(16px) saturate(160%);
	}
	.pt-touch-joystick__thumb {
		position: relative;
		z-index: 1;
		border-radius: 9999px;
		background: radial-gradient(
			circle at 35% 30%,
			rgb(255 255 255 / 0.85),
			rgb(160 180 255 / 0.35)
		);
		border: 1px solid rgb(255 255 255 / 0.55);
		box-shadow:
			0 4px 14px rgb(0 0 0 / 0.35),
			inset 0 1px 0 rgb(255 255 255 / 0.45);
		transition: box-shadow 120ms ease;
		will-change: transform;
	}
	.pt-touch-joystick--active .pt-touch-joystick__thumb {
		box-shadow:
			0 6px 18px rgb(0 0 0 / 0.45),
			inset 0 1px 0 rgb(255 255 255 / 0.55);
	}
	.pt-touch-joystick--editing {
		outline: 2px dashed rgb(255 85 102 / 0.9);
		outline-offset: 4px;
	}
</style>
