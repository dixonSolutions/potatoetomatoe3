/**
 * App-made documents for games whose own URL a frame cannot show (`local` and `shell`
 * routes in `online-play-routing.ts`), where no relay gives them an origin of their own:
 * the public site and Android. The desktop app plays both through its relay instead.
 *
 * The game's HTML is played from a document the app makes, with a `<base href>` pointing
 * back at where it came from, so every relative URL still loads from the origin, and with
 * the in-frame bridge first in `<head>`. No server is involved:
 *
 * - `local`: the catalog's `online/embed.html`, written by the importer for Drive U 7
 *   games (the document inside the Google Sites gadget, which Sites itself refuses to let
 *   anyone frame).
 * - `shell`: the game's own HTML from a host that labels it `text/plain` (jsDelivr), which
 *   a frame would show as source. jsDelivr sends `Access-Control-Allow-Origin: *`.
 *
 * **A document the app makes can have the app's origin** (a `blob:` or `srcdoc` inherits
 * it), and this third-party HTML must never run with it: it could reach into the app page,
 * call the desktop app's commands and read or wipe every game's saves. The frame gets
 * `SHELL_FRAME_SANDBOX` — no `allow-same-origin` — so the document runs with an opaque
 * origin, walled off from the app. It has no storage of its own there, so the bridge keeps
 * the game's localStorage, cookies and IndexedDB in memory and carries them through the app
 * like any cross-origin game's (`static/game-storage-bridge.child.js`).
 *
 * The frame loads a small loader from a `data:` URL. It asks the app for the game's
 * document (`attachShellDocuments`) and for its saves, then writes the game into itself
 * with the saves inlined ahead of the bridge: a sandboxed document cannot read the saves
 * the app preloaded, and a game reads them as it boots, before any message could bring
 * them. Every boot asks again, a reload included. Why a `data:` URL: a sandboxed document
 * may not load the app's `blob:` URLs, not even to reload itself (games do, from a restart
 * button; so does the bridge, for saves that arrive late), and an `srcdoc` document is
 * never in quirks mode, which half the Drive U 7 documents (no doctype) lay out for.
 *
 * The page's play URL for a shell is a `blob:` URL that only names it
 * (`shellFrameSrcFor` gives the frame its source). One is made per game and source for the
 * whole visit to the game page, so a play-URL refresh never restarts a running game
 * (`releaseOnlineShells` when the visit ends).
 */

import { base } from '$app/paths';
import { mayTouchGameSaves } from './game-storage-bridge';

/**
 * The sandbox of a frame holding an app-made shell: everything a game needs, nothing that
 * gives it the app's origin (`allow-same-origin`) or lets it navigate the app away
 * (`allow-top-navigation`). Fullscreen, gamepads and autoplay come from `allow` as usual.
 */
export const SHELL_FRAME_SANDBOX = [
	'allow-scripts',
	'allow-forms',
	'allow-pointer-lock',
	'allow-popups',
	'allow-popups-to-escape-sandbox',
	'allow-modals',
	'allow-orientation-lock',
	'allow-presentation',
	'allow-downloads'
].join(' ');

/** How long the loader waits for the app to answer before starting the game without saves. */
const SAVES_WAIT_MS = 5000;

/** Where the loader writes the saves, ahead of the bridge. */
const PROFILE_SLOT = '<!--pt-shell-profile-->';

const STORAGE_MESSAGE_TYPE = 'potato-tomato-game-storage';
/** A loader asking for its game's document, and the app's answer. */
export const SHELL_MESSAGE_TYPE = 'potato-tomato-game-shell';

interface Shell {
	gameId: string;
	/** The game document the loader writes in. */
	html: string;
	/** What the frame loads: the loader, as a `data:` URL. */
	frameSrc: string;
}

/** Every URL this module made, for `frameSandboxFor` — kept even after one is revoked. */
const madeUrls = new Set<string>();
/** The shell each live play URL stands for. */
const shellByUrl = new Map<string, Shell>();
/** Per game: the play URL for each source (`local`, or `shell:<page URL>`), until the visit ends. */
const shellsByGame = new Map<string, Map<string, string>>();
const building = new Map<string, Promise<string | null>>();

