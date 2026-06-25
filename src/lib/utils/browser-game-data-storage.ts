/** IndexedDB persistence for per-game browser profiles (GitHub Pages / browser fallback). */

import {
	emptyGameBrowserProfile,
	isGameBrowserProfile,
	type GameBrowserProfile
} from './game-browser-profile';

const DB_NAME = 'potatotomato-browser-data-v1';
const DB_VERSION = 1;
const PROFILES_STORE = 'browserProfiles';

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
		req.onsuccess = () => resolve(req.result);
		req.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(PROFILES_STORE)) {
				db.createObjectStore(PROFILES_STORE);
			}
		};
	});
}

export async function loadBrowserGameProfile(gameId: string): Promise<GameBrowserProfile | null> {
	if (typeof indexedDB === 'undefined') return null;
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(PROFILES_STORE, 'readonly');
		tx.onerror = () => reject(tx.error ?? new Error('IndexedDB read failed'));
		const req = tx.objectStore(PROFILES_STORE).get(gameId);
		req.onsuccess = () => {
			const result = req.result as GameBrowserProfile | undefined;
			if (result && isGameBrowserProfile(result)) {
				resolve(result);
			} else {
				resolve(null);
			}
		};
		req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
	});
}

export async function saveBrowserGameProfile(gameId: string, profile: GameBrowserProfile): Promise<void> {
	if (typeof indexedDB === 'undefined') return;
	if (!isGameBrowserProfile(profile)) {
		throw new Error('Invalid browser profile');
	}
	const db = await openDb();
	const payload: GameBrowserProfile = {
		...profile,
		updatedAt: Date.now()
	};
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(PROFILES_STORE, 'readwrite');
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
		tx.objectStore(PROFILES_STORE).put(payload, gameId);
	});
}

export async function deleteBrowserGameProfile(gameId: string): Promise<void> {
	if (typeof indexedDB === 'undefined') return;
	const db = await openDb();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(PROFILES_STORE, 'readwrite');
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
		tx.objectStore(PROFILES_STORE).delete(gameId);
	});
}

export function isBrowserGameDataSupported(): boolean {
	return typeof indexedDB !== 'undefined';
}
