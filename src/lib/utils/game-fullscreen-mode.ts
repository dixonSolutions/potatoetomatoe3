/**
 * Putting a game "in fullscreen" is two separate things, done separately on purpose:
 *
 *   1. **The game fills the viewport.** A CSS class (`pseudo-fullscreen`) on the game
 *      surface — no permission needed, works on every engine, and it is what the player
 *      layout, the in-game menu and the hidden top bar key on.
 *   2. **The browser or window chrome goes away.** The Fullscreen API on the whole
 *      document in a browser, the native window in the Tauri desktop app.
 *
 * (2) is best-effort. Browsers only grant the Fullscreen API inside a user gesture, and a
 * game that opens by itself has none unless the click that navigated here is still fresh.
 * When (2) is refused the game still fills the window, and the next press on the in-game
 * menu upgrades to real fullscreen.
 *
 * The document is made fullscreen, not the surface: an element in fullscreen hides
 * everything outside it, and toasts, dialogs and menus render into `<body>`. Leaving
 * browser fullscreen (Esc, the browser's own UI) keeps (1), so the game keeps filling the
 * window; the in-game menu's Exit fullscreen is what returns to the windowed page.
 */

import {
	enterPseudoFullscreen,
	exitFullscreen,
	exitPseudoFullscreen,
	getFullscreenElement,
	isPseudoFullscreen,
	requestFullscreen
} from '$lib/utils/fullscreen';
import { isTauriApp, isTauriMobileBuild } from '$lib/utils/offline-deployment';

export type ChromeFullscreen = 'tauri-window' | 'document' | 'none';

type DocumentWithFullscreenFlags = Document & { webkitFullscreenEnabled?: boolean };

/**
 * How to hide the browser/window chrome here, or `none` when it cannot be done right now.
 *
 * @param userActivation `navigator.userActivation.isActive` where the browser reports
 *   it, otherwise null. A known `false` skips the request instead of letting it fail.
 */
export function pickChromeFullscreen(env: {
	tauriDesktop: boolean;
	documentApi: boolean;
	userActivation: boolean | null;
}): ChromeFullscreen {
	if (env.tauriDesktop) return 'tauri-window';
	if (!env.documentApi) return 'none';
	if (env.userActivation === false) return 'none';
	return 'document';
}

function documentFullscreenAvailable(): boolean {
	if (typeof document === 'undefined') return false;
	const doc = document as DocumentWithFullscreenFlags;
	if (typeof doc.fullscreenEnabled === 'boolean') return doc.fullscreenEnabled;
	if (typeof doc.webkitFullscreenEnabled === 'boolean') return doc.webkitFullscreenEnabled;
	return typeof Element !== 'undefined' && 'requestFullscreen' in Element.prototype;
}

function currentUserActivation(): boolean | null {
	if (typeof navigator === 'undefined') return null;
	const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
	return ua ? ua.isActive : null;
}

function isTauriDesktop(): boolean {
	return isTauriApp() && !isTauriMobileBuild();
}

/** Chrome was hidden by us, and how — so leaving restores exactly what was there. */
let chromeOwned: ChromeFullscreen = 'none';
/** The first attempt had no gesture to ride on; the next menu press may try again. */
let upgradePending = false;

async function setTauriWindowFullscreen(on: boolean): Promise<boolean> {
	try {
		const { getCurrentWindow } = await import('@tauri-apps/api/window');
		const win = getCurrentWindow();
		if (on && (await win.isFullscreen())) return false; /* already fullscreen: not ours */
		await win.setFullscreen(on);
		return true;
	} catch {
		return false;
	}
}

async function hideChrome(): Promise<boolean> {
	const how = pickChromeFullscreen({
		tauriDesktop: isTauriDesktop(),
		documentApi: documentFullscreenAvailable(),
		userActivation: currentUserActivation()
	});
	if (how === 'tauri-window') {
		if (await setTauriWindowFullscreen(true)) chromeOwned = 'tauri-window';
		return true;
	}
	if (how === 'none') return false;
	if (getFullscreenElement()) return true; /* already fullscreen (F11 or earlier upgrade) */
	try {
		await requestFullscreen(document.documentElement);
		chromeOwned = 'document';
		return true;
	} catch {
		return false;
	}
}

/**
 * Make `surface` immersive. Always fills the viewport; hides the chrome when allowed.
 * Call from inside a user gesture whenever there is one.
 */
export async function enterGameFullscreen(surface: Element): Promise<void> {
	enterPseudoFullscreen(surface);
	upgradePending = !(await hideChrome());
}

/**
 * A press on the in-game menu is a user gesture: if the automatic fullscreen could only
 * fill the window, hide the chrome now. Once per automatic start — after the user leaves
 * browser fullscreen on purpose this never pulls them back in.
 */
export function upgradeGameFullscreenOnGesture(surface: Element | null | undefined): void {
	if (!upgradePending || !surface || !isPseudoFullscreen(surface)) return;
	upgradePending = false;
	void hideChrome();
}

/** Leave immersive mode entirely: surface back in the page, chrome restored. */
export async function exitGameFullscreen(surface: Element | null | undefined): Promise<void> {
	upgradePending = false;
	if (surface) exitPseudoFullscreen(surface);
	const owned = chromeOwned;
	chromeOwned = 'none';
	if (owned === 'tauri-window') {
		await setTauriWindowFullscreen(false);
		return;
	}
	if (getFullscreenElement()) {
		try {
			await exitFullscreen();
		} catch {
			/* already left */
		}
	}
}

/**
 * The browser left fullscreen by itself (Esc, its own UI). The game keeps filling the
 * window; only the bookkeeping changes, so leaving later does not try to exit twice.
 */
export function noteDocumentFullscreenChange(): void {
	if (chromeOwned === 'document' && !getFullscreenElement()) chromeOwned = 'none';
}
