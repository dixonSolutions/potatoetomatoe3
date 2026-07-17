import { isPublicSiteDeployment } from './offline-deployment';

/**
 * Same-origin touch → keyboard translation for game iframes.
 * Recurses nested same-origin frames (like broadcastGamePause) and stops at cross-origin boundaries.
 */

import type { TouchDirection, TouchKeyCode } from '$lib/utils/touch-console';

/**
 * Cross-platform touch-first heuristic. Browsers do not expose physical
 * keyboard presence, so combine touch capability with coarse/no-hover input.
 */
export function isTouchOnlyDevice(): boolean {
	if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
	const touchPoints = navigator.maxTouchPoints ?? 0;
	const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
	const hoverInput = window.matchMedia?.('(hover: hover)').matches ?? false;
	return touchPoints > 0 && coarsePointer && !hoverInput;
}

export type InjectableTarget = {
	doc: Document;
	win: Window;
	canvas: HTMLCanvasElement | HTMLElement | null;
	/** True when we reached a document that likely hosts the game (canvas / nested deepest). */
	depth: number;
};

const KEY_CODE_TO_KEY: Record<string, string> = {
	ArrowUp: 'ArrowUp',
	ArrowDown: 'ArrowDown',
	ArrowLeft: 'ArrowLeft',
	ArrowRight: 'ArrowRight',
	Space: ' ',
	Enter: 'Enter',
	Escape: 'Escape',
	ShiftLeft: 'Shift',
	ShiftRight: 'Shift',
	ControlLeft: 'Control',
	ControlRight: 'Control',
	AltLeft: 'Alt',
	AltRight: 'Alt',
	Tab: 'Tab',
	Backspace: 'Backspace'
};

const KEY_CODE_TO_KEY_CODE: Record<string, number> = {
	ArrowLeft: 37,
	ArrowUp: 38,
	ArrowRight: 39,
	ArrowDown: 40,
	Space: 32,
	Enter: 13,
	Escape: 27,
	ShiftLeft: 16,
	ShiftRight: 16,
	ControlLeft: 17,
	ControlRight: 17,
	AltLeft: 18,
	AltRight: 18,
	Tab: 9,
	Backspace: 8,
	KeyA: 65,
	KeyB: 66,
	KeyC: 67,
	KeyD: 68,
	KeyE: 69,
	KeyF: 70,
	KeyG: 71,
	KeyH: 72,
	KeyI: 73,
	KeyJ: 74,
	KeyK: 75,
	KeyL: 76,
	KeyM: 77,
	KeyN: 78,
	KeyO: 79,
	KeyP: 80,
	KeyQ: 81,
	KeyR: 82,
	KeyS: 83,
	KeyT: 84,
	KeyU: 85,
	KeyV: 86,
	KeyW: 87,
	KeyX: 88,
	KeyY: 89,
	KeyZ: 90
};

function keyFromCode(code: string): string {
	if (KEY_CODE_TO_KEY[code]) return KEY_CODE_TO_KEY[code];
	if (code.startsWith('Key') && code.length === 4) return code.slice(3).toLowerCase();
	if (code.startsWith('Digit') && code.length === 6) return code.slice(5);
	return code;
}

function keyCodeFromCode(code: string): number {
	if (KEY_CODE_TO_KEY_CODE[code] != null) return KEY_CODE_TO_KEY_CODE[code];
	if (code.startsWith('Key') && code.length === 4) return code.charCodeAt(3);
	if (code.startsWith('Digit') && code.length === 6) return code.charCodeAt(5);
	return 0;
}

function findCanvas(doc: Document): HTMLCanvasElement | HTMLElement | null {
	const canvas = doc.querySelector('canvas');
	if (canvas instanceof HTMLCanvasElement) return canvas;
	const unity = doc.querySelector(
		'#unity-canvas, #gameContainer, #game, .game-canvas, [data-game-canvas]'
	);
	if (unity instanceof HTMLElement) return unity;
	return null;
}

/**
 * Walk same-origin nested iframes and prefer the deepest document that has a canvas.
 * Returns null if the top iframe itself is cross-origin.
 */
