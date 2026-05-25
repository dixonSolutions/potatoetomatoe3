/**
 * Which entry HTML to open (offline = static/games/<id>/offline/index.html when mirrored, else online shell).
 * Stored in localStorage only (client-side).
 */

const STORAGE_KEY = 'potato-tomato-game-host-mode';

/** Use mirrored copy under offline/ when game-entries lists it; otherwise the online iframe shell. */
export type GameHostMode = 'offline' | 'online';

const DEFAULT_MODE: GameHostMode = 'offline';

function normalize(raw: string | null): GameHostMode {
	if (raw === 'online' || raw === 'offline') return raw;
	return DEFAULT_MODE;
}

export function getGameHostMode(): GameHostMode {
	if (typeof localStorage === 'undefined') return DEFAULT_MODE;
	try {
		return normalize(localStorage.getItem(STORAGE_KEY));
	} catch {
		return DEFAULT_MODE;
	}
}

export function saveGameHostMode(mode: GameHostMode): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_KEY, mode);
	} catch (e) {
		console.error('Failed to save game host mode:', e);
	}
}
