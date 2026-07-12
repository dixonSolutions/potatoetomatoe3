/**
 * Desktop system tray bridge (Tauri / StatusNotifierItem).
 * Syncs top recent games into the tray menu and handles tray navigation events.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { loadAllGames } from '$lib/utils/games';
import { isTauriApp } from '$lib/utils/offline-deployment';
import { getPlaySessionsList } from '$lib/utils/play-recommendations';
import { getPreferences } from '$lib/utils/preferences';

export interface TrayRecentGame {
	id: string;
	name: string;
}

const TRAY_HINT_KEY = 'potato-tomato-tray-hint-shown';

/** Top five recently played games for the tray menu (excludes disliked). */
export async function getTrayRecentGames(limit = 5): Promise<TrayRecentGame[]> {
	const [allGames, prefs] = await Promise.all([loadAllGames(), Promise.resolve(getPreferences())]);
	const disliked = new Set(prefs.disliked);
	const byId = new Map(allGames.map((g) => [g.id, g]));

	return getPlaySessionsList()
		.filter((s) => !disliked.has(s.gameId))
		.slice(0, limit)
		.map((s) => ({
			id: s.gameId,
			name: byId.get(s.gameId)?.name?.trim() || s.gameId
		}));
}

export async function syncDesktopTrayRecent(): Promise<void> {
	if (!isTauriApp()) return;
	try {
		const games = await getTrayRecentGames(5);
		await invoke('sync_tray_recent', { games });
	} catch (err) {
		console.warn('Tray recent sync failed:', err);
	}
}

/** Subscribe to tray menu navigations. Returns cleanup. */
export async function attachDesktopTrayListeners(): Promise<UnlistenFn> {
	if (!isTauriApp()) return () => {};

	const unlistenOpen = await listen<string>('tray-open-game', (event) => {
		const id = (event.payload ?? '').trim();
		if (!id) return;
		void goto(resolve(`/games/${encodeURIComponent(id)}`));
	});

	const unlistenNav = await listen<string>('tray-navigate', (event) => {
		const path = (event.payload ?? '').trim();
		if (!path.startsWith('/')) return;
		void goto(resolve(path));
	});

	void syncDesktopTrayRecent();

	return () => {
		unlistenOpen();
		unlistenNav();
	};
}

/** One-time hint that closing the window keeps the app in the tray. */
export function shouldShowTrayCloseHint(): boolean {
	if (!isTauriApp() || typeof localStorage === 'undefined') return false;
	try {
		return localStorage.getItem(TRAY_HINT_KEY) !== '1';
	} catch {
		return false;
	}
}

export function markTrayCloseHintShown(): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(TRAY_HINT_KEY, '1');
	} catch {
		/* ignore */
	}
}
