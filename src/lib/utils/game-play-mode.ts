/**
 * Per-game online vs offline play preference (localStorage).
 */

import { loadSiteSettings, patchSiteSettings } from '$lib/utils/site-settings';

export type GamePlayMode = 'online' | 'offline';

const STORAGE_PREFIX = 'potato-tomato-game-play-mode-';

export const GAME_PLAY_MODE_CHANGED = 'potato-tomato-game-play-mode-changed';
export const DEFAULT_GAME_PLAY_MODE_CHANGED = 'potato-tomato-default-game-play-mode-changed';

export function getDefaultGamePlayMode(): GamePlayMode {
	const settings = loadSiteSettings();
	return settings.defaultGamePlayMode === 'offline' ? 'offline' : 'online';
}

export function saveDefaultGamePlayMode(mode: GamePlayMode): void {
	patchSiteSettings({ defaultGamePlayMode: mode });
	window.dispatchEvent(new CustomEvent(DEFAULT_GAME_PLAY_MODE_CHANGED, { detail: { mode } }));
}

export function getGamePlayMode(gameId: string): GamePlayMode {
	if (typeof localStorage === 'undefined') return getDefaultGamePlayMode();
	try {
		const raw = localStorage.getItem(STORAGE_PREFIX + gameId);
		if (raw === 'online' || raw === 'offline') return raw;
	} catch {
		// ignore
	}
	return getDefaultGamePlayMode();
}

export function saveGamePlayMode(gameId: string, mode: GamePlayMode): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(STORAGE_PREFIX + gameId, mode);
		window.dispatchEvent(new CustomEvent(GAME_PLAY_MODE_CHANGED, { detail: { gameId, mode } }));
	} catch (e) {
		console.error('Failed to save game play mode:', e);
	}
}

export function clearGamePlayMode(gameId: string): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.removeItem(STORAGE_PREFIX + gameId);
	} catch {
		// ignore
	}
}
