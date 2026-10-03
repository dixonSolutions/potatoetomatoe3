/**
 * Games that grab the mouse (`requestPointerLock()`, FPS-style mouse look) keep it. This is
 * the way back out, and what tells the player it happened:
 *
 *   - the game locks the pointer → a one-line hint: two quick double-clicks unlock it;
 *   - the game hides the cursor (`cursor: none`) and the player keeps clicking without a
 *     lock → the same hint, since that looks exactly like a stuck cursor;
 *   - two quick double-clicks → `exitPointerLock()`, and the cursor is forced visible until
 *     the game locks it again.
 *
 * Esc is left alone: browsers release a pointer lock on Esc themselves, and games that
 * handle Esc keep it.
 *
 * Pointer lock and the clicks that release it belong to the game's own document, so the
 * guard mostly runs inside the frame — the "Pointer lock guard" block appended to
 * `static/game-storage-bridge.child.js`, which posts {@link POINTER_LOCK_MESSAGE} to the
 * app. {@link watchDocumentPointerLock} is the same guard for documents the page can reach
 * itself (its own, and same-origin frames served without the bridge). The two copies share
 * {@link isUnlockGesture}'s rules; `pointer-lock.spec.ts` runs both against the same cases.
 */

export const POINTER_LOCK_MESSAGE = 'potato-tomato-pointer-lock';

/** Set on a window once a guard (bridge or parent-installed) watches its document. */
export const POINTER_LOCK_GUARD_FLAG = '__ptPointerLockGuard';

export type PointerLockState = 'locked' | 'unlocked' | 'stuck' | 'released';

export const UNLOCK_GESTURE = {
	/** Two double-clicks. */
	presses: 4,
	/** Longest gap inside one double-click. */
	pairMaxMs: 400,
	/** First press to last. */
	totalMaxMs: 1400,
	/**
	 * The pause between the two double-clicks must be this much longer than either click
	 * pair. Rapid fire in a shooter, or a clicker game, is evenly spaced; two double-clicks
	 * are not.
	 */
	pauseRatio: 1.25,
	/** Mouse travel allowed across the gesture: aiming moves the mouse, unlocking doesn't. */
	maxTravelPx: 48
} as const;

/** Presses on a hidden cursor, within `windowMs`, that count as "stuck". */
export const STUCK_CURSOR = { presses: 3, windowMs: 2500 } as const;

/** Clicks that follow the unlocking press are swallowed so the game cannot re-lock on them. */
export const SWALLOW_AFTER_UNLOCK_MS = 600;

export type UnlockPress = {
	/** Timestamp, ms. */
	at: number;
	/** Pointer travel counter when pressed, px — only differences matter. */
	travel: number;
};

/**
 * Whether the last four presses are two quick double-clicks. Only presses made while the
 * pointer is locked or the cursor is hidden are ever passed in.
 */
export function isUnlockGesture(presses: readonly UnlockPress[]): boolean {
	const g = UNLOCK_GESTURE;
	if (presses.length < g.presses) return false;
	const [a, b, c, d] = presses.slice(-g.presses);
	const total = d.at - a.at;
	if (total < 0 || total > g.totalMaxMs) return false;
	const firstPair = b.at - a.at;
	const pause = c.at - b.at;
	const secondPair = d.at - c.at;
	if (firstPair > g.pairMaxMs || secondPair > g.pairMaxMs) return false;
	if (pause < Math.max(firstPair, secondPair) * g.pauseRatio) return false;
	return d.travel - a.travel <= g.maxTravelPx;
}

export function parsePointerLockMessage(data: unknown): PointerLockState | null {
	if (!data || typeof data !== 'object') return null;
	const d = data as { type?: unknown; state?: unknown };
	if (d.type !== POINTER_LOCK_MESSAGE) return null;
	return d.state === 'locked' ||
		d.state === 'unlocked' ||
		d.state === 'stuck' ||
		d.state === 'released'
		? d.state
		: null;
}

const CURSOR_STYLE_ID = '__pt-cursor-visible';

function cursorHidden(target: EventTarget | null): boolean {
	const el = target as Element | null;
	if (!el || el.nodeType !== 1) return false;
	try {
		const view = el.ownerDocument?.defaultView;
		return view?.getComputedStyle(el).cursor === 'none';
	} catch {
		return false;
	}
}

