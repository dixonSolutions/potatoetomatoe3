/**
 * How the game player behaves around a running game: whether games open fullscreen, how
 * the in-game menu is reached while they do, whether a key toggles fullscreen at all, and
 * two engine tunings of the Linux desktop app (`src-tauri/src/game_frame_tuning.rs`).
 *
 * Stored in the site settings under `gamePlayer` and normalised on every read, so an
 * older build's value, a hand-edited one or a half-written one can never put the player
 * in a state it does not handle.
 */

import {
	loadSiteSettings,
	patchSiteSettings,
	type PrivacyLockShortcut
} from '$lib/utils/site-settings';

/** How the in-game menu is reached while a game is fullscreen. */
export type InGameMenuAccess = 'button' | 'hover' | 'both';

/** Size of the always-visible menu button. `auto` is small with a mouse, medium on touch. */
export type InGameMenuButtonSize = 'auto' | 'small' | 'medium' | 'large';

/** Corner of the game the menu button (and hover zone) sits in. */
export type InGameMenuCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type GamePlayerSettings = {
	/** Open games in fullscreen as soon as they start. */
	autoFullscreen: boolean;
	menuAccess: InGameMenuAccess;
	menuButtonSize: InGameMenuButtonSize;
	menuCorner: InGameMenuCorner;
	/** A key that toggles fullscreen. Off by default: the in-game menu is the way in and out. */
	fullscreenShortcutEnabled: boolean;
	/**
	 * Linux desktop: games keep their full frame rate while the system is in power saver
	 * (WebKitGTK halves it otherwise). Read by the app at startup.
	 */
	fullSpeedInPowerSaver: boolean;
	/**
	 * Linux desktop: on a fractional-scaled display, games render at the display's real
	 * scale instead of WebKitGTK's rounded-up one. Applies from the next game start.
	 */
	renderAtDisplayScale: boolean;
};

export const GAME_PLAYER_SETTINGS_CHANGED = 'potato-tomato-game-player-settings-changed';

export const DEFAULT_GAME_PLAYER_SETTINGS: GamePlayerSettings = {
	autoFullscreen: true,
	menuAccess: 'button',
	menuButtonSize: 'auto',
	menuCorner: 'top-left',
	fullscreenShortcutEnabled: false,
	fullSpeedInPowerSaver: true,
	renderAtDisplayScale: true
};

const ACCESS: readonly InGameMenuAccess[] = ['button', 'hover', 'both'];
const SIZES: readonly InGameMenuButtonSize[] = ['auto', 'small', 'medium', 'large'];
const CORNERS: readonly InGameMenuCorner[] = [
	'top-left',
	'top-right',
	'bottom-left',
	'bottom-right'
];

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value)
		? (value as T)
		: fallback;
}

/** The fullscreen shortcut every install had before it became opt-in. */
function isLegacyDefaultShortcut(s: PrivacyLockShortcut | null | undefined): boolean {
	if (!s || typeof s !== 'object' || typeof s.code !== 'string') return true;
	return s.code === 'KeyF' && !s.ctrlKey && !s.shiftKey && !s.altKey && !s.metaKey;
}

/**
 * @param legacyFullscreenShortcut The `gameFullscreenShortcut` saved alongside, used only
 *   while `fullscreenShortcutEnabled` has never been written. Every save of the site
 *   settings wrote the default `F` into that field, so its presence says nothing — only a
 *   key the user actually recorded (anything other than a bare `F`) keeps the shortcut on.
 */
export function normalizeGamePlayerSettings(
	raw: unknown,
	legacyFullscreenShortcut?: PrivacyLockShortcut | null
): GamePlayerSettings {
	const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
	const d = DEFAULT_GAME_PLAYER_SETTINGS;
	return {
		autoFullscreen: typeof r.autoFullscreen === 'boolean' ? r.autoFullscreen : d.autoFullscreen,
		menuAccess: pick(r.menuAccess, ACCESS, d.menuAccess),
		menuButtonSize: pick(r.menuButtonSize, SIZES, d.menuButtonSize),
		menuCorner: pick(r.menuCorner, CORNERS, d.menuCorner),
		fullscreenShortcutEnabled:
			typeof r.fullscreenShortcutEnabled === 'boolean'
				? r.fullscreenShortcutEnabled
				: !isLegacyDefaultShortcut(legacyFullscreenShortcut),
		fullSpeedInPowerSaver:
			typeof r.fullSpeedInPowerSaver === 'boolean'
				? r.fullSpeedInPowerSaver
				: d.fullSpeedInPowerSaver,
		renderAtDisplayScale:
			typeof r.renderAtDisplayScale === 'boolean' ? r.renderAtDisplayScale : d.renderAtDisplayScale
	};
}

export function getGamePlayerSettings(): GamePlayerSettings {
	const site = loadSiteSettings();
	return normalizeGamePlayerSettings(site.gamePlayer, site.gameFullscreenShortcut);
}

/**
 * Merge `patch` into the saved player settings. Every field is written out, so a value
 * derived from older settings (the fullscreen shortcut migration) is pinned the first
 * time anything here is saved and cannot flip later.
 */
export function saveGamePlayerSettings(patch: Partial<GamePlayerSettings>): GamePlayerSettings {
	const next = normalizeGamePlayerSettings({ ...getGamePlayerSettings(), ...patch });
	patchSiteSettings({ gamePlayer: next });
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent(GAME_PLAYER_SETTINGS_CHANGED, { detail: next }));
	}
	return next;
}

export type ResolvedMenuButtonSize = Exclude<InGameMenuButtonSize, 'auto'>;

export function resolveMenuButtonSize(
	size: InGameMenuButtonSize,
	touch: boolean
): ResolvedMenuButtonSize {
	if (size !== 'auto') return size;
	return touch ? 'medium' : 'small';
}

/**
 * Pixel sizes for the menu button. `visual` is the drawn disc, `hit` the pressable box
 * around it: on touch the box never drops below 36 px, however small the disc is drawn.
 */
export function menuButtonMetrics(
	size: InGameMenuButtonSize,
	touch: boolean
): { visual: number; hit: number; icon: number } {
	const resolved = resolveMenuButtonSize(size, touch);
	const visual = resolved === 'small' ? 28 : resolved === 'medium' ? 38 : 50;
	const icon = resolved === 'small' ? 15 : resolved === 'medium' ? 19 : 24;
	return { visual, hit: touch ? Math.max(36, visual) : visual, icon };
}

/** Touch cannot hover, so a touch device always gets the button whatever the mode says. */
export function showsMenuButton(access: InGameMenuAccess, touch: boolean): boolean {
	return touch || access !== 'hover';
}

export function usesHoverZone(access: InGameMenuAccess): boolean {
	return access !== 'button';
}
