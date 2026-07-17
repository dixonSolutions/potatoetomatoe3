/**
 * Safe localStorage access for SvelteKit (avoids Node's ExperimentalWarning on
 * the bare `localStorage` global during SSR).
 */

export function canUseLocalStorage(): boolean {
	try {
		return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
	} catch {
		return false;
	}
}
