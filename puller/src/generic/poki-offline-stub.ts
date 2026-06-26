/** Minimal PokiSDK stub for offline OpenFL / HTML5 builds (no ads, no remote core loader). */
export function buildPokiOfflineStubScript(): string {
	return `(function(){
  var resolved = function(v){ return Promise.resolve(v); };
  var noop = function(){};
  window.PokiSDK = {
    init: function(){ return resolved(); },
    gameLoadingStart: noop,
    gameLoadingProgress: noop,
    gameLoadingFinished: noop,
    gameplayStart: noop,
    gameplayStop: noop,
    happyTime: noop,
    commercialBreak: function(){ return resolved(); },
    rewardedBreak: function(){ return resolved(false); },
    isAdBlocked: function(){ return false; }
  };
})();`;
}

export function indexHtmlReferencesPokiSdk(html: string): boolean {
	return /poki-sdk/i.test(html);
}

/** Point script tags at a local offline stub beside index.html. */
export function patchPokiSdkScriptTags(html: string): string {
	return html.replace(
		/<script\b[^>]*\bsrc=["'][^"']*poki-sdk[^"']*["'][^>]*>\s*<\/script>/gi,
		'<script src="poki-sdk.js"></script>'
	);
}