export function resolveInjectable(
	iframe: HTMLIFrameElement | null | undefined
): InjectableTarget | null {
	if (!iframe) return null;
	try {
		const win = iframe.contentWindow;
		const doc = iframe.contentDocument;
		if (!win || !doc) return null;

		let best: InjectableTarget = {
			doc,
			win,
			canvas: findCanvas(doc),
			depth: 0
		};

		const visit = (root: Document, depth: number) => {
			for (const frame of root.querySelectorAll('iframe')) {
				if (!(frame instanceof HTMLIFrameElement)) continue;
				try {
					const childDoc = frame.contentDocument;
					const childWin = frame.contentWindow;
					if (!childDoc || !childWin) continue;
					const canvas = findCanvas(childDoc);
					const candidate: InjectableTarget = { doc: childDoc, win: childWin, canvas, depth };
					if (canvas && (!best.canvas || depth >= best.depth)) {
						best = candidate;
					} else if (!best.canvas && depth > best.depth) {
						best = candidate;
					}
					visit(childDoc, depth + 1);
				} catch {
					/* cross-origin nested frame — stop here */
				}
			}
		};

		visit(doc, 1);

		// Shell-only documents with a nested cross-origin game (Unity player.html, online shells)
		// are not useful for keyboard injection into the actual game.
		const nested = doc.querySelectorAll('iframe');
		if (!best.canvas && nested.length > 0) {
			let anySameOriginChild = false;
			for (const frame of nested) {
				if (!(frame instanceof HTMLIFrameElement)) continue;
				try {
					if (frame.contentDocument) anySameOriginChild = true;
				} catch {
					/* cross-origin */
				}
			}
			if (!anySameOriginChild) {
				return null;
			}
		}

		return best;
	} catch {
		return null;
	}
}

/**
 * Heuristic: can the parent page likely inject into this play URL's top iframe?
 * Does not replace resolveInjectable — use both (URL hint + live probe).
 */
function isPullerPlayProxyPath(pathname: string): boolean {
	return pathname.includes('/api/unity-play/') || pathname.includes('/api/game-live/');
}

export function isLikelyInjectableUrl(url: string | null | undefined): boolean {
	if (!url) return false;
	const u = url.trim();
	if (!u) return false;
	if (u.startsWith('blob:')) return true;
	if (u.includes('/puller-games/')) return true;
	if (u.includes('/browser-offline/')) return true;
	if (
		(u.includes('/api/unity-play/') || u.includes('/api/game-live/')) &&
		!isPublicSiteDeployment()
	)
		return true;
	if (u.includes('/games/') && u.includes('/offline/')) return true;
	// Same-origin shells that nest a cross-origin game — not injectable for the real game.
	if (u.includes('/unity/player.html')) return false;
	if (u.includes('/games/') && u.includes('/online/') && !u.includes('/offline/')) return false;
	try {
		if (typeof window !== 'undefined') {
			const parsed = new URL(u, window.location.href);
			if (parsed.origin !== window.location.origin) return false;
		}
	} catch {
		return false;
	}
	return true;
}

/**
 * URLs where inject.js (or storage bridge) runs in the top game iframe and accepts
 * `potato-tomato-touch-input` postMessage — even when contentDocument is cross-origin.
 */
