/**
 * Android-only update helpers. Resolves the latest GitHub Release APK for this repo.
 * Flatpak updates remain system-managed (`flatpak update`); no in-app Flatpak updater.
 */

export const APP_UPDATE_REPO = 'dixonSolutions/potatoetomatoe3';
const RELEASES_API = `https://api.github.com/repos/${APP_UPDATE_REPO}/releases/latest`;

export interface LatestApkRelease {
	tag: string;
	versionName: string;
	apkName: string;
	apkUrl: string;
	releaseUrl: string;
	publishedAt: string | null;
}

type GithubReleaseAsset = {
	name?: string;
	browser_download_url?: string;
	content_type?: string;
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
		publishedAt: release.published_at ?? null
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

/** Open the verified APK download URL in a new browsing context / system downloader. */
export function openApkDownload(apkUrl: string): void {
	if (
		!apkUrl.startsWith('https://') ||
		!apkUrl.includes(APP_UPDATE_REPO) ||
		!apkUrl.endsWith('.apk')
	) {
		throw new Error('Refusing to open an untrusted APK URL');
	}
	const a = document.createElement('a');
	a.href = apkUrl;
	a.rel = 'noopener noreferrer';
	a.target = '_blank';
	a.download = '';
	document.body.appendChild(a);
	a.click();
	a.remove();
}
