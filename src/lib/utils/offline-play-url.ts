/** Resolve URLs for on-disk offline copies under static/games/{id}/offline/. */

/** Keep in sync with `BUNDLED_OFFLINE_GAME_IDS` in offline-downloader.ts */
const BUNDLED_OFFLINE_GAME_IDS = ['shrek-escape'] as const;

export {
	fetchOfflineManifest,
	looksLikeGameShellHtml,
	offlineManifestUrl,
	resolveStaticOfflineEntry,
	resolveStaticOfflinePlayUrl,
	staticOfflinePlayUrlForEntry
} from './offline-manifest';

import {
	looksLikeGameShellHtml,
	resolveStaticOfflineEntry,
	resolveStaticOfflinePlayUrl,
	staticOfflinePlayUrlForEntry
} from './offline-manifest';

/** @deprecated Prefer resolveStaticOfflinePlayUrl — entry may not be index.html */
export function staticOfflinePlayUrl(gameId: string, basePath = '', entry = 'index.html'): string {
	return staticOfflinePlayUrlForEntry(gameId, entry, basePath);
}

/** GitHub Pages serves the SPA shell for missing paths — must not treat that as a real offline mirror. */
export function looksLikeAppShell(html: string): boolean {
	return (
		html.includes('__sveltekit') ||
		html.includes('data-sveltekit') ||
		html.includes('Potato Tomato Games')
	);
}

export async function staticOfflineFileExists(gameId: string, basePath = ''): Promise<boolean> {
	if ((BUNDLED_OFFLINE_GAME_IDS as readonly string[]).includes(gameId)) return true;
	if (typeof fetch === 'undefined') return false;

	const entry = await resolveStaticOfflineEntry(gameId, basePath);
	const playUrl = staticOfflinePlayUrlForEntry(gameId, entry, basePath);

	try {
		const res = await fetch(playUrl, { method: 'GET' });
		if (!res.ok) return false;
		const snippet = await res.text();
		if (looksLikeAppShell(snippet)) return false;
		return looksLikeGameShellHtml(snippet);
	} catch {
		return false;
	}
}
