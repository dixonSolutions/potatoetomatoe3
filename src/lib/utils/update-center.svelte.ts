/**
 * App updates, one place for every platform.
 *
 *   android-live  AndySU (live updates) does the download and apply; this mirrors its status.
 *   android-apk   the release APK is downloaded in-app and handed to the package installer.
 *   desktop       the Flatpak remote updates the app; nothing to do in-app.
 *   web           always the latest; nothing to do.
 *
 * Only Android checks, downloads and shows anything (the top-bar badge, the Updates section).
 * Nothing here ever raises a toast or a notification, and an update is never forced: the
 * player downloads it, and it installs on the next start unless "Right away" is chosen.
 *
 * Checks run on start, every CHECK_INTERVAL_MS while the app is open, and when it comes back
 * to the foreground or back online. Downloads respect the Wi-Fi / mobile data settings.
 */
import {
	andysuAvailable,
	andysuStatus,
	applyAndySU,
	checkAndySU,
	initAndySU,
	setAndySUMode,
	type AndyStatus
} from './andysu';
import {
	cancelApkDownload,
	compareVersions,
	downloadAndInstallApk,
	fetchLatestApkRelease,
	getInstalledVersion,
	type LatestApkRelease
} from './app-update';
import { isTauriAndroidBuild, isTauriApp } from './offline-deployment';

export type UpdatePlatform = 'android-live' | 'android-apk' | 'desktop' | 'web';
export type UpdatePhase =
	| 'idle'
	| 'checking'
	| 'up-to-date'
	| 'available'
	| 'downloading'
	| 'staged'
	| 'error';
export type ApplyMode = 'next-start' | 'live';
export type UpdateSettings = {
	/** Download updates on Wi-Fi (or any unmetered / unknown connection). */
	wifi: boolean;
	/** Download updates on mobile data. */
	mobileData: boolean;
	/** Check and download on its own; off = only when the player taps Download. */
	automatic: boolean;
	/** When a downloaded update is applied. */
	applyMode: ApplyMode;
};

export const DEFAULT_UPDATE_SETTINGS: Readonly<UpdateSettings> = Object.freeze({
	wifi: true,
	mobileData: false,
	automatic: true,
	applyMode: 'next-start'
});

/** How often an open app looks for a new release. */
export const CHECK_INTERVAL_MS = 30 * 60 * 1000;
/** How often the timer wakes to see whether a check is due. */
const TICK_MS = 60 * 1000;

const SETTINGS_KEY = 'potato-tomato-update-settings';
/** The pre-M13 switch ("Download updates automatically"), migrated once. */
const LEGACY_AUTO_KEY = 'potato-tomato-auto-apk-update';
/** APK version downloaded for "next start". */
const STAGED_KEY = 'potato-tomato-apk-staged-version';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): StorageLike | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

export function loadUpdateSettings(store: StorageLike | null = storage()): UpdateSettings {
	const out: UpdateSettings = { ...DEFAULT_UPDATE_SETTINGS };
	if (!store) return out;
	try {
		const raw = store.getItem(SETTINGS_KEY);
		if (raw) {
			const saved = JSON.parse(raw) as Partial<UpdateSettings>;
			if (typeof saved.wifi === 'boolean') out.wifi = saved.wifi;
			if (typeof saved.mobileData === 'boolean') out.mobileData = saved.mobileData;
			if (typeof saved.automatic === 'boolean') out.automatic = saved.automatic;
			if (saved.applyMode === 'live' || saved.applyMode === 'next-start') {
				out.applyMode = saved.applyMode;
			}
		} else if (store.getItem(LEGACY_AUTO_KEY) === 'off') {
			out.automatic = false;
		}
	} catch {
		/* corrupt: defaults */
	}
	return out;
}

export function saveUpdateSettings(
	settings: UpdateSettings,
	store: StorageLike | null = storage()
): void {
	try {
		store?.setItem(SETTINGS_KEY, JSON.stringify(settings));
	} catch {
		/* private mode / quota */
	}
}

export function detectUpdatePlatform(
	env: { tauri: boolean; android: boolean; live: boolean } = {
		tauri: isTauriApp(),
		android: isTauriAndroidBuild(),
		live: andysuAvailable()
	}
): UpdatePlatform {
	if (!env.tauri) return 'web';
	if (env.android) return env.live ? 'android-live' : 'android-apk';
	return 'desktop';
}

/** Does this platform check, download and show updates in the app? */
export function updatesInApp(platform: UpdatePlatform): boolean {
	return platform === 'android-live' || platform === 'android-apk';
}

/** The top-bar badge: Android only, and only while there is an update to act on. */
export function showsUpdateBadge(platform: UpdatePlatform, phase: UpdatePhase): boolean {
	return (
		updatesInApp(platform) &&
		(phase === 'available' || phase === 'downloading' || phase === 'staged')
	);
}

