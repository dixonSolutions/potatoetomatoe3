import { describe, expect, it } from 'vitest';
import { detectPlayers, mentionsTwoPlayers } from './touch-players';

/* Fixture games: the keys their key profile reports, plus their catalog description. */
const SINGLE_ARROWS = {
	codes: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'],
	text: 'Use the arrow keys to steer and Space to jump.'
};
/* Many single-player games accept both clusters for the same thing. */
const SINGLE_BOTH_CLUSTERS = {
	codes: [
		'KeyW',
		'KeyA',
		'KeyS',
		'KeyD',
		'ArrowUp',
		'ArrowDown',
		'ArrowLeft',
		'ArrowRight',
		'Space'
	],
	text: 'Move with WASD or the arrow keys, Space to shoot.'
};
const SINGLE_WASD = {
	codes: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'ShiftLeft'],
	text: 'WASD to move, E to interact, Shift to run.'
};
const TWO_PLAYER_TEXT = {
	codes: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
	text: 'A 2 player game: player 1 uses WASD, player 2 uses the arrow keys.'
};
const TWO_PLAYER_KEYS = {
	codes: [
		'KeyW',
		'KeyA',
		'KeyS',
		'KeyD',
		'KeyF',
		'ArrowUp',
		'ArrowDown',
		'ArrowLeft',
		'ArrowRight',
		'Enter',
		'Escape'
	],
	text: 'Race your friend to the finish.'
};

describe('detectPlayers', () => {
	it('single-player arrow game: one player on the arrows', () => {
		expect(detectPlayers(SINGLE_ARROWS.codes, SINGLE_ARROWS.text)).toEqual([
			{ index: 1, directions: 'arrows', actions: ['Space'] }
		]);
	});

	it('single-player game that accepts both clusters stays one player', () => {
		const players = detectPlayers(SINGLE_BOTH_CLUSTERS.codes, SINGLE_BOTH_CLUSTERS.text);
		expect(players).toHaveLength(1);
		expect(players[0].actions).toEqual(['Space']);
	});

	it('single-player WASD game: WASD directions, letters are not actions', () => {
		expect(detectPlayers(SINGLE_WASD.codes, SINGLE_WASD.text)).toEqual([
			{ index: 1, directions: 'wasd', actions: ['KeyE', 'ShiftLeft'] }
		]);
	});

	it('two players named in the text: WASD left, arrows right', () => {
		const players = detectPlayers(TWO_PLAYER_TEXT.codes, TWO_PLAYER_TEXT.text);
		expect(players.map((p) => p.directions)).toEqual(['wasd', 'arrows']);
	});

	it('two players from per-side action keys, without any text', () => {
		const players = detectPlayers(TWO_PLAYER_KEYS.codes, TWO_PLAYER_KEYS.text);
		expect(players).toEqual([
			{ index: 1, directions: 'wasd', actions: ['KeyF', 'Escape'] },
			{ index: 2, directions: 'arrows', actions: ['Enter'] }
		]);
	});

	it('arrow game using A and S as actions keeps them', () => {
		expect(
			detectPlayers(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyA', 'KeyS'], '')
		).toEqual([{ index: 1, directions: 'arrows', actions: ['KeyA', 'KeyS'] }]);
	});

	it('ties fall back to the preferred scheme', () => {
		expect(detectPlayers(['Space'], '', 'wasd')[0].directions).toBe('wasd');
	});
});

describe('mentionsTwoPlayers', () => {
	it.each([
		['2 player game', true],
		['Two-player mode', true],
		['Player 2: arrows', true],
		['1v1 against a friend', true],
		['local co-op', true],
		['Play with a friend on the same keyboard', true],
		['Collect 2 players worth of coins', true],
		['Score 200 points', false],
		['A game for one player', false],
		['', false]
	])('%s → %s', (text, expected) => {
		expect(mentionsTwoPlayers(text)).toBe(expected);
	});
});
