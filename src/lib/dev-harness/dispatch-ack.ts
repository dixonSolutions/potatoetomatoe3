/**
 * Correlated dispatch acknowledgements for console-test.
 * Bridge path: child posts `potato-tomato-touch-input-ack` when `ackId` is present.
 * DOM path: harness observes keydown/keyup on the injectable document.
 */

export const TOUCH_INPUT_ACK_TYPE = 'potato-tomato-touch-input-ack';

export type DispatchPath = 'dom' | 'bridge' | 'none';

export interface TouchInputAck {
	type: typeof TOUCH_INPUT_ACK_TYPE;
	ackId: string;
	action: 'down' | 'up' | 'releaseAll';
	codes: string[];
	path: 'bridge';
	ok: boolean;
}

export interface PendingAck {
	ackId: string;
	action: 'down' | 'up' | 'releaseAll';
	codes: string[];
	path: DispatchPath;
	startedAt: number;
	resolved: boolean;
}

let nextAckSeq = 1;

export function createAckId(): string {
	return `ack-${Date.now().toString(36)}-${nextAckSeq++}`;
}

export function isTouchInputAck(data: unknown): data is TouchInputAck {
	if (!data || typeof data !== 'object') return false;
	const msg = data as Record<string, unknown>;
	return (
		msg.type === TOUCH_INPUT_ACK_TYPE &&
		typeof msg.ackId === 'string' &&
		(msg.action === 'down' || msg.action === 'up' || msg.action === 'releaseAll') &&
		msg.path === 'bridge' &&
		typeof msg.ok === 'boolean'
	);
}

export type AckWaitResult =
	| { status: 'ok'; ack: TouchInputAck | { path: 'dom'; codes: string[] } }
	| { status: 'timeout'; ackId: string }
	| { status: 'skipped'; reason: string };

/**
 * Wait for a bridge ack message, or resolve immediately for DOM path after a short observe window.
 */
export function waitForDispatchAck(options: {
	ackId: string;
	path: DispatchPath;
	timeoutMs?: number;
	domCodes?: string[];
	iframeWin?: Window | null;
}): Promise<AckWaitResult> {
	const { ackId, path, timeoutMs = 1500, domCodes = [], iframeWin } = options;

	if (path === 'none') {
		return Promise.resolve({ status: 'skipped', reason: 'No dispatch path' });
	}

	if (path === 'dom') {
		return new Promise((resolve) => {
			const seen = new Set<string>();
			const onKey = (event: Event) => {
				const ke = event as KeyboardEvent;
				if (ke.code) seen.add(ke.code);
			};
			const doc = iframeWin?.document;
			doc?.addEventListener('keydown', onKey, true);
			doc?.addEventListener('keyup', onKey, true);
			window.setTimeout(() => {
				doc?.removeEventListener('keydown', onKey, true);
				doc?.removeEventListener('keyup', onKey, true);
				const matched = domCodes.length === 0 || domCodes.some((c) => seen.has(c));
				if (matched || seen.size > 0) {
					resolve({
						status: 'ok',
						ack: { path: 'dom', codes: [...seen] }
					});
				} else {
					resolve({ status: 'timeout', ackId });
				}
			}, Math.min(timeoutMs, 400));
		});
	}

	return new Promise((resolve) => {
		const timer = window.setTimeout(() => {
			window.removeEventListener('message', onMessage);
			resolve({ status: 'timeout', ackId });
		}, timeoutMs);

		function onMessage(event: MessageEvent) {
			if (!isTouchInputAck(event.data)) return;
			if (event.data.ackId !== ackId) return;
			window.clearTimeout(timer);
			window.removeEventListener('message', onMessage);
			resolve({ status: 'ok', ack: event.data });
		}

		window.addEventListener('message', onMessage);
	});
}