/**
 * Watch one document for pointer lock and a stuck cursor, and release on the gesture.
 * Returns a detach function. Does nothing (and returns a no-op) when a guard already
 * watches this document — the bridge's, usually.
 */
export function watchDocumentPointerLock(
	doc: Document,
	onState: (state: PointerLockState) => void
): () => void {
	const win = doc.defaultView as (Window & Record<string, unknown>) | null;
	if (!win || win[POINTER_LOCK_GUARD_FLAG]) return () => {};
	win[POINTER_LOCK_GUARD_FLAG] = true;

	let presses: UnlockPress[] = [];
	let stuckAt: number[] = [];
	let stuckReported = false;
	let travel = 0;
	let lastPointerDownAt = -Infinity;
	let swallowUntil = 0;

	const showCursor = () => {
		if (doc.getElementById(CURSOR_STYLE_ID)) return;
		const style = doc.createElement('style');
		style.id = CURSOR_STYLE_ID;
		style.textContent = '*,*::before,*::after{cursor:auto!important}';
		(doc.head || doc.documentElement).appendChild(style);
	};
	const restoreCursor = () => doc.getElementById(CURSOR_STYLE_ID)?.remove();

	const release = () => {
		presses = [];
		stuckAt = [];
		stuckReported = false;
		swallowUntil = Date.now() + SWALLOW_AFTER_UNLOCK_MS;
		try {
			if (doc.pointerLockElement) doc.exitPointerLock();
		} catch {
			/* nothing to release */
		}
		showCursor();
		onState('released');
	};

	const onMove = (e: MouseEvent) => {
		travel += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0);
	};

	const onPress = (e: MouseEvent) => {
		const now = Date.now();
		if (now <= swallowUntil) {
			/* The unlocking press's own mousedown, or a click right after it. */
			e.preventDefault();
			e.stopImmediatePropagation();
			return;
		}
		if (e.button !== 0) return;
		if (e.type === 'pointerdown') {
			if ((e as PointerEvent).pointerType && (e as PointerEvent).pointerType !== 'mouse') return;
			lastPointerDownAt = now;
		} else if (now - lastPointerDownAt < 100) {
			return; /* the mousedown twin of a pointerdown already counted */
		}
		const locked = Boolean(doc.pointerLockElement);
		const hidden = !locked && cursorHidden(e.target);
		if (!locked && !hidden) {
			presses = [];
			return;
		}
		presses.push({ at: now, travel });
		if (presses.length > UNLOCK_GESTURE.presses) presses.shift();
		if (isUnlockGesture(presses)) {
			e.preventDefault();
			e.stopImmediatePropagation();
			release();
			return;
		}
		if (!hidden) return;
		stuckAt = stuckAt.filter((t) => now - t <= STUCK_CURSOR.windowMs);
		stuckAt.push(now);
		if (!stuckReported && stuckAt.length >= STUCK_CURSOR.presses) {
			stuckReported = true;
			onState('stuck');
		}
	};

	const onFollowUp = (e: Event) => {
		if (Date.now() > swallowUntil) return;
		e.preventDefault();
		e.stopImmediatePropagation();
	};

	const onLockChange = () => {
		presses = [];
		if (doc.pointerLockElement) {
			restoreCursor();
			onState('locked');
		} else {
			onState('unlocked');
		}
	};

	const followUps = ['pointerup', 'mouseup', 'click', 'dblclick'] as const;
	win.addEventListener('mousemove', onMove, true);
	win.addEventListener('pointerdown', onPress, true);
	win.addEventListener('mousedown', onPress, true);
	for (const type of followUps) win.addEventListener(type, onFollowUp, true);
	doc.addEventListener('pointerlockchange', onLockChange);

	return () => {
		win[POINTER_LOCK_GUARD_FLAG] = false;
		win.removeEventListener('mousemove', onMove, true);
		win.removeEventListener('pointerdown', onPress, true);
		win.removeEventListener('mousedown', onPress, true);
		for (const type of followUps) win.removeEventListener(type, onFollowUp, true);
		doc.removeEventListener('pointerlockchange', onLockChange);
		restoreCursor();
	};
}
