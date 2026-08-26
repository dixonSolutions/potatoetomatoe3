import { describe, expect, it } from 'vitest';
import {
	planControlVisibility,
	emptyKeyProfile,
	keyProfileCodes,
	keyProfileConfidence,
	keyProfileSaysNoKeyboard,
	mergeKeyProfile,
	parseKeyProfileMessage
} from './key-profile';

type Report = {
	url: string;
	listens: boolean;
	listenerCount: number;
	declared: string[];
	inferred: string[];
};

const report = (over: Partial<Report> = {}): Report => ({
	url: 'https://example.test/game',
	listens: true,
	listenerCount: 1,
	declared: [],
	inferred: [],
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
	it('is strong only when the game declared its own controls', () => {
		const declared = mergeKeyProfile(emptyKeyProfile('g'), report({ declared: ['Space'] }), 1);
		const inferredOnly = mergeKeyProfile(emptyKeyProfile('g'), report({ inferred: ['Space'] }), 1);
		expect(keyProfileConfidence(declared)).toBe('strong');
		expect(keyProfileConfidence(inferredOnly)).toBe('weak');
		expect(keyProfileConfidence(emptyKeyProfile('g'))).toBe('none');
		expect(keyProfileCodes(declared).has('Space')).toBe(true);
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

	it('hides what a declared control list does not mention', () => {
		const profile = mergeKeyProfile(
			emptyKeyProfile('g'),
			report({ declared: ['Space', 'ArrowLeft'] }),
			1
		);
		const plan = planControlVisibility(profile, DEFAULTS);
		expect(plan).toEqual({ __joystick: 'show', a: 'hide', b: 'hide', space: 'show' });
	});

	it('only fades when the evidence is an inferred source scan', () => {
		const profile = mergeKeyProfile(emptyKeyProfile('g'), report({ inferred: ['Space'] }), 1);
		const plan = planControlVisibility(profile, DEFAULTS);
		expect(plan).toEqual({ __joystick: 'dim', a: 'dim', b: 'dim', space: 'show' });
	});

	it('never empties the console — a trim that hides everything is a parse error', () => {
		/* KeyA is what "tap a key" used to parse to: strong evidence matching no control. */
		const profile = mergeKeyProfile(emptyKeyProfile('g'), report({ declared: ['KeyA'] }), 1);
		const plan = planControlVisibility(profile, DEFAULTS);
		expect(Object.values(plan)).not.toContain('hide');
		expect(Object.values(plan).every((f) => f === 'dim')).toBe(true);
	});
});
