/**
 * Open an https URL outside the app surface.
 *
 * The web build can just click an anchor. The Tauri **Android** WebView cannot: it
 * registers no `DownloadListener`, so a click on `<a download>` is dropped without an
 * error, and `target="_blank"` navigates the app's own WebView away from
 * `tauri.localhost` with no way back. Field test on a Galaxy Tab Active3 showed the APK
 * updater resolving release metadata correctly and then doing precisely nothing —
 * no DownloadManager entry, no file, no exception.
 *
 * `open_external_url` (src-tauri/src/lib.rs) hands the URL to the OS instead, which on
 * Android is `Intent.ACTION_VIEW` — the system browser takes the download.
 */

import { isTauriApp } from '$lib/utils/offline-deployment';

export function isHttpsUrl(url: string | null | undefined): boolean {
	const raw = url?.trim();
	if (!raw) return false;
	try {
		return new URL(raw).protocol === 'https:';
	} catch {
		return false;
	}
}

/** Fallback for the hosted web build, where an anchor click is the right mechanism. */
function openViaAnchor(url: string): void {
	const a = document.createElement('a');
	a.href = url;
	a.rel = 'noopener noreferrer';
	a.target = '_blank';
	document.body.appendChild(a);
	a.click();
	a.remove();
}

/**
 * Hand `url` to the OS (native builds) or a new browsing context (web).
 * Throws when the URL is not https, or when the native call fails.
 */
export async function openExternalUrl(url: string): Promise<void> {
	const target = url?.trim() ?? '';
	if (!isHttpsUrl(target)) {
		throw new Error('Refusing to open a non-https URL');
	}

	if (isTauriApp()) {
		const { invoke } = await import('@tauri-apps/api/core');
		await invoke('open_external_url', { url: target });
		return;
	}

	openViaAnchor(target);
}
