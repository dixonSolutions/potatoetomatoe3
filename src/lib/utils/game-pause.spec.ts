import { describe, expect, it } from 'vitest';
import {
	DEFAULT_GAME_PAUSE_SHORTCUT,
	formatGamePauseShortcutLabel,
	gamePauseShortcutMatches,
	isValidGamePauseShortcut
} from './game-pause';

describe('game pause shortcut', () => {
	it('defaults to backtick / Backquote', () => {
		expect(DEFAULT_GAME_PAUSE_SHORTCUT.code).toBe('Backquote');
		expect(formatGamePauseShortcutLabel(DEFAULT_GAME_PAUSE_SHORTCUT)).toBe('`');
	});

	it('matches a bare backtick keydown', () => {
		const e = {
			code: 'Backquote',
			ctrlKey: false,
			shiftKey: false,
			altKey: false,
			metaKey: false
		} as KeyboardEvent;
		expect(gamePauseShortcutMatches(e, DEFAULT_GAME_PAUSE_SHORTCUT)).toBe(true);
	});

	it('rejects the reserved settings shortcut', () => {
		expect(
			isValidGamePauseShortcut({
				code: 'Comma',
				ctrlKey: true,
				shiftKey: true,
				altKey: false,
				metaKey: false
			})
		).toBe(false);
	});
});
