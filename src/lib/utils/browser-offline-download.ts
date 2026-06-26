/** Client-side mirror of same-origin online shells into IndexedDB (GitHub Pages). */

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
import type { DownloadProgress, GameOfflineStatus } from './offline-downloader-puller';

const ASSET_PATTERN =
	/(?:href|src)=["']([^"']+\.(?:js|css|png|jpg|jpeg|gif|webp|wasm|json|br|mp3|ogg|wav|svg|ico|html?))["']/gi;

const progressByGame = new Map<string, DownloadProgress>();
const abortByGame = new Map<string, AbortController>();
const discardOnCancel = new Map<string, boolean>();

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

/** Wait until the offline service worker can intercept /browser-offline/ requests. */
export async function ensureBrowserOfflineReady(): Promise<void> {
	if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
	const scope = `${appBase()}/`;
	let reg = await navigator.serviceWorker.getRegistration(scope);
	if (!reg) {
		await navigator.serviceWorker.register(`${appBase()}/offline-sw.js`, { scope });
	}
	await navigator.serviceWorker.ready;
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
	const offline = Boolean(meta?.downloadedAt && meta.fileCount > 0 && !meta?.partialCache);
	const cacheFileCount = meta?.cachedFileCount ?? (partialCache ? await countStoredGameFiles(gameId) : 0);
	return {
		online,
		offline,
		downloading: Boolean(meta?.downloading),
		partialCache: partialCache && !offline,
		cacheFileCount: cacheFileCount > 0 ? cacheFileCount : undefined
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
		setBrowserProgress(gameId, { state: 'running', progress: 5, message: 'Scanning online shell…' });
		const { files, externalIframe } = await collectSameOriginFiles(gameId, signal);
		if (files.size === 0) {
			throw new Error('No same-origin files found for this game');
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
		await setGameMeta(gameId, meta);

		const message = externalIframe
			? 'Saved online shell (external iframe may still need network)'
			: 'Download complete';
		setBrowserProgress(gameId, { state: 'done', progress: 100, message });
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
	await deleteStoredGame(gameId);
	progressByGame.delete(gameId);
}

export function browserOfflinePlayUrl(gameId: string): string {
	const base = appBase();
	return `${window.location.origin}${base}/browser-offline/${encodeURIComponent(gameId)}/online/index.html`;
}

export { isBrowserGameDownloaded };
