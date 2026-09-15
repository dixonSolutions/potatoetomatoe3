/** Client-side mirror of same-origin online shells into IndexedDB (GitHub Pages). */

import { shouldProbePullerBackend } from './offline-deployment';
import { base } from '$app/paths';
import {
	deleteStoredGame,
	getGameFile,
	getGameMeta,
	guessMimeType,
	isBrowserGameDownloaded,
	hasBrowserPartialCache,
	countStoredGameFiles,
	listStoredGameIds,
	putGameFile,
	setGameMeta,
	type StoredGameMeta
} from './browser-offline-storage';
import { looksLikeAppShell } from './offline-play-url';
import type { DownloadProgress, GameOfflineStatus } from './offline-downloader-puller';
import { getPullerBaseUrl } from './offline-downloader-puller';

const ASSET_PATTERN =
	/(?:href|src)=["']([^"']+\.(?:js|css|png|jpg|jpeg|gif|webp|wasm|json|br|mp3|ogg|wav|svg|ico|html?))["']/gi;

const progressByGame = new Map<string, DownloadProgress>();
const abortByGame = new Map<string, AbortController>();
const discardOnCancel = new Map<string, boolean>();
/** Blob URLs for cached covers (browser offline backend). */
const thumbBlobUrls = new Map<string, string>();

const COVER_PATH = '__cover__/thumbnail';

async function cacheRemoteThumbnail(
	gameId: string,
	thumbnail: string,
	signal: AbortSignal
): Promise<string | null> {
	const t = thumbnail.trim();
	if (!t || (!t.startsWith('http') && !t.startsWith('/'))) return null;
	try {
		const url = t.startsWith('/') ? `${window.location.origin}${base}${t}` : t;
		const res = await fetch(url, { signal, redirect: 'follow' });
		if (!res.ok) return null;
		const buf = await res.arrayBuffer();
		if (buf.byteLength < 32) return null;
		const mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg';
		const ext = mime.includes('png')
			? '.png'
			: mime.includes('webp')
				? '.webp'
				: mime.includes('gif')
					? '.gif'
					: '.jpg';
		const path = `${COVER_PATH}${ext}`;
		await putGameFile(gameId, path, mime, buf);
		return path;
	} catch {
		return null;
	}
}

export async function browserOfflineThumbnailUrl(gameId: string): Promise<string | null> {
	const cached = thumbBlobUrls.get(gameId);
	if (cached) return cached;
	const meta = await getGameMeta(gameId);
	const path = meta?.thumbnailPath;
	if (!path) return null;
	const file = await getGameFile(gameId, path);
	if (!file) return null;
	const url = URL.createObjectURL(new Blob([file.data], { type: file.mimeType }));
	thumbBlobUrls.set(gameId, url);
	return url;
}

export class BrowserDownloadCancelledError extends Error {
	constructor(message = 'Download cancelled') {
		super(message);
		this.name = 'BrowserDownloadCancelledError';
	}
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new BrowserDownloadCancelledError();
}

/** Use `$app/paths` base — `import.meta.env.BASE_URL` is `./` in static builds and breaks absolute URLs. */
function appBase(): string {
	return base.replace(/\/$/, '');
}

