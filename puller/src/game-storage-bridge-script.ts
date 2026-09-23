import { GAME_STORAGE_BRIDGE_SOURCE } from './embedded/assets.generated.js';

let cachedBridge: string | null = null;

function loadBridgeSource(): string {
	if (cachedBridge) return cachedBridge;
	cachedBridge = GAME_STORAGE_BRIDGE_SOURCE;
	return cachedBridge;
}

/**
 * Inline the shared child bridge (no external script URL on cross-origin puller loads).
 * The catalog id rides along so the bridge still knows its game on URLs it cannot parse.
 */
export function buildInlineGameStorageBridgeScript(gameId = ''): string {
	/* `</` must not appear inside an inline script, or the HTML parser ends it early. */
	const source = loadBridgeSource().replace(/<\/(script)/gi, '<\\/$1');
	const idLine = gameId
		? `window.__ptGameId=${JSON.stringify(gameId).replace(/</g, '\\u003c')};`
		: '';
	return `<script>${idLine}${source}</script>`;
}

/**
 * Put the bridge first in <head>.
 *
 * It replaces the game's localStorage, sessionStorage and cookies with per-game virtual
 * stores, so it has to run before any game script reads them. Appending it before
 * `</head>` (as this used to) let every head script boot against the real, shared store.
 */
export function injectGameStorageBridge(
	html: string,
	gameId: string,
	childScriptSrc?: string
): string {
	const tag = childScriptSrc
		? `<script src="${childScriptSrc}" data-pt-game="${gameId.replace(/["<>&]/g, '')}"></script>`
		: buildInlineGameStorageBridgeScript(gameId);

	if (/<head[\s>]/i.test(html)) {
		return html.replace(/<head([^>]*)>/i, (m) => m + tag);
	}
	if (/<body[\s>]/i.test(html)) {
		return html.replace(/<body([^>]*)>/i, (m) => m + tag);
	}
	return tag + html;
}
