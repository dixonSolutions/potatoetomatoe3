import { describe, expect, it, vi } from 'vitest';
import { GAME_MENU_KEY, canSendGameKey, sendGameKey } from './game-key-tap';
import { KeyDispatcher } from './touch-input-dispatch';

describe('game-key-tap', () => {
	it('sends Escape, the key games use for their own menu', () => {
		expect(GAME_MENU_KEY).toBe('Escape');
	});

	it('reports no dispatch path when there is no frame', () => {
		expect(canSendGameKey(null, '/games/foo/offline/index.html')).toBe(false);
	});

	/*
	 * The toolbar button uses this return value to decide between staying quiet and
	 * explaining itself, so "could not reach the game" has to be false rather than
	 * an exception or a silent success.
	 */
	it('reports failure rather than throwing when the game cannot be reached', () => {
		expect(sendGameKey(null, '/games/foo/online/index.html')).toBe(false);
	});

	it('treats a frame with no contentWindow as unreachable', () => {
		const frame = { contentWindow: null, contentDocument: null } as unknown as HTMLIFrameElement;
		expect(canSendGameKey(frame, '/games/foo/offline/index.html')).toBe(false);
		expect(sendGameKey(frame, '/games/foo/offline/index.html')).toBe(false);
	});
});

describe('KeyDispatcher.tap', () => {
	it('presses and then releases, so a menu key does not stay held', () => {
		vi.useFakeTimers();
		try {
			const dispatcher = new KeyDispatcher();
			const posted: unknown[] = [];
			const frame = {
				contentWindow: { postMessage: (msg: unknown) => posted.push(msg) }
			} as unknown as HTMLIFrameElement;
			dispatcher.setBridgeFrame(frame);

			dispatcher.tap([GAME_MENU_KEY]);
			expect(posted).toContainEqual(
				expect.objectContaining({ action: 'down', codes: [GAME_MENU_KEY] })
			);
			/* Still held: a game polling key state per frame must see the press. */
			expect(dispatcher.isHeld(GAME_MENU_KEY)).toBe(true);

			vi.runAllTimers();
			expect(posted).toContainEqual(
				expect.objectContaining({ action: 'up', codes: [GAME_MENU_KEY] })
			);
			expect(dispatcher.isHeld(GAME_MENU_KEY)).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it('does nothing when there is no dispatch path', () => {
		vi.useFakeTimers();
		try {
			const dispatcher = new KeyDispatcher();
			dispatcher.tap([GAME_MENU_KEY]);
			vi.runAllTimers();
			expect(dispatcher.isHeld(GAME_MENU_KEY)).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});
});
