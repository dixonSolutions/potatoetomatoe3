/**
 * Send a one-off key press into the running game frame.
 *
 * The touch console owns a long-lived `KeyDispatcher` because it holds keys down
 * across a gesture. Chrome-level actions — "open the game's own menu" — are the
 * opposite: a single press, fired from a toolbar button, with no state to keep
 * between calls. Wiring those through the console would mean the console has to
 * be enabled, switched ON, and showing before Escape is reachable at all, which
 * is exactly the trap this exists to avoid.
 *
 * Dispatch target resolution is shared with the console (`resolveInjectable` for
 * same-origin frames, the postMessage bridge otherwise), so a key sent from here
 * lands wherever a console key would have.
 */

import {
	KeyDispatcher,
	canUseTouchBridge,
	resolveInjectable,
	type InjectableTarget
} from '$lib/utils/touch-input-dispatch';

/** `KeyboardEvent.code` for the in-game menu key. Not the browser's Escape. */
export const GAME_MENU_KEY = 'Escape';

/**
 * Bind a fresh dispatcher to `iframe`, or return null when nothing can receive
 * keys — a raw third-party embed, or a frame that has not loaded yet.
 */
function bindDispatcher(iframe: HTMLIFrameElement | null, playerUrl: string): KeyDispatcher | null {
	if (!iframe) return null;
	const dispatcher = new KeyDispatcher();
	const target: InjectableTarget | null = resolveInjectable(iframe);
	if (target) {
		dispatcher.setTarget(target);
		return dispatcher;
	}
	if (iframe.contentWindow && canUseTouchBridge(playerUrl)) {
		dispatcher.setBridgeFrame(iframe);
		return dispatcher;
	}
	return null;
}

/**
 * True when a key sent now would actually reach the game.
 *
 * Used to decide whether to offer the button at all: a control that silently
 * does nothing is worse than one that is not there.
 */
export function canSendGameKey(iframe: HTMLIFrameElement | null, playerUrl: string): boolean {
	return bindDispatcher(iframe, playerUrl) !== null;
}

/**
 * Tap `code` inside the game frame. Returns false when there was no path to it,
 * so the caller can say so rather than leaving the player guessing.
 */
export function sendGameKey(
	iframe: HTMLIFrameElement | null,
	playerUrl: string,
	code: string = GAME_MENU_KEY
): boolean {
	const dispatcher = bindDispatcher(iframe, playerUrl);
	if (!dispatcher) return false;
	dispatcher.tap([code]);
	return true;
}
