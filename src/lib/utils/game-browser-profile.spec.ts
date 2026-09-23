import { describe, expect, it } from 'vitest';
import {
	BROWSER_PROFILE_SCHEMA_VERSION,
	emptyGameBrowserProfile,
	isGameBrowserProfile,
	mergeGameBrowserProfiles,
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

	it('merges a frame push without dropping other origins or databases', () => {
		const existing = emptyGameBrowserProfile();
		existing.profile.Default.localStorage['http://127.0.0.1:18787'] = { save: 'offline' };
		existing.profile.Default.localStorage['https://app'] = { save: 'old' };
		existing.profile.Default.indexedDB.push(
			{ name: 'keep', version: 1, objectStores: ['s'], records: [] },
			{ name: 'replace', version: 1, objectStores: ['s'], records: [] }
		);
		existing.profile.Default.cookies = [{ name: 'old', value: '1' }];

		const pushed = emptyGameBrowserProfile();
		pushed.profile.Default.localStorage['https://app'] = { save: 'new' };
		pushed.profile.Default.indexedDB.push({
			name: 'replace',
			version: 2,
			objectStores: ['s'],
			records: [{ storeName: 's', key: '"k"', value: '"v"' }]
		});
		pushed.profile.Default.cookies = [{ name: 'jar', value: '2' }];

		const merged = mergeGameBrowserProfiles(existing, pushed);
		expect(merged.profile.Default.localStorage).toEqual({
			'http://127.0.0.1:18787': { save: 'offline' },
			'https://app': { save: 'new' }
		});
		expect(merged.profile.Default.indexedDB.map((d) => [d.name, d.version])).toEqual([
			['keep', 1],
			['replace', 2]
		]);
		expect(merged.profile.Default.cookies).toEqual([{ name: 'jar', value: '2' }]);
		expect(isGameBrowserProfile(merged)).toBe(true);
	});

	it('uses the push as-is when nothing is stored yet', () => {
		const pushed = emptyGameBrowserProfile();
		pushed.profile.Default.localStorage['https://app'] = { a: '1' };
		expect(mergeGameBrowserProfiles(null, pushed).profile.Default.localStorage).toEqual({
			'https://app': { a: '1' }
		});
	});
});
