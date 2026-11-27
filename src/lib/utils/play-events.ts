/**
 * The recommender's event log: launch errors and early leaves, the signals play analytics
 * (starts, playtime, last played) does not keep. Six months at most, newest kept.
 *
 * Lives in IndexedDB: it grows with every session and is only needed when ranking, so it
 * stays off the synchronous localStorage path that paints Home. Reads before the first load
 * finishes see what this page recorded so far; `loadPlayEvents()` resolves once the stored
 * log is in. Without IndexedDB (private mode, tests) it is memory only.
 */
import { WINDOW_MS } from './recommendation-model';

export type PlayEventKind = 'error' | 'leave';
export type PlayEvent = { t: number; id: string; k: PlayEventKind };

const DB = 'potato-tomato-recs';
const STORE = 'kv';
const KEY = 'events';
export const MAX_EVENTS = 4000;

let events: PlayEvent[] = [];
let loaded: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function openDb(): Promise<IDBDatabase | null> {
	if (typeof indexedDB === 'undefined') return Promise.resolve(null);
	return new Promise((resolve) => {
		try {
			const req = indexedDB.open(DB, 1);
			req.onupgradeneeded = () => req.result.createObjectStore(STORE);
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => resolve(null);
			req.onblocked = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
}

export function prune(list: PlayEvent[], now = Date.now()): PlayEvent[] {
	const kept = list.filter((e) => now - e.t <= WINDOW_MS);
	return kept.length > MAX_EVENTS ? kept.slice(kept.length - MAX_EVENTS) : kept;
}

/** Load the stored log once (merged with anything recorded meanwhile). */
export function loadPlayEvents(): Promise<void> {
	loaded ??= (async () => {
		const db = await openDb();
		if (!db) return;
		const stored = await new Promise<PlayEvent[]>((resolve) => {
			try {
				const req = db.transaction(STORE).objectStore(STORE).get(KEY);
				req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
				req.onerror = () => resolve([]);
			} catch {
				resolve([]);
			}
		});
		db.close();
		events = prune([...stored, ...events].sort((a, b) => a.t - b.t));
	})();
	return loaded;
}

function scheduleSave() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		void (async () => {
			await loadPlayEvents();
			const db = await openDb();
			if (!db) return;
			try {
				db.transaction(STORE, 'readwrite').objectStore(STORE).put(events, KEY);
			} catch {
				/* best effort */
			}
			db.close();
		})();
	}, 1000);
}

export function recordPlayEvent(id: string, k: PlayEventKind, t = Date.now()): void {
	events = prune([...events, { t, id, k }], t);
	scheduleSave();
}

export function playEvents(): readonly PlayEvent[] {
	return events;
}

/** Tests only. */
export function resetPlayEventsForTests(): void {
	events = [];
	loaded = null;
	clearTimeout(saveTimer);
}
