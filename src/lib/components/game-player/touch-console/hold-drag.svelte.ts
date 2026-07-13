/**
 * Hold-2s-then-drag / resize helper for touch console controls.
 * Uses Pointer Events; commits on pointerup after edit mode engages.
 */

export type HoldDragPoint = { x: number; y: number };

export type HoldDragOptions = {
	/** Hold duration before edit mode (ms). Default 2000. */
	holdMs?: number;
	/** Movement (px) that cancels the hold timer. Default 10. */
	moveThresholdPx?: number;
	/** Called when hold completes and drag/resize mode starts. */
	onEditStart?: () => void;
	/** Called while dragging with delta from the edit-start point. */
	onDrag?: (delta: HoldDragPoint, absolute: HoldDragPoint) => void;
	/** Called on pointerup after an edit session (or cancelled hold). */
	onEditEnd?: (committed: boolean) => void;
	/** When true, any pointerdown immediately starts drag (settings preview). */
	immediate?: boolean;
};

export type HoldDragController = {
	onPointerDown: (e: PointerEvent) => void;
	onPointerMove: (e: PointerEvent) => void;
	onPointerUp: (e: PointerEvent) => void;
	onPointerCancel: (e: PointerEvent) => void;
	isEditing: () => boolean;
	reset: () => void;
};

export function createHoldDrag(options: HoldDragOptions = {}): HoldDragController {
	const holdMs = options.holdMs ?? 2000;
	const moveThresholdPx = options.moveThresholdPx ?? 10;
	const immediate = options.immediate ?? false;

	let pointerId: number | null = null;
	let start: HoldDragPoint | null = null;
	let holdTimer: ReturnType<typeof setTimeout> | null = null;
	let editing = false;
	let movedPastThreshold = false;

	function clearTimer() {
		if (holdTimer != null) {
			clearTimeout(holdTimer);
			holdTimer = null;
		}
	}

	function reset() {
		clearTimer();
		pointerId = null;
		start = null;
		editing = false;
		movedPastThreshold = false;
	}

	function beginEdit() {
		if (editing) return;
		editing = true;
		options.onEditStart?.();
	}

	return {
		onPointerDown(e: PointerEvent) {
			if (pointerId != null) return;
			if (e.button != null && e.button !== 0) return;
			pointerId = e.pointerId;
			start = { x: e.clientX, y: e.clientY };
			movedPastThreshold = false;
			editing = false;
			try {
				(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId);
			} catch {
				/* ignore */
			}
			e.preventDefault();
			e.stopPropagation();

			if (immediate) {
				beginEdit();
				return;
			}

			clearTimer();
			holdTimer = setTimeout(() => {
				holdTimer = null;
				if (pointerId == null || movedPastThreshold) return;
				beginEdit();
			}, holdMs);
		},

		onPointerMove(e: PointerEvent) {
			if (pointerId !== e.pointerId || !start) return;
			const dx = e.clientX - start.x;
			const dy = e.clientY - start.y;
			const dist = Math.hypot(dx, dy);

			if (!editing) {
				if (dist > moveThresholdPx) {
					movedPastThreshold = true;
					clearTimer();
				}
				return;
			}

			e.preventDefault();
			e.stopPropagation();
			options.onDrag?.({ x: dx, y: dy }, { x: e.clientX, y: e.clientY });
		},

		onPointerUp(e: PointerEvent) {
			if (pointerId !== e.pointerId) return;
			const wasEditing = editing;
			clearTimer();
			try {
				(e.currentTarget as HTMLElement | null)?.releasePointerCapture?.(e.pointerId);
			} catch {
				/* ignore */
			}
			options.onEditEnd?.(wasEditing);
			reset();
		},

		onPointerCancel(e: PointerEvent) {
			if (pointerId !== e.pointerId) return;
			clearTimer();
			options.onEditEnd?.(false);
			reset();
		},

		isEditing: () => editing,
		reset
	};
}
