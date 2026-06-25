/**
 * Privacy mode: decoy title/icon when the tab is hidden or locked, and a client-side passcode.
 * Options persist in localStorage (mirrored to a cookie for SSR; see site-settings.ts). Unlock is per tab (sessionStorage).
 */

import {
	loadSiteSettings,
	patchSiteSettings,
	type PrivacyDisguiseMode,
	type PrivacyDisguiseProvider,
	type PrivacyLockShortcut,
	type SiteSettingsV1
} from '$lib/utils/site-settings';
import {
	getDefaultServiceId,
	isDecoyTitleForService,
	isValidDisguiseService,
	pickDecoyTitleForService,
	resolveDisguiseService
} from '$lib/utils/privacy-disguise-registry';

export type { PrivacyDisguiseMode, PrivacyDisguiseProvider, PrivacyLockShortcut };

const SESSION_UNLOCK = 'potato-tomato-privacy-session-ok';

/**
 * Mirrors session unlock for SSR: first HTML paint can show the privacy gate and decoy title when
 * appropriate, without a flash of the full app before the client runs. Cleared on explicit lock.
 * (Best-effort; same browser profile may share this cookie across tabs.)
 */
export const PRIVACY_UNLOCK_COOKIE_NAME = 'potato-tomato-privacy-unlock';
const PRIVACY_UNLOCK_MAX_AGE_SEC = 12 * 60 * 60;

function writePrivacyUnlockCookie(value: string, maxAgeSec: number): void {
	if (typeof document === 'undefined') return;
	const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? ';Secure' : '';
	document.cookie = `${PRIVACY_UNLOCK_COOKIE_NAME}=${encodeURIComponent(value)};path=/;max-age=${maxAgeSec};SameSite=Lax${secure}`;
}

/** Keep cookie aligned with sessionStorage so reloads and SSR match client unlock state. */
export function syncPrivacyUnlockCookieWithSession(): void {
	if (typeof document === 'undefined') return;
	if (!isPrivacyEnabled()) {
		writePrivacyUnlockCookie('', 0);
		return;
	}
	if (isPrivacySessionUnlocked()) {
		writePrivacyUnlockCookie('1', PRIVACY_UNLOCK_MAX_AGE_SEC);
	} else {
		writePrivacyUnlockCookie('', 0);
	}
}

export const MAX_PRIVACY_LOCK_DELAY_MS = 10 * 60 * 1000;

export const REAL_APP_TITLE = 'Potato Tomato Games';

export interface PrivacyVault {
	passwordHash: string;
}

/** @deprecated Use privacy-disguise-registry tab titles per service. */
export const DECOY_TITLES = ['Google Docs', 'Untitled document - Google Docs'] as const;

export function getPrivacyDisguiseProvider(): PrivacyDisguiseProvider {
	const p = loadSiteSettings().privacyDisguiseProvider;
	return p === 'microsoft' ? 'microsoft' : 'google';
}

export function getPrivacyDisguiseServiceId(): string {
	const s = loadSiteSettings();
	const provider = getPrivacyDisguiseProvider();
	const id = s.privacyDisguiseService;
	if (typeof id === 'string' && isValidDisguiseService(provider, id)) return id;
	return getDefaultServiceId(provider);
}

export function getActiveDisguiseService() {
	const provider = getPrivacyDisguiseProvider();
	return resolveDisguiseService(provider, getPrivacyDisguiseServiceId());
}

export function savePrivacyDisguiseProvider(provider: PrivacyDisguiseProvider): void {
	savePrivacyDisguiseSelection(provider, getDefaultServiceId(provider));
}

export function savePrivacyDisguiseService(serviceId: string): boolean {
	const provider = getPrivacyDisguiseProvider();
	return savePrivacyDisguiseSelection(provider, serviceId);
}

export function savePrivacyDisguiseSelection(
	provider: PrivacyDisguiseProvider,
	serviceId: string
): boolean {
	const validService = isValidDisguiseService(provider, serviceId)
		? serviceId
		: getDefaultServiceId(provider);
	patchSiteSettings({
		privacyDisguiseProvider: provider,
		privacyDisguiseService: validService,
		privacyDecoyTitle: null
	});
	return isValidDisguiseService(provider, serviceId);
}

