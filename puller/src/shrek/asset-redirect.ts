/**
 * Patches fetch/XHR so Unity runtime requests to external CDN URLs
 * are routed to locally pulled copies under /assets/.
 */
export function buildAssetRedirectScript(routeMap: Record<string, string>): string {
	const mapJson = JSON.stringify(routeMap);
	return `<script>
(function(){
  var ROUTE_MAP = ${mapJson};
  function route(url){
    if (!url || typeof url !== 'string') return url;
    return ROUTE_MAP[url] || url;
  }
  var origFetch = window.fetch;
  window.fetch = function(input, init){
    if (typeof input === 'string') return origFetch(route(input), init);
    if (input instanceof Request) {
      var mapped = route(input.url);
      if (mapped !== input.url) return origFetch(mapped, init);
    }
    return origFetch(input, init);
  };
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url){
    return origOpen.apply(this, [method, route(url), ...Array.prototype.slice.call(arguments, 2)]);
  };
})();
</script>`;
}

/**
 * Install runtime asset routing in the browser (Tauri / dev app).
 */
export function installAssetRedirect(routeMap: Record<string, string>): void {
	if (typeof window === 'undefined' || Object.keys(routeMap).length === 0) return;
	if ((window as unknown as { __assetRedirectInstalled?: boolean }).__assetRedirectInstalled)
		return;

	const route = (url: string): string => routeMap[url] ?? url;

	const origFetch = window.fetch.bind(window);
	window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
		if (typeof input === 'string') return origFetch(route(input), init);
		if (input instanceof Request) {
			const mapped = route(input.url);
			if (mapped !== input.url) return origFetch(mapped, init);
		}
		return origFetch(input, init);
	};

	const origOpen = XMLHttpRequest.prototype.open;
	XMLHttpRequest.prototype.open = function (
		method: string,
		url: string | URL,
		async?: boolean,
		username?: string | null,
		password?: string | null
	) {
		const resolved = typeof url === 'string' ? route(url) : url;
		return origOpen.call(this, method, resolved, async ?? true, username, password);
	};

	(window as unknown as { __assetRedirectInstalled?: boolean }).__assetRedirectInstalled = true;
}

/**
 * Load asset-map.json from /game/ and install redirect patch.
 */
export async function loadAndInstallAssetRedirect(base = '/game'): Promise<void> {
	try {
		const response = await fetch(`${base}/asset-map.json`);
		if (!response.ok) return;
		const map = (await response.json()) as Record<string, string>;
		installAssetRedirect(map);
	} catch {
		// Offline play still works for bundled assets without external routes.
	}
}
