import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	POINTER_LOCK_MESSAGE,
	isUnlockGesture,
	parsePointerLockMessage,
	watchDocumentPointerLock,
	type PointerLockState,
	type UnlockPress
} from './pointer-lock';

/* ---------- a minimal DOM: just what the guard touches ---------- */

type Listener = (e: FakeEvent) => void;
type FakeEvent = {
	type: string;
	button: number;
	pointerType?: string;
	target: FakeEl;
	movementX?: number;
	movementY?: number;
	defaultPrevented: boolean;
	stopped: boolean;
	preventDefault: () => void;
	stopImmediatePropagation: () => void;
};
type FakeEl = { nodeType: 1; cursor: string; ownerDocument?: unknown };

function makeTarget() {
	const listeners: Record<string, Listener[]> = {};
	return {
		listeners,
		addEventListener(type: string, fn: Listener) {
			(listeners[type] ||= []).push(fn);
		},
		removeEventListener(type: string, fn: Listener) {
			listeners[type] = (listeners[type] || []).filter((l) => l !== fn);
		},
		fire(type: string, init: Partial<FakeEvent>) {
			const e: FakeEvent = {
				type,
				button: 0,
				target: init.target as FakeEl,
				defaultPrevented: false,
				stopped: false,
				preventDefault() {
					e.defaultPrevented = true;
				},
				stopImmediatePropagation() {
					e.stopped = true;
				},
				...init
			};
			for (const fn of listeners[type] || []) {
				fn(e);
				if (e.stopped) break;
			}
			return e;
		}
	};
}

function makeFrame() {
	const styles: Record<string, { id: string; parentNode: unknown }> = {};
	const win = makeTarget() as ReturnType<typeof makeTarget> & Record<string, unknown>;
	const docTarget = makeTarget();
	const posted: PointerLockState[] = [];
	const top = {
		postMessage: (m: { type: string; state: PointerLockState }) => {
			if (m.type === POINTER_LOCK_MESSAGE) posted.push(m.state);
		}
	};
	const doc = {
		...docTarget,
		pointerLockElement: null as unknown,
		defaultView: win,
		exitPointerLock() {
			doc.pointerLockElement = null;
			docTarget.fire('pointerlockchange', {});
		},
		getElementById: (id: string) => styles[id] ?? null,
		/* The bridge removes its style through parentNode, the TS guard with `.remove()`. */
		createElement: () => {
			const el = {
				id: '',
				textContent: '',
				parentNode: null as unknown,
				remove: () => delete styles[el.id]
			};
			return el;
		},
		head: {
			appendChild(el: { id: string; parentNode: unknown }) {
				styles[el.id] = el;
				el.parentNode = { removeChild: () => delete styles[el.id] };
			}
		},
		documentElement: {}
	};
	Object.assign(win, {
		top,
		parent: top,
		getComputedStyle: (el: FakeEl) => ({ cursor: el.cursor })
	});
	const canvas: FakeEl = { nodeType: 1, cursor: 'auto', ownerDocument: doc };
	return {
		win,
		doc,
		canvas,
		posted,
		cursorForced: () => Boolean(styles['__pt-cursor-visible']),
		lock() {
			doc.pointerLockElement = canvas;
			docTarget.fire('pointerlockchange', {});
		},
		/** A real mouse press: pointerdown, its mousedown twin, then up + click. */
		press() {
			const down = win.fire('pointerdown', { target: canvas, pointerType: 'mouse' });
			win.fire('mousedown', { target: canvas });
			win.fire('pointerup', { target: canvas, pointerType: 'mouse' });
			const click = win.fire('click', { target: canvas });
			return { down, click };
		},
		move(px: number) {
			win.fire('mousemove', { target: canvas, movementX: px, movementY: 0 });
		}
	};
}

type Frame = ReturnType<typeof makeFrame>;

/** Runs the appended block of the real bridge script in a fake frame. */
function installBridgeGuard(frame: Frame) {
	const src = readFileSync(
		path.resolve(__dirname, '../../../static/game-storage-bridge.child.js'),
		'utf8'
	);
	const start = src.indexOf(
		'/* ==========================================================================\n * Pointer lock guard'
	);
	expect(start).toBeGreaterThan(0);
	new Function('window', 'document', src.slice(start))(frame.win, frame.doc);
	const f = frame.win.__ptIsUnlockGesture;
	expect(typeof f).toBe('function');
	return f as (presses: UnlockPress[]) => boolean;
}

function installTsGuard(frame: Frame) {
	watchDocumentPointerLock(frame.doc as unknown as Document, (s) => frame.posted.push(s));
}

/* ---------- the gesture rules ---------- */

const at = (...times: number[]): UnlockPress[] => times.map((t) => ({ at: t, travel: 0 }));

