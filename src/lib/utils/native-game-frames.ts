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

import { getGamePlayerSettings } from './game-player-settings';
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
	const player = getGamePlayerSettings();
	try {
		active = await invoke<boolean>('set_game_frame_context', {
			context: {
				gameId: launch.gameId,
				appOrigin: window.location.origin,
				ownOrigins: launch.ownOrigins ?? [],
				topHasBridge: launch.topHasBridge,
				/* WebKitGTK tuning for this launch (src-tauri/src/game_frame_tuning.rs). */
				capDpr: player.renderAtDisplayScale,
				fullSpeed: player.fullSpeedInPowerSaver
			}
		});
	} catch {
		active = false;
	}
	if (active) armFirstInput();
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
		const data = event.data as {
			type?: string;
			action?: string;
			gameId?: unknown;
			role?: unknown;
		} | null;
		if (!data || typeof data !== 'object') return;
		/* A nested frame of the game (a portal's playable canvas) announces itself too. */
		if (data.type === 'potato-tomato-game-frame' && data.role === 'nested') {
			firstInputFor(event.source, NESTED_FRAME_SETTLE_MS, 'document');
			return;
		}
		if (typeof data.gameId !== 'string' || !data.gameId) return;
		const preamble = data.type === 'potato-tomato-game-frame';
		const alive =
			preamble || (data.type === 'potato-tomato-game-storage' && data.action === 'pull');
		if (!alive) return;
		lastHeard.set(data.gameId, Date.now());
		firstInputFor(event.source, GAME_FRAME_SETTLE_MS, preamble ? 'document' : 'bridge');
	});
}

/*
 * First input.
 *
 * WebKitGTK runs a cross-origin frame the user has not interacted with at 30 fps, and
 * every game is cross-origin to the app page. The throttle lifts on the first click, or
 * the first key press while the frame has focus. So once a game document has announced
 * itself and its frame holds the keyboard, the native side sends one F24 press into it
 * (`src-tauri/src/frame_first_input.rs`); the app's in-frame tuning script swallows it, so
 * no game sees it. One press per announced document: the native preamble announces each
 * game and nested frame document once (the press goes wherever focus is by then), and a
 * document that brings the bridge in its HTML (relay, offline copy) is known by the bridge
 * asking for its saves, which can repeat, so that counts once per frame and launch. Nothing
 * waits on it: if it never happens, the player's own first input lifts the throttle.
 */
const GAME_FRAME_SETTLE_MS = 250;
const NESTED_FRAME_SETTLE_MS = 1500;
/** How long to wait for the game frame to get the keyboard before giving up. */
const FOCUS_WAIT_MS = 60_000;
const FOCUS_POLL_MS = 250;
/** Presses per launch, whatever the frames do. */
const PRESSES_PER_LAUNCH = 4;

let pressesLeft = 0;
/** Announcing windows with a press already scheduled or sent this launch, and when. */
const recentSources = new Map<MessageEventSource, number>();
/** The preamble and the bridge of one document announce it within this window. */
const SAME_DOCUMENT_MS = 1500;

function armFirstInput(): void {
	pressesLeft = PRESSES_PER_LAUNCH;
	recentSources.clear();
	listen();
}

/** The app's iframe that holds `source`, directly or further down. */
function appFrameHolding(source: MessageEventSource): HTMLIFrameElement | null {
	for (const frame of Array.from(document.getElementsByTagName('iframe'))) {
		const win = frame.contentWindow;
		if (!win) continue;
		let w = source as Window | null;
		for (let depth = 0; w && depth < 8; depth++) {
			if (w === win) return frame;
			if (w.parent === w) break;
			w = w.parent;
		}
	}
	return null;
}

function firstInputFor(
	source: MessageEventSource | null,
	settleMs: number,
	announcedBy: 'document' | 'bridge'
): void {
	if (!active || pressesLeft <= 0 || !source) return;
	const now = Date.now();
	const last = recentSources.get(source);
	if (last !== undefined && (announcedBy === 'bridge' || now - last < SAME_DOCUMENT_MS)) return;
	recentSources.set(source, now);
	const frame = appFrameHolding(source);
	if (!frame) return;
	const deadline = now + FOCUS_WAIT_MS;
	const attempt = () => {
		if (!active || pressesLeft <= 0 || !frame.isConnected) return;
		/*
		 * The press goes to the webview's focused frame, so it must be the game's. Whether
		 * the window itself has focus does not matter: the event is sent to this webview
		 * only, and lands in the game frame either way.
		 */
		if (document.activeElement === frame) {
			pressesLeft--;
			void invoke('lift_game_frame_throttle').catch(() => {});
			return;
		}
		if (Date.now() < deadline) window.setTimeout(attempt, FOCUS_POLL_MS);
	};
	window.setTimeout(attempt, settleMs);
}

/** Start listening before the frame exists, so the first word from it is not missed. */
export function watchGameFrameLife(): void {
	listen();
}

/** Did a document of this game's frames run since `since` (ms epoch)? */
export function gameFrameSpokeSince(gameId: string, since: number): boolean {
	return (lastHeard.get(gameId) ?? 0) >= since;
}
