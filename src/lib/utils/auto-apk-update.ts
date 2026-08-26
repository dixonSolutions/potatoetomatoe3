/**
 * Background APK self-update with a single progress toast.
 *
 * Runs once per app start on Android. The check is cheap (one GitHub API call); the
 * download only starts when the latest release is genuinely newer than the installed
 * build, so an up-to-date app shows nothing at all.
 *
 * Deliberately quiet on failure: a filtered network, a rate-limited GitHub API, or no
 * release yet are all normal, and none of them are worth interrupting someone mid-game.
 * Failures surface in Settings → Updates, where the user asked for them.
 */

import { toast } from 'svelte-sonner';
import {
	canSelfInstall,
	downloadAndInstallApk,
	findPendingUpdate,
	openInstallPermissionSettings,
	type ApkUpdateProgress,
	type LatestApkRelease
} from '$lib/utils/app-update';

const AUTO_UPDATE_PREF = 'potato-tomato-auto-apk-update';
/** Last version the automatic pass already downloaded and offered to install. */
const OFFERED_PREF = 'potato-tomato-apk-offered-version';

/** Auto-update is opt-out; the toast is the only UI it ever shows. */
export function isAutoUpdateEnabled(): boolean {
	if (typeof localStorage === 'undefined') return true;
	try {
		return localStorage.getItem(AUTO_UPDATE_PREF) !== 'off';
	} catch {
		return true;
	}
}

export function setAutoUpdateEnabled(on: boolean): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(AUTO_UPDATE_PREF, on ? 'on' : 'off');
	} catch {
		/* private mode / quota */
	}
}

function alreadyOffered(version: string): boolean {
	if (typeof localStorage === 'undefined') return false;
	try {
		return localStorage.getItem(OFFERED_PREF) === version;
	} catch {
		return false;
	}
}

function markOffered(version: string): void {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(OFFERED_PREF, version);
	} catch {
		/* private mode / quota */
	}
}

function formatMb(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

function describe(p: ApkUpdateProgress): string {
	if (p.phase === 'cached') return 'Already downloaded';
	if (p.phase === 'downloading') {
		if (p.total > 0) {
			const pct = Math.min(100, Math.round((p.received / p.total) * 100));
			return `${pct}% · ${formatMb(p.received)} of ${formatMb(p.total)}`;
		}
		return formatMb(p.received);
	}
	if (p.phase === 'installing') return 'Opening installer…';
	if (p.phase === 'needs-permission') return p.message ?? 'Permission needed';
	return '';
}

/** Download + install `release`, driving one toast from start to finish. */
export async function runApkUpdate(release: LatestApkRelease): Promise<void> {
	const id = toast.loading(`Updating to ${release.versionName}`, {
		description: 'Starting download…'
	});
	let blockedOnPermission = false;
	try {
		await downloadAndInstallApk(release, (p) => {
			if (p.phase === 'needs-permission') blockedOnPermission = true;
			toast.loading(`Updating to ${release.versionName}`, { id, description: describe(p) });
		});
		if (blockedOnPermission) {
			/*
			 * Downloaded fine, but Android will not accept the handover until this app has
			 * "install unknown apps". Without this branch the installer flashes open and shuts
			 * and the update looks like it silently failed.
			 */
			toast.warning(`${release.versionName} is ready to install`, {
				id,
				duration: Infinity,
				description: 'Android needs permission to install apps from Potato Tomato.',
				action: {
					label: 'Allow',
					onClick: () => void openInstallPermissionSettings()
				}
			});
			return;
		}
		toast.success(`Ready to install ${release.versionName}`, {
			id,
			description: 'Confirm the install prompt to finish.'
		});
	} catch (e) {
		toast.error('Update failed', {
			id,
			description: e instanceof Error ? e.message : 'Could not download the update'
		});
		throw e;
	}
}

let started = false;

/**
 * Fire-and-forget check on app start. Safe to call more than once — only the first call
 * does anything, so a client-side navigation cannot kick off a second 188 MB download.
 */
export function startAutoApkUpdate(): void {
	if (started) return;
	started = true;
	/*
	 * `findPendingUpdate` answers on every packaged build, but only Android can apply the
	 * answer. Without this a desktop build would pull the whole APK and then fail at the
	 * Android-only installer; Flatpak updates stay `flatpak update`'s job.
	 */
	if (!canSelfInstall()) return;
	if (!isAutoUpdateEnabled()) return;

	void (async () => {
		try {
			const pending = await findPendingUpdate();
			if (!pending) return;
			/*
			 * Offer a given version once. The version check alone cannot stop a repeat: a
			 * locally built APK reports 0.0.1 permanently, and a user who dismisses the
			 * install prompt still has the old version installed — so without this the app
			 * re-downloaded and re-prompted on every single launch.
			 */
			if (alreadyOffered(pending.versionName)) return;
			markOffered(pending.versionName);
			await runApkUpdate(pending);
		} catch {
			/* Silent by design — see module comment. */
		}
	})();
}
