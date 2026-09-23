import { describe, expect, it } from 'vitest';
import { keysInPhrase, parseControlsText } from './controls-text';

const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const WASD = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];

describe('keysInPhrase', () => {
	it('reads named keys, groups and single letters', () => {
		expect(keysInPhrase('WASD')).toEqual(WASD);
		expect(keysInPhrase('arrow keys')).toEqual(ARROWS);
		expect(keysInPhrase('left arrow')).toEqual(['ArrowLeft']);
		expect(keysInPhrase('Space bar')).toEqual(['Space']);
		expect(keysInPhrase('Z or X')).toEqual(['KeyZ', 'KeyX']);
		expect(keysInPhrase('1-4')).toEqual(['Digit1', 'Digit2', 'Digit3', 'Digit4']);
		expect(keysInPhrase('Press E')).toEqual(['KeyE']);
	});

	it('never reads the article or a sentence as keys', () => {
		expect(keysInPhrase('press a key')).toEqual([]);
		expect(keysInPhrase('collect every coin in a level before time runs out')).toEqual([]);
	});
});

describe('parseControlsText', () => {
	it('pairs keys with what they do — "key = action"', () => {
		const p = parseControlsText('Arrow keys = move, Press J to jump, Space = dash');
		for (const c of ARROWS) expect(p.purposes[c]).toBe('Move');
		expect(p.purposes.KeyJ).toBe('Jump');
		expect(p.purposes.Space).toBe('Dash');
	});

	it('reads "action: keys" lists, one per line', () => {
		const p = parseControlsText('Move: WASD\nJump: Z\nPause: P');
		for (const c of WASD) expect(p.purposes[c]).toBe('Move');
		expect(p.purposes.KeyZ).toBe('Jump');
		expect(p.purposes.KeyP).toBe('Pause');
	});

	it('reads sentences with "to" and splits on "and"', () => {
		const p = parseControlsText('Use the arrow keys to move. Press Space to jump and X to shoot.');
		expect(p.purposes.ArrowLeft).toBe('Move');
		expect(p.purposes.Space).toBe('Jump');
		expect(p.purposes.KeyX).toBe('Shoot');
	});

	it('keeps a key list together across a comma', () => {
		const p = parseControlsText('WASD, arrow keys = move');
		for (const c of [...WASD, ...ARROWS]) expect(p.purposes[c]).toBe('Move');
	});

	it('reads "action with keys"', () => {
		const p = parseControlsText('Jump with Space. Shoot using the Z key');
		expect(p.purposes.Space).toBe('Jump');
		expect(p.purposes.KeyZ).toBe('Shoot');
	});

	it('handles portal HTML blurbs', () => {
		const p = parseControlsText(
			'<h3>Controls</h3><ul><li>WASD or arrow keys = move</li><li>Space = dash</li><li>E - interact</li></ul>'
		);
		expect(p.purposes.KeyW).toBe('Move');
		expect(p.purposes.ArrowUp).toBe('Move');
		expect(p.purposes.Space).toBe('Dash');
		expect(p.purposes.KeyE).toBe('Interact');
	});

	it('ignores mouse and touch controls', () => {
		const p = parseControlsText('Left click to shoot. Mouse to aim. Press R to reload');
		expect(p.codes).toEqual(['KeyR']);
		expect(p.purposes.KeyR).toBe('Reload');
	});

	it('does not invent keys from ordinary description text', () => {
		const p = parseControlsText(
			'Help Shrek escape the swamp in this Unity WebGL adventure. Collect a key to open doors and press a key to start.'
		);
		expect(p.codes).toEqual([]);
	});

	it('names keys even when no action is given', () => {
		const p = parseControlsText('Controls: arrow keys and space');
		expect(p.codes).toEqual(expect.arrayContaining([...ARROWS, 'Space']));
	});

	it('keeps captions short', () => {
		const p = parseControlsText('Space = jump over the enormous spinning saw blades in the castle');
		expect(p.purposes.Space.length).toBeLessThanOrEqual(28);
		expect(p.purposes.Space.startsWith('Jump over')).toBe(true);
	});

	it('stays quiet on ordinary catalog prose', () => {
		for (const text of [
			'A fun game about cats.',
			'Level 3: The Castle. Beat the boss to win!',
			'Version 2 - new maps and skins',
			'Collect a key to open doors, then find the exit.',
			'Play as Mario: jump, run and stomp on enemies.',
			'I love this game. It is the best one of 2024.'
		]) {
			expect(parseControlsText(text).codes, text).toEqual([]);
		}
	});

	it('reads keys named as "the X key"', () => {
		const p = parseControlsText('Press the E key to open doors and the Q key to drop items');
		expect(p.purposes.KeyE).toBe('Open doors');
		expect(p.purposes.KeyQ).toBe('Drop items');
	});

	it('reads digit ranges', () => {
		const p = parseControlsText('1-4 = switch weapon');
		expect(p.codes).toEqual(['Digit1', 'Digit2', 'Digit3', 'Digit4']);
		expect(p.purposes.Digit3).toBe('Switch weapon');
	});

	it('does not mistake modifier and mouse names for arrows, or verbs for keys', () => {
		const p = parseControlsText(
			'WASD: Movement, Left Shift: Slow down. Return to the castle to rest'
		);
		expect(p.purposes.ShiftLeft).toBe('Slow down');
		expect(p.codes).not.toContain('ArrowLeft');
		expect(p.codes).not.toContain('Enter');
	});

	it('pulls several pairs out of one line', () => {
		const p = parseControlsText('Controls: AD:Rotate W:Thrust S:Reverse E:Fire');
		expect(p.purposes).toMatchObject({
			KeyW: 'Thrust',
			KeyS: 'Reverse',
			KeyE: 'Fire'
		});
		const q = parseControlsText('W - Forward / S - Backward / Shift - Sprint / R - Restart');
		expect(q.purposes).toMatchObject({
			KeyW: 'Forward',
			KeyS: 'Backward',
			ShiftLeft: 'Sprint',
			KeyR: 'Restart'
		});
	});

	it('ignores links, handles, clock times, emoticons and titles with numbers', () => {
		for (const text of [
			'Tutorial here: https://www.youtube.com/watch?v=SYPcCkFHtyU',
			'Socials: X: @Studio',
			'Opens at 6:00 PM daily',
			'I hope to fix the bugs soon :D',
			'FNF VS Rewrite – Round 2 – Sonic.EXE, a horror rhythm mod'
		]) {
			expect(parseControlsText(text).codes, text).toEqual([]);
		}
	});

	it('drops a heading that runs into the first line', () => {
		const p = parseControlsText('Controls Arrow keys = move, Space = dash');
		expect(p.purposes.ArrowUp).toBe('Move');
		expect(p.purposes.Space).toBe('Dash');
	});
});
