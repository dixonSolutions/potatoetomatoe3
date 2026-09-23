import { describe, expect, it } from 'vitest';
import {
	planControlVisibility,
	emptyKeyProfile,
	keyProfileCodes,
	keyProfileConfidence,
	keyProfileSaysNoKeyboard,
	keyEvidence,
	keyKind,
	detectedControls,
	planExtraControls,
	withControlsHint,
	mergeKeyProfile,
	parseKeyProfileMessage
} from './key-profile';

type Report = {
	url: string;
	listens: boolean;
	listenerCount: number;
	declared: string[];
	inferred: string[];
	used: string[];
	purposes: Record<string, string>;
	shortcuts: string[];
	textEntry: boolean;
	bound: string[];
	boundPurposes: Record<string, string>;
};

const report = (over: Partial<Report> = {}): Report => ({
	url: 'https://example.test/game',
	listens: true,
	listenerCount: 1,
	declared: [],
	inferred: [],
	used: [],
	purposes: {},
	shortcuts: [],
	textEntry: false,
	bound: [],
	boundPurposes: {},
	...over
});

describe('parseKeyProfileMessage', () => {
	it('rejects anything that is not a v1 profile report', () => {
		expect(parseKeyProfileMessage(null)).toBeNull();
		expect(parseKeyProfileMessage('potato-tomato-key-profile')).toBeNull();
		expect(parseKeyProfileMessage({ type: 'something-else', v: 1 })).toBeNull();
		expect(parseKeyProfileMessage({ type: 'potato-tomato-key-profile', v: 2 })).toBeNull();
	});

	it('keeps only codes the console can actually emit', () => {
		const parsed = parseKeyProfileMessage({
			type: 'potato-tomato-key-profile',
			v: 1,
			listens: true,
			declared: ['KeyW', 'F5', 'Tab', 'ArrowUp', 42, 'KeyW'],
			inferred: 'not-an-array'
		});
		expect(parsed?.declared).toEqual(['KeyW', 'ArrowUp']);
		expect(parsed?.inferred).toEqual([]);
	});

	it('does not trust listens or listenerCount from the wire', () => {
		const parsed = parseKeyProfileMessage({
			type: 'potato-tomato-key-profile',
			v: 1,
			listens: 'yes',
			listenerCount: -5
		});
		expect(parsed?.listens).toBe(false);
		expect(parsed?.listenerCount).toBe(0);
	});
});

describe('mergeKeyProfile', () => {
	it('unions across frames — the shell knows the controls, the game frame knows it listens', () => {
		let profile = emptyKeyProfile('g1');
		profile = mergeKeyProfile(
			profile,
			report({ listens: false, declared: ['KeyW', 'KeyA', 'KeyS', 'KeyD'] }),
			1
		);
		profile = mergeKeyProfile(profile, report({ listens: true, inferred: ['Escape'] }), 2);
		expect(profile.listens).toBe(true);
		expect(profile.declared).toEqual(['KeyA', 'KeyD', 'KeyS', 'KeyW']);
		expect(profile.inferred).toEqual(['Escape']);
		expect(profile.frames).toBe(2);
	});

	it('records an empty first report — that is how "no keyboard" arrives', () => {
		const profile = mergeKeyProfile(emptyKeyProfile('g1'), report({ listens: false }), 1);
		expect(profile.frames).toBe(1);
		expect(keyProfileSaysNoKeyboard(profile)).toBe(true);
		/* ...but a second identical one is still deduped. */
		expect(mergeKeyProfile(profile, report({ listens: false }), 2)).toBe(profile);
	});

	it('returns the same object when a repeat report adds nothing', () => {
		const first = mergeKeyProfile(emptyKeyProfile('g1'), report({ declared: ['Space'] }), 1);
		const second = mergeKeyProfile(first, report({ declared: ['Space'] }), 2);
		expect(second).toBe(first);
	});
});

describe('confidence', () => {
	it('is strong only when the engine registered the keys', () => {
		const bound = mergeKeyProfile(emptyKeyProfile('g'), report({ bound: ['Space'] }), 1);
		const inferredOnly = mergeKeyProfile(emptyKeyProfile('g'), report({ inferred: ['Space'] }), 1);
		expect(keyProfileConfidence(bound)).toBe('strong');
		expect(keyProfileConfidence(inferredOnly)).toBe('weak');
		expect(keyProfileConfidence(emptyKeyProfile('g'))).toBe('none');
		expect(keyProfileCodes(bound).has('Space')).toBe(true);
	});

	it('never acts on text: a key only mentioned in text is no evidence at all', () => {
		const mentioned = mergeKeyProfile(emptyKeyProfile('g'), report({ declared: ['Space'] }), 1);
		expect(keyProfileConfidence(mentioned)).toBe('none');
		expect(keyProfileCodes(mentioned).has('Space')).toBe(false);
		expect(keyEvidence(mentioned, 'Space')).toBe('declared');
	});
});

