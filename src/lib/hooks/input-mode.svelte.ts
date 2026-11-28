/**
 * Live input mode: is the player using touch right now, or keyboard and mouse?
 *
 * Decided by what the player last did, not by what the device has: a touch on the
 * screen means 'touch'; a key press or a real mouse move means 'keyboard'. Browsers
 * follow a tap with emulated mouse events, so mouse events right after a touch are
 * ignored, as are events scripts make up (the touch controls send synthetic keys).
 *
 * Game frames the app cannot reach (cross-origin) report their own trusted input with a
 * `potato-tomato-input` message.
 *
 * Starts from the device heuristic (`isTouchOnlyDevice`). The state is a module-level
 * rune, so every reader re-renders the moment it changes: no popup, no reload.
 */
import { isTouchOnlyDevice } from '$lib/utils/touch-input-dispatch';

export type InputMode = 'touch' | 'keyboard';

/** Mouse events this soon after a touch are the browser's emulation of the tap. */
export const TOUCH_MOUSE_GRACE_MS = 800;

const state = $state<{ mode: InputMode }>({
	mode: isTouchOnlyDevice() ? 'touch' : 'keyboard'
});
let lastTouchAt = -Infinity;
// Bookkeeping for listeners, not reactive state.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const attached = new Map<EventTarget, () => void>();

function set(mode: InputMode) {
	if (state.mode !== mode) state.mode = mode;
}

function onPointer(e: Event) {
	if (!e.isTrusted) return;
	const type = (e as PointerEvent).pointerType;
	if (type === 'touch' || type === 'pen') {
		lastTouchAt = e.timeStamp;
		set('touch');
	} else if (type === 'mouse' && e.timeStamp - lastTouchAt > TOUCH_MOUSE_GRACE_MS) {
		set('keyboard');
	}
}

function onTouch(e: Event) {
	if (!e.isTrusted) return;
	lastTouchAt = e.timeStamp;
	set('touch');
}

function onMouseMove(e: Event) {
	if (!e.isTrusted) return;
	const m = e as MouseEvent;
	if (e.timeStamp - lastTouchAt <= TOUCH_MOUSE_GRACE_MS) return;
	if (!m.movementX && !m.movementY) return;
	set('keyboard');
}

/** A game frame's report of trusted input the app cannot see (cross-origin frames). */
function onMessage(e: Event) {
	const data = (e as MessageEvent).data as { type?: unknown; mode?: unknown } | null;
	if (!data || data.type !== 'potato-tomato-input') return;
	if (data.mode === 'touch') {
		lastTouchAt = e.timeStamp;
		set('touch');
	} else if (data.mode === 'keyboard') {
		set('keyboard');
	}
}

function onKey(e: Event) {
	if (!e.isTrusted) return;
	set('keyboard');
}

/** Listen on a window (the app's, or a same-origin game frame's). Returns a detach. */
export function watchInputMode(target: EventTarget | null | undefined): () => void {
	if (!target) return () => {};
	const existing = attached.get(target);
	if (existing) return existing;
	const opts = { capture: true, passive: true } as const;
	target.addEventListener('pointerdown', onPointer, opts);
	target.addEventListener('touchstart', onTouch, opts);
	target.addEventListener('mousemove', onMouseMove, opts);
	target.addEventListener('keydown', onKey, opts);
	target.addEventListener('message', onMessage);
	const detach = () => {
		attached.delete(target);
		/*
		 * A game frame's window may have navigated cross-origin since: touching it throws a
		 * SecurityError, which in a component's cleanup used to leave the next page blank.
		 * Its listeners went with the old document anyway.
		 */
		try {
			target.removeEventListener('pointerdown', onPointer, opts);
			target.removeEventListener('touchstart', onTouch, opts);
			target.removeEventListener('mousemove', onMouseMove, opts);
			target.removeEventListener('keydown', onKey, opts);
			target.removeEventListener('message', onMessage);
		} catch {
			/* cross-origin or gone */
		}
	};
	attached.set(target, detach);
	return detach;
}

/** The current mode (reactive). */
export function inputMode(): InputMode {
	return state.mode;
}

/** Tests only. */
export function resetInputModeForTests(mode: InputMode = 'keyboard'): void {
	for (const detach of [...attached.values()]) detach();
	state.mode = mode;
	lastTouchAt = -Infinity;
}