/** Used by client + server so stored decoy titles stay in sync with the selected service. */
export function isDocsDecoyTitleAllowed(t: string): boolean {
	const service = getActiveDisguiseService();
	return isDecoyTitleForService(service, t);
}

function getSessionStorage(): Storage | null {
	if (typeof sessionStorage === 'undefined') return null;
	return sessionStorage;
}

function settingsToVault(s: SiteSettingsV1): PrivacyVault | null {
	const h = s.privacyPasswordHash;
	if (typeof h === 'string' && h.length > 0) return { passwordHash: h };
	return null;
}

export function isPrivacyEnabled(): boolean {
	return loadSiteSettings().privacyModeEnabled === true;
}

export function getPrivacyLockDelayMs(): number {
	const n = loadSiteSettings().privacyLockDelayMs;
	if (typeof n !== 'number' || Number.isNaN(n) || n < 0) return 0;
	return Math.min(Math.floor(n), MAX_PRIVACY_LOCK_DELAY_MS);
}

export function getPrivacyDisguiseMode(): PrivacyDisguiseMode {
	const m = loadSiteSettings().privacyDisguiseMode;
	if (m === 'off' || m === 'focus_loss' || m === 'always') return m;
	return 'focus_loss';
}

export function getPrivacyPauseGameWhileLocked(): boolean {
	return loadSiteSettings().privacyPauseGameWhileLocked === true;
}

export function savePrivacyPauseGameWhileLocked(pause: boolean): void {
	patchSiteSettings({ privacyPauseGameWhileLocked: pause });
}

export function getPrivacyLockShortcut(): PrivacyLockShortcut | null {
	const s = loadSiteSettings().privacyLockShortcut;
	if (!s || typeof s.code !== 'string' || !s.code) return null;
	return {
		code: s.code,
		ctrlKey: s.ctrlKey === true,
		shiftKey: s.shiftKey === true,
		altKey: s.altKey === true,
		metaKey: s.metaKey === true
	};
}

export function savePrivacyLockShortcut(shortcut: PrivacyLockShortcut | null): void {
	patchSiteSettings({ privacyLockShortcut: shortcut });
}

/** Reserved: opens the settings dialog (Ctrl+Shift+,). */
export function conflictsWithSettingsShortcut(s: PrivacyLockShortcut): boolean {
	return s.code === 'Comma' && s.ctrlKey && s.shiftKey && !s.altKey && !s.metaKey;
}

export function privacyLockShortcutMatches(e: KeyboardEvent, s: PrivacyLockShortcut): boolean {
	return (
		e.code === s.code &&
		e.ctrlKey === s.ctrlKey &&
		e.shiftKey === s.shiftKey &&
		e.altKey === s.altKey &&
		e.metaKey === s.metaKey
	);
}

/** True for Shift, Control, Alt, Meta keys — not valid as the main key of a shortcut. */
export function isModifierOnlyKeyboardCode(code: string): boolean {
	if (
		code === 'MetaLeft' ||
		code === 'MetaRight' ||
		code === 'AltLeft' ||
		code === 'AltRight' ||
		code === 'ControlLeft' ||
		code === 'ControlRight' ||
		code === 'ShiftLeft' ||
		code === 'ShiftRight'
	) {
		return true;
	}
	return false;
}

export function formatPrivacyLockShortcutLabel(s: PrivacyLockShortcut | null): string {
	if (!s) return 'None';
	const parts: string[] = [];
	if (s.ctrlKey) parts.push('Ctrl');
	if (s.metaKey) parts.push('⌘');
	if (s.altKey) parts.push('Alt');
	if (s.shiftKey) parts.push('Shift');
	parts.push(shortcutCodeToLabel(s.code));
	return parts.join('+');
}

