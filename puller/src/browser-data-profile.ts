/**
 * Chromium-inspired browser profile types (mirrors src/lib/utils/game-browser-profile.ts).
 */

export const BROWSER_PROFILE_SCHEMA_VERSION = 1;

export interface BrowserProfileCookie {
	name: string;
	value: string;
	domain?: string;
	path?: string;
	expires?: number;
	httpOnly?: boolean;
	secure?: boolean;
	sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface IndexedDbRecord {
	storeName: string;
	key: string;
	value: string;
}

export interface IndexedDbDatabaseProfile {
	name: string;
	version: number;
	objectStores: string[];
	records: IndexedDbRecord[];
}

export type OriginStorageMap = Record<string, Record<string, string>>;

export interface GameBrowserProfile {
	schemaVersion: number;
	updatedAt: number;
	profile: {
		Default: {
			localStorage: OriginStorageMap;
			sessionStorage: OriginStorageMap;
			cookies: BrowserProfileCookie[];
			indexedDB: IndexedDbDatabaseProfile[];
		};
	};
}

export function emptyGameBrowserProfile(): GameBrowserProfile {
	return {
		schemaVersion: BROWSER_PROFILE_SCHEMA_VERSION,
		updatedAt: 0,
		profile: {
			Default: {
				localStorage: {},
				sessionStorage: {},
				cookies: [],
				indexedDB: []
			}
		}
	};
}

export function isGameBrowserProfile(value: unknown): value is GameBrowserProfile {
	if (!value || typeof value !== 'object') return false;
	const v = value as GameBrowserProfile;
	return (
		typeof v.schemaVersion === 'number' &&
		typeof v.updatedAt === 'number' &&
		v.profile?.Default != null &&
		typeof v.profile.Default.localStorage === 'object' &&
		typeof v.profile.Default.sessionStorage === 'object' &&
		Array.isArray(v.profile.Default.cookies) &&
		Array.isArray(v.profile.Default.indexedDB)
	);
}

export const PROFILE_DISK_PATHS = {
	meta: 'meta.json',
	localStorage: 'profile/Default/localStorage.json',
	sessionStorage: 'profile/Default/sessionStorage.json',
	cookies: 'profile/Default/cookies.json',
	indexedDbDir: 'profile/Default/indexeddb'
} as const;
