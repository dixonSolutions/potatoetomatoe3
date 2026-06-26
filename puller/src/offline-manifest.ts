import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { catalogGameRoot, offlineDir } from './catalog.js';
import { MIN_OFFLINE_INDEX_BYTES } from './config.js';

export const OFFLINE_MANIFEST_FILENAME = 'offline-manifest.json';

export interface OfflineManifest {
	/** HTML entry file relative to offline/ (e.g. index.html, ovo.html). */
	entry: string;
	mirroredFrom?: string;
	savedAt?: string;
}

export function normalizeOfflineEntryRel(entry: string): string {
	const normalized = path.normalize(entry).replace(/^(\.\.(\/|\\|$))+/, '');
	if (normalized.includes('..') || path.isAbsolute(normalized)) {
		throw new Error('Invalid offline entry path');
	}
	return normalized.split(path.sep).join('/');
}

export function offlineManifestPathForDir(offlineRoot: string): string {
	return path.join(offlineRoot, OFFLINE_MANIFEST_FILENAME);
}

export async function readOfflineManifestFromDir(
	offlineRoot: string
): Promise<OfflineManifest | null> {
	try {
		const raw = await fs.readFile(offlineManifestPathForDir(offlineRoot), 'utf-8');
		const parsed = JSON.parse(raw) as OfflineManifest;
		if (typeof parsed?.entry !== 'string' || !parsed.entry.trim()) return null;
		return { ...parsed, entry: normalizeOfflineEntryRel(parsed.entry) };
	} catch {
		return null;
	}
}

export async function writeOfflineManifest(
	offlineRoot: string,
	manifest: OfflineManifest
): Promise<void> {
	const payload: OfflineManifest = {
		...manifest,
		entry: normalizeOfflineEntryRel(manifest.entry),
		savedAt: manifest.savedAt ?? new Date().toISOString()
	};
	await fs.writeFile(
		offlineManifestPathForDir(offlineRoot),
		`${JSON.stringify(payload, null, 2)}\n`,
		'utf-8'
	);
}

async function entryFileValid(offlineRoot: string, entryRel: string): Promise<boolean> {
	try {
		const stat = await fs.stat(path.join(offlineRoot, entryRel));
		return stat.isFile() && stat.size >= MIN_OFFLINE_INDEX_BYTES;
	} catch {
		return false;
	}
}

/** Resolve playable entry HTML under offline/ (manifest first, then index.html). */
export async function resolveOfflineEntryRelForDir(offlineRoot: string): Promise<string | null> {
	if (!existsSync(offlineRoot)) return null;

	const manifest = await readOfflineManifestFromDir(offlineRoot);
	if (manifest && (await entryFileValid(offlineRoot, manifest.entry))) {
		return manifest.entry;
	}

	if (await entryFileValid(offlineRoot, 'index.html')) {
		return 'index.html';
	}

	return null;
}

export async function resolveOfflineEntryRel(gameId: string): Promise<string | null> {
	for (const root of [offlineDir(gameId), path.join(catalogGameRoot(gameId), 'offline')]) {
		const entry = await resolveOfflineEntryRelForDir(root);
		if (entry) return entry;
	}
	return null;
}

export function offlineEntryPath(gameId: string, entryRel: string): string {
	return path.join(offlineDir(gameId), normalizeOfflineEntryRel(entryRel));
}
