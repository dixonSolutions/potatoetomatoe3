import { afterEach, describe, expect, it } from 'vitest';
import {
	TOUCH_MOUSE_GRACE_MS,
	inputMode,
	resetInputModeForTests,
	watchInputMode
} from './input-mode.svelte';

type Handler = (e: Event) => void;

/** A window stand-in whose handlers we call directly, so events can be "trusted". */
function fakeWindow() {
	const handlers = new Map<string, Set<Handler>>();
	const target = {
		addEventListener(type: string, fn: Handler) {
			if (!handlers.has(type)) handlers.set(type, new Set());
			handlers.get(type)!.add(fn);
		},
		removeEventListener(type: string, fn: Handler) {
			handlers.get(type)?.delete(fn);
		},
		dispatchEvent() {
			return true;
		}
	} as unknown as EventTarget;
	const fire = (type: string, init: Record<string, unknown>) => {
		const e = { isTrusted: true, timeStamp: 0, ...init } as unknown as Event;
		for (const fn of handlers.get(type) ?? []) fn(e);
	};
	const count = () => [...handlers.values()].reduce((n, s) => n + s.size, 0);
	return { target, fire, count };
}

afterEach(() => resetInputModeForTests());

describe('input mode', () => {
	it('switches to touch on a touch and back to keyboard on a key press', () => {
		const w = fakeWindow();
		watchInputMode(w.target);
		expect(inputMode()).toBe('keyboard');
		w.fire('pointerdown', { pointerType: 'touch', timeStamp: 100 });
		expect(inputMode()).toBe('touch');
		w.fire('keydown', { timeStamp: 200 });
		expect(inputMode()).toBe('keyboard');
	});

	it('ignores the mouse events a browser emulates right after a tap', () => {
		const w = fakeWindow();
		watchInputMode(w.target);
		w.fire('touchstart', { timeStamp: 1000 });
		w.fire('pointerdown', { pointerType: 'mouse', timeStamp: 1010 });
		w.fire('mousemove', { movementX: 3, movementY: 0, timeStamp: 1020 });
		expect(inputMode()).toBe('touch');
		w.fire('mousemove', {
			movementX: 3,
			movementY: 0,
			timeStamp: 1000 + TOUCH_MOUSE_GRACE_MS + 50
		});
		expect(inputMode()).toBe('keyboard');
	});

	it('ignores synthetic events, such as keys the touch controls send', () => {
		const w = fakeWindow();
		watchInputMode(w.target);
		w.fire('touchstart', { timeStamp: 10 });
		w.fire('keydown', { isTrusted: false, timeStamp: 5000 });
		expect(inputMode()).toBe('touch');
	});

	it('mouse moves without movement do not count', () => {
		resetInputModeForTests('touch');
		const w = fakeWindow();
		watchInputMode(w.target);
		w.fire('mousemove', { movementX: 0, movementY: 0, timeStamp: 5000 });
		expect(inputMode()).toBe('touch');
	});

	it('takes reports from game frames it cannot reach', () => {
		const w = fakeWindow();
		watchInputMode(w.target);
		w.fire('message', { data: { type: 'potato-tomato-input', mode: 'touch' }, timeStamp: 10 });
		expect(inputMode()).toBe('touch');
		w.fire('message', { data: { type: 'something-else', mode: 'keyboard' }, timeStamp: 20 });
		expect(inputMode()).toBe('touch');
		w.fire('message', { data: { type: 'potato-tomato-input', mode: 'keyboard' }, timeStamp: 30 });
		expect(inputMode()).toBe('keyboard');
	});

	it('attaches once per target and detaches cleanly', () => {
		const w = fakeWindow();
		const a = watchInputMode(w.target);
		const b = watchInputMode(w.target);
		expect(a).toBe(b);
		expect(w.count()).toBe(5);
		a();
		expect(w.count()).toBe(0);
		expect(watchInputMode(null)).toBeTypeOf('function');
	});

	it('detaches quietly from a frame window that went cross-origin', () => {
		const target = {
			addEventListener: () => {},
			removeEventListener: () => {
				throw new DOMException('Blocked a frame', 'SecurityError');
			}
		} as unknown as EventTarget;
		const detach = watchInputMode(target);
		expect(() => detach()).not.toThrow();
		/* It is forgotten, so a later watch attaches afresh. */
		expect(watchInputMode(target)).not.toBe(detach);
	});
});
