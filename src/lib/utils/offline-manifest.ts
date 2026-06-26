/** Client-side helpers for offline-manifest.json under static/games/{id}/offline/. */

export const OFFLINE_MANIFEST_FILENAME = 'offline-manifest.json';

export interface OfflineManifest {
	entry: string;
	mirroredFrom?: string;
	savedAt?: string;
}

const GAME_SHELL_MARKERS =
	/c2runtime|cr_createRuntime|lime\.embed|UnityLoader|createUnityInstance|openfl-content/i;

export function offlineManifestUrl(gameId: string, basePath = ''): string {
	const base = basePath.replace(/\/$/, '');
	return `${base}/games/${encodeURIComponent(gameId)}/offline/${OFFLINE_MANIFEST_FILENAME}`.replace(
		/\/{2,}/g,
		'/'
	);
}

export function staticOfflinePlayUrlForEntry(
	gameId: string,
	entry: string,
	basePath = ''
): string {
	const base = basePath.replace(/\/$/, '');
	const safeEntry = entry.replace(/^(\.\.\/)+/, '').replace(/^\//, '');
	return `${base}/games/${encodeURIComponent(gameId)}/offline/${safeEntry}`.replace(/\/{2,}/g, '/');
}

/** @deprecated Prefer resolveStaticOfflinePlayUrl — entry may not be index.html */
export function staticOfflinePlayUrl(gameId: string, basePath = '', entry = 'index.html'): string {
	return staticOfflinePlayUrlForEntry(gameId, entry, basePath);
}

export async function fetchOfflineManifest(
	gameId: string,
	basePath = ''
): Promise<OfflineManifest | null> {
	if (typeof fetch === 'undefined') return null;
	try {
		const res = await fetch(offlineManifestUrl(gameId, basePath));
		if (!res.ok) return null;
		const parsed = (await res.json()) as OfflineManifest;
		if (typeof parsed?.entry !== 'string' || !parsed.entry.trim()) return null;
		return parsed;
	} catch {
		return null;
	}
}

export async function resolveStaticOfflineEntry(
	gameId: string,
	basePath = ''
): Promise<string> {
	const manifest = await fetchOfflineManifest(gameId, basePath);
	if (manifest?.entry) return manifest.entry;
	return 'index.html';
}

export async function resolveStaticOfflinePlayUrl(
	gameId: string,
	basePath = ''
): Promise<string> {
	const entry = await resolveStaticOfflineEntry(gameId, basePath);
	return staticOfflinePlayUrlForEntry(gameId, entry, basePath);
}

export function looksLikeGameShellHtml(html: string): boolean {
	return (
		html.includes('<iframe') ||
		html.includes('createUnityInstance') ||
		html.includes('UnityLoader') ||
		html.includes('lime.embed') ||
		html.includes('openfl-content') ||
		html.includes('c2runtime.js') ||
		html.includes('cr_createRuntime') ||
		GAME_SHELL_MARKERS.test(html)
	);
}