const CASES: { name: string; presses: UnlockPress[]; unlocks: boolean }[] = [
	{ name: 'two double-clicks', presses: at(0, 150, 450, 600), unlocks: true },
	{ name: 'two slow-ish double-clicks', presses: at(0, 300, 800, 1100), unlocks: true },
	{ name: 'even rapid fire', presses: at(0, 120, 240, 360), unlocks: false },
	{ name: 'jittery rapid fire', presses: at(0, 110, 245, 350), unlocks: false },
	{ name: 'pairs too slow to be double-clicks', presses: at(0, 500, 1100, 1400), unlocks: false },
	{ name: 'too long overall', presses: at(0, 200, 1300, 1500), unlocks: false },
	{ name: 'only three presses', presses: at(0, 150, 450), unlocks: false },
	{
		name: 'the mouse moved (aiming, not unlocking)',
		presses: [
			{ at: 0, travel: 0 },
			{ at: 150, travel: 20 },
			{ at: 450, travel: 60 },
			{ at: 600, travel: 90 }
		],
		unlocks: false
	},
	{
		name: 'a little hand jitter is fine',
		presses: [
			{ at: 0, travel: 0 },
			{ at: 150, travel: 4 },
			{ at: 450, travel: 10 },
			{ at: 600, travel: 12 }
		],
		unlocks: true
	},
	{
		name: 'only the last four presses count',
		presses: at(0, 5000, 5150, 5450, 5600),
		unlocks: true
	}
];

describe('isUnlockGesture', () => {
	for (const c of CASES) {
		it(`${c.unlocks ? 'unlocks on' : 'ignores'} ${c.name}`, () => {
			expect(isUnlockGesture(c.presses)).toBe(c.unlocks);
		});
	}

	it('the bridge block applies the same rules', () => {
		const bridge = installBridgeGuard(makeFrame());
		for (const c of CASES) expect([c.name, bridge(c.presses)]).toEqual([c.name, c.unlocks]);
	});
});

describe('parsePointerLockMessage', () => {
	it('reads the frame messages and nothing else', () => {
		expect(parsePointerLockMessage({ type: POINTER_LOCK_MESSAGE, state: 'locked' })).toBe('locked');
		expect(parsePointerLockMessage({ type: POINTER_LOCK_MESSAGE, state: 'nope' })).toBeNull();
		expect(parsePointerLockMessage({ type: 'other', state: 'locked' })).toBeNull();
		expect(parsePointerLockMessage(null)).toBeNull();
	});
});

/* ---------- the guards, frame-side (bridge) and parent-side (TS) ---------- */

for (const [label, install] of [
	['bridge block', installBridgeGuard],
	['watchDocumentPointerLock', installTsGuard]
] as const) {
	describe(`pointer lock guard: ${label}`, () => {
		let now = 1_000_000;
		const advance = (ms: number) => {
			now += ms;
			vi.setSystemTime(now);
		};
		beforeEach(() => {
			vi.useFakeTimers();
			vi.setSystemTime(now);
		});
		afterEach(() => vi.useRealTimers());

		function doubleDoubleClick(frame: Frame) {
			frame.press();
			advance(150);
			frame.press();
			advance(300);
			frame.press();
			advance(150);
			return frame.press();
		}

		it('reports the lock and releases it on two double-clicks', () => {
			const frame = makeFrame();
			install(frame);
			frame.lock();
			expect(frame.posted).toEqual(['locked']);

			const last = doubleDoubleClick(frame);
			expect(frame.doc.pointerLockElement).toBeNull();
			expect(frame.cursorForced()).toBe(true);
			expect(frame.posted).toEqual(['locked', 'unlocked', 'released']);
			/* The game never sees the unlocking press, so it cannot re-lock on its click. */
			expect(last.down.defaultPrevented).toBe(true);
			expect(last.click.stopped).toBe(true);

			/* Locking again hands the cursor back to the game. */
			advance(2000);
			frame.lock();
			expect(frame.cursorForced()).toBe(false);
		});

		it('leaves rapid fire alone', () => {
			const frame = makeFrame();
			install(frame);
			frame.lock();
			for (let i = 0; i < 8; i++) {
				frame.press();
				advance(120);
			}
			expect(frame.doc.pointerLockElement).not.toBeNull();
			expect(frame.posted).toEqual(['locked']);
		});

		it('does not unlock while the player is aiming', () => {
			const frame = makeFrame();
			install(frame);
			frame.lock();
			frame.press();
			frame.move(30);
			advance(150);
			frame.press();
			frame.move(30);
			advance(300);
			frame.press();
			advance(150);
			frame.press();
			expect(frame.doc.pointerLockElement).not.toBeNull();
		});

		it('leaves quick clicks on a visible cursor alone', () => {
			const frame = makeFrame();
			install(frame);
			doubleDoubleClick(frame);
			expect(frame.posted).toEqual([]);
			expect(frame.cursorForced()).toBe(false);
		});

		it('reports a hidden cursor that keeps being clicked, once, and shows it on the gesture', () => {
			const frame = makeFrame();
			install(frame);
			frame.canvas.cursor = 'none';
			for (let i = 0; i < 5; i++) {
				frame.press();
				advance(700);
			}
			expect(frame.posted).toEqual(['stuck']);
			advance(2000);
			doubleDoubleClick(frame);
			expect(frame.posted).toEqual(['stuck', 'released']);
			expect(frame.cursorForced()).toBe(true);
		});
	});
}
