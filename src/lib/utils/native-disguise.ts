/**
 * Push the privacy disguise onto the native app identity (Tauri only).
 *
 * `+layout.svelte` already swaps the tab `<title>` and favicon, but a native build is
 * also identified by its Android recents card and, on Linux, its window title, taskbar
 * entry and tray icon — none of which a `<svelte:head>` can reach. This hands the same
 * label and icon to Rust, which applies them per platform (`src-tauri/src/disguise.rs`).
 *
 * The icon is rasterised here rather than shipped as a second set of native assets: the
 * disguise favicons are SVG under `static/privacy-favicons/`, the platform APIs want
 * pixels, and rasterising the exact file the tab is displaying is the only way the two
 * views of the app cannot drift apart as disguises are added.
 */

import { invoke } from '@tauri-apps/api/core';
import { isTauriApp } from '$lib/utils/offline-deployment';

/**
 * Which native surface carries the app identity, and therefore when to disguise it.
 *
 * `task` (Android) is only visible once the app is backgrounded, and the system can
 * snapshot the recents card while the app pauses — so the caller keeps it disguised for
 * as long as privacy mode is armed rather than racing `visibilitychange` on the way out.
 * `window` (desktop) is on screen during use, so it tracks the tab exactly.
 */
export type NativeIdentityTarget = 'task' | 'window';

/** Recents cards and tray icons render well under this; larger only inflates the IPC payload. */
const ICON_PX = 128;

const iconCache = new Map<string, Promise<string>>();
let targetPromise: Promise<NativeIdentityTarget> | null = null;
let lastSent: string | null = null;
let everDisguised = false;

/**
 * Draw an icon URL into a square PNG and return it base64-encoded (no data: prefix).
 *
 * Aspect ratio is preserved rather than stretched — the Docs sheet is 47×65, and a
 * squashed logo is exactly the sort of detail that makes a disguise read as fake.
 */
function rasterizeToPngBase64(url: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => {
			const canvas = document.createElement('canvas');
			canvas.width = ICON_PX;
			canvas.height = ICON_PX;
			const ctx = canvas.getContext('2d');
			if (!ctx) {
				reject(new Error('no 2d canvas context'));
				return;
			}
			const scale = Math.min(ICON_PX / img.width, ICON_PX / img.height);
			const w = img.width * scale;
			const h = img.height * scale;
			ctx.drawImage(img, (ICON_PX - w) / 2, (ICON_PX - h) / 2, w, h);
			try {
				const encoded = canvas.toDataURL('image/png').split(',')[1];
				if (encoded) resolve(encoded);
				else reject(new Error('canvas produced no PNG data'));
			} catch (err) {
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		};
		img.onerror = () => reject(new Error(`could not load icon ${url}`));
		img.src = url;
	});
}

function rasterizeCached(url: string): Promise<string> {
	const hit = iconCache.get(url);
	if (hit) return hit;
	const pending = rasterizeToPngBase64(url);
	iconCache.set(url, pending);
	/* A failed decode must not be cached, or the disguise never recovers. */
	pending.catch(() => iconCache.delete(url));
	return pending;
}

/** Cached per session — the answer is a compile-time constant on the Rust side. */
export function getNativeIdentityTarget(): Promise<NativeIdentityTarget> {
	if (!isTauriApp()) return Promise.resolve('window');
	targetPromise ??= invoke<string>('native_identity_target')
		.then((t) => (t === 'task' ? 'task' : 'window'))
		.catch(() => 'window' as const);
	return targetPromise;
}

/**
 * Point the native surfaces at the decoy, or hand them back their real identity.
 *
 * A build that never disguises anything is never touched: until the first disguise lands,
 * `disguised === false` returns without an IPC call. Restoring is not the same as setting
 * the real name — Rust reads that from the window config / package manager — so calling
 * this eagerly on an untouched install would relabel it for no reason.
 */
export async function syncNativeIdentity(
	label: string,
	iconUrl: string,
	disguised: boolean
): Promise<void> {
	if (!isTauriApp()) return;
	if (!disguised && !everDisguised) return;

	const key = disguised ? `${label} ${iconUrl}` : '';
	if (key === lastSent) return;
	lastSent = key;

	try {
		if (disguised) {
			const iconPngBase64 = await rasterizeCached(iconUrl);
			await invoke('set_native_disguise', { label, iconPngBase64 });
			everDisguised = true;
		} else {
			await invoke('clear_native_disguise');
		}
	} catch (err) {
		/* Let the next change retry rather than latching onto a half-applied identity. */
		lastSent = null;
		console.warn('[native-disguise] could not apply native identity', err);
	}
}