describe('live use', () => {
	it('reads `used` when present and tolerates reports without it', () => {
		const withUsed = parseKeyProfileMessage({
			type: 'potato-tomato-key-profile',
			v: 1,
			listens: true,
			used: ['KeyJ', 'NotAKey']
		});
		expect(withUsed?.used).toEqual(['KeyJ']);
		const android = parseKeyProfileMessage({ type: 'potato-tomato-key-profile', v: 1 });
		expect(android?.used).toEqual([]);
	});

	it('counts a key seen in use as present, but never as licence to hide the rest', () => {
		const p = mergeKeyProfile(
			emptyKeyProfile('g'),
			report({ used: ['KeyJ'], inferred: ['KeyK'] }),
			1
		);
		/* One press of J says J matters — not that every other button is unused. */
		expect(keyProfileConfidence(p)).toBe('weak');
		expect(keyEvidence(p, 'KeyJ')).toBe('used');
		expect(keyEvidence(p, 'KeyK')).toBe('inferred');
		expect(keyEvidence(p, 'KeyL')).toBe('none');
	});

	it('grows as more keys are used, and reports a change each time', () => {
		const first = mergeKeyProfile(emptyKeyProfile('g'), report({ used: ['Space'] }), 1);
		const second = mergeKeyProfile(first, report({ used: ['ArrowLeft'] }), 2);
		expect(second).not.toBe(first);
		expect(second.used).toEqual(['ArrowLeft', 'Space']);
		expect(mergeKeyProfile(second, report({ used: ['Space'] }), 3)).toBe(second);
	});
});

describe('keyProfileSaysNoKeyboard', () => {
	it('needs a frame to have reported — silence is not a no', () => {
		expect(keyProfileSaysNoKeyboard(emptyKeyProfile('g'))).toBe(false);
	});

	it('is true once a frame reports no listeners and no codes', () => {
		const profile = mergeKeyProfile(emptyKeyProfile('g'), report({ listens: false }), 1);
		expect(keyProfileSaysNoKeyboard(profile)).toBe(true);
	});

	it('is false as soon as any frame listens', () => {
		let profile = mergeKeyProfile(emptyKeyProfile('g'), report({ listens: false }), 1);
		profile = mergeKeyProfile(profile, report({ listens: true }), 2);
		expect(keyProfileSaysNoKeyboard(profile)).toBe(false);
	});
});

describe('planControlVisibility', () => {
	const DEFAULTS = [
		{ id: '__joystick', codes: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] },
		{ id: 'a', codes: ['KeyZ'] },
		{ id: 'b', codes: ['Enter'] },
		{ id: 'space', codes: ['Space'] }
	];

	it('leaves everything alone when nothing has been reported', () => {
		const plan = planControlVisibility(emptyKeyProfile('g'), DEFAULTS);
		expect(Object.values(plan).every((f) => f === 'show')).toBe(true);
	});

	it('hides what the engine did not bind', () => {
		const profile = mergeKeyProfile(
			emptyKeyProfile('g'),
			report({ bound: ['Space', 'ArrowLeft'] }),
			1
		);
		const plan = planControlVisibility(profile, DEFAULTS);
		expect(plan).toEqual({ __joystick: 'show', a: 'hide', b: 'hide', space: 'show' });
	});

	it('fades rather than hides a key the engine missed but a handler mentions', () => {
		const profile = mergeKeyProfile(
			emptyKeyProfile('g'),
			report({ bound: ['Space', 'ArrowLeft'], inferred: ['KeyZ'] }),
			1
		);
		expect(planControlVisibility(profile, DEFAULTS).a).toBe('dim');
	});

	it('leaves the layout alone when only text names the controls', () => {
		const profile = mergeKeyProfile(emptyKeyProfile('g'), report({ declared: ['Space'] }), 1);
		const plan = planControlVisibility(profile, DEFAULTS);
		expect(Object.values(plan).every((f) => f === 'show')).toBe(true);
	});

	it('only fades when the evidence is an inferred source scan', () => {
		const profile = mergeKeyProfile(emptyKeyProfile('g'), report({ inferred: ['Space'] }), 1);
		const plan = planControlVisibility(profile, DEFAULTS);
		expect(plan).toEqual({ __joystick: 'dim', a: 'dim', b: 'dim', space: 'show' });
	});

	it('never empties the console — a trim that hides everything is a parse error', () => {
		/* Strong evidence that matches no control at all. */
		const profile = mergeKeyProfile(emptyKeyProfile('g'), report({ bound: ['KeyA'] }), 1);
		const plan = planControlVisibility(profile, DEFAULTS);
		expect(Object.values(plan)).not.toContain('hide');
		expect(Object.values(plan).every((f) => f === 'dim')).toBe(true);
	});
});

