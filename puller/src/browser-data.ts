import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { gameDataRoot, resolveSafeGamesPath } from './catalog.js';
import {
	BROWSER_PROFILE_SCHEMA_VERSION,
	emptyGameBrowserProfile,
	isGameBrowserProfile,
	PROFILE_DISK_PATHS,
	type GameBrowserProfile,
	type IndexedDbDatabaseProfile
} from './browser-data-profile.js';

export function browserDataDir(gameId: string): string {
	return path.join(gameDataRoot(gameId), 'data');
}

function dataFilePath(gameId: string, rel: string): string {
	return path.join(browserDataDir(gameId), rel);
}

function assertDataPath(gameId: string, absPath: string): void {
	const root = path.resolve(browserDataDir(gameId));
	const resolved = path.resolve(absPath);
	if (!resolved.startsWith(root + path.sep) && resolved !== root) {
		throw new Error('Path traversal rejected');
	}
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
	try {
		const raw = await fs.readFile(filePath, 'utf-8');
		return JSON.parse(raw) as T;
	} catch {
		return fallback;
	}
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
	const dir = path.dirname(filePath);
	await fs.mkdir(dir, { recursive: true });
	const tmp = filePath + '.tmp';
	await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
	await fs.rename(tmp, filePath);
}

async function loadIndexedDbProfiles(gameId: string): Promise<IndexedDbDatabaseProfile[]> {
	const idbRoot = dataFilePath(gameId, PROFILE_DISK_PATHS.indexedDbDir);
	if (!existsSync(idbRoot)) return [];

	const entries = await fs.readdir(idbRoot, { withFileTypes: true });
	const profiles: IndexedDbDatabaseProfile[] = [];

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const dbDir = path.join(idbRoot, entry.name);
		const metaPath = path.join(dbDir, 'meta.json');
		const recordsPath = path.join(dbDir, 'records.json');
		try {
			const meta = await readJsonFile<{ name: string; version: number; objectStores: string[] }>(
				metaPath,
				{ name: entry.name, version: 1, objectStores: [] }
			);
			const records = await readJsonFile(recordsPath, []);
			profiles.push({
				name: meta.name ?? entry.name,
				version: meta.version ?? 1,
				objectStores: meta.objectStores ?? [],
				records: Array.isArray(records) ? records : []
			});
		} catch {
			/* skip corrupt db folder */
		}
	}

	return profiles;
}

async function saveIndexedDbProfiles(gameId: string, databases: IndexedDbDatabaseProfile[]): Promise<void> {
	const idbRoot = dataFilePath(gameId, PROFILE_DISK_PATHS.indexedDbDir);
	await fs.mkdir(idbRoot, { recursive: true });

	const existing = existsSync(idbRoot)
		? await fs.readdir(idbRoot, { withFileTypes: true })
		: [];
	for (const entry of existing) {
		if (entry.isDirectory()) {
			await fs.rm(path.join(idbRoot, entry.name), { recursive: true, force: true });
		}
	}

	for (const db of databases) {
		const safeName = db.name.replace(/[^a-zA-Z0-9._-]/g, '_');
		const dbDir = path.join(idbRoot, safeName);
		assertDataPath(gameId, dbDir);
		await fs.mkdir(dbDir, { recursive: true });
		await writeJsonAtomic(path.join(dbDir, 'meta.json'), {
			name: db.name,
			version: db.version,
			objectStores: db.objectStores
		});
		await writeJsonAtomic(path.join(dbDir, 'records.json'), db.records);
	}
}

export async function readGameBrowserProfile(gameId: string): Promise<GameBrowserProfile | null> {
	const root = browserDataDir(gameId);
	const metaPath = dataFilePath(gameId, PROFILE_DISK_PATHS.meta);
	if (!existsSync(root) && !existsSync(metaPath)) {
		return null;
	}

	const profile = emptyGameBrowserProfile();
	const meta = await readJsonFile<{ schemaVersion?: number; updatedAt?: number } | null>(
		metaPath,
		null
	);
	if (meta) {
		profile.schemaVersion = meta.schemaVersion ?? BROWSER_PROFILE_SCHEMA_VERSION;
		profile.updatedAt = meta.updatedAt ?? 0;
	}

	profile.profile.Default.localStorage = await readJsonFile(
		dataFilePath(gameId, PROFILE_DISK_PATHS.localStorage),
		{}
	);
	profile.profile.Default.sessionStorage = await readJsonFile(
		dataFilePath(gameId, PROFILE_DISK_PATHS.sessionStorage),
		{}
	);
	profile.profile.Default.cookies = await readJsonFile(
		dataFilePath(gameId, PROFILE_DISK_PATHS.cookies),
		[]
	);
	profile.profile.Default.indexedDB = await loadIndexedDbProfiles(gameId);

	const hasData =
		profile.updatedAt > 0 ||
		Object.keys(profile.profile.Default.localStorage).length > 0 ||
		Object.keys(profile.profile.Default.sessionStorage).length > 0 ||
		profile.profile.Default.cookies.length > 0 ||
		profile.profile.Default.indexedDB.length > 0;

	return hasData ? profile : null;
}

export async function writeGameBrowserProfile(
	gameId: string,
	input: GameBrowserProfile
): Promise<void> {
	if (!isGameBrowserProfile(input)) {
		throw new Error('Invalid browser profile payload');
	}

	const root = browserDataDir(gameId);
	assertDataPath(gameId, root);
	await fs.mkdir(root, { recursive: true });

	const updatedAt = Date.now();
	const profile: GameBrowserProfile = {
		...input,
		schemaVersion: BROWSER_PROFILE_SCHEMA_VERSION,
		updatedAt
	};

	await writeJsonAtomic(dataFilePath(gameId, PROFILE_DISK_PATHS.meta), {
		schemaVersion: profile.schemaVersion,
		updatedAt: profile.updatedAt
	});
	await writeJsonAtomic(
		dataFilePath(gameId, PROFILE_DISK_PATHS.localStorage),
		profile.profile.Default.localStorage
	);
	await writeJsonAtomic(
		dataFilePath(gameId, PROFILE_DISK_PATHS.sessionStorage),
		profile.profile.Default.sessionStorage
	);
	await writeJsonAtomic(dataFilePath(gameId, PROFILE_DISK_PATHS.cookies), profile.profile.Default.cookies);
	await saveIndexedDbProfiles(gameId, profile.profile.Default.indexedDB);
}

export async function deleteGameBrowserProfile(gameId: string): Promise<void> {
	const root = browserDataDir(gameId);
	if (!existsSync(root)) return;
	assertDataPath(gameId, root);
	await fs.rm(root, { recursive: true, force: true });
}

/** Resolve browser-data path under games data dir for security checks. */
export function resolveBrowserDataPath(gameId: string): string {
	const rel = path.join(gameId, 'data');
	return resolveSafeGamesPath(rel);
}
