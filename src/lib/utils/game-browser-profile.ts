/**
 * Chromium-inspired per-game browser profile (JSON on disk / IndexedDB).
 * Layout mirrors profile/Default/{Local Storage, Session Storage, Network, IndexedDB}.
 */

export const BROWSER_PROFILE_SCHEMA_VERSION = 1;

/** Playwright-style cookie entry (subset of Chromium cookie model). */
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

/** Origin-keyed storage maps (e.g. "http://localhost:5173"). */
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

/**
 * Fold a profile pushed by a game frame into the stored one.
 *
 * A frame only knows its own origin: online play and the puller's offline mirror are
 * different origins, and each pushes just its own localStorage bucket. Replacing the
 * whole profile on every push threw the other origin's saves away. Origin buckets and
 * databases are therefore replaced one by one; cookies belong to the game rather than an
 * origin (the bridge keeps one virtual jar per game), so the incoming jar wins.
 */
export function mergeGameBrowserProfiles(
	existing: GameBrowserProfile | null,
	incoming: GameBrowserProfile
): GameBrowserProfile {
	if (!existing) return { ...incoming, updatedAt: Date.now() };
	const prev = existing.profile.Default;
	const next = incoming.profile.Default;
	const byName = new Map(prev.indexedDB.map((db) => [db.name, db]));
	for (const db of next.indexedDB) byName.set(db.name, db);
	return {
		schemaVersion: incoming.schemaVersion,
		updatedAt: Date.now(),
		profile: {
			Default: {
				localStorage: { ...prev.localStorage, ...next.localStorage },
				sessionStorage: { ...prev.sessionStorage, ...next.sessionStorage },
				cookies: next.cookies,
				indexedDB: [...byName.values()]
			}
		}
	};
}

/** Merge legacy single-origin localStorage snapshot into a profile. */
export function mergeLegacyLocalStorage(
	profile: GameBrowserProfile,
	origin: string,
	localStorage: Record<string, string>
): GameBrowserProfile {
	const next = structuredClone(profile);
	if (!next.profile.Default.localStorage[origin]) {
		next.profile.Default.localStorage[origin] = {};
	}
	const bucket = next.profile.Default.localStorage[origin];
	for (const [key, value] of Object.entries(localStorage)) {
		bucket[key] = value;
	}
	next.updatedAt = Date.now();
	return next;
}

export function snapshotOriginLocalStorage(origin: string): OriginStorageMap {
	const data: Record<string, string> = {};
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key) data[key] = localStorage.getItem(key) ?? '';
		}
	} catch {
		/* private mode */
	}
	return { [origin]: data };
}

export function snapshotOriginSessionStorage(origin: string): OriginStorageMap {
	const data: Record<string, string> = {};
	try {
		for (let i = 0; i < sessionStorage.length; i++) {
			const key = sessionStorage.key(i);
			if (key) data[key] = sessionStorage.getItem(key) ?? '';
		}
	} catch {
		/* ignore */
	}
	return { [origin]: data };
}

export function applyOriginLocalStorage(map: OriginStorageMap, origin: string): void {
	const bucket = map[origin];
	if (!bucket) return;
	for (const [key, value] of Object.entries(bucket)) {
		try {
			localStorage.setItem(key, value);
		} catch {
			/* quota */
		}
	}
}

export function applyOriginSessionStorage(map: OriginStorageMap, origin: string): void {
	const bucket = map[origin];
	if (!bucket) return;
	for (const [key, value] of Object.entries(bucket)) {
		try {
			sessionStorage.setItem(key, value);
		} catch {
			/* ignore */
		}
	}
}

export function snapshotCookies(): BrowserProfileCookie[] {
	const raw = document.cookie;
	if (!raw) return [];
	const cookies: BrowserProfileCookie[] = [];
	for (const part of raw.split(';')) {
		const trimmed = part.trim();
		if (!trimmed) continue;
		const eq = trimmed.indexOf('=');
		if (eq === -1) continue;
		cookies.push({
			name: trimmed.slice(0, eq).trim(),
			value: trimmed.slice(eq + 1).trim(),
			path: '/'
		});
	}
	return cookies;
}

export function applyCookies(cookies: BrowserProfileCookie[]): void {
	for (const c of cookies) {
		if (c.httpOnly) continue;
		let segment = `${encodeURIComponent(c.name)}=${encodeURIComponent(c.value)}`;
		if (c.path) segment += `; path=${c.path}`;
		if (c.domain) segment += `; domain=${c.domain}`;
		if (c.secure) segment += '; secure';
		if (c.sameSite) segment += `; samesite=${c.sameSite}`;
		if (c.expires && c.expires > 0) {
			segment += `; expires=${new Date(c.expires).toUTCString()}`;
		}
		try {
			document.cookie = segment;
		} catch {
			/* ignore */
		}
	}
}

/** Disk layout paths relative to `{gameId}/data/`. */
export const PROFILE_DISK_PATHS = {
	meta: 'meta.json',
	localStorage: 'profile/Default/localStorage.json',
	sessionStorage: 'profile/Default/sessionStorage.json',
	cookies: 'profile/Default/cookies.json',
	indexedDbDir: 'profile/Default/indexeddb'
} as const;
