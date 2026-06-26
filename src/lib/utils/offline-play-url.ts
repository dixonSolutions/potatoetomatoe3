/** Resolve URLs for on-disk offline copies under static/games/{id}/offline/. */

/** Keep in sync with `BUNDLED_OFFLINE_GAME_IDS` in offline-downloader.ts */
const BUNDLED_OFFLINE_GAME_IDS = ['shrek-escape'] as const;

export function staticOfflinePlayUrl(gameId: string, basePath = ''): string {
	const base = basePath.replace(/\/$/, '');
	return `${base}/games/${encodeURIComponent(gameId)}/offline/index.html`.replace(/\/{2,}/g, '/');
}

/** GitHub Pages serves the SPA shell for missing paths — must not treat that as a real offline mirror. */
function looksLikeAppShell(html: string): boolean {
	return (
		html.includes('__sveltekit') ||
		html.includes('data-sveltekit') ||
		html.includes('Potato Tomato Games')
	);
}

export async function staticOfflineFileExists(gameId: string, basePath = ''): Promise<boolean> {
	if ((BUNDLED_OFFLINE_GAME_IDS as readonly string[]).includes(gameId)) return true;
	if (typeof fetch === 'undefined') return false;
	try {
		const res = await fetch(staticOfflinePlayUrl(gameId, basePath), { method: 'GET' });
		if (!res.ok) return false;
		const snippet = await res.text();
		if (looksLikeAppShell(snippet)) return false;
		return (
			snippet.includes('<iframe') ||
			snippet.includes('createUnityInstance') ||
			snippet.includes('UnityLoader')
		);
	} catch {
		return false;
	}
}
