/**
 * Android-only update helpers. Resolves the latest GitHub Release APK for this repo.
 * Flatpak updates remain system-managed (`flatpak update`); no in-app Flatpak updater.
 */

import { isTauriApp, isTauriAndroidBuild } from '$lib/utils/offline-deployment';
import { openExternalUrl } from '$lib/utils/open-external';

export const APP_UPDATE_REPO = 'dixonSolutions/potatoetomatoe3';
const RELEASES_API = `https://api.github.com/repos/${APP_UPDATE_REPO}/releases/latest`;

export interface LatestApkRelease {
	tag: string;
	versionName: string;
	apkName: string;
	apkUrl: string;
	releaseUrl: string;
	publishedAt: string | null;
	/** Asset size in bytes; 0 when the API omits it. */
	apkSize: number;
}

type GithubReleaseAsset = {
	name?: string;
	browser_download_url?: string;
	content_type?: string;
	size?: number;
};

type GithubRelease = {
	tag_name?: string;
	html_url?: string;
	published_at?: string;
	assets?: GithubReleaseAsset[];
};

function isApkAsset(asset: GithubReleaseAsset): boolean {
	const name = (asset.name ?? '').toLowerCase();
	const type = (asset.content_type ?? '').toLowerCase();
	const url = (asset.browser_download_url ?? '').toLowerCase();
	return (
		name.endsWith('.apk') ||
		url.includes('.apk') ||
		type === 'application/vnd.android.package-archive'
	);
}

function versionFromTag(tag: string): string {
	const m = tag.match(/release-(\d+)/i);
	if (m) return `0.0.${m[1]}`;
	return tag.replace(/^v/i, '');
}

/** Pick the preferred APK asset from a GitHub release payload. */
export function selectLatestApkAsset(release: GithubRelease): LatestApkRelease | null {
	const tag = (release.tag_name ?? '').trim();
	const releaseUrl = (release.html_url ?? '').trim();
	if (!tag || !releaseUrl.includes(APP_UPDATE_REPO)) return null;

	const assets = Array.isArray(release.assets) ? release.assets : [];
	const apk =
		assets.find((a) => isApkAsset(a) && (a.name ?? '').toLowerCase().includes('potato')) ??
		assets.find((a) => isApkAsset(a));
	const apkUrl = (apk?.browser_download_url ?? '').trim();
	const apkName = (apk?.name ?? '').trim();
	if (!apkUrl || !apkName || !apkUrl.includes(APP_UPDATE_REPO) || !apkUrl.endsWith('.apk')) {
		return null;
	}

	return {
		tag,
		versionName: versionFromTag(tag),
		apkName,
		apkUrl,
		releaseUrl,
		publishedAt: release.published_at ?? null,
		apkSize: typeof apk?.size === 'number' ? apk.size : 0
	};
}

export async function fetchLatestApkRelease(signal?: AbortSignal): Promise<LatestApkRelease> {
	const res = await fetch(RELEASES_API, {
		headers: {
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28'
		},
		signal
	});
	if (!res.ok) {
		throw new Error(`GitHub Releases returned ${res.status}`);
	}
	const body = (await res.json()) as GithubRelease;
	const selected = selectLatestApkAsset(body);
	if (!selected) {
		throw new Error('Latest GitHub Release has no Potato Tomato APK asset');
	}
	return selected;
}

/** True when `apkUrl` is a release asset of this repo and safe to hand to the OS. */
export function isTrustedApkUrl(apkUrl: string): boolean {
	return (
		apkUrl.startsWith('https://') && apkUrl.includes(APP_UPDATE_REPO) && apkUrl.endsWith('.apk')
	);
}

/**
 * Hand the verified APK URL to the OS downloader.
 *
 * This used to click an `<a download>`. On the Tauri Android WebView that is a silent
 * no-op — no DownloadListener is registered — so the updater resolved the right release
 * and then never downloaded anything. `openExternalUrl` routes through ACTION_VIEW.
 */
