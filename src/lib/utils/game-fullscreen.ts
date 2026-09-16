/**
 * In-game fullscreen toggle (F by default).
 *
 * Same storage and validation as the pause shortcut — see `game-pause.ts`. Kept apart
 * so the two can never be saved as the same key: `isValidGameFullscreenShortcut`
 * rejects whatever pause currently owns, and vice versa.
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
import { getGamePauseShortcut } from '$lib/utils/game-pause';

export type GameFullscreenShortcut = PrivacyLockShortcut;

export const DEFAULT_GAME_FULLSCREEN_SHORTCUT: GameFullscreenShortcut = {
	code: 'KeyF',
	ctrlKey: false,
	shiftKey: false,
	altKey: false,
	metaKey: false
};

function normalizeShortcut(raw: unknown): GameFullscreenShortcut {
	if (!raw || typeof raw !== 'object') return { ...DEFAULT_GAME_FULLSCREEN_SHORTCUT };
	const s = raw as Partial<GameFullscreenShortcut>;
	if (typeof s.code !== 'string' || !s.code) return { ...DEFAULT_GAME_FULLSCREEN_SHORTCUT };
	return {
		code: s.code,
		ctrlKey: s.ctrlKey === true,
		shiftKey: s.shiftKey === true,
		altKey: s.altKey === true,
		metaKey: s.metaKey === true
	};
}

export function getGameFullscreenShortcut(): GameFullscreenShortcut {
	return normalizeShortcut(loadSiteSettings().gameFullscreenShortcut);
}

export function saveGameFullscreenShortcut(
	shortcut: GameFullscreenShortcut | null
): GameFullscreenShortcut {
	const next = shortcut ? normalizeShortcut(shortcut) : { ...DEFAULT_GAME_FULLSCREEN_SHORTCUT };
	patchSiteSettings({ gameFullscreenShortcut: next });
	return next;
}

export function formatGameFullscreenShortcutLabel(
	s: GameFullscreenShortcut | null = getGameFullscreenShortcut()
): string {
	return formatPrivacyLockShortcutLabel(s ?? getGameFullscreenShortcut());
}

export function gameFullscreenShortcutMatches(
	e: KeyboardEvent,
	s: GameFullscreenShortcut = getGameFullscreenShortcut()
): boolean {
	return privacyLockShortcutMatches(e, s);
}

function sameShortcut(a: PrivacyLockShortcut, b: PrivacyLockShortcut): boolean {
	return (
		a.code === b.code &&
		a.ctrlKey === b.ctrlKey &&
		a.shiftKey === b.shiftKey &&
		a.altKey === b.altKey &&
		a.metaKey === b.metaKey
	);
}

export function isValidGameFullscreenShortcut(s: GameFullscreenShortcut): boolean {
	if (!s.code || isModifierOnlyKeyboardCode(s.code)) return false;
	if (conflictsWithSettingsShortcut(s)) return false;
	/* Pause owns this combination — one key cannot do both. */
	if (sameShortcut(s, getGamePauseShortcut())) return false;
	return true;
}