function escapeAttr(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/** JSON that can sit inside a `<script>` element. */
function scriptJson(value: unknown): string {
	return JSON.stringify(value)
		.replace(/</g, '\\u003c')
		.replace(/\u2028/g, '\\u2028')
		.replace(/\u2029/g, '\\u2029');
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
 * The game document a shell writes: `<base href>` unless the page brings its own, the slot
 * the loader fills with the saves, then the bridge inline — all ahead of everything else in
 * `<head>`.
 *
 * A bridge tag the page already carries is dropped: it was written for the page's own URL
 * (`src="/game-storage-bridge.child.js"`), which under the shell's `<base>` resolves
 * against the game's host, and the inline bridge is the one that runs first anyway.
 */
export function buildShellHtml(
	html: string,
	options: { gameId: string; baseHref?: string; bridgeSource: string }
): string {
	const page = html.replace(EXISTING_BRIDGE_TAG, '');
	let tags = '';
	if (options.baseHref && !/<base\b[^>]*\bhref\s*=/i.test(page)) {
		tags += `<base href="${escapeAttr(options.baseHref)}">`;
	}
	const bridge = options.bridgeSource.replace(/<\/script/gi, '<\\/script');
	tags += `${PROFILE_SLOT}<script>window.__ptGameId=${scriptJson(options.gameId)};${bridge}</script>`;
	return insertFirstInHead(page, tags);
}

/*
 * Runs in the sandboxed frame. Asks the app (the top frame) for the game's document and
 * its saves; once it has the document and the saves — or has waited long enough for them —
 * writes the game in. It waits for its own `load` first, so the frame fires `load` exactly
 * twice: once for this, once for the game. ORIGIN is where the game's saves are filed: the
 * document's own origin is opaque ("null").
 */
const LOADER = `(function (GAME, ORIGIN, SHELL, TYPE, SHELL_TYPE, SLOT, WAIT) {
	var app = window.top;
	var loaded = document.readyState === 'complete';
	var html = null;
	var answered = false;
	var answer = null;
	var started = false;
	window.__ptShell = { gameId: GAME, origin: ORIGIN };
	function start() {
		if (started || !loaded || html === null || !answered) return;
		started = true;
		var shell = { gameId: GAME, origin: ORIGIN };
		if (answer) shell.profile = answer.data;
		var inline = '<' + 'script>window.__ptShell=' +
			JSON.stringify(shell).replace(/</g, '\\\\u003c') + ';<' + '/script>';
		var at = html.indexOf(SLOT);
		var page = at === -1 ? inline + html : html.slice(0, at) + inline + html.slice(at + SLOT.length);
		document.open();
		document.write(page);
		document.close();
	}
	window.addEventListener('message', function (e) {
		var d = e.data;
		if (e.source !== app || !d || d.gameId !== GAME) return;
		if (d.type === SHELL_TYPE && d.action === 'document' && d.shell === SHELL) {
			if (html === null && typeof d.html === 'string') html = d.html;
			start();
		} else if (d.type === TYPE && d.action === 'hydrate' && !answered) {
			answered = true;
			answer = { data: d.data || null };
			start();
		}
	});
	window.addEventListener('load', function () {
		setTimeout(function () {
			loaded = true;
			start();
		}, 0);
	});
	setTimeout(function () {
		answered = true;
		start();
	}, WAIT);
	var asks = 0;
	(function ask() {
		if (html !== null || asks++ > 30) return;
		try {
			app.postMessage({ type: SHELL_TYPE, action: 'document', gameId: GAME, shell: SHELL }, '*');
		} catch (e) {}
		setTimeout(ask, 1000);
	})();
	try {
		app.postMessage({ type: TYPE, action: 'pull', gameId: GAME }, '*');
	} catch (e) {}
})`;

/**
 * The loader's document for the shell `shellUrl` of `gameId`. `origin` is where the bridge
 * files the game's saves (the game's own host, or the app's).
 */
export function buildShellLoader(gameId: string, shellUrl: string, origin = ''): string {
	const args = [
		gameId,
		origin,
		shellUrl,
		STORAGE_MESSAGE_TYPE,
		SHELL_MESSAGE_TYPE,
		PROFILE_SLOT,
		SAVES_WAIT_MS
	]
		.map(scriptJson)
		.join(',');
	return `<!doctype html><html><head><meta charset="utf-8"><script>${LOADER}(${args});</script></head><body></body></html>`;
}

let documentsAttached = false;

/**
 * Answer loaders asking for their game's document — only a frame this page hosts that game
 * in (`game-storage-bridge.ts` decides that, as for its saves).
 */
function attachShellDocuments(): void {
	if (documentsAttached || typeof window === 'undefined') return;
	documentsAttached = true;
	window.addEventListener('message', (event: MessageEvent) => {
		const msg = event.data as { type?: string; action?: string; gameId?: unknown; shell?: unknown };
		if (!msg || msg.type !== SHELL_MESSAGE_TYPE || msg.action !== 'document') return;
		if (typeof msg.gameId !== 'string' || typeof msg.shell !== 'string') return;
		const shell = shellByUrl.get(msg.shell);
		if (!shell || shell.gameId !== msg.gameId) return;
		if (!mayTouchGameSaves(event.source, msg.gameId, 'pull')) return;
		(event.source as Window).postMessage(
			{
				type: SHELL_MESSAGE_TYPE,
				action: 'document',
				gameId: msg.gameId,
				shell: msg.shell,
				html: shell.html
			},
			'*'
		);
	});
}

let bridgeSource: Promise<string> | null = null;

/** The bridge's source, fetched once: shells carry it inline (the sandbox has no app origin). */
function loadBridgeSource(): Promise<string> {
	if (!bridgeSource) {
		const url = `${base}/game-storage-bridge.child.js`.replace(/\/{2,}/g, '/');
		bridgeSource = fetch(url)
			.then((res) => {
				if (!res.ok) throw new Error(`bridge: HTTP ${res.status}`);
				return res.text();
			})
			.catch((error: unknown) => {
				bridgeSource = null;
				throw error;
			});
	}
	return bridgeSource;
}

/**
 * The shell for `key` of this game: the one already made this visit, else a new one.
 * Concurrent requests share one build. A shell is never replaced or revoked while the
 * visit lasts: a new URL for the same game would restart it, and a revoked one would
 * leave the frame with no document.
 */
function shellFor(
	gameId: string,
	key: string,
	build: () => Promise<{ html: string; origin: string } | null>
): Promise<string | null> {
	const made = shellsByGame.get(gameId)?.get(key);
	if (made) return Promise.resolve(made);
	const buildKey = `${gameId}\n${key}`;
	const pending = building.get(buildKey);
	if (pending) return pending;
	const task = build()
		.then((built) => {
			if (!built) return null;
			attachShellDocuments();
			/* An empty blob: the URL only names the shell. */
			const url = URL.createObjectURL(new Blob([], { type: 'text/html' }));
			const loader = buildShellLoader(gameId, url, built.origin);
			madeUrls.add(url);
			shellByUrl.set(url, {
				gameId,
				html: built.html,
				frameSrc: `data:text/html;charset=utf-8,${encodeURIComponent(loader)}`
			});
			let forGame = shellsByGame.get(gameId);
			if (!forGame) shellsByGame.set(gameId, (forGame = new Map()));
			forGame.set(key, url);
			return url;
		})
		.catch(() => null)
		.finally(() => building.delete(buildKey));
	building.set(buildKey, task);
	return task;
}

function originOf(url: string | undefined): string {
	try {
		return url ? new URL(url).origin : window.location.origin;
	} catch {
		return '';
	}
}

async function shellDocument(
	gameId: string,
	html: string,
	baseHref?: string
): Promise<{ html: string; origin: string } | null> {
	if (!looksLikeHtml(html) || html.includes('data-sveltekit')) return null;
	const bridge = await loadBridgeSource();
	return {
		html: buildShellHtml(html, { gameId, baseHref, bridgeSource: bridge }),
		origin: originOf(baseHref)
	};
}

/** True for a play URL this module made (a `local` or `shell` route). */
export function isShellBlobUrl(url: string | null | undefined): boolean {
	return Boolean(url) && madeUrls.has((url as string).trim());
}

/** What a frame showing the shell `url` loads, while the visit lasts: its loader. */
export function shellFrameSrcFor(url: string | null | undefined): string | undefined {
	return url ? shellByUrl.get(url.trim())?.frameSrc : undefined;
}

/** The game document the shell `url` writes in, while the visit lasts. */
export function shellDocumentFor(url: string | null | undefined): string | undefined {
	return url ? shellByUrl.get(url.trim())?.html : undefined;
}

/** The `sandbox` a frame showing `url` needs; `undefined` when it is not an app-made shell. */
export function frameSandboxFor(url: string | null | undefined): string | undefined {
	return isShellBlobUrl(url) ? SHELL_FRAME_SANDBOX : undefined;
}

/**
 * How many `load` events one start of `url` fires: a shell's loader loads, then the game
 * it writes in does. The cover stays up until the second.
 */
export function frameLoadsPerStart(url: string | null | undefined): number {
	return isShellBlobUrl(url) ? 2 : 1;
}

/** The visit to the game page is over: its shells go (all games' when `gameId` is absent). */
export function releaseOnlineShells(gameId?: string): void {
	const games = gameId === undefined ? [...shellsByGame.keys()] : [gameId];
	for (const id of games) {
		const forGame = shellsByGame.get(id);
		if (!forGame) continue;
		shellsByGame.delete(id);
		for (const url of forGame.values()) {
			shellByUrl.delete(url);
			URL.revokeObjectURL(url);
		}
	}
}

/** Play the catalog's own `online/embed.html` (Drive U 7). */
export function createLocalEmbedShell(gameId: string, baseHref?: string): Promise<string | null> {
	return shellFor(gameId, 'local', async () => {
		const url = `${base}/games/${encodeURIComponent(gameId)}/online/embed.html`.replace(
			/\/{2,}/g,
			'/'
		);
		const res = await fetch(url);
		if (!res.ok) return null;
		return shellDocument(gameId, await res.text(), baseHref);
	});
}

/** Play HTML that its host labels `text/plain`, from a document with the right type. */
export function createRemoteShell(gameId: string, pageUrl: string): Promise<string | null> {
	return shellFor(gameId, `shell:${pageUrl}`, async () => {
		const res = await fetch(pageUrl, { credentials: 'omit', redirect: 'follow' });
		if (!res.ok) return null;
		return shellDocument(gameId, await res.text(), res.url || pageUrl);
	});
}
