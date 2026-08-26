import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Runs the real Android bridge script in a hand-built stub frame.
 *
 * The file ships as a raw Android resource and is injected by
 * `WebViewCompat.addDocumentStartJavaScript`, so it can never be imported. It is also the
 * one piece of this feature with no type checker behind it and the widest blast radius —
 * it executes inside every frame of every third-party game — which makes the key-usage
 * detection worth pinning down here rather than only on a device.
 */

const BRIDGE = readFileSync(
	resolve(process.cwd(), 'src-tauri/gen/android/app/src/main/res/raw/native_touch_bridge.js'),
	'utf8'
);

type Report = {
	type: string;
	listens: boolean;
	listenerCount: number;
	declared: string[];
	inferred: string[];
};

type Frame = {
	reports: Report[];
	/** Register a key handler the way a game would, so the wrapper sees its source. */
	bindKeyHandler: (source: string) => void;
	/** Assign one the old way, via the `onkeydown` IDL attribute. */
	assignHandlerProp: (source: string) => unknown;
	/** What the native IDL setter actually received. */
	wiredHandler: () => unknown;
	document: { onkeydown: unknown };
	/** Run every pending timer callback due within `ms`, repeatedly until quiet. */
	flush: (ms: number) => void;
	navigator: { maxTouchPoints: number };
};

function runBridge(options: {
	hostname: string;
	scripts?: string[];
	size?: [number, number];
}): Frame {
	const [innerWidth, innerHeight] = options.size ?? [800, 600];
	const reports: Report[] = [];
	let clock = 0;
	const timers: { at: number; fn: () => void; id: number }[] = [];
	let nextTimerId = 1;

	const setTimeoutStub = (fn: () => void, ms: number) => {
		const id = nextTimerId++;
		timers.push({ at: clock + (ms || 0), fn, id });
		return id;
	};
	const clearTimeoutStub = (id: number) => {
		const i = timers.findIndex((t) => t.id === id);
		if (i >= 0) timers.splice(i, 1);
	};

	class FakeEventTarget {
		addEventListener(...args: [string, unknown]): void {
			void args;
		}
		removeEventListener(...args: [string, unknown]): void {
			void args;
		}
		dispatchEvent(): boolean {
			return true;
		}
	}

	/*
	 * `onkeydown` is an IDL attribute: the real setter is what wires the handler to the
	 * event loop. Model it as a genuine accessor pair on a prototype so the spec can prove
	 * the bridge forwards to it instead of swallowing the assignment.
	 */
	const wired: Record<string, unknown> = {};
	function withHandlerProps<T extends object>(obj: T, label: string): T {
		const proto = Object.create(Object.getPrototypeOf(obj) as object);
		for (const prop of ['onkeydown', 'onkeyup']) {
			Object.defineProperty(proto, prop, {
				configurable: true,
				get() {
					return wired[label + '.' + prop] ?? null;
				},
				set(fn: unknown) {
					wired[label + '.' + prop] = fn;
				}
			});
		}
		Object.setPrototypeOf(obj, proto);
		return obj;
	}

	const scripts = (options.scripts ?? []).map((textContent) => ({ textContent }));
	const documentStub = withHandlerProps(
		{
			readyState: 'complete',
			body: null,
			documentElement: null,
			addEventListener: () => {},
			getElementsByTagName: () => scripts,
			querySelector: () => null,
			querySelectorAll: () => [] as unknown[]
		},
		'document'
	);

	const top = { postMessage: (data: Report) => reports.push(data) };
	const windowStub: Record<string, unknown> = {
		innerWidth,
		innerHeight,
		addEventListener: () => {},
		removeEventListener: () => {},
		postMessage: () => {},
		matchMedia: () => ({
			matches: false,
			addEventListener: () => {},
			removeEventListener: () => {}
		}),
		parent: top,
		top
	};

	withHandlerProps(windowStub, 'window');

	const navigatorStub = { maxTouchPoints: 5, userAgent: 'stub' };

	const fn = new Function(
		'window',
		'document',
		'navigator',
		'screen',
		'location',
		'EventTarget',
		'KeyboardEvent',
		'Event',
		'setTimeout',
		'clearTimeout',
		BRIDGE
	);
	fn(
		windowStub,
		documentStub,
		navigatorStub,
		{},
		{ hostname: options.hostname, href: `https://${options.hostname}/game` },
		FakeEventTarget,
		class {},
		class {},
		setTimeoutStub,
		clearTimeoutStub
	);

	return {
		reports,
		navigator: navigatorStub,
		document: documentStub as unknown as { onkeydown: unknown },
		wiredHandler: () => wired['document.onkeydown'],
		assignHandlerProp(source: string) {
			const handler = new Function('e', source);
			(documentStub as unknown as { onkeydown: unknown }).onkeydown = handler;
			return handler;
		},
		bindKeyHandler(source: string) {
			const handler = new Function('e', source);
			new FakeEventTarget().addEventListener('keydown', handler);
		},
		flush(ms: number) {
			clock += ms;
			for (let guard = 0; guard < 50; guard++) {
				const due = timers.filter((t) => t.at <= clock);
				if (!due.length) return;
				for (const t of due) {
					clearTimeoutStub(t.id);
					t.fn();
				}
			}
		}
	};
}

