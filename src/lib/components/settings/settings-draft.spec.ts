import { describe, expect, it } from 'vitest';
import { changedFields, snapshotFields, stableStringify } from './settings-draft';

describe('stableStringify', () => {
	it('ignores object key order', () => {
		expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
			stableStringify({ a: { c: 3, d: 2 }, b: 1 })
		);
	});

	it('keeps array order', () => {
		expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
	});
});

describe('changedFields', () => {
	it('counts only the fields that differ from the baseline', () => {
		const baseline = snapshotFields({ volume: 100, mute: 'off', shortcut: null });
		expect(changedFields({ volume: 40, mute: 'off', shortcut: null }, baseline)).toEqual([
			'volume'
		]);
	});

	it('treats a re-ordered nested object as unchanged', () => {
		const baseline = snapshotFields({ affinity: { action: 0.5, puzzle: -0.25 } });
		expect(changedFields({ affinity: { puzzle: -0.25, action: 0.5 } }, baseline)).toEqual([]);
	});
});
