/**
 * Site-wide preferences: primary storage is localStorage; we mirror to a cookie so SSR (+layout.server)
 * can still paint the decoy tab title on first load. Legacy cookie-only installs migrate on read.
 */

export const SITE_SETTINGS_COOKIE = 'potato-tomato-settings';
const LOCAL_STORAGE_KEY = 'potato-tomato-site-settings-v1';
const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 400; // ~400 days

/** When the tab uses the Google Docs title and favicon while privacy mode is on. */
export type PrivacyDisguiseMode = 'off' | 'focus_loss' | 'always';

/** When to force mute on audio/video elements (see audio-mute.ts). */
export type MuteAudioScope = 'off' | 'focus_loss' | 'always';

/** Keyboard combo stored for “lock now” (see privacy-mode.ts). */
export type PrivacyLockShortcut = {
	code: string;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
	metaKey: boolean;
};

export type SiteSettingsV1 = {
	version: 1;
	/** Privacy mode (decoy tab + passcode lock on blur) */
	privacyModeEnabled: boolean;
	privacyPasswordHash: string | null;
	privacyDecoyTitle: string | null;
	/** 0 = lock as soon as you leave focus; otherwise delay in ms before locking */
	privacyLockDelayMs: number;
	/** Tab disguise: off | when background/locked | always (see privacy-mode + layout). */
	privacyDisguiseMode: PrivacyDisguiseMode;
	/** Best-effort: hide the game iframe while the privacy lock overlay is shown. */
	privacyPauseGameWhileLocked: boolean;
	/** Optional global shortcut that locks the session (same as leaving the tab). */
	privacyLockShortcut: PrivacyLockShortcut | null;
	/** Mute HTML media: off | when tab hidden / window loses focus | always. */
	muteAudioScope: MuteAudioScope;
	/** Master output level for HTML audio/video when not forced mute (0–1). */
	masterVolume: number;
	/** Default play source when a game offers both online and offline copies. */
	defaultGamePlayMode: GamePlayModePreference;
};

export type GamePlayModePreference = 'online' | 'offline';

const DEFAULTS: SiteSettingsV1 = {
	version: 1,
	privacyModeEnabled: false,
	privacyPasswordHash: null,
	privacyDecoyTitle: null,
	privacyLockDelayMs: 0,
	privacyDisguiseMode: 'focus_loss',
	privacyPauseGameWhileLocked: false,
	privacyLockShortcut: null,
	muteAudioScope: 'off',
	masterVolume: 1,
	defaultGamePlayMode: 'online'
};

type ParsedCookie = Partial<SiteSettingsV1> & { muteAllAudio?: boolean };

function mergeCookieSettings(parsed: ParsedCookie): SiteSettingsV1 {
	const merged = { ...DEFAULTS, ...parsed, version: 1 as const };
	let muteAudioScope = merged.muteAudioScope;
	if (parsed.muteAudioScope === undefined && typeof parsed.muteAllAudio === 'boolean') {
		muteAudioScope = parsed.muteAllAudio ? 'always' : 'off';
	}
	if (muteAudioScope !== 'off' && muteAudioScope !== 'focus_loss' && muteAudioScope !== 'always') {
		muteAudioScope = 'off';
	}
	let privacyPauseGameWhileLocked = merged.privacyPauseGameWhileLocked;
	if (typeof privacyPauseGameWhileLocked !== 'boolean') {
		privacyPauseGameWhileLocked = DEFAULTS.privacyPauseGameWhileLocked;
	}
	let privacyLockShortcut: PrivacyLockShortcut | null = DEFAULTS.privacyLockShortcut;
	const rawSc = merged.privacyLockShortcut;
	if (rawSc === null || rawSc === undefined) {
		privacyLockShortcut = null;
	} else if (
		typeof rawSc === 'object' &&
		rawSc !== null &&
		typeof (rawSc as PrivacyLockShortcut).code === 'string' &&
		(rawSc as PrivacyLockShortcut).code.length > 0
	) {
		const r = rawSc as PrivacyLockShortcut;
		privacyLockShortcut = {
			code: r.code,
			ctrlKey: r.ctrlKey === true,
			shiftKey: r.shiftKey === true,
			altKey: r.altKey === true,
			metaKey: r.metaKey === true
		};
	} else {
		privacyLockShortcut = null;
	}
	let masterVolume = merged.masterVolume;
	if (typeof masterVolume !== 'number' || Number.isNaN(masterVolume)) {
		masterVolume = DEFAULTS.masterVolume;
	} else {
		masterVolume = Math.max(0, Math.min(1, masterVolume));
	}
	let defaultGamePlayMode = merged.defaultGamePlayMode;
	if (defaultGamePlayMode !== 'online' && defaultGamePlayMode !== 'offline') {
		defaultGamePlayMode = DEFAULTS.defaultGamePlayMode;
	}
	return {
		...merged,
		muteAudioScope,
		masterVolume,
		privacyPauseGameWhileLocked,
		privacyLockShortcut,
		defaultGamePlayMode
	};
}