export type ConnectionKind = 'wifi' | 'cellular' | 'none' | 'unknown';

type NavigatorLike = { onLine?: boolean; connection?: { type?: string } };

export function connectionKind(nav: NavigatorLike | undefined): ConnectionKind {
	if (!nav) return 'unknown';
	if (nav.onLine === false) return 'none';
	const type = nav.connection?.type;
	if (type === 'cellular') return 'cellular';
	if (type === 'wifi' || type === 'ethernet' || type === 'wimax') return 'wifi';
	if (type === 'none') return 'none';
	return 'unknown';
}

/** May an automatic download start on this connection? Unknown counts as Wi-Fi. */
export function downloadAllowed(settings: UpdateSettings, kind: ConnectionKind): boolean {
	if (kind === 'none') return false;
	if (kind === 'cellular') return settings.mobileData;
	return settings.wifi;
}

export function isCheckDue(lastCheckedAt: number, now: number): boolean {
	return now - lastCheckedAt >= CHECK_INTERVAL_MS;
}

/** AndySU's status in this module's terms. */
export function phaseFromAndy(s: AndyStatus): UpdatePhase {
	switch (s.state) {
		case 'checking':
			return 'checking';
		case 'up_to_date':
			return 'up-to-date';
		case 'available':
		case 'shell_update':
			return 'available';
		case 'downloading':
			return 'downloading';
		case 'staged':
		case 'applying':
			return s.release && s.release === s.runningVersion ? 'up-to-date' : 'staged';
		case 'error':
			return 'error';
		default:
			return 'idle';
	}
}

/* ---------------- live state ---------------- */

export const updates = $state({
	platform: 'web' as UpdatePlatform,
	phase: 'idle' as UpdatePhase,
	installed: null as string | null,
	latest: null as string | null,
	/** 0–100 while downloading. */
	progress: 0,
	error: '',
	/** AndySU: the update needs a new app install (Android asks first). */
	needsInstall: false,
	settings: loadUpdateSettings()
});

let started = false;
let lastCheckedAt = 0;
let latestRelease: LatestApkRelease | null = null;
let appliedLive = '';

function nav(): NavigatorLike | undefined {
	return typeof navigator === 'undefined' ? undefined : (navigator as NavigatorLike);
}

function automaticAllowedNow(): boolean {
	return updates.settings.automatic && downloadAllowed(updates.settings, connectionKind(nav()));
}

/** AndySU downloads on its own in 'auto' mode; keep that in line with the settings. */
function syncAndyMode() {
	if (updates.platform !== 'android-live') return;
	setAndySUMode(automaticAllowedNow() ? 'auto' : 'off');
}

function onAndyStatus(s: AndyStatus) {
	updates.phase = phaseFromAndy(s);
	updates.installed = s.runningVersion ?? updates.installed;
	updates.latest = s.release ?? updates.latest;
	updates.needsInstall = s.state === 'shell_update';
	if (typeof s.percent === 'number') updates.progress = Math.max(0, Math.min(100, s.percent));
	updates.error = s.state === 'error' ? 'Could not check for updates' : '';
	/* "Right away": apply a staged update once, as soon as it is ready. */
	if (
		updates.phase === 'staged' &&
		updates.settings.applyMode === 'live' &&
		s.release &&
		appliedLive !== s.release
	) {
		appliedLive = s.release;
		applyAndySU();
	}
}

function readStaged(): string | null {
	try {
		return storage()?.getItem(STAGED_KEY) ?? null;
	} catch {
		return null;
	}
}

function writeStaged(version: string | null) {
	try {
		if (version) storage()?.setItem(STAGED_KEY, version);
		else (storage() as Storage | null)?.removeItem?.(STAGED_KEY);
	} catch {
		/* ignore */
	}
}

/** Last version whose install was offered on start (Android asks; "not now" sticks). */
const OFFERED_KEY = 'potato-tomato-apk-offered-version';

function readOffered(): string | null {
	try {
		return storage()?.getItem(OFFERED_KEY) ?? null;
	} catch {
		return null;
	}
}

function writeOffered(version: string) {
	try {
		storage()?.setItem(OFFERED_KEY, version);
	} catch {
		/* ignore */
	}
}

/** Look for a newer release now. */
export async function checkForUpdates(): Promise<void> {
	lastCheckedAt = Date.now();
	if (updates.platform === 'android-live') {
		checkAndySU();
		return;
	}
	if (updates.platform !== 'android-apk') return;
	if (updates.phase === 'downloading') return;
	updates.phase = 'checking';
	updates.error = '';
	try {
		updates.installed ??= await getInstalledVersion();
		latestRelease = await fetchLatestApkRelease();
		updates.latest = latestRelease.versionName;
		const newer =
			!updates.installed || compareVersions(latestRelease.versionName, updates.installed) > 0;
		if (!newer) {
			updates.phase = 'up-to-date';
			writeStaged(null);
			return;
		}
		if (readStaged() === latestRelease.versionName) {
			updates.phase = 'staged';
			return;
		}
		updates.phase = 'available';
		if (automaticAllowedNow()) void downloadUpdate();
	} catch (e) {
		updates.phase = 'error';
		updates.error = e instanceof Error ? e.message : 'Could not check for updates';
	}
}

