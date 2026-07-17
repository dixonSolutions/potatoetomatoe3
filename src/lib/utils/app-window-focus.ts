/**
 * Tracks whether the Potato Tomato window itself has OS focus.
 * Used by mute-on-focus-loss so focusing a game iframe does not count as "other window".
 */

import { isTauriApp } from '$lib/utils/offline-deployment';

export const APP_WINDOW_FOCUS_CHANGED = 'potato-tomato-app-window-focus';

let appWindowFocused = true;
let attached = false;

/** Parent-realm native check — game iframes spoof `document.hasFocus()` for Unity. */
function nativeDocumentHasFocus(doc: Document): boolean {
	if (typeof Document === 'undefined') return false;
	return Document.prototype.hasFocus.call(doc);
}

export function isAppWindowFocused(): boolean {
	return appWindowFocused;
}

function setFocused(focused: boolean): void {
	if (appWindowFocused === focused) return;
	appWindowFocused = focused;
	if (typeof window === 'undefined') return;
	window.dispatchEvent(
		new CustomEvent(APP_WINDOW_FOCUS_CHANGED, { detail: { focused } })
	);
}

/**
 * Start listening for real window focus (Tauri) or best-effort browser signals.
 * Safe to call once from layout mount.
 */
export async function attachAppWindowFocusTracking(): Promise<() => void> {
	if (typeof window === 'undefined' || attached) {
		return () => {};
	}
	attached = true;

	const cleanups: Array<() => void> = [];

	if (isTauriApp()) {
		try {
			const { getCurrentWindow } = await import('@tauri-apps/api/window');
			const win = getCurrentWindow();
			const unlisten = await win.onFocusChanged(({ payload: focused }) => {
				setFocused(focused);
			});
			cleanups.push(unlisten);
			/* Seed from current state when available */
			try {
				setFocused(await win.isFocused());
			} catch {
				setFocused(true);
			}
			return () => {
				attached = false;
				for (const c of cleanups) c();
			};
		} catch (err) {
			console.warn('Tauri window focus tracking unavailable:', err);
			/* fall through to browser heuristics */
		}
	}

	/*
	 * Browser: document.hasFocus() is false while an iframe is focused, so we must not
	 * treat that as leaving the app. Debounce blur and keep focus if an iframe is active.
	 */
	let blurTimer: ReturnType<typeof setTimeout> | null = null;

	const clearBlurTimer = () => {
		if (blurTimer) {
			clearTimeout(blurTimer);
			blurTimer = null;
		}
	};

	const onFocus = () => {
		clearBlurTimer();
		setFocused(true);
	};

	const onBlur = () => {
		clearBlurTimer();
		blurTimer = setTimeout(() => {
			blurTimer = null;
			if (document.visibilityState === 'hidden') {
				setFocused(false);
				return;
			}
			if (document.hasFocus()) {
				setFocused(true);
				return;
			}
			const active = document.activeElement;
			if (active && active.tagName === 'IFRAME') {
				const iframe = active as HTMLIFrameElement;
				try {
					/* Same-origin: native hasFocus on child doc (bypasses iframe focus spoof). */
					const childDoc = iframe.contentDocument;
					setFocused(Boolean(childDoc && nativeDocumentHasFocus(childDoc)));
					return;
				} catch {
					/* Cross-origin game frame — keep audio while this tab is visible. */
					setFocused(true);
					return;
				}
			}
			setFocused(false);
		}, 200);
	};

	const onVisibility = () => {
		if (document.visibilityState === 'hidden') {
			clearBlurTimer();
			setFocused(false);
		} else if (document.hasFocus() || document.activeElement?.tagName === 'IFRAME') {
			setFocused(true);
		}
	};

	window.addEventListener('focus', onFocus);
	window.addEventListener('blur', onBlur);
	document.addEventListener('visibilitychange', onVisibility);
	cleanups.push(() => {
		clearBlurTimer();
		window.removeEventListener('focus', onFocus);
		window.removeEventListener('blur', onBlur);
		document.removeEventListener('visibilitychange', onVisibility);
	});

	setFocused(
		document.visibilityState !== 'hidden' &&
			(document.hasFocus() || document.activeElement?.tagName === 'IFRAME')
	);

	return () => {
		attached = false;
		for (const c of cleanups) c();
	};
}
