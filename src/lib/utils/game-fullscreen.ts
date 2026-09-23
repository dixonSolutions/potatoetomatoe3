/**
 * Optional in-game fullscreen key (F once turned on).
 *
 * Off unless the user switches it on in Settings → Games: games are opened fullscreen
 * and left through the in-game menu, and a bare `F` belongs to the game — plenty of them
 * use it. The key itself is stored even while the switch is off, so turning it back on
 * restores whatever was recorded.
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
import { getGamePlayerSettings, saveGamePlayerSettings } from '$lib/utils/game-player-settings';

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

export function isGameFullscreenShortcutEnabled(): boolean {
	return getGamePlayerSettings().fullscreenShortcutEnabled;
}

/** The shortcut when it is switched on, otherwise null — what the player listens for. */
export function getActiveGameFullscreenShortcut(): GameFullscreenShortcut | null {
	return isGameFullscreenShortcutEnabled() ? getGameFullscreenShortcut() : null;
}

export function setGameFullscreenShortcutEnabled(enabled: boolean): boolean {
	return saveGamePlayerSettings({ fullscreenShortcutEnabled: enabled }).fullscreenShortcutEnabled;
}

export function saveGameFullscreenShortcut(
	shortcut: GameFullscreenShortcut | null
): GameFullscreenShortcut {
	/*
	 * Pin the switch before the key changes: while it has never been written, whether it
	 * is on is read from the saved key, and recording `F` would silently turn it off.
	 */
	saveGamePlayerSettings({ fullscreenShortcutEnabled: isGameFullscreenShortcutEnabled() });
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