/** Download the newest release (the player tapped Download, or automatic updates). */
export async function downloadUpdate(): Promise<void> {
	if (updates.platform === 'android-live') {
		/* A tap is consent for this download even with automatic updates off. */
		setAndySUMode('auto');
		checkAndySU();
		return;
	}
	if (updates.platform !== 'android-apk' || !latestRelease) return;
	if (updates.phase === 'downloading') return;
	const release = latestRelease;
	const installNow = updates.settings.applyMode === 'live';
	updates.phase = 'downloading';
	updates.progress = 0;
	updates.error = '';
	try {
		await downloadAndInstallApk(
			release,
			(p) => {
				if (p.phase === 'downloading' && p.total > 0) {
					updates.progress = Math.min(100, (p.received / p.total) * 100);
				}
			},
			{ install: installNow }
		);
		writeStaged(release.versionName);
		updates.progress = 100;
		updates.phase = 'staged';
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		if (/cancel/i.test(message)) {
			updates.phase = 'available';
		} else {
			updates.phase = 'error';
			updates.error = message || 'Download failed';
		}
	}
}

/** Stop the running download. */
export async function cancelUpdate(): Promise<void> {
	if (updates.platform === 'android-live') {
		setAndySUMode('off');
		updates.phase = 'available';
		return;
	}
	await cancelApkDownload();
}

/** Apply a downloaded update now (it would otherwise apply on the next start). */
export async function applyUpdate(): Promise<void> {
	if (updates.platform === 'android-live') {
		applyAndySU();
		return;
	}
	if (updates.platform !== 'android-apk' || !latestRelease) return;
	try {
		/* Cached from the download, so this goes straight to Android's installer. */
		await downloadAndInstallApk(latestRelease, undefined, { install: true });
	} catch (e) {
		updates.error = e instanceof Error ? e.message : 'Could not open the installer';
	}
}

export function setUpdateSettings(patch: Partial<UpdateSettings>): void {
	updates.settings = { ...updates.settings, ...patch };
	saveUpdateSettings(updates.settings);
	syncAndyMode();
}

/**
 * Start following updates. Safe to call more than once. Returns a stop function (tests,
 * HMR); the app keeps it running for its whole life.
 */
/**
 * Dev preview only: the page sets the state by hand, so the app's own start (the root
 * layout's startUpdates, which mounts after the page) must not detect and overwrite it.
 */
export function holdUpdatesForPreview(): void {
	started = true;
}

export function startUpdates(): () => void {
	if (started) return () => {};
	started = true;
	updates.platform = detectUpdatePlatform();
	if (updates.platform === 'desktop') {
		void getInstalledVersion().then((v) => (updates.installed = v));
		return () => {};
	}
	if (!updatesInApp(updates.platform)) return () => {};

	const stops: (() => void)[] = [];
	if (updates.platform === 'android-live') {
		stops.push(initAndySU());
		stops.push(andysuStatus.subscribe(onAndyStatus));
		syncAndyMode();
	} else {
		void (async () => {
			await checkForUpdates();
			/* "On next start": the APK downloaded last time installs now. */
			if (
				updates.phase === 'staged' &&
				updates.settings.applyMode === 'next-start' &&
				updates.latest &&
				readOffered() !== updates.latest
			) {
				/* Android asks first; a "not now" is respected until the next release. */
				writeOffered(updates.latest);
				await applyUpdate();
			}
		})();
	}

	const due = () => {
		if (!updates.settings.automatic && updates.platform === 'android-apk') return;
		if (isCheckDue(lastCheckedAt, Date.now())) void checkForUpdates();
	};
	const timer = setInterval(due, TICK_MS);
	const onVisible = () => {
		if (document.visibilityState === 'visible') due();
	};
	const onNetwork = () => {
		syncAndyMode();
		due();
	};
	document.addEventListener('visibilitychange', onVisible);
	window.addEventListener('online', onNetwork);
	const connection = (navigator as { connection?: EventTarget }).connection;
	connection?.addEventListener?.('change', onNetwork);
	stops.push(() => {
		clearInterval(timer);
		document.removeEventListener('visibilitychange', onVisible);
		window.removeEventListener('online', onNetwork);
		connection?.removeEventListener?.('change', onNetwork);
		started = false;
	});
	return () => stops.forEach((s) => s());
}
