/**
 * What the desktop app tells the page after a game crashed WebKit's web process.
 *
 * The Linux app reloads its page when the web process dies (`src-tauri/src/webview_crash.rs`),
 * returning to where the user was. A game page must not then start the same game again —
 * it would crash again, reload again — so the reloaded page asks once what happened and
 * the game page shows a notice instead.
 */

import { isTauriApp, isTauriMobileBuild } from './offline-deployment';

export interface WebviewCrash {
	/** The game whose page was open, when it was a game page. */
	gameId: string | null;
	/** `crashed`, `exceeded-memory-limit`, or `terminated` (the debug trigger). */
	reason: string;
	url: string;
	/** Milliseconds since the epoch. */
	at: number;
}

export function isWebviewCrash(value: unknown): value is WebviewCrash {
	if (!value || typeof value !== 'object') return false;
	const v = value as WebviewCrash;
	return (
		(v.gameId === null || typeof v.gameId === 'string') &&
		typeof v.reason === 'string' &&
		typeof v.url === 'string' &&
		typeof v.at === 'number'
	);
}

type Invoke = <T>(command: string) => Promise<T>;

async function defaultInvoke<T>(command: string): Promise<T> {
	const { invoke } = await import('@tauri-apps/api/core');
	return invoke<T>(command);
}

/**
 * The native side hands the crash to its first reader, so this page load reads it once and
 * every caller shares the answer.
 */
export function createWebviewCrashReader(
	invoke: Invoke = defaultInvoke,
	available: () => boolean = () =>
		typeof window !== 'undefined' && isTauriApp() && !isTauriMobileBuild()
) {
	let read: Promise<WebviewCrash | null> | null = null;
	let shown = false;

	function crashOnLoad(): Promise<WebviewCrash | null> {
		read ??= available()
			? invoke<unknown>('take_webview_crash').then(
					(crash) => (isWebviewCrash(crash) ? crash : null),
					() => null
				)
			: Promise.resolve(null);
		return read;
	}

	/**
	 * The crash that brought the page back, if it happened on `gameId`'s page — once per
	 * page load: coming back to the game later starts it as usual.
	 */
	async function takeCrashOfGame(gameId: string): Promise<WebviewCrash | null> {
		const crash = await crashOnLoad();
		if (!crash || shown || !gameId || crash.gameId !== gameId) return null;
		shown = true;
		return crash;
	}

	return { crashOnLoad, takeCrashOfGame };
}

const reader = createWebviewCrashReader();

export const webviewCrashOnLoad = reader.crashOnLoad;
export const takeWebviewCrashOfGame = reader.takeCrashOfGame;
