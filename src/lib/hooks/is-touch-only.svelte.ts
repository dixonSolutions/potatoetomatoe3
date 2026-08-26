import { MediaQuery } from 'svelte/reactivity';

/**
 * Reactive "this device has touch and no mouse" check.
 *
 * The non-reactive `isTouchOnlyDevice()` in `touch-input-dispatch.ts` answers the same
 * question for a one-shot decision at dispatch time. UI that is *rendered* from the answer
 * needs it to update: pairing a Bluetooth keyboard and mouse to a tablet flips
 * `(hover: hover)` and `(pointer: coarse)` live, and a control that only makes sense
 * without a keyboard should disappear when one appears.
 *
 * Browsers cannot report whether a physical keyboard is attached, so this is a heuristic:
 * touch points, a coarse primary pointer, and no hover. It matches `isTouchOnlyDevice()`
 * so the two never disagree about the same device.
 */
export class IsTouchOnly {
	#coarse = new MediaQuery('pointer: coarse');
	#hover = new MediaQuery('hover: hover');

	get current(): boolean {
		if (typeof navigator === 'undefined') return false;
		const touchPoints = navigator.maxTouchPoints ?? 0;
		return touchPoints > 0 && this.#coarse.current && !this.#hover.current;
	}
}
