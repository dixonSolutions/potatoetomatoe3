import { GAME_STORAGE_BRIDGE_SOURCE } from './embedded/assets.generated.js';

let cachedBridge: string | null = null;

function loadBridgeSource(): string {
	if (cachedBridge) return cachedBridge;
	cachedBridge = GAME_STORAGE_BRIDGE_SOURCE;
	return cachedBridge;
}

/** Inline the shared child bridge (no external script URL on cross-origin puller loads). */
export function buildInlineGameStorageBridgeScript(): string {
	const source = loadBridgeSource();
	return `<script>${source}</script>`;
}

export function injectGameStorageBridge(html: string, _gameId: string, childScriptSrc?: string): string {
	const tag = childScriptSrc
		? `<script src="${childScriptSrc}"></script>`
		: buildInlineGameStorageBridgeScript();

	if (html.includes('</head>')) {
		return html.replace('</head>', tag + '</head>');
	}
	if (html.includes('<body')) {
		return html.replace(/<body([^>]*)>/i, `<body$1>${tag}`);
	}
	return tag + html;
}
