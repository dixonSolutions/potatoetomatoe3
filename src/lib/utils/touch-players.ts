/**
 * Multiplayer detection for the touch controls.
 *
 * A same-keyboard two-player game gives each player a direction cluster (WASD for one,
 * the arrows for the other) and a few action keys on that player's side of the keyboard.
 * When the game listens to both clusters and either its own text names two players or
 * each cluster has its own action keys, the controls split into one set per player:
 * player 1 on the left half of the screen, player 2 on the right.
 *
 * Pure functions over KeyboardEvent.code values; no DOM.
 */

export type DirectionScheme = 'wasd' | 'arrows';

export type TouchPlayer = {
	/** 1-based, left to right on screen. */
	index: number;
	directions: DirectionScheme;
	/** Action codes this player presses (no direction keys). */
	actions: string[];
};

const WASD = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];
const ARROWS = ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];

/** Keys a left-hand (WASD) player reaches. */
const LEFT_HAND = new Set([
	'Space',
	'ShiftLeft',
	'ControlLeft',
	'AltLeft',
	'Tab',
	'CapsLock',
	'Backquote',
	'KeyQ',
	'KeyE',
	'KeyR',
	'KeyT',
	'KeyF',
	'KeyG',
	'KeyZ',
	'KeyX',
	'KeyC',
	'KeyV',
	'KeyB',
	'Digit1',
	'Digit2',
	'Digit3',
	'Digit4',
	'Digit5'
]);

/** Keys a right-hand (arrows) player reaches. */
const RIGHT_HAND = new Set([
	'Enter',
	'NumpadEnter',
	'ShiftRight',
	'ControlRight',
	'AltRight',
	'Slash',
	'Period',
	'Comma',
	'Semicolon',
	'Quote',
	'BracketLeft',
	'BracketRight',
	'Backslash',
	'KeyI',
	'KeyO',
	'KeyP',
	'KeyJ',
	'KeyK',
	'KeyL',
	'KeyM',
	'KeyN',
	'Digit0',
	'Digit9',
	'Digit8',
	'Insert',
	'Delete',
	'End',
	'PageDown',
	'Numpad0',
	'Numpad1',
	'Numpad2',
	'Numpad3',
	'NumpadDecimal'
]);

const TWO_PLAYER_TEXT =
	/\b(2|two)[\s-]?players?\b|\bplayer\s*(2|two)\b|\bp2\b|\b1\s*v(s|ersus)?\s*1\b|\blocal\s+(co-?op|multiplayer)\b|\bsame\s+(keyboard|device|computer)\b/i;

function countOf(codes: Set<string>, cluster: string[]): number {
	return cluster.filter((c) => codes.has(c)).length;
}

/** Does the game's own description say two people play on one keyboard? */
export function mentionsTwoPlayers(text: string | null | undefined): boolean {
	return Boolean(text && TWO_PLAYER_TEXT.test(text));
}

/**
 * Split the game's keys into players.
 *
 * `codes` are the keys the game is known to listen to or use (key profile). `text` is any
 * description of the controls (catalog description, in-game help). Returns one player
 * for a single-player game, two for a same-keyboard two-player game.
 */
export function detectPlayers(
	codes: Iterable<string>,
	text?: string | null,
	preferred: DirectionScheme = 'arrows'
): TouchPlayer[] {
	const set = new Set(codes);
	const wasd = countOf(set, WASD);
	const arrows = countOf(set, ARROWS);
	/* A cluster counts as directions only when the game uses most of it (A/S alone are actions). */
	const directionCodes = new Set([...(wasd >= 3 ? WASD : []), ...(arrows >= 3 ? ARROWS : [])]);
	const actions = [...set].filter((c) => !directionCodes.has(c));
	const left = actions.filter((c) => LEFT_HAND.has(c));
	const right = actions.filter((c) => RIGHT_HAND.has(c));
	const bothClusters = wasd >= 3 && arrows >= 3;
	const twoPlayers =
		bothClusters && (mentionsTwoPlayers(text) || (left.length > 0 && right.length > 0));

	if (twoPlayers) {
		/* Keys on neither side (e.g. KeyH, Escape) stay with player 1 so nothing is lost. */
		const neither = actions.filter((c) => !LEFT_HAND.has(c) && !RIGHT_HAND.has(c));
		return [
			{ index: 1, directions: 'wasd', actions: [...left, ...neither] },
			{ index: 2, directions: 'arrows', actions: right }
		];
	}

	const directions: DirectionScheme = wasd > arrows ? 'wasd' : arrows > wasd ? 'arrows' : preferred;
	/* A full second cluster is an alternative way to move, not a set of actions. */
	return [{ index: 1, directions, actions }];
}
