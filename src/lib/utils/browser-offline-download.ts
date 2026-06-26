/** Client-side mirror of same-origin online shells into IndexedDB (GitHub Pages). */

import { base } from '$app/paths';
import {
	deleteStoredGame,
	getGameMeta,
	guessMimeType,
	isBrowserGameDownloaded,
	listStoredGameIds,
	putGameFile,
	setGameMeta,
	type StoredGameMeta
} from './browser-offline-storage';
import type { DownloadProgress, GameOfflineStatus } from './offline-downloader-puller';

const ASSET_PATTERN =
	/(?:href|src)=["']([^"']+\.(?:js|css|png|jpg|jpeg|gif|webp|wasm|json|br|mp3|ogg|wav|svg|ico|html?))["']/gi;

const progressByGame = new Map<string, DownloadProgress>();

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

async function collectSameOriginFiles(gameId: string): Promise<{
	files: Map<string, ArrayBuffer>;
	externalIframe: boolean;
}> {
	const files = new Map<string, ArrayBuffer>();
	const queue = new Set<string>(['index.html']);
	const seen = new Set<string>();
	let externalIframe = false;

	while (queue.size > 0) {
		const rel = queue.values().next().value as string;
		queue.delete(rel);
		if (seen.has(rel)) continue;
		seen.add(rel);

		const url = absoluteGameOnlineUrl(gameId, rel);
		const res = await fetch(url);
		if (!res.ok) continue;

		let buffer = await res.arrayBuffer();

		const mime = res.headers.get('content-type') ?? guessMimeType(rel);
		if (/html/i.test(mime) || rel.endsWith('.html') || rel.endsWith('.htm')) {
			let html = new TextDecoder().decode(buffer);
			if (rel === 'index.html') {
				html = patchShellHtml(html);
				buffer = new TextEncoder().encode(html).buffer;
			}
			if (rel === 'index.html') {
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
			files.set(toStoredPath(rel), buffer);
			continue;
		} else if (/javascript|json|css/i.test(mime) || /\.(js|css|json)$/i.test(rel)) {
			const text = new TextDecoder().decode(buffer);
			scanTextForAssets(gameId, text, url, queue);
		}
		files.set(toStoredPath(rel), buffer);
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
	const offline = Boolean(meta?.downloadedAt && meta.fileCount > 0);
	return {
		online,
		offline,
		downloading: Boolean(meta?.downloading)
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

	setBrowserProgress(gameId, { state: 'pending', progress: 0, message: 'Starting…' });
	await setGameMeta(gameId, {
		downloadedAt: 0,
		fileCount: 0,
		downloading: true
	});

	void runBrowserDownload(gameId);
	return { started: true, message: 'Download started' };
}

async function runBrowserDownload(gameId: string): Promise<void> {
	try {
		setBrowserProgress(gameId, { state: 'running', progress: 5, message: 'Scanning online shell…' });
		const { files, externalIframe } = await collectSameOriginFiles(gameId);
		if (files.size === 0) {
			throw new Error('No same-origin files found for this game');
		}

		let written = 0;
		for (const [path, data] of files) {
			written++;
			const pct = Math.min(95, Math.round((written / files.size) * 90) + 5);
			setBrowserProgress(gameId, {
				state: 'running',
				progress: pct,
				message: `Saving ${written}/${files.size}…`
			});
			await putGameFile(gameId, path, guessMimeType(path), data);
		}

		const meta: StoredGameMeta = {
			downloadedAt: Date.now(),
			fileCount: files.size,
			downloading: false,
			externalIframe
		};
		await setGameMeta(gameId, meta);

		const message = externalIframe
			? 'Saved online shell (external iframe may still need network)'
			: 'Download complete';
		setBrowserProgress(gameId, { state: 'done', progress: 100, message });
	} catch (error) {
		await setGameMeta(gameId, {
			downloadedAt: 0,
			fileCount: 0,
			downloading: false
		});
		setBrowserProgress(gameId, {
			state: 'error',
			progress: 0,
			message: 'Download failed',
			error: error instanceof Error ? error.message : 'Download failed'
		});
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
		if (p.state === 'done' || p.state === 'error' || p.state === 'idle') {
			return p;
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
}

export async function deleteBrowserOfflineCopy(gameId: string): Promise<void> {
	await deleteStoredGame(gameId);
	progressByGame.delete(gameId);
}

export function browserOfflinePlayUrl(gameId: string): string {
	const base = appBase();
	return `${window.location.origin}${base}/browser-offline/${encodeURIComponent(gameId)}/online/index.html`;
}

export { isBrowserGameDownloaded };
