/**
 * Persists in-game browser storage in per-game profiles (disk or IndexedDB)
 * so offline and online play share the same save data.
 */

import {
	emptyGameBrowserProfile,
	isGameBrowserProfile,
	type GameBrowserProfile
} from './game-browser-profile';
import { loadGameBrowserProfile, saveGameBrowserProfile } from './game-browser-storage';

export const GAME_STORAGE_MESSAGE_TYPE = 'potato-tomato-game-storage';

/** @deprecated Use GameBrowserProfile via game-browser-storage */
export interface GameBrowserData {
	localStorage: Record<string, string>;
	updatedAt: number;
}

export function attachGameStorageBridge(): () => void {
	if (typeof window === 'undefined') return () => {};

	const onMessage = (event: MessageEvent) => {
		const msg = event.data as {
			type?: string;
			action?: string;
			gameId?: string;
			data?: GameBrowserProfile;
		};
		if (!msg || msg.type !== GAME_STORAGE_MESSAGE_TYPE || typeof msg.gameId !== 'string') return;

		if (msg.action === 'pull') {
			void loadGameBrowserProfile(msg.gameId).then((stored) => {
				const source = event.source;
				if (source && typeof (source as Window).postMessage === 'function' && stored) {
					(source as Window).postMessage(
						{
							type: GAME_STORAGE_MESSAGE_TYPE,
							action: 'hydrate',
							gameId: msg.gameId,
							data: stored
						},
						'*'
					);
				}
			});
			return;
		}

		if (msg.action === 'push' && msg.data && isGameBrowserProfile(msg.data)) {
			void saveGameBrowserProfile(msg.gameId, msg.data);
		}
	};

	window.addEventListener('message', onMessage);
	return () => window.removeEventListener('message', onMessage);
}

/** Same-origin backup: snapshot iframe storage when the child bridge did not run. */
export async function captureGameStorageFromIframe(
	iframe: HTMLIFrameElement,
	gameId: string
): Promise<void> {
	try {
		const win = iframe.contentWindow;
		if (!win || win === window) return;
		const origin = win.location.origin;

		const localStorageSnapshot: Record<string, string> = {};
		for (let i = 0; i < win.localStorage.length; i++) {
			const key = win.localStorage.key(i);
			if (key) localStorageSnapshot[key] = win.localStorage.getItem(key) ?? '';
		}

		const sessionStorageSnapshot: Record<string, string> = {};
		for (let i = 0; i < win.sessionStorage.length; i++) {
			const key = win.sessionStorage.key(i);
			if (key) sessionStorageSnapshot[key] = win.sessionStorage.getItem(key) ?? '';
		}

		const profile = emptyGameBrowserProfile();
		profile.profile.Default.localStorage[origin] = localStorageSnapshot;
		profile.profile.Default.sessionStorage[origin] = sessionStorageSnapshot;
		profile.updatedAt = Date.now();

		await saveGameBrowserProfile(gameId, profile);
	} catch {
		// cross-origin iframe — child bridge uses postMessage instead
	}
}
