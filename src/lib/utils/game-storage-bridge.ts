/**
 * Persists in-game browser storage (localStorage) in the app shell so offline copies
 * can hydrate the same save data as online / prior sessions.
 */

export const GAME_STORAGE_MESSAGE_TYPE = 'potato-tomato-game-storage';

export interface GameBrowserData {
	localStorage: Record<string, string>;
	updatedAt: number;
}

const STORAGE_PREFIX = 'potato-tomato-game-browser-data-';

export function gameBrowserDataKey(gameId: string): string {
	return STORAGE_PREFIX + gameId;
}

export function loadGameBrowserData(gameId: string): GameBrowserData | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(gameBrowserDataKey(gameId));
		if (!raw) return null;
		const parsed = JSON.parse(raw) as GameBrowserData;
		if (!parsed || typeof parsed.localStorage !== 'object') return null;
		return parsed;
	} catch {
		return null;
	}
}

export function saveGameBrowserData(gameId: string, data: GameBrowserData): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(gameBrowserDataKey(gameId), JSON.stringify(data));
	} catch {
		// quota or private mode
	}
}

/** Read same-origin iframe localStorage into the parent snapshot store. */
export function captureGameStorageFromIframe(iframe: HTMLIFrameElement, gameId: string): void {
	try {
		const win = iframe.contentWindow;
		if (!win || win === window) return;
		const localStorageSnapshot: Record<string, string> = {};
		for (let i = 0; i < win.localStorage.length; i++) {
			const key = win.localStorage.key(i);
			if (key) localStorageSnapshot[key] = win.localStorage.getItem(key) ?? '';
		}
		saveGameBrowserData(gameId, { localStorage: localStorageSnapshot, updatedAt: Date.now() });
	} catch {
		// cross-origin iframe — child bridge uses postMessage instead
	}
}

export function attachGameStorageBridge(): () => void {
	if (typeof window === 'undefined') return () => {};

	const onMessage = (event: MessageEvent) => {
		const msg = event.data as {
			type?: string;
			action?: string;
			gameId?: string;
			data?: { localStorage?: Record<string, string> };
		};
		if (!msg || msg.type !== GAME_STORAGE_MESSAGE_TYPE || typeof msg.gameId !== 'string') return;

		if (msg.action === 'pull') {
			const stored = loadGameBrowserData(msg.gameId);
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
			return;
		}

		if (msg.action === 'push' && msg.data?.localStorage) {
			saveGameBrowserData(msg.gameId, {
				localStorage: msg.data.localStorage,
				updatedAt: Date.now()
			});
		}
	};

	window.addEventListener('message', onMessage);
	return () => window.removeEventListener('message', onMessage);
}
