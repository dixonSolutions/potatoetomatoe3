/**
 * App-made documents for games whose own URL a frame cannot show (`local` and `shell`
 * routes in `online-play-routing.ts`).
 *
 * The HTML is fetched and played from a `blob:` document with a `<base href>` pointing
 * back at where it came from, so every relative URL still loads from the origin, and with
 * the in-frame bridge first in `<head>`. No server is involved, so this works on the public
 * site, on Android and on desktop alike:
 *
 * - `local`: the catalog's `online/embed.html`, written by the importer for Drive U 7
 *   games (the document inside the Google Sites gadget, which Sites itself refuses to let
 *   anyone frame). Same origin, so it is always fetchable.
 * - `shell`: the game's own HTML from a host that labels it `text/plain` (jsDelivr), which
 *   a frame would show as source. jsDelivr sends `Access-Control-Allow-Origin: *`.
 */

import { base } from '$app/paths';

const blobByGame = new Map<string, string>();

function escapeAttr(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/** Insert `tags` right after `<head …>` (or `<html …>`), else at the very start. */
export function insertFirstInHead(html: string, tags: string): string {
	for (const re of [/<head(\s[^>]*)?>/i, /<html(\s[^>]*)?>/i]) {
		const m = re.exec(html);
		if (m) return html.slice(0, m.index + m[0].length) + tags + html.slice(m.index + m[0].length);
	}
	return tags + html;
}

/** HTML served under another label still starts like HTML. */
export function looksLikeHtml(text: string): boolean {
	const head = text
		.slice(0, 2048)
		.replace(/^\uFEFF/, '')
		.trimStart()
		.toLowerCase();
	return (
		head.startsWith('<!doctype html') ||
		head.startsWith('<html') ||
		head.startsWith('<head') ||
		head.startsWith('<script') ||
		head.includes('<body')
	);
}

/** A bridge tag already in the page, as a dev server or service worker may have added it. */
const EXISTING_BRIDGE_TAG = /<script\b[^>]*game-storage-bridge\.child\.js[^>]*>\s*<\/script>/gi;

/**
 * The document a shell plays: `<base href>` unless the page brings its own, then the
 * bridge, both ahead of everything else in `<head>`.
 *
 * A bridge tag the page already carries is replaced, not kept: it was written for the
 * page's own URL (`src="/game-storage-bridge.child.js"`), and under the shell's `<base>`
 * that would resolve against the game's host instead of the app.
 */
export function buildShellHtml(
	html: string,
	options: { gameId: string; baseHref?: string; bridgeSrc: string }
): string {
	const page = html.replace(EXISTING_BRIDGE_TAG, '');
	let tags = '';
	if (options.baseHref && !/<base\b[^>]*\bhref\s*=/i.test(page)) {
		tags += `<base href="${escapeAttr(options.baseHref)}">`;
	}
	const id = options.gameId.replace(/["<>&]/g, '');
	tags += `<script src="${escapeAttr(options.bridgeSrc)}" data-pt-game="${id}"></script>`;
	return insertFirstInHead(page, tags);
}

function bridgeSrc(): string {
	return `${window.location.origin}${base.replace(/\/$/, '')}/game-storage-bridge.child.js`;
}

function toBlobUrl(gameId: string, html: string): string {
	const previous = blobByGame.get(gameId);
	if (previous) URL.revokeObjectURL(previous);
	const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
	blobByGame.set(gameId, url);
	return url;
}

/** True for a document this module made (the play URL of a `local` or `shell` route). */
export function isShellBlobUrl(url: string): boolean {
	for (const blob of blobByGame.values()) if (blob === url) return true;
	return false;
}

/** Play the catalog's own `online/embed.html` (Drive U 7). */
export async function createLocalEmbedShell(gameId: string): Promise<string | null> {
	const url = `${base}/games/${encodeURIComponent(gameId)}/online/embed.html`.replace(
		/\/{2,}/g,
		'/'
	);
	try {
		const res = await fetch(url);
		if (!res.ok) return null;
		const html = await res.text();
		if (!looksLikeHtml(html) || html.includes('data-sveltekit')) return null;
		return toBlobUrl(gameId, buildShellHtml(html, { gameId, bridgeSrc: bridgeSrc() }));
	} catch {
		return null;
	}
}

/** Play HTML that its host labels `text/plain`, from a blob with the right type. */
export async function createRemoteShell(gameId: string, pageUrl: string): Promise<string | null> {
	try {
		const res = await fetch(pageUrl, { credentials: 'omit', redirect: 'follow' });
		if (!res.ok) return null;
		const html = await res.text();
		if (!looksLikeHtml(html)) return null;
		const baseHref = res.url || pageUrl;
		return toBlobUrl(gameId, buildShellHtml(html, { gameId, baseHref, bridgeSrc: bridgeSrc() }));
	} catch {
		return null;
	}
}
