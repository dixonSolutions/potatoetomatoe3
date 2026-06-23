/** Inline bootstrap for cross-origin puller iframes (direct 127.0.0.1:18787 loads). */
export function buildInlineGameStorageBridgeScript(gameId: string): string {
	const safeId = JSON.stringify(gameId);
	return `<script>(function(){var GAME_ID=${safeId};var TYPE='potato-tomato-game-storage';function snap(){var d={},i,k;try{for(i=0;i<localStorage.length;i++){k=localStorage.key(i);if(k)d[k]=localStorage.getItem(k);}}catch(e){}return d;}function push(){if(window.parent===window)return;window.parent.postMessage({type:TYPE,action:'push',gameId:GAME_ID,data:{localStorage:snap()}},'*');}window.addEventListener('message',function(e){var m=e.data;if(!m||m.type!==TYPE||m.gameId!==GAME_ID||m.action!=='hydrate'||!m.data||!m.data.localStorage)return;var ls=m.data.localStorage,k;for(k in ls){if(Object.prototype.hasOwnProperty.call(ls,k)){try{localStorage.setItem(k,ls[k]);}catch(err){}}}});if(window.parent!==window){window.parent.postMessage({type:TYPE,action:'pull',gameId:GAME_ID},'*');setInterval(push,4000);window.addEventListener('pagehide',push);}})();</script>`;
}

export function injectGameStorageBridge(html: string, gameId: string, childScriptSrc?: string): string {
	const tag = childScriptSrc
		? `<script src="${childScriptSrc}" defer></script>`
		: buildInlineGameStorageBridgeScript(gameId);

	if (html.includes('</head>')) {
		return html.replace('</head>', `${tag}</head>`);
	}
	if (html.includes('<body')) {
		return html.replace(/<body([^>]*)>/i, `<body$1>${tag}`);
	}
	return tag + html;
}
