/** IndexedDB storage for browser-hosted offline game copies (GitHub Pages / static web). */

const DB_NAME = 'potatotomato-offline-v1';
const DB_VERSION = 1;
const FILES_STORE = 'files';
const GAMES_STORE = 'games';

export interface StoredGameFile {
	mimeType: string;
	data: ArrayBuffer;
}

export interface StoredGameMeta {
	downloadedAt: number;
	fileCount: number;
	downloading: boolean;
	externalIframe?: boolean;
	/** Incomplete download kept for resume. */
	partialCache?: boolean;
	cachedFileCount?: number;
	totalFileCount?: number;
}

function fileKey(gameId: string, relativePath: string): string {
	return `${gameId}::${relativePath}`;
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
		req.onsuccess = () => resolve(req.result);
		req.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(FILES_STORE)) {
				db.createObjectStore(FILES_STORE);
			}
			if (!db.objectStoreNames.contains(GAMES_STORE)) {
				db.createObjectStore(GAMES_STORE);
			}
		};
	});
}

export async function putGameFile(
	gameId: string,
	relativePath: string,
	mimeType: string,
	data: ArrayBuffer
): Promise<void> {
	const db = await openDb();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(FILES_STORE, 'readwrite');
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
		tx.objectStore(FILES_STORE).put({ mimeType, data }, fileKey(gameId, relativePath));
	});
}

export async function getGameFile(
	gameId: string,
	relativePath: string
): Promise<StoredGameFile | null> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(FILES_STORE, 'readonly');
		tx.onerror = () => reject(tx.error ?? new Error('IndexedDB read failed'));
		const req = tx.objectStore(FILES_STORE).get(fileKey(gameId, relativePath));
		req.onsuccess = () => resolve((req.result as StoredGameFile | undefined) ?? null);
		req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
	});
}

export async function setGameMeta(gameId: string, meta: StoredGameMeta): Promise<void> {
	const db = await openDb();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(GAMES_STORE, 'readwrite');
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('IndexedDB meta write failed'));
		tx.objectStore(GAMES_STORE).put(meta, gameId);
	});
}

export async function getGameMeta(gameId: string): Promise<StoredGameMeta | null> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(GAMES_STORE, 'readonly');
		tx.onerror = () => reject(tx.error ?? new Error('IndexedDB meta read failed'));
		const req = tx.objectStore(GAMES_STORE).get(gameId);
		req.onsuccess = () => resolve((req.result as StoredGameMeta | undefined) ?? null);
		req.onerror = () => reject(req.error ?? new Error('IndexedDB meta read failed'));
	});
}

export async function listStoredGameIds(): Promise<string[]> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(GAMES_STORE, 'readonly');
		tx.onerror = () => reject(tx.error ?? new Error('IndexedDB list failed'));
		const req = tx.objectStore(GAMES_STORE).getAllKeys();
		req.onsuccess = () => resolve((req.result as string[]) ?? []);
		req.onerror = () => reject(req.error ?? new Error('IndexedDB list failed'));
	});
}

export async function deleteStoredGame(gameId: string): Promise<void> {
	const db = await openDb();
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction([FILES_STORE, GAMES_STORE], 'readwrite');
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'));
		const files = tx.objectStore(FILES_STORE);
		const prefix = `${gameId}::`;
		const keysReq = files.getAllKeys();
		keysReq.onsuccess = () => {
			for (const key of keysReq.result as string[]) {
				if (key.startsWith(prefix)) files.delete(key);
			}
		};
		tx.objectStore(GAMES_STORE).delete(gameId);
	});
}

export async function isBrowserGameDownloaded(gameId: string): Promise<boolean> {
	const meta = await getGameMeta(gameId);
	return Boolean(meta?.downloadedAt && meta.fileCount > 0 && !meta.partialCache);
}

export async function countStoredGameFiles(gameId: string): Promise<number> {
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(FILES_STORE, 'readonly');
		tx.onerror = () => reject(tx.error ?? new Error('IndexedDB count failed'));
		const prefix = `${gameId}::`;
		const req = tx.objectStore(FILES_STORE).getAllKeys();
		req.onsuccess = () => {
			const keys = (req.result as string[]) ?? [];
			resolve(keys.filter((k) => k.startsWith(prefix)).length);
		};
		req.onerror = () => reject(req.error ?? new Error('IndexedDB count failed'));
	});
}

export async function hasBrowserPartialCache(gameId: string): Promise<boolean> {
	const meta = await getGameMeta(gameId);
	if (meta?.partialCache && (meta.cachedFileCount ?? meta.fileCount) > 0) return true;
	const count = await countStoredGameFiles(gameId);
	return count > 0 && !meta?.downloadedAt;
}

export function guessMimeType(relativePath: string): string {
	const lower = relativePath.toLowerCase();
	if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html; charset=utf-8';
	if (lower.endsWith('.js')) return 'application/javascript; charset=utf-8';
	if (lower.endsWith('.css')) return 'text/css; charset=utf-8';
	if (lower.endsWith('.json')) return 'application/json; charset=utf-8';
	if (lower.endsWith('.wasm')) return 'application/wasm';
	if (lower.endsWith('.svg')) return 'image/svg+xml';
	if (lower.endsWith('.png')) return 'image/png';
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
	if (lower.endsWith('.webp')) return 'image/webp';
	if (lower.endsWith('.gif')) return 'image/gif';
	if (lower.endsWith('.mp3')) return 'audio/mpeg';
	if (lower.endsWith('.ogg')) return 'audio/ogg';
	if (lower.endsWith('.wav')) return 'audio/wav';
	return 'application/octet-stream';
}