export async function openApkDownload(apkUrl: string): Promise<void> {
	if (!isTrustedApkUrl(apkUrl)) {
		throw new Error('Refusing to open an untrusted APK URL');
	}
	await openExternalUrl(apkUrl);
}

/**
 * Compare two `0.0.N` version strings.
 *
 * Returns > 0 when `a` is newer. Non-numeric segments sort as 0 rather than throwing —
 * a locally built APK reports `0.0.1` and must simply look older than any release.
 */
export function compareVersions(a: string, b: string): number {
	const parse = (v: string) =>
		v
			.replace(/^v/i, '')
			.split('.')
			.map((n) => Number.parseInt(n, 10) || 0);
	const av = parse(a);
	const bv = parse(b);
	for (let i = 0; i < Math.max(av.length, bv.length); i++) {
		const diff = (av[i] ?? 0) - (bv[i] ?? 0);
		if (diff !== 0) return diff;
	}
	return 0;
}

export interface ApkUpdateProgress {
	phase: 'cached' | 'downloading' | 'needs-permission' | 'installing' | 'done' | 'error';
	received: number;
	total: number;
	message?: string | null;
}

/** Installed app version, or null off-Tauri. */
export async function getInstalledVersion(): Promise<string | null> {
	if (!isTauriApp()) return null;
	try {
		const { getVersion } = await import('@tauri-apps/api/app');
		return await getVersion();
	} catch {
		return null;
	}
}

/**
 * Download the release APK in-app and hand it to the Android package installer.
 *
 * `onProgress` fires roughly once per MiB. Resolves once the installer has been launched —
 * Android then shows its own confirmation, which cannot be skipped.
 */
export async function downloadAndInstallApk(
	release: LatestApkRelease,
	onProgress?: (p: ApkUpdateProgress) => void
): Promise<void> {
	if (!isTrustedApkUrl(release.apkUrl)) {
		throw new Error('Refusing to install an untrusted APK URL');
	}
	const { invoke } = await import('@tauri-apps/api/core');
	const { listen } = await import('@tauri-apps/api/event');
	const unlisten = onProgress
		? await listen<ApkUpdateProgress>('apk-update://progress', (e) => onProgress(e.payload))
		: null;
	try {
		await invoke('download_and_install_apk', {
			url: release.apkUrl,
			fileName: release.apkName
		});
	} finally {
		unlisten?.();
	}
}

/**
 * True when this build can self-update: Android only, and only when the latest release is
 * actually newer than what is installed.
 */
export async function findPendingUpdate(signal?: AbortSignal): Promise<LatestApkRelease | null> {
	if (!isTauriAndroidBuild()) return null;
	const installed = await getInstalledVersion();
	if (!installed) return null;
	const latest = await fetchLatestApkRelease(signal);
	return compareVersions(latest.versionName, installed) > 0 ? latest : null;
}

/** Open this app's Android "install unknown apps" toggle. */
export async function openInstallPermissionSettings(): Promise<void> {
	const { invoke } = await import('@tauri-apps/api/core');
	await invoke('open_install_permission_settings');
}

/**
 * How many releases the installed build is behind, for the update badge.
 *
 * Release tags are strictly `0.0.N`, so the patch delta is the release count. Anything
 * that does not fit that shape (a locally built APK, a dirty version string) falls back
 * to 1 — "an update exists" is still true and a wrong number is worse than a vague one.
 */
export function versionsBehind(installed: string, latest: string): number {
	const parse = (v: string) =>
		v
			.replace(/^v/i, '')
			.split('.')
			.map((n) => Number.parseInt(n, 10));
	const a = parse(installed);
	const b = parse(latest);
	const sameLine = a.length === 3 && b.length === 3 && a[0] === b[0] && a[1] === b[1];
	if (!sameLine || Number.isNaN(a[2]) || Number.isNaN(b[2])) {
		return compareVersions(latest, installed) > 0 ? 1 : 0;
	}
	return Math.max(0, b[2] - a[2]);
}