export function canUseTouchBridge(url: string | null | undefined): boolean {
	if (!url) return false;
	const u = url.trim();
	if (!u) return false;
	if (
		(u.includes('/api/unity-play/') || u.includes('/api/game-live/')) &&
		!isPublicSiteDeployment()
	)
		return true;
	if (u.includes('/puller-games/') && u.includes('/offline/')) return true;
	if (u.includes('/games/') && u.includes('/offline/')) return true;
	if (u.includes('/browser-offline/')) return true;
	if (u.startsWith('blob:')) return true;
	try {
		const proxy = (import.meta.env.PUBLIC_PLAY_PROXY_URL as string | undefined)?.replace(/\/$/, '');
		if (proxy) {
			const parsed = new URL(
				u,
				typeof window !== 'undefined' ? window.location.href : 'http://local'
			);
			const proxyOrigin = new URL(proxy).origin;
			if (parsed.origin === proxyOrigin && isPullerPlayProxyPath(parsed.pathname)) return true;
		}
	} catch {
		/* ignore */
	}
	try {
		if (typeof window !== 'undefined') {
			const parsed = new URL(u, window.location.href);
			/* Packaged Tauri puller on loopback */
			if (
				(parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') &&
				isPullerPlayProxyPath(parsed.pathname)
			) {
				return true;
			}
		}
	} catch {
		/* ignore */
	}
	return false;
}

export type TouchBridgeMessage = {
	type: 'potato-tomato-touch-input';
	action: 'down' | 'up' | 'releaseAll';
	code?: string;
	codes?: string[];
	/** When set, child bridge replies with potato-tomato-touch-input-ack (dev harness). */
	ackId?: string;
};

export class KeyDispatcher {
	private held = new Set<TouchKeyCode>();
	/** Codes currently held by the joystick channel (not action buttons). */
	private joystickHeld = new Set<TouchKeyCode>();
	private target: InjectableTarget | null = null;
	/** Cross-origin iframe that hosts inject.js (postMessage fallback). */
	private bridgeFrame: HTMLIFrameElement | null = null;

	setTarget(target: InjectableTarget | null): void {
		if (!target) {
			/* Clearing for a bridge handoff — do not release held keys here. */
			this.target = null;
			return;
		}
		const same =
			this.target?.doc === target.doc &&
			this.target?.win === target.win &&
			this.target?.canvas === target.canvas &&
			!this.bridgeFrame;
		if (same) return;
		/* Switching dispatch destination — drop prior keys once. */
		if (this.target || this.bridgeFrame) this.releaseAll();
		this.target = target;
		this.bridgeFrame = null;
	}

	setBridgeFrame(frame: HTMLIFrameElement | null): void {
		if (!frame) {
			if (this.bridgeFrame) {
				this.releaseAll();
				this.bridgeFrame = null;
			}
			return;
		}
		const same = this.bridgeFrame === frame && !this.target;
		if (same) return;
		if (this.target || (this.bridgeFrame && this.bridgeFrame !== frame)) this.releaseAll();
		this.bridgeFrame = frame;
		this.target = null;
	}

	getTarget(): InjectableTarget | null {
		return this.target;
	}

	hasDispatchPath(): boolean {
		return Boolean(this.target || this.bridgeFrame?.contentWindow);
	}

	isHeld(code: TouchKeyCode): boolean {
		return this.held.has(code);
	}

	private postBridge(msg: TouchBridgeMessage): void {
		const win = this.bridgeFrame?.contentWindow;
		if (!win) return;
		try {
			win.postMessage(msg, '*');
		} catch {
			/* ignore */
		}
	}

	/** Optional ackId attached to the next bridge postMessage (cleared after use). */
	private pendingAckId: string | null = null;

	setPendingAckId(ackId: string | null): void {
		this.pendingAckId = ackId;
	}

	getDispatchPathKind(): 'dom' | 'bridge' | 'none' {
		if (this.target) return 'dom';
		if (this.bridgeFrame?.contentWindow) return 'bridge';
		return 'none';
	}

	private withAck(msg: TouchBridgeMessage): TouchBridgeMessage {
		if (!this.pendingAckId) return msg;
		return { ...msg, ackId: this.pendingAckId };
	}

	private clearPendingAckId(): void {
		this.pendingAckId = null;
	}

	/** Focus the game once per press burst — not on every joystick tick (WebKit freezes otherwise). */
	private focusTargetOnce(): void {
		const t = this.target;
		if (!t) return;
		try {
			t.canvas?.focus?.({ preventScroll: true } as FocusOptions);
		} catch {
			/* ignore */
		}
	}

	private dispatch(type: 'keydown' | 'keyup', code: TouchKeyCode): void {
		if (this.bridgeFrame?.contentWindow && !this.target) {
			this.postBridge(
				this.withAck({
					type: 'potato-tomato-touch-input',
					action: type === 'keydown' ? 'down' : 'up',
					codes: [code]
				})
			);
			return;
		}

		const t = this.target;
		if (!t) return;
		const key = keyFromCode(code);
		const keyCode = keyCodeFromCode(code);
		const init: KeyboardEventInit = {
			key,
			code,
			keyCode,
			which: keyCode,
			bubbles: true,
			cancelable: true,
			composed: true,
			view: t.win
		};

		const makeEvent = (): KeyboardEvent => {
			/* Prefer the iframe realm's KeyboardEvent — parent-constructed events are often ignored. */
			const winWithKE = t.win as Window & { KeyboardEvent: typeof KeyboardEvent };
			const Ctor = winWithKE.KeyboardEvent || KeyboardEvent;
			const event = new Ctor(type, init);
			try {
				Object.defineProperty(event, 'keyCode', { get: () => keyCode });
				Object.defineProperty(event, 'which', { get: () => keyCode });
				Object.defineProperty(event, 'charCode', { get: () => 0 });
			} catch {
				/* ignore */
			}
			return event;
		};

		try {
			/*
			 * One primary target only. Fanning key events to body/document/window on every
			 * joystick frame stalls Unity/WebKit (looks like the game "freezes").
			 */
			const primary = t.canvas ?? t.doc.body ?? t.doc.documentElement ?? t.win;
			primary.dispatchEvent(makeEvent());
		} catch {
			/* ignore */
		}
	}

	down(codes: TouchKeyCode[]): void {
		if (!this.hasDispatchPath() || !codes.length) {
			this.clearPendingAckId();
			return;
		}
		const firstPress = this.held.size === 0;
		if (firstPress && this.target) this.focusTargetOnce();
		try {
			for (const code of codes) {
				if (this.held.has(code)) continue;
				this.held.add(code);
				this.dispatch('keydown', code);
			}
		} finally {
			this.clearPendingAckId();
		}
	}

	up(codes: TouchKeyCode[]): void {
		try {
			for (const code of codes) {
				if (!this.held.has(code)) continue;
				this.held.delete(code);
				this.joystickHeld.delete(code);
				this.dispatch('keyup', code);
			}
		} finally {
			this.clearPendingAckId();
		}
	}

	/**
	 * Diff currently held *joystick* direction codes against the desired set.
	 * Does not release action-button keys held via `down()`.
	 */
	setJoystickCodes(nextCodes: TouchKeyCode[]): void {
		const next = new Set(nextCodes);
		const toRelease: TouchKeyCode[] = [];
		const toPress: TouchKeyCode[] = [];
		for (const code of this.joystickHeld) {
			if (!next.has(code)) toRelease.push(code);
		}
		for (const code of next) {
			if (!this.joystickHeld.has(code)) toPress.push(code);
		}
		/* No-op when the direction set is unchanged — pointermove fires every frame. */
		if (!toRelease.length && !toPress.length) return;
		if (toRelease.length) {
			for (const code of toRelease) this.joystickHeld.delete(code);
			this.up(toRelease);
		}
		if (toPress.length) {
			for (const code of toPress) this.joystickHeld.add(code);
			this.down(toPress);
		}
	}

	/** True while any touch key is held — callers should avoid rebinding targets mid-gesture. */
	hasHeldKeys(): boolean {
		return this.held.size > 0;
	}

	/** @deprecated Use setJoystickCodes — kept as alias for clarity in call sites. */
	setHeldCodes(nextCodes: TouchKeyCode[]): void {
		this.setJoystickCodes(nextCodes);
	}

	releaseAll(): void {
		try {
			if (!this.held.size) {
				if (this.bridgeFrame?.contentWindow && !this.target) {
					this.postBridge(
						this.withAck({ type: 'potato-tomato-touch-input', action: 'releaseAll' })
					);
				}
				return;
			}
			const codes = [...this.held];
			this.held.clear();
			this.joystickHeld.clear();
			if (this.bridgeFrame?.contentWindow && !this.target) {
				this.postBridge(
					this.withAck({ type: 'potato-tomato-touch-input', action: 'releaseAll' })
				);
				return;
			}
			for (const code of codes) {
				this.dispatch('keyup', code);
			}
		} finally {
			this.clearPendingAckId();
		}
	}

	/**
	 * Convert a normalized joystick vector into direction key codes using an 8-way gate.
	 * Deadzone is applied by the caller (pass 0,0 when inside deadzone).
	 */
	static directionsFromVector(
		x: number,
		y: number,
		mapping: Record<TouchDirection, TouchKeyCode[]>
	): TouchKeyCode[] {
		const codes: TouchKeyCode[] = [];
		const threshold = 0.35;
		if (y < -threshold) codes.push(...mapping.up);
		if (y > threshold) codes.push(...mapping.down);
		if (x < -threshold) codes.push(...mapping.left);
		if (x > threshold) codes.push(...mapping.right);
		return codes;
	}
}