function absoluteGameOnlineUrl(gameId: string, relativePath: string): string {
	const rel = relativePath.replace(/^\//, '');
	return `${window.location.origin}${appBase()}/games/${gameId}/online/${rel}`;
}

function toStoredPath(relativePath: string): string {
	const clean = relativePath.replace(/^\//, '');
	return clean.startsWith('online/') ? clean : `online/${clean}`;
}

const blobUrlByGame = new Map<string, string>();

function revokeBlobUrl(gameId: string): void {
	const existing = blobUrlByGame.get(gameId);
	if (existing) {
		URL.revokeObjectURL(existing);
		blobUrlByGame.delete(gameId);
	}
}

function injectStorageBridge(html: string): string {
	const bridgeSrc = `${window.location.origin}${appBase()}/game-storage-bridge.child.js`;
	if (html.includes('game-storage-bridge.child.js')) return html;
	const tag = `<script src="${bridgeSrc}"></script>`;
	if (html.includes('</head>')) return html.replace('</head>', `${tag}</head>`);
	return `${tag}${html}`;
}

/** Create a blob URL for the saved online shell (works without service worker control). */
export async function createBrowserOfflineBlobUrl(gameId: string): Promise<string | null> {
	const record = await getGameFile(gameId, 'online/index.html');
	if (!record?.data) return null;
	let html = new TextDecoder().decode(record.data);
	html = injectStorageBridge(html);
	revokeBlobUrl(gameId);
	const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
	blobUrlByGame.set(gameId, url);
	return url;
}

async function swServesOfflineShell(playUrl: string): Promise<boolean> {
	try {
		const res = await fetch(playUrl, { cache: 'no-store', credentials: 'same-origin' });
		if (!res.ok) return false;
		const snippet = (await res.text()).slice(0, 8192);
		if (looksLikeAppShell(snippet)) return false;
		return snippet.includes('<html') || snippet.includes('<iframe');
	} catch {
		return false;
	}
}

/**
 * Registration is impossible in some webviews, and retrying is not free: on Tauri Android
 * the script fetch escapes the custom-scheme interceptor and reaches the network stack as
 * plain http, which the release manifest forbids. Every attempt therefore logged two
 * errors — `ERR_CLEARTEXT_NOT_PERMITTED` and "An unknown error occurred when fetching the
 * script" — for a worker that was never going to activate. Try once per session.
 */
let serviceWorkerUnavailable = false;

/** Wait until the offline service worker can intercept /browser-offline/ and /api/unity-play/. */
export async function ensureOfflineServiceWorker(maxWaitMs = 8000): Promise<boolean> {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
	if (serviceWorkerUnavailable) return false;
	const scope = `${appBase()}/`;
	try {
		let reg = await navigator.serviceWorker.getRegistration(scope);
		if (!reg) {
			reg = await navigator.serviceWorker.register(`${appBase()}/offline-sw.js`, { scope });
		}
		await navigator.serviceWorker.ready;

		const deadline = Date.now() + maxWaitMs;
		while (Date.now() < deadline) {
			if (reg.active?.state === 'activated') return true;
			await new Promise((r) => setTimeout(r, 50));
			reg = (await navigator.serviceWorker.getRegistration(scope)) ?? reg;
		}
		return Boolean(reg.active?.state === 'activated');
	} catch {
		serviceWorkerUnavailable = true;
		return false;
	}
}

/**
 * Hand the worker the app assets this page already loaded.
 *
 * The worker registers from `onMount`, so the first page load — and every route chunk it
 * pulled in — happened before it could intercept anything. Those URLs are content-hashed
 * and never requested again, so without this the cache has a hole exactly where the app's
 * own code lives, and the site cannot boot offline until a second online visit.
 */
export function cacheLoadedAppAssets(): void {
	if (typeof navigator === 'undefined' || typeof performance === 'undefined') return;
	const worker = navigator.serviceWorker?.controller;
	if (!worker) return;
	try {
		const urls = performance
			.getEntriesByType('resource')
			.map((entry) => entry.name)
			/* Pre-filter to keep the message small; the worker decides what it will keep. */
			.filter((name) => {
				if (name.includes('/_app/immutable/')) return true;
				/* Route data carries a `?x-sveltekit-invalidated=…` hint, so test the path. */
				try {
					return new URL(name, window.location.href).pathname.endsWith('.json');
				} catch {
					return false;
				}
			});
		if (urls.length === 0) return;
		worker.postMessage({ type: 'pt-cache-app-assets', urls: [...new Set(urls)] });
	} catch {
		/* Opportunistic — never worth surfacing. */
	}
}

/** @deprecated Prefer ensureOfflineServiceWorker — same registration. */
export async function ensureBrowserOfflineReady(maxWaitMs = 8000): Promise<boolean> {
	return ensureOfflineServiceWorker(maxWaitMs);
}

/** Resolve a playable URL for a browser-stored offline copy (SW route or blob fallback). */
export async function resolveBrowserOfflinePlayUrl(gameId: string): Promise<string | null> {
	if (!(await isBrowserGameDownloaded(gameId))) return null;

	await ensureBrowserOfflineReady();
	const swUrl = browserOfflinePlayUrl(gameId);
	if (await swServesOfflineShell(swUrl)) return swUrl;

	const meta = await getGameMeta(gameId);
	const blobUrl = await createBrowserOfflineBlobUrl(gameId);
	if (blobUrl && (meta?.externalIframe || (meta?.fileCount ?? 0) <= 1)) {
		return blobUrl;
	}
	if (blobUrl) return blobUrl;

	return swUrl;
}

function patchShellHtml(html: string): string {
	if (!/<iframe/i.test(html)) return html;
	return html.replace(/<iframe([^>]*?)>/gi, (tag) => {
		if (/allow=/i.test(tag)) return tag;
		return tag.replace('<iframe', '<iframe allow="fullscreen; autoplay; gamepad"');
	});
}

function extractIframeSrc(html: string): string | null {
	const patterns = [/<iframe[^>]+src=["']([^"']+)["']/i, /<iframe[^>]+src=([^\s>]+)/i];
	for (const re of patterns) {
		const m = html.match(re);
		if (m?.[1]) {
			const src = m[1].replace(/&amp;/g, '&').trim();
			if (src.startsWith('http')) return src;
		}
	}
	return null;
}

/**
 * Hosts that almost always serve Unity WebGL. Do NOT include abinbins.github.io —
 * that mirror hosts Unity and OpenFL/Lime (e.g. G-Switch 3) under the same domain.
 */
const UNITY_IFRAME_HOST_RE =
	/play\.unity\.com|cdn\.play\.unity\.com|storage-direct\.y8\.com|unity3d\.com/i;

/** True when an embed URL path/host is a strong Unity signal (no network). */
export function iframeSrcLooksLikeUnity(src: string): boolean {
	try {
		const u = new URL(src);
		if (UNITY_IFRAME_HOST_RE.test(u.hostname)) return true;
		if (/\/(Build|Release|TemplateData)\//i.test(u.pathname)) return true;
		return false;
	} catch {
		return false;
	}
}

/** OpenFL / Lime HTML5 (G-Switch etc.) — must use game-live, not unity-play. */
export function htmlLooksLikeOpenFl(html: string): boolean {
	return /lime\.embed\s*\(|id=["']openfl-content["']|openfl-content/i.test(html);
}

/** Unity WebGL document markers (must run on raw HTML — never after inject.js). */
export function htmlLooksLikeUnityDocument(html: string): boolean {
	if (htmlLooksLikeOpenFl(html)) return false;
	/*
	 * CrazyGames portal shells mention Unity loader URLs but need game-live
	 * (proxy the shell). Do not classify as Unity → unity-play.
	 */
	if (/Crazygames\.load\s*\(|useLocalGF\s*=|gfBuildPath\s*=/i.test(html)) return false;
	if (
		/"moduleJsonUrl"\s*:\s*"https?:\/\//i.test(html) &&
		/"unityLoaderUrl"\s*:\s*"https?:\/\//i.test(html)
	) {
		return false;
	}
	return /UnityLoader|createUnityInstance|unityWebglLoaderUrl|Build\/[^"' ]+\.json/i.test(html);
}

/** Fetch embed HTML and decide Unity vs OpenFL/other. */
export async function remoteEmbedLooksLikeUnity(src: string): Promise<boolean> {
	if (iframeSrcLooksLikeUnity(src)) return true;
	/*
	 * The fetch below is cross-origin to a portal host that sends no CORS headers, so it
	 * can only ever fail — it exists to pick between two *relay* hosts. Where no relay can
	 * run (Tauri mobile, public site) that is an 8-second timeout and a console CORS error
	 * on every game page, for an answer nothing will use. Fall back to the URL heuristic.
	 */
	if (!shouldProbePullerBackend()) return false;
	try {
		const res = await fetch(src, {
			cache: 'no-store',
			signal: AbortSignal.timeout(8_000),
			redirect: 'follow'
		});
		if (!res.ok) return false;
		const html = (await res.text()).slice(0, 256_000);
		if (htmlLooksLikeOpenFl(html)) return false;
		return htmlLooksLikeUnityDocument(html);
	} catch {
		/* Unknown host — prefer game-live (rewrites all assets) over unity-play. */
		return false;
	}
}

export type OnlineShellExternalInfo = {
	external: boolean;
	/** Prefer puller unity-play (CDN assets + inject) over full game-live relay. */
	unityLike: boolean;
	iframeSrc: string | null;
};

/**
 * Peek the online shell for a cross-origin iframe and whether it looks like Unity.
 * Browser IndexedDB cannot full-scrape those hosts.
 */
export async function probeOnlineShellExternal(gameId: string): Promise<OnlineShellExternalInfo> {
	const empty: OnlineShellExternalInfo = { external: false, unityLike: false, iframeSrc: null };
	try {
		const { loadGameMetadata } = await import('./games');
		const metadata = await loadGameMetadata(gameId);
		if (metadata?.onlineEmbedUrl) {
			try {
				const embed = metadata.onlineEmbedUrl.trim();
				if (new URL(embed).origin !== window.location.origin) {
					const unityLike = metadata.engine === 'unity' || (await remoteEmbedLooksLikeUnity(embed));
					return {
						external: true,
						unityLike,
						iframeSrc: embed
					};
				}
			} catch {
				return {
					external: true,
					unityLike: metadata?.engine === 'unity',
					iframeSrc: metadata.onlineEmbedUrl
				};
			}
		}
		const res = await fetch(absoluteGameOnlineUrl(gameId, 'index.html'), {
			cache: 'no-store'
		});
		if (!res.ok) return empty;
		const html = await res.text();
		const iframeSrc = extractIframeSrc(html);
		if (!iframeSrc) return empty;
		const external = new URL(iframeSrc).origin !== window.location.origin;
		if (!external) return empty;
		const unityLike = metadata?.engine === 'unity' || (await remoteEmbedLooksLikeUnity(iframeSrc));
		return {
			external: true,
			unityLike,
			iframeSrc
		};
	} catch {
		return empty;
	}
}

/**
 * Peek the online shell for a cross-origin iframe (browser IndexedDB cannot full-scrape those).
 */
export async function onlineShellHasExternalIframe(gameId: string): Promise<boolean> {
	const info = await probeOnlineShellExternal(gameId);
	return info.external;
}

/** Clear message when browser storage cannot mirror a third-party game host. */
export const EXTERNAL_IFRAME_NEEDS_PULLER =
	'Full offline needs the desktop app or a local puller — this game embeds a third-party host that cannot be scraped from the browser alone.';

function isSameOriginAsset(gameId: string, ref: string, pageUrl: string): string | null {
	if (!ref || ref.startsWith('data:') || ref.startsWith('blob:') || ref.startsWith('#')) {
		return null;
	}
	try {
		const resolved = new URL(ref, pageUrl);
		if (resolved.origin !== window.location.origin) return null;
		const prefix = `${appBase()}/games/${gameId}/online/`;
		if (!resolved.pathname.startsWith(prefix)) return null;
		return resolved.pathname.slice(prefix.length);
	} catch {
		return null;
	}
}

function scanTextForAssets(
	gameId: string,
	text: string,
	pageUrl: string,
	queue: Set<string>
): void {
	let m: RegExpExecArray | null;
	ASSET_PATTERN.lastIndex = 0;
	while ((m = ASSET_PATTERN.exec(text)) !== null) {
		const rel = isSameOriginAsset(gameId, m[1], pageUrl);
		if (rel) queue.add(rel);
	}
}

async function collectSameOriginFiles(
	gameId: string,
	signal?: AbortSignal
): Promise<{
	files: Map<string, ArrayBuffer>;
	externalIframe: boolean;
}> {
	const files = new Map<string, ArrayBuffer>();
	const queue = new Set<string>(['index.html']);
	const seen = new Set<string>();
	let externalIframe = false;

	while (queue.size > 0) {
		throwIfAborted(signal);
		const rel = queue.values().next().value as string;
		queue.delete(rel);
		if (seen.has(rel)) continue;
		seen.add(rel);

		const storedPath = toStoredPath(rel);
		const cached = await getGameFile(gameId, storedPath);
		let buffer: ArrayBuffer;
		const url = absoluteGameOnlineUrl(gameId, rel);

		if (cached?.data) {
			buffer = cached.data;
		} else {
			const res = await fetch(url, { signal });
			if (!res.ok) continue;
			buffer = await res.arrayBuffer();
		}

		const mime = guessMimeType(rel);
		if (/html/i.test(mime) || rel.endsWith('.html') || rel.endsWith('.htm')) {
			let html = new TextDecoder().decode(buffer);
			if (rel === 'index.html') {
				html = patchShellHtml(html);
				buffer = new TextEncoder().encode(html).buffer;
				const iframeSrc = extractIframeSrc(html);
				if (iframeSrc) {
					try {
						const iframeOrigin = new URL(iframeSrc).origin;
						if (iframeOrigin !== window.location.origin) externalIframe = true;
					} catch {
						externalIframe = true;
					}
				}
			}
			scanTextForAssets(gameId, html, url, queue);
			files.set(storedPath, buffer);
			continue;
		} else if (/javascript|json|css/i.test(mime) || /\.(js|css|json)$/i.test(rel)) {
			const text = new TextDecoder().decode(buffer);
			scanTextForAssets(gameId, text, url, queue);
		}
		files.set(storedPath, buffer);
	}

	return { files, externalIframe };
}

export function getBrowserDownloadProgress(gameId: string): DownloadProgress {
	return progressByGame.get(gameId) ?? { state: 'idle', progress: 0, message: '' };
}

function setBrowserProgress(gameId: string, progress: DownloadProgress): void {
	progressByGame.set(gameId, progress);
}

export async function checkOnlineShellExists(gameId: string): Promise<boolean> {
	try {
		const res = await fetch(absoluteGameOnlineUrl(gameId, 'index.html'), { method: 'HEAD' });
		return res.ok;
	} catch {
		return false;
	}
}

export async function fetchBrowserGameOfflineStatus(gameId: string): Promise<GameOfflineStatus> {
	const online = await checkOnlineShellExists(gameId);
	const meta = await getGameMeta(gameId);
	const partialCache = Boolean(meta?.partialCache) || (await hasBrowserPartialCache(gameId));
	const offline = Boolean(
		meta?.downloadedAt && meta.fileCount > 0 && !meta?.partialCache && !meta?.externalIframe
	);
	const cacheFileCount =
		meta?.cachedFileCount ?? (partialCache ? await countStoredGameFiles(gameId) : 0);
	const thumbUrl = offline ? await browserOfflineThumbnailUrl(gameId) : null;
	return {
		online,
		offline,
		downloading: Boolean(meta?.downloading),
		partialCache: partialCache && !offline,
		cacheFileCount: cacheFileCount > 0 ? cacheFileCount : undefined,
		/* Reuse offlineThumbnail for a usable URL (blob:) so cards can preferOffline without a second field. */
		offlineThumbnail: thumbUrl ?? undefined
	};
}

export async function fetchBrowserOfflineStatuses(): Promise<Record<string, GameOfflineStatus>> {
	const ids = await listStoredGameIds();
	const out: Record<string, GameOfflineStatus> = {};
	await Promise.all(
		ids.map(async (id) => {
			out[id] = await fetchBrowserGameOfflineStatus(id);
		})
	);
	return out;
}

/**
 * Ask the browser to keep this origin's data.
 *
 * Without a persistence grant, IndexedDB is best-effort storage the browser may evict
 * under pressure — which would silently delete downloaded games, the one failure that
 * makes an offline download worthless. Browsers grant this on engagement signals
 * (installed PWA, bookmarked, frequently visited) and refuse quietly otherwise, so this
 * is a request, not a guarantee; a refusal is not a reason to block the download.
 */
export async function requestPersistentStorage(): Promise<boolean> {
	if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
	try {
		if (await navigator.storage.persisted?.()) return true;
		return await navigator.storage.persist();
	} catch {
		return false;
	}
}

export async function startBrowserGameDownload(
	gameId: string
): Promise<{ started: boolean; message: string }> {
	const existing = progressByGame.get(gameId);
	if (existing?.state === 'running' || existing?.state === 'pending') {
		return { started: false, message: 'Download already in progress' };
	}

	const controller = new AbortController();
	abortByGame.set(gameId, controller);
	discardOnCancel.delete(gameId);

	/* Best effort, and deliberately not awaited into the failure path — see the helper. */
	void requestPersistentStorage();

	setBrowserProgress(gameId, { state: 'pending', progress: 0, message: 'Starting…' });
	const prior = await getGameMeta(gameId);
	await setGameMeta(gameId, {
		downloadedAt: prior?.partialCache ? 0 : (prior?.downloadedAt ?? 0),
		fileCount: prior?.cachedFileCount ?? prior?.fileCount ?? 0,
		downloading: true,
		partialCache: prior?.partialCache,
		cachedFileCount: prior?.cachedFileCount,
		totalFileCount: prior?.totalFileCount,
		externalIframe: prior?.externalIframe
	});

	void runBrowserDownload(gameId, controller.signal);
	return { started: true, message: 'Download started' };
}

export async function cancelBrowserGameDownload(
	gameId: string,
	discardCache: boolean
): Promise<void> {
	discardOnCancel.set(gameId, discardCache);
	abortByGame.get(gameId)?.abort();
	if (discardCache) {
		await deleteStoredGame(gameId);
		progressByGame.delete(gameId);
	}
	abortByGame.delete(gameId);
}

async function runBrowserDownload(gameId: string, signal: AbortSignal): Promise<void> {
	try {
		setBrowserProgress(gameId, {
			state: 'running',
			progress: 5,
			message: 'Scanning online shell…'
		});
		const { files, externalIframe } = await collectSameOriginFiles(gameId, signal);
		if (files.size === 0) {
			throw new Error('No same-origin files found for this game');
		}

		/*
		 * Cross-origin iframe shells cannot be full-scraped from IndexedDB alone.
		 * Refuse to mark as offline — callers should route to the puller first.
		 */
		if (externalIframe) {
			await setGameMeta(gameId, {
				downloadedAt: 0,
				fileCount: 0,
				downloading: false,
				partialCache: false,
				externalIframe: true
			});
			setBrowserProgress(gameId, {
				state: 'error',
				progress: 0,
				message: EXTERNAL_IFRAME_NEEDS_PULLER,
				error: EXTERNAL_IFRAME_NEEDS_PULLER
			});
			return;
		}

		let written = 0;
		const total = files.size;
		for (const [path, data] of files) {
			throwIfAborted(signal);
			written++;
			const pct = Math.min(95, Math.round((written / total) * 90) + 5);
			setBrowserProgress(gameId, {
				state: 'running',
				progress: pct,
				message: `Saving ${written}/${total}…`
			});
			await putGameFile(gameId, path, guessMimeType(path), data);
			await setGameMeta(gameId, {
				downloadedAt: 0,
				fileCount: written,
				downloading: true,
				partialCache: true,
				cachedFileCount: written,
				totalFileCount: total,
				externalIframe
			});
		}

		const meta: StoredGameMeta = {
			downloadedAt: Date.now(),
			fileCount: files.size,
			downloading: false,
			partialCache: false,
			cachedFileCount: files.size,
			totalFileCount: files.size,
			externalIframe
		};

		try {
			setBrowserProgress(gameId, {
				state: 'running',
				progress: 97,
				message: 'Caching cover thumbnail…'
			});
			const { loadGameMetadata } = await import('./games');
			const gameMeta = await loadGameMetadata(gameId);
			const thumbPath = gameMeta?.thumbnail
				? await cacheRemoteThumbnail(gameId, gameMeta.thumbnail, signal)
				: null;
			if (thumbPath) meta.thumbnailPath = thumbPath;
		} catch {
			/* cover is optional */
		}

		await setGameMeta(gameId, meta);

		setBrowserProgress(gameId, { state: 'done', progress: 100, message: 'Download complete' });
	} catch (error) {
		const discard = discardOnCancel.get(gameId) ?? false;
		discardOnCancel.delete(gameId);
		abortByGame.delete(gameId);

		if (error instanceof BrowserDownloadCancelledError || signal.aborted) {
			if (discard) {
				await deleteStoredGame(gameId);
				setBrowserProgress(gameId, {
					state: 'cancelled',
					progress: 0,
					message: 'Cancelled — cache discarded'
				});
			} else {
				const cachedFileCount = await countStoredGameFiles(gameId);
				await setGameMeta(gameId, {
					downloadedAt: 0,
					fileCount: cachedFileCount,
					downloading: false,
					partialCache: cachedFileCount > 0,
					cachedFileCount
				});
				setBrowserProgress(gameId, {
					state: 'cancelled',
					progress: 0,
					message: 'Cancelled — partial cache kept for next time'
				});
			}
			return;
		}

		await setGameMeta(gameId, {
			downloadedAt: 0,
			fileCount: 0,
			downloading: false,
			partialCache: false
		});
		setBrowserProgress(gameId, {
			state: 'error',
			progress: 0,
			message: 'Download failed',
			error: error instanceof Error ? error.message : 'Download failed'
		});
	} finally {
		abortByGame.delete(gameId);
	}
}

export async function pollBrowserDownloadUntilDone(
	gameId: string,
	onProgress: (p: DownloadProgress) => void,
	intervalMs = 400
): Promise<DownloadProgress> {
	for (;;) {
		const p = getBrowserDownloadProgress(gameId);
		onProgress(p);
		if (
			p.state === 'done' ||
			p.state === 'error' ||
			p.state === 'cancelled' ||
			p.state === 'idle'
		) {
			return p;
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
}

export async function deleteBrowserOfflineCopy(gameId: string): Promise<void> {
	abortByGame.get(gameId)?.abort();
	abortByGame.delete(gameId);
	revokeBlobUrl(gameId);
	await deleteStoredGame(gameId);
	progressByGame.delete(gameId);
}

export function browserOfflinePlayUrl(gameId: string): string {
	const base = appBase();
	return `${window.location.origin}${base}/browser-offline/${encodeURIComponent(gameId)}/online/index.html`;
}

/**
 * Import a completed puller mirror into this browser's IndexedDB.
 * Scraping stays in the shared puller; this function is only a storage adapter.
 */
export async function importPullerOfflineCopy(
	gameId: string,
	onProgress?: (progress: DownloadProgress) => void,
	signal?: AbortSignal
): Promise<void> {
	const baseUrl = getPullerBaseUrl();
	const manifestResponse = await fetch(
		`${baseUrl}/api/offline/${encodeURIComponent(gameId)}/export`,
		{ signal }
	);
	if (!manifestResponse.ok) {
		throw new Error(`Puller export unavailable (${manifestResponse.status})`);
	}
	const manifest = (await manifestResponse.json()) as {
		files?: Array<{ path: string; mimeType?: string }>;
	};
	const files = manifest.files ?? [];
	if (files.length === 0) throw new Error('Puller export contains no files');
	const exportedThumbnail = files.find((file) => /^assets\/thumbnail\./i.test(file.path));
	const thumbnailPath = exportedThumbnail ? `online/${exportedThumbnail.path}` : undefined;

	await setGameMeta(gameId, {
		downloadedAt: 0,
		fileCount: 0,
		downloading: true,
		partialCache: true,
		cachedFileCount: 0,
		totalFileCount: files.length,
		externalIframe: false,
		thumbnailPath
	});

	for (let index = 0; index < files.length; index++) {
		throwIfAborted(signal);
		const file = files[index];
		const response = await fetch(
			`${baseUrl}/api/offline/${encodeURIComponent(gameId)}/export/file?path=${encodeURIComponent(file.path)}`,
			{ signal }
		);
		if (!response.ok) throw new Error(`Puller export file failed (${response.status})`);
		const data = await response.arrayBuffer();
		await putGameFile(
			gameId,
			`online/${file.path}`,
			file.mimeType ?? guessMimeType(file.path),
			data
		);
		const count = index + 1;
		const progress = Math.min(99, Math.round((count / files.length) * 95));
		onProgress?.({
			state: 'running',
			progress,
			message: `Saving puller mirror ${count}/${files.length}…`
		});
		await setGameMeta(gameId, {
			downloadedAt: 0,
			fileCount: count,
			downloading: true,
			partialCache: true,
			cachedFileCount: count,
			totalFileCount: files.length,
			externalIframe: false,
			thumbnailPath
		});
	}

	await setGameMeta(gameId, {
		downloadedAt: Date.now(),
		fileCount: files.length,
		downloading: false,
		partialCache: false,
		cachedFileCount: files.length,
		totalFileCount: files.length,
		externalIframe: false,
		thumbnailPath
	});
}

export { isBrowserGameDownloaded };