const latest = (frame: Frame): Report | undefined =>
	[...frame.reports].reverse().find((r) => r.type === 'potato-tomato-key-profile');

describe('native touch bridge — key usage detection', () => {
	it('reads the control scheme a portal declares in its bootstrap', () => {
		const frame = runBridge({
			hostname: 'games.crazygames.com',
			scripts: [
				'var options = {"gameSlug":"x","controls":{"text":"<h3>Controls</h3><ul><li>WASD or arrow keys = move</li><li>Space = dash</li></ul>"}};'
			]
		});
		frame.flush(1000);
		expect(latest(frame)?.declared.sort()).toEqual([
			'ArrowDown',
			'ArrowLeft',
			'ArrowRight',
			'ArrowUp',
			'KeyA',
			'KeyD',
			'KeyS',
			'KeyW',
			'Space'
		]);
	});

	const declaredFrom = (text: string) => {
		const frame = runBridge({
			hostname: 'games.crazygames.com',
			scripts: [`var options = {"controls":{"text":${JSON.stringify(text)}}};`]
		});
		frame.flush(1000);
		return latest(frame)?.declared ?? [];
	};

	it('does not mistake ordinary English in a control blurb for a key', () => {
		/* Each of these declared a stray code once, and a stray declared code hides controls. */
		expect(declaredFrom('Tap a key to begin.')).not.toContain('KeyA');
		expect(declaredFrom('Collect a key to open doors.')).not.toContain('KeyA');
		expect(declaredFrom('Press a key to start.')).not.toContain('KeyA');
		/* A numbered step list uses the same dash a binding would. */
		expect(declaredFrom('1 - move with the mouse')).not.toContain('Digit1');
	});

	it('still reads the shapes a real control list uses', () => {
		expect(declaredFrom('Hold the R key to reload.')).toContain('KeyR');
		expect(declaredFrom('Press e to interact.')).toContain('KeyE');
		expect(declaredFrom('Press A to jump.')).toContain('KeyA');
		expect(declaredFrom('The B key blocks.')).toContain('KeyB');
		expect(declaredFrom('E = interact')).toContain('KeyE');
		expect(declaredFrom('1 = pistol')).toContain('Digit1');
	});

	it('reads codes out of the key handlers a game registers', () => {
		const frame = runBridge({ hostname: 'game.example.test' });
		frame.bindKeyHandler('if (e.code === "KeyE") return 1; if (e.keyCode === 32) return 2;');
		frame.flush(1000);
		const report = latest(frame);
		expect(report?.listens).toBe(true);
		expect(report?.inferred).toContain('KeyE');
		expect(report?.inferred).toContain('Space');
	});

	it('ignores keys that only ever appear behind a modifier', () => {
		const frame = runBridge({ hostname: 'game.example.test' });
		frame.bindKeyHandler(
			'if (e.ctrlKey && e.key === "s") return 1; if (e.metaKey && e.code === "KeyR") return 2;'
		);
		frame.flush(1000);
		const report = latest(frame);
		/* The console cannot send Ctrl+S, so an S button for it would be dead clutter. */
		expect(report?.inferred).not.toContain('KeyS');
		expect(report?.inferred).not.toContain('KeyR');
		expect(report?.listens).toBe(true);
	});

	it('still wires up a handler assigned the old way, via document.onkeydown', () => {
		const frame = runBridge({ hostname: 'game.example.test' });
		const handler = frame.assignHandlerProp('if (e.code === "KeyF") return 1;');
		frame.flush(1000);
		/*
		 * The regression this guards: an accessor that only stored the function for
		 * scanning left the game deaf to every key, from a real keyboard and from the
		 * console alike. The native IDL setter has to see it.
		 */
		expect(frame.wiredHandler()).toBe(handler);
		expect(frame.document.onkeydown).toBe(handler);
		expect(latest(frame)?.inferred).toContain('KeyF');
	});

	it('reports that nothing listens, so the console can say so', () => {
		const frame = runBridge({ hostname: 'game.example.test' });
		frame.flush(1000);
		const report = latest(frame);
		expect(report).toBeDefined();
		expect(report?.listens).toBe(false);
		expect(report?.inferred).toEqual([]);
	});

	it('stays silent in ad frames, which bind key handlers of their own', () => {
		const frame = runBridge({ hostname: 'imasdk.googleapis.com' });
		frame.bindKeyHandler('if (e.code === "Escape") return 1;');
		frame.flush(1000);
		expect(latest(frame)).toBeUndefined();
	});

	it('stays silent in frames too small to hold a game', () => {
		const frame = runBridge({ hostname: 'pixel.example.test', size: [1, 1] });
		frame.bindKeyHandler('if (e.code === "Space") return 1;');
		frame.flush(1000);
		expect(latest(frame)).toBeUndefined();
	});

	it('presents desktop touch traits to the shell we already tell "desktop"', () => {
		const shell = runBridge({ hostname: 'games.crazygames.com' });
		expect(shell.navigator.maxTouchPoints).toBe(0);

		/* The playable frame is a different host and must keep real touch. */
		const game = runBridge({ hostname: '10-minute-mage.game-files.crazygames.com' });
		expect(game.navigator.maxTouchPoints).toBe(5);
	});
});
