import { describe, expect, it } from 'vitest';
import {
	BROWSER_PROFILE_SCHEMA_VERSION,
	emptyGameBrowserProfile,
	isGameBrowserProfile,
	mergeLegacyLocalStorage
} from './game-browser-profile';

describe('game-browser-profile', () => {
	it('emptyGameBrowserProfile has expected shape', () => {
		const p = emptyGameBrowserProfile();
		expect(p.schemaVersion).toBe(BROWSER_PROFILE_SCHEMA_VERSION);
		expect(p.profile.Default.localStorage).toEqual({});
		expect(p.profile.Default.indexedDB).toEqual([]);
	});

	it('isGameBrowserProfile validates structure', () => {
		expect(isGameBrowserProfile(emptyGameBrowserProfile())).toBe(true);
		expect(isGameBrowserProfile(null)).toBe(false);
		expect(isGameBrowserProfile({ schemaVersion: 1 })).toBe(false);
	});

	it('mergeLegacyLocalStorage merges into origin bucket', () => {
		const base = emptyGameBrowserProfile();
		const merged = mergeLegacyLocalStorage(base, 'http://localhost:5173', {
			save: 'data',
			level: '3'
		});
		expect(merged.profile.Default.localStorage['http://localhost:5173']).toEqual({
			save: 'data',
			level: '3'
		});
		expect(merged.updatedAt).toBeGreaterThan(0);
	});

	it('round-trips through JSON', () => {
		const p = emptyGameBrowserProfile();
		p.profile.Default.localStorage['http://test'] = { a: '1' };
		p.profile.Default.indexedDB.push({
			name: 'unity-db',
			version: 2,
			objectStores: ['store'],
			records: [{ storeName: 'store', key: '"k"', value: '"v"' }]
		});
		const parsed = JSON.parse(JSON.stringify(p));
		expect(isGameBrowserProfile(parsed)).toBe(true);
		expect(parsed.profile.Default.indexedDB[0].records[0].value).toBe('"v"');
	});
});
