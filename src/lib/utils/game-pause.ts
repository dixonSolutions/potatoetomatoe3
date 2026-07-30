/**
 * In-game pause / resume (Xonotic-style backtick by default).
 * Parent overlays the player and posts into the frame to suspend Web Audio when possible.
 */

import {
	loadSiteSettings,
	patchSiteSettings,
	type PrivacyLockShortcut
} from '$lib/utils/site-settings';
import {
	conflictsWithSettingsShortcut,
	formatPrivacyLockShortcutLabel,
	isModifierOnlyKeyboardCode,
	privacyLockShortcutMatches
} from '$lib/utils/privacy-mode';

export type GamePauseShortcut = PrivacyLockShortcut;

export const GAME_PAUSE_CHANGED = 'potato-tomato-game-pause-changed';

export const DEFAULT_GAME_PAUSE_SHORTCUT: GamePauseShortcut = {
	code: 'Backquote',
	ctrlKey: false,
	shiftKey: false,
	altKey: false,
	metaKey: false
};

function normalizeShortcut(raw: unknown): GamePauseShortcut {
	if (!raw || typeof raw !== 'object') return { ...DEFAULT_GAME_PAUSE_SHORTCUT };
	const s = raw as Partial<GamePauseShortcut>;
	if (typeof s.code !== 'string' || !s.code) return { ...DEFAULT_GAME_PAUSE_SHORTCUT };
	return {
		code: s.code,
		ctrlKey: s.ctrlKey === true,
		shiftKey: s.shiftKey === true,
		altKey: s.altKey === true,
		metaKey: s.metaKey === true
	};
}

export function getGamePauseShortcut(): GamePauseShortcut {
	return normalizeShortcut(loadSiteSettings().gamePauseShortcut);
}

export function saveGamePauseShortcut(shortcut: GamePauseShortcut | null): GamePauseShortcut {
	const next = shortcut ? normalizeShortcut(shortcut) : { ...DEFAULT_GAME_PAUSE_SHORTCUT };
	patchSiteSettings({ gamePauseShortcut: next });
	return next;
}

export function formatGamePauseShortcutLabel(s: GamePauseShortcut | null = getGamePauseShortcut()): string {
	const shortcut = s ?? getGamePauseShortcut();
	if (shortcut.code === 'Backquote' && !shortcut.ctrlKey && !shortcut.shiftKey && !shortcut.altKey && !shortcut.metaKey) {
		return '`';
	}
	const label = formatPrivacyLockShortcutLabel(shortcut);
	return label === 'Backquote' ? '`' : label.replace(/\bBackquote\b/g, '`');
}

export function gamePauseShortcutMatches(e: KeyboardEvent, s: GamePauseShortcut = getGamePauseShortcut()): boolean {
	return privacyLockShortcutMatches(e, s);
}

export function isValidGamePauseShortcut(s: GamePauseShortcut): boolean {
	if (!s.code || isModifierOnlyKeyboardCode(s.code)) return false;
	if (conflictsWithSettingsShortcut(s)) return false;
	return true;
}

export function broadcastGamePause(paused: boolean, root: Document = document): void {
	const msg = { type: 'potato-tomato-game-pause', paused: !!paused };
	for (const frame of root.querySelectorAll('iframe')) {
		if (!(frame instanceof HTMLIFrameElement)) continue;
		try {
			frame.contentWindow?.postMessage(msg, '*');
		} catch {
			/* ignore */
		}
		try {
			const child = frame.contentDocument;
			if (child) broadcastGamePause(paused, child);
		} catch {
			/* cross-origin */
		}
	}
}

export function dispatchGamePauseChanged(paused: boolean): void {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(new CustomEvent(GAME_PAUSE_CHANGED, { detail: { paused } }));
}

/** Apply pause visuals / pointer lock on the game iframe element. */
export function applyPauseToGameIframe(iframe: HTMLIFrameElement | null | undefined, paused: boolean): void {
	if (!iframe) return;
	if (paused) {
		iframe.style.pointerEvents = 'none';
		iframe.setAttribute('data-pt-paused', '1');
	} else {
		iframe.style.pointerEvents = '';
		iframe.removeAttribute('data-pt-paused');
		/*
		 * Resume clicks are a user gesture in the parent — wake iframe audio immediately.
		 * (inject no longer suspends AudioContext on pause; unlock still helps late Unity AC.)
		 */
		try {
			iframe.contentWindow?.postMessage({ type: 'potato-tomato-unlock-audio' }, '*');
		} catch {
			/* ignore */
		}
		try {
			iframe.contentWindow?.focus?.();
		} catch {
			/* ignore */
		}
	}
	broadcastGamePause(paused);
}
