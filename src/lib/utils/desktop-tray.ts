/**
 * Desktop system tray bridge (Tauri / StatusNotifierItem).
 * Syncs top recent games into the tray menu and handles tray navigation events.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { canUseLocalStorage } from '$lib/utils/browser-storage';
import { loadAllGames } from '$lib/utils/games';
import { isTauriApp } from '$lib/utils/offline-deployment';
import { getPlaySessionsList } from '$lib/utils/play-recommendations';
import { getPreferences } from '$lib/utils/preferences';

export interface TrayRecentGame {
	id: string;
	name: string;
}

export interface TrayLifecycleState {
	trayAvailable: boolean;
	closeToTray: boolean;
}

const TRAY_HINT_KEY = 'potato-tomato-tray-hint-shown';

let cachedLifecycle: TrayLifecycleState | null = null;

/** Top five recently played games for the tray menu (excludes disliked). */
export async function getTrayRecentGames(limit = 5): Promise<TrayRecentGame[]> {
	const prefs = getPreferences();
	const disliked = new Set(prefs.disliked);
	const sessions = getPlaySessionsList()
		.filter((s) => !disliked.has(s.gameId))
		.slice(0, limit);

	/* Prefer lean index names; fall back to game id */
	let byId = new Map<string, { name?: string }>();
	try {
		const allGames = await loadAllGames();
		byId = new Map(allGames.map((g) => [g.id, g]));
	} catch {
		/* ignore */
	}

	return sessions.map((s) => ({
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

export async function getTrayLifecycleState(force = false): Promise<TrayLifecycleState> {
	if (!isTauriApp()) {
		return { trayAvailable: false, closeToTray: false };
	}
	if (!force && cachedLifecycle) return cachedLifecycle;
	try {
		const [trayAvailable, closeToTray] = await Promise.all([
			invoke<boolean>('is_tray_available'),
			invoke<boolean>('is_close_to_tray_enabled')
		]);
		cachedLifecycle = {
			trayAvailable: !!trayAvailable,
			closeToTray: !!closeToTray
		};
		return cachedLifecycle;
	} catch {
		cachedLifecycle = { trayAvailable: false, closeToTray: false };
		return cachedLifecycle;
	}
}

export async function setCloseToTrayEnabled(enabled: boolean): Promise<boolean> {
	if (!isTauriApp()) return false;
	try {
		const next = await invoke<boolean>('set_close_to_tray_enabled', { enabled });
		cachedLifecycle = {
			trayAvailable: cachedLifecycle?.trayAvailable ?? true,
			closeToTray: !!next
		};
		return !!next;
	} catch {
		return false;
	}
}

/** Fully quit the desktop app (stops puller). */
export async function quitDesktopApp(): Promise<void> {
	if (!isTauriApp()) return;
	try {
		await invoke('quit_app');
	} catch (err) {
		console.warn('quit_app failed:', err);
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
		void goto(resolve(path as any));
	});

	void syncDesktopTrayRecent();

	return () => {
		unlistenOpen();
		unlistenNav();
	};
}

/** One-time hint about close behavior (tray vs quit). */
export function shouldShowTrayCloseHint(): boolean {
	if (!isTauriApp() || !canUseLocalStorage()) return false;
	try {
		return localStorage.getItem(TRAY_HINT_KEY) !== '1';
	} catch {
		return false;
	}
}

export function markTrayCloseHintShown(): void {
	if (!canUseLocalStorage()) return;
	try {
		localStorage.setItem(TRAY_HINT_KEY, '1');
	} catch {
		/* ignore */
	}
}