function shortcutCodeToLabel(code: string): string {
	if (code.startsWith('Key')) return code.slice(3);
	if (code.startsWith('Digit')) return code.slice(5);
	if (code === 'Comma') return ',';
	if (code === 'Period') return '.';
	if (code === 'Slash') return '/';
	if (code === 'Space') return 'Space';
	if (code.startsWith('F') && /^F\d{1,2}$/.test(code)) return code;
	return code;
}

export function savePrivacyDisguiseMode(mode: PrivacyDisguiseMode): void {
	patchSiteSettings({ privacyDisguiseMode: mode });
}

export function savePrivacyLockDelayMs(ms: number): void {
	const clamped = Math.max(0, Math.min(Math.floor(ms), MAX_PRIVACY_LOCK_DELAY_MS));
	patchSiteSettings({ privacyLockDelayMs: clamped });
}

export function savePrivacyDecoyTitle(title: string): boolean {
	const service = getActiveDisguiseService();
	if (!isDecoyTitleForService(service, title)) return false;
	patchSiteSettings({ privacyDecoyTitle: title });
	return true;
}

export function readVault(): PrivacyVault | null {
	return settingsToVault(loadSiteSettings());
}

async function sha256Hex(text: string): Promise<string> {
	const enc = new TextEncoder().encode(text);
	const buf = await crypto.subtle.digest('SHA-256', enc);
	return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Turn privacy mode on: saves settings + password hash. Caller should unlock session after. */
export async function enablePrivacyMode(password: string): Promise<void> {
	const passwordHash = await sha256Hex(password);
	patchSiteSettings({
		privacyModeEnabled: true,
		privacyPasswordHash: passwordHash
	});
	const sess = getSessionStorage();
	if (sess) {
		sess.setItem(SESSION_UNLOCK, '1');
	}
	syncPrivacyUnlockCookieWithSession();
}

export function disablePrivacyMode(): void {
	patchSiteSettings({
		privacyModeEnabled: false,
		privacyPasswordHash: null,
		privacyDecoyTitle: null
	});
	const sess = getSessionStorage();
	if (sess) {
		sess.removeItem(SESSION_UNLOCK);
	}
	syncPrivacyUnlockCookieWithSession();
}

export async function verifyAndUnlock(password: string): Promise<boolean> {
	const vault = readVault();
	if (!vault) return false;
	const h = await sha256Hex(password);
	if (h !== vault.passwordHash) return false;
	const sess = getSessionStorage();
	if (sess) {
		sess.setItem(SESSION_UNLOCK, '1');
	}
	syncPrivacyUnlockCookieWithSession();
	return true;
}

export function isPrivacySessionUnlocked(): boolean {
	const sess = getSessionStorage();
	if (!sess) return false;
	return sess.getItem(SESSION_UNLOCK) === '1';
}

export function lockPrivacySession(): void {
	const sess = getSessionStorage();
	if (!sess) return;
	sess.removeItem(SESSION_UNLOCK);
	syncPrivacyUnlockCookieWithSession();
}

export async function verifyPassword(password: string): Promise<boolean> {
	const vault = readVault();
	if (!vault) return false;
	return (await sha256Hex(password)) === vault.passwordHash;
}

export async function changePrivacyPassword(currentPassword: string, newPassword: string): Promise<boolean> {
	const vault = readVault();
	if (!vault) return false;
	if ((await sha256Hex(currentPassword)) !== vault.passwordHash) return false;
	const passwordHash = await sha256Hex(newPassword);
	patchSiteSettings({ privacyPasswordHash: passwordHash });
	return true;
}

/** Stable decoy tab title for this browser profile (derived from selected service). */
export function getDecoyTitleForSession(): string {
	const s = loadSiteSettings();
	const service = resolveDisguiseService(s.privacyDisguiseProvider, s.privacyDisguiseService);
	let t = s.privacyDecoyTitle ?? '';
	if (!t || !isDecoyTitleForService(service, t)) {
		t = pickDecoyTitleForService(service);
		patchSiteSettings({ privacyDecoyTitle: t });
	}
	return t;
}
