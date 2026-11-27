/**
 * Every profile loader, on every backend, tells "no saves" (`null`) from "could not read the
 * saves" (a rejection). The bridge's rule — never push before the saved profile is known —
 * rests on that answer; a failed read reported as `null` let the next write replace the
 * real saves with one session's data.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyGameBrowserProfile } from './game-browser-profile';

const env = vi.hoisted(() => ({
	publicSite: false,
	native: false,
	invoke: (async () => null) as (command: string, args?: unknown) => Promise<unknown>
}));

vi.mock('./offline-deployment', () => ({
	isPublicSiteDeployment: () => env.publicSite,
	isTauriApp: () => env.native,
	isTauriMobileBuild: () => false
}));
vi.mock('@tauri-apps/api/core', () => ({
	invoke: (command: string, args?: unknown) => env.invoke(command, args)
}));

const { GameProfileReadError, loadGameBrowserProfile, saveGameBrowserProfile } = await import(
	'./game-browser-storage'
);
const { loadNativeGameProfile } = await import('./offline-native');
const { loadBrowserGameProfile } = await import('./browser-game-data-storage');

function saves() {
	const profile = emptyGameBrowserProfile();
	profile.updatedAt = 5;
	profile.profile.Default.localStorage['https://h'] = { level: '7' };
	return profile;
}


/** Just enough IndexedDB for the profile store: one database, one record per game. */
function fakeIndexedDB(opts: { openFails?: boolean; getFails?: boolean; record?: unknown }) {
	const later = (fn: () => void) => setTimeout(fn, 0);
	return {
		open() {
			const req: Record<string, unknown> & { onsuccess?: () => void; onerror?: () => void } = {};
			later(() => {
				if (opts.openFails) {
					req.error = new Error('open failed');
					req.onerror?.();
					return;
				}
				req.result = {
					objectStoreNames: { contains: () => true },
					transaction: () => ({
						objectStore: () => ({
							get: () => {
								const get: Record<string, unknown> & {
									onsuccess?: () => void;
									onerror?: () => void;
								} = {};
								later(() => {
									if (opts.getFails) {
										get.error = new Error('read failed');
										get.onerror?.();
									} else {
										get.result = opts.record;
										get.onsuccess?.();
									}
								});
								return get;
							}
						})
					})
				};
				req.onsuccess?.();
			});
			return req;
		}
	};
}

beforeEach(() => {
	env.publicSite = false;
	env.native = false;
	env.invoke = async () => null;
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('native (desktop app) saves', () => {
	beforeEach(() => {
		env.native = true;
		vi.stubGlobal('window', { location: { origin: 'tauri://localhost' } });
	});

	it('rejects when the saves command fails', async () => {
		env.invoke = async () => {
			throw 'profile/Default/localStorage.json: expected value at line 1';
		};
		await expect(loadNativeGameProfile('g')).rejects.toBeDefined();
		await expect(loadGameBrowserProfile('g')).rejects.toBeInstanceOf(GameProfileReadError);
	});

	it('reads "nothing on disk" and nothing stranded in IndexedDB as no saves', async () => {
		env.invoke = async () => null;
		vi.stubGlobal('indexedDB', fakeIndexedDB({ record: undefined }));
		expect(await loadGameBrowserProfile('g')).toBeNull();
	});

	it('fails when the IndexedDB fallback, which may hold stranded saves, cannot be read', async () => {
		env.invoke = async () => null;
		vi.stubGlobal('indexedDB', fakeIndexedDB({ getFails: true }));
		await expect(loadGameBrowserProfile('g')).rejects.toBeInstanceOf(GameProfileReadError);
	});

	it('returns what is on disk', async () => {
		env.invoke = async (command) => (command === 'game_profile_read' ? saves() : null);
		expect(await loadGameBrowserProfile('g')).toEqual(saves());
	});

	it('reports a disk write that failed, instead of writing the saves to IndexedDB', async () => {
		/* IndexedDB is never read back while the disk has a profile: a write there was lost. */
		env.invoke = async (command) => {
			if (command === 'game_profile_write') throw 'No space left on device';
			return null;
		};
		const idb = fakeIndexedDB({ record: undefined });
		const open = vi.spyOn(idb, 'open');
		vi.stubGlobal('indexedDB', idb);
		await expect(saveGameBrowserProfile('g', saves())).rejects.toBe('No space left on device');
		expect(open).not.toHaveBeenCalled();
	});
});

describe('IndexedDB saves (public site)', () => {
	beforeEach(() => {
		env.publicSite = true;
	});

	it('reads a missing record as no saves', async () => {
		vi.stubGlobal('indexedDB', fakeIndexedDB({ record: undefined }));
		expect(await loadBrowserGameProfile('g')).toBeNull();
		expect(await loadGameBrowserProfile('g', 'https://site')).toBeNull();
	});

	it('rejects when the database cannot be opened or read', async () => {
		vi.stubGlobal('indexedDB', fakeIndexedDB({ openFails: true }));
		await expect(loadBrowserGameProfile('g')).rejects.toThrow('open failed');
		vi.stubGlobal('indexedDB', fakeIndexedDB({ getFails: true }));
		await expect(loadGameBrowserProfile('g', 'https://site')).rejects.toBeInstanceOf(
			GameProfileReadError
		);
	});

	it('rejects a record that is not a profile instead of calling it empty', async () => {
		vi.stubGlobal('indexedDB', fakeIndexedDB({ record: { localStorage: 'garbage' } }));
		await expect(loadBrowserGameProfile('g')).rejects.toThrow('not a profile');
	});

	it('returns a stored profile', async () => {
		vi.stubGlobal('indexedDB', fakeIndexedDB({ record: saves() }));
		expect(await loadBrowserGameProfile('g')).toEqual(saves());
	});
});