const LEGACY_KEYS = {
	flag: 'potato-tomato-privacy-enabled',
	hash: 'potato-tomato-privacy-hash',
	decoy: 'potato-tomato-privacy-decoy-title'
} as const;

function getCookieRaw(name: string): string | null {
	if (typeof document === 'undefined') return null;
	const escaped = name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1');
	const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
	return match?.[1] != null ? decodeURIComponent(match[1]) : null;
}

function setCookieRaw(name: string, value: string, maxAgeSec: number): void {
	if (typeof document === 'undefined') return;
	const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? ';Secure' : '';
	document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${maxAgeSec};SameSite=Lax${secure}`;
}

function migrateFromLocalStorage(): SiteSettingsV1 | null {
	if (typeof localStorage === 'undefined') return null;
	const flag = localStorage.getItem(LEGACY_KEYS.flag);
	if (flag !== '1') return null;
	const hash = localStorage.getItem(LEGACY_KEYS.hash);
	const decoy = localStorage.getItem(LEGACY_KEYS.decoy);
	return {
		...DEFAULTS,
		privacyModeEnabled: true,
		privacyPasswordHash: hash,
		privacyDecoyTitle: decoy
	};
}

function clearLegacyLocalStorage(): void {
	if (typeof localStorage === 'undefined') return;
	localStorage.removeItem(LEGACY_KEYS.flag);
	localStorage.removeItem(LEGACY_KEYS.hash);
	localStorage.removeItem(LEGACY_KEYS.decoy);
}

/** Read merged settings: localStorage first, then migrate from cookie or legacy keys. */
export function loadSiteSettings(): SiteSettingsV1 {
	if (typeof localStorage !== 'undefined') {
		const ls = localStorage.getItem(LOCAL_STORAGE_KEY);
		if (ls) {
			try {
				const parsed = JSON.parse(ls) as ParsedCookie;
				if (parsed && typeof parsed === 'object') {
					const merged = mergeCookieSettings(parsed);
					if (parsed.muteAudioScope === undefined && typeof parsed.muteAllAudio === 'boolean') {
						saveSiteSettings(merged);
					}
					return merged;
				}
			} catch {
				/* fall through */
			}
		}
	}

	const raw = getCookieRaw(SITE_SETTINGS_COOKIE);
	if (raw) {
		try {
			const parsed = JSON.parse(raw) as ParsedCookie;
			if (parsed && typeof parsed === 'object') {
				const merged = mergeCookieSettings(parsed);
				saveSiteSettings(merged);
				return merged;
			}
		} catch {
			/* fall through */
		}
	}

	const migrated = migrateFromLocalStorage();
	if (migrated) {
		clearLegacyLocalStorage();
		saveSiteSettings(migrated);
		return migrated;
	}

	return { ...DEFAULTS };
}

export function saveSiteSettings(settings: SiteSettingsV1): void {
	if (typeof localStorage !== 'undefined') {
		try {
			localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
		} catch (e) {
			console.error('Failed to save site settings to localStorage:', e);
		}
	}
	setCookieRaw(SITE_SETTINGS_COOKIE, JSON.stringify(settings), COOKIE_MAX_AGE_SEC);
}

export function patchSiteSettings(patch: Partial<Omit<SiteSettingsV1, 'version'>>): SiteSettingsV1 {
	const next = { ...loadSiteSettings(), ...patch, version: 1 as const };
	saveSiteSettings(next);
	return next;
}
