/**
 * The desktop app's native in-frame bridge (see `src-tauri/src/game_frames.rs`).
 *
 * A game played from its own host is a cross-origin document, and page JavaScript cannot
 * put anything inside it. The Linux desktop webview can: before a launch, the app hands
 * the game's id to the native side, which installs `game-storage-bridge.child.js` as a
 * document-start user script in the game's frames. Virtual storage, key detection, the
 * touch console and pause then work in a game played straight from its host, with no
 * relay in between.
 *
 * Android has its own native bridge (`native_touch_bridge.js`), and the public site has
 * none, so everything here is a no-op there.
 */

import { isTauriApp, isTauriMobileBuild } from './offline-deployment';

export interface GameFrameLaunch {
	gameId: string;
	/** The frame the app creates holds an app-made document that already carries the bridge. */
	topHasBridge: boolean;
	/** Origins that serve documents with the bridge in their HTML (a running puller). */
	ownOrigins?: string[];
}

let supported: Promise<boolean> | null = null;
let active = false;

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
	const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
	return tauriInvoke<T>(command, args);
}

/** Desktop Tauri build whose webview can inject into cross-origin frames. */
export function nativeGameFramesSupported(): Promise<boolean> {
	if (supported) return supported;
	if (typeof window === 'undefined' || !isTauriApp() || isTauriMobileBuild()) {
		supported = Promise.resolve(false);
		return supported;
	}
	supported = invoke<boolean>('native_game_frames_supported').catch(() => false);
	return supported;
}

/**
 * True once a launch installed the native bridge in this webview. The console and the
 * pause/audio channel may then message any game frame, whatever origin it came from.
 */
export function nativeGameFramesActive(): boolean {
	return active;
}

/**
 * Install the bridge for the game about to be framed. Must finish before the frame's
 * `src` is set: the game document has to find the script there at its first byte.
 */
export async function prepareNativeGameFrames(launch: GameFrameLaunch): Promise<boolean> {
	if (!(await nativeGameFramesSupported())) return false;
	try {
		active = await invoke<boolean>('set_game_frame_context', {
			context: {
				gameId: launch.gameId,
				appOrigin: window.location.origin,
				ownOrigins: launch.ownOrigins ?? [],
				topHasBridge: launch.topHasBridge
			}
		});
	} catch {
		active = false;
	}
	return active;
}

/** Remove the bridge from the webview's frames (no game on screen any more). */
export async function releaseNativeGameFrames(): Promise<void> {
	if (!active) return;
	active = false;
	try {
		await invoke('clear_game_frame_context');
	} catch {
		/* the next launch replaces it anyway */
	}
}

/*
 * Proof of life from a game document.
 *
 * A host that refuses to be framed, an error page and a Flash file all still fire the
 * iframe's `load`, so a timer on `load` cannot tell them from a game. What it can tell is
 * whether the frame ran anything: the native preamble and the relay page post
 * `potato-tomato-game-frame` at document start, and the bridge asks for the saved profile
 * (`potato-tomato-game-storage` / `pull`) as it boots. A frame that loaded and said
 * neither never ran a script — the launch watchdog moves on to the next route.
 */
const lastHeard = new Map<string, number>();
let listening = false;

function listen(): void {
	if (listening || typeof window === 'undefined') return;
	listening = true;
	window.addEventListener('message', (event: MessageEvent) => {
		const data = event.data as { type?: string; action?: string; gameId?: unknown } | null;
		if (!data || typeof data !== 'object' || typeof data.gameId !== 'string' || !data.gameId) {
			return;
		}
		const alive =
			data.type === 'potato-tomato-game-frame' ||
			(data.type === 'potato-tomato-game-storage' && data.action === 'pull');
		if (alive) lastHeard.set(data.gameId, Date.now());
	});
}

/** Start listening before the frame exists, so the first word from it is not missed. */
export function watchGameFrameLife(): void {
	listen();
}

/** Did a document of this game's frames run since `since` (ms epoch)? */
export function gameFrameSpokeSince(gameId: string, since: number): boolean {
	return (lastHeard.get(gameId) ?? 0) >= since;
}