describe('controls text and purposes', () => {
	it('reads purposes from forwarded controls text and declares its keys', () => {
		const parsed = parseKeyProfileMessage({
			type: 'potato-tomato-key-profile',
			v: 1,
			listens: true,
			controlsText: 'Arrow keys = move, Press J to jump'
		});
		const p = mergeKeyProfile(emptyKeyProfile('g'), parsed!, 1);
		expect(p.declared).toEqual(expect.arrayContaining(['KeyJ', 'ArrowLeft']));
		expect(p.purposes.KeyJ).toBe('Jump');
		/* Text is a caption source, not evidence. */
		expect(keyProfileConfidence(p)).toBe('none');
	});

	it("prefers the engine's own name for a key over the text", () => {
		const p = mergeKeyProfile(
			emptyKeyProfile('g'),
			report({ bound: ['Space'], boundPurposes: { Space: 'Fire' }, purposes: { Space: 'Jump' } }),
			1
		);
		expect(detectedControls(p)[0].purpose).toBe('Fire');
	});

	it('drops purposes for keys the console cannot send', () => {
		const parsed = parseKeyProfileMessage({
			type: 'potato-tomato-key-profile',
			v: 1,
			controlsText: 'F5 = reload, Tab = map'
		});
		expect(parsed?.purposes).toEqual({});
	});

	it('folds a catalog description in as declared controls', () => {
		const p = withControlsHint(
			emptyKeyProfile('g'),
			'Race to the finish! Use the arrow keys to steer and Space to boost.'
		);
		expect(p.declared).toEqual(expect.arrayContaining(['ArrowUp', 'Space']));
		expect(p.purposes.Space).toBe('Boost');
		expect(withControlsHint(p, 'A fun game about cats.')).toBe(p);
	});
});

describe('keyKind', () => {
	it('treats a key only ever handled with a modifier as a shortcut', () => {
		const p = mergeKeyProfile(
			emptyKeyProfile('g'),
			report({ shortcuts: ['KeyS'], used: ['Space'] }),
			1
		);
		expect(keyKind(p, 'KeyS')).toBe('shortcut');
		expect(keyKind(p, 'Space')).toBe('gameplay');
	});

	it('treats unexplained letters as typing once the game has a text box', () => {
		const p = mergeKeyProfile(
			emptyKeyProfile('g'),
			report({ textEntry: true, inferred: ['KeyQ', 'KeyW'], bound: ['KeyW'] }),
			1
		);
		expect(keyKind(p, 'KeyQ')).toBe('typing');
		/* Bound by the engine: still a game key, text box or not. */
		expect(keyKind(p, 'KeyW')).toBe('gameplay');
		expect(keyKind(p, 'Space')).toBe('gameplay');
	});

	it('spots a handler that reads the whole alphabet as text input', () => {
		const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `Key${c}`);
		const p = mergeKeyProfile(emptyKeyProfile('g'), report({ inferred: letters }), 1);
		expect(keyKind(p, 'KeyQ')).toBe('typing');
	});

	it('lists gameplay before shortcuts and typing, strongest evidence first', () => {
		const p = mergeKeyProfile(
			emptyKeyProfile('g'),
			report({
				textEntry: true,
				used: ['Space'],
				bound: ['KeyJ'],
				inferred: ['KeyQ'],
				shortcuts: ['KeyS'],
				purposes: { KeyJ: 'Jump' }
			}),
			1
		);
		expect(detectedControls(p).map((c) => `${c.code}:${c.kind}`)).toEqual([
			'Space:gameplay',
			'KeyJ:gameplay',
			'KeyS:shortcut',
			'KeyQ:typing'
		]);
	});
});

describe('planExtraControls', () => {
	const profile = (over: Partial<Report>) => mergeKeyProfile(emptyKeyProfile('g'), report(over), 1);

	it('adds strongly evidenced keys the console lacks', () => {
		const p = profile({ bound: ['KeyJ', 'Space', 'ArrowLeft'], purposes: { KeyJ: 'Jump' } });
		const extras = planExtraControls(p, [
			'Space',
			'ArrowUp',
			'ArrowDown',
			'ArrowLeft',
			'ArrowRight'
		]);
		expect(extras.map((e) => e.code)).toEqual(['KeyJ']);
		expect(extras[0].purpose).toBe('Jump');
	});

	it('never adds keys that are only mentioned, guessed from source, typed, or shortcuts', () => {
		const p = profile({
			declared: ['KeyM'],
			inferred: ['KeyK'],
			shortcuts: ['KeyS'],
			textEntry: true,
			used: ['KeyQ']
		});
		/* KeyQ was seen in use, so it is gameplay despite the text box. */
		expect(planExtraControls(p, []).map((e) => e.code)).toEqual(['KeyQ']);
	});

	it('skips a second direction set that only repeats the stick', () => {
		const move = { KeyW: 'Move', KeyA: 'Move', KeyS: 'Move', KeyD: 'Move', ArrowUp: 'Move' };
		const p = profile({ bound: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp'], purposes: move });
		expect(planExtraControls(p, ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])).toEqual([]);
	});

	it('caps how many it adds', () => {
		const p = profile({ bound: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'] });
		expect(planExtraControls(p, [], 4)).toHaveLength(4);
	});
});
