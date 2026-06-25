import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BRIDGE_PATH = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../static/game-storage-bridge.child.js'
);

let cachedBridge: string | null = null;

function loadBridgeSource(): string {
	if (cachedBridge) return cachedBridge;
	cachedBridge = readFileSync(BRIDGE_PATH, 'utf-8');
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
