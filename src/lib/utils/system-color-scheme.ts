/**
 * Native desktop colour scheme → page mode.
 *
 * The page is meant to learn this from `prefers-color-scheme`, which WebKitGTK derives
 * from the GTK settings the Rust side writes when the desktop portal announces a switch.
 * That media event is not reliable in the app: it can arrive seconds late (the first
 * switch after launch under `tauri dev`) or not at all, leaving the page in its launch
 * scheme under a native titlebar that has already followed — light desktop, dark page.
 *
 * The portal answer reaches Rust either way, so the app takes it from there instead of
 * waiting for WebKit to notice. Browser builds keep the media query untouched; there is
 * no native side to ask.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { setMode } from 'mode-watcher';
import { isTauriApp } from '$lib/utils/offline-deployment';

const SCHEME_EVENT = 'system-color-scheme';

function apply(dark: unknown): void {
	if (typeof dark !== 'boolean') return;
	setMode(dark ? 'dark' : 'light');
}

/**
 * Apply the desktop's current scheme, then follow it. Returns an unsubscribe function;
 * a no-op outside the app, so callers need no platform check of their own.
 */
export async function followNativeColorScheme(): Promise<() => void> {
	if (!isTauriApp()) return () => {};

	let unlisten: UnlistenFn | null = null;
	let cancelled = false;

	try {
		unlisten = await listen<boolean>(SCHEME_EVENT, (event) => apply(event.payload));
	} catch {
		/* No native event bus (browser build served from the app's origin). */
	}
	if (cancelled) {
		unlisten?.();
		return () => {};
	}

	try {
		apply(await invoke<boolean | null>('desktop_color_scheme_is_dark'));
	} catch {
		/* Older app binary without the command, or a desktop with no portal. */
	}

	return () => {
		cancelled = true;
		unlisten?.();
	};
}
