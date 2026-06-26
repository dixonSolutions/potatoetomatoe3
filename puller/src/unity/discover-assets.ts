/**
 * Unity WebGL asset discovery — parse HTML, Build/*.json manifests, and loader/framework JS bundles.
 * Handles legacy UnityLoader, modern createUnityInstance, split Brotli parts, and Poki master-loader shells.
 */

export const UNITY_ASSET_EXT =
	/(?:\.(?:unityweb|wasm|data|js|json|css|png|jpe?g|gif|webp|svg|ico|br|mp3|ogg|wav|woff2?|ttf|eot))(?:[?#]|$)/i;

const MANIFEST_KEYS = [
	'dataUrl',
	'wasmCodeUrl',
	'wasmFrameworkUrl',
	'codeUrl',
	'frameworkUrl',
	'symbolsUrl',
	'streamingAssetsUrl',
	'loaderUrl'
] as const;

/** Collect generic quoted / linked asset refs from HTML, CSS, or JS text. */
export function collectGenericAssetRefs(
	text: string,
	baseUrl: string,
	queue: Set<string>,
	seen: Set<string>
): void {
	const patterns = [
		/(?:href|src)=["']([^"']+)["']/gi,
		/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi,
		/UnityLoader\.instantiate\s*\(\s*[^,]+,\s*["']([^"']+)["']/gi,
		/"(?:dataUrl|wasmCodeUrl|wasmFrameworkUrl|codeUrl|frameworkUrl|symbolsUrl|streamingAssetsUrl|loaderUrl)"\s*:\s*"([^"]+)"/gi,
		/['"]([^'"]+\.(?:unityweb|wasm|data|js|json|css|png|jpe?g|gif|webp|svg|ico|br|mp3|ogg|wav|woff2?|ttf|eot)(?:\?[^'"]*)?)['"]/gi
	];

	for (const pattern of patterns) {
		pattern.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = pattern.exec(text)) !== null) {
			addResolvedUrl(m[1]?.trim(), baseUrl, queue, seen);
		}
	}
}

function addResolvedUrl(
	ref: string | undefined,
	baseUrl: string,
	queue: Set<string>,
	seen: Set<string>
): void {
	if (!ref || ref.startsWith('data:') || ref.startsWith('blob:') || ref.startsWith('#')) return;
	try {
		const abs = new URL(ref, baseUrl).href;
		if (!UNITY_ASSET_EXT.test(abs)) return;
		if (seen.has(abs)) return;
		queue.add(abs);
	} catch {
		// skip invalid URL
	}
}

/** Parse inline createUnityInstance(canvas, { ... }, ...) config object. */
export function parseCreateUnityInstanceConfig(text: string): Record<string, string> {
	const out: Record<string, string> = {};
	const blockMatch = text.match(/createUnityInstance\s*\(\s*[^,]+,\s*(\{[\s\S]*?\})\s*,/);
	if (!blockMatch?.[1]) return out;

	const block = blockMatch[1];
	for (const key of MANIFEST_KEYS) {
		const re = new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`, 'i');
		const m = block.match(re);
		if (m?.[1]) out[key] = m[1];
	}
	return out;
}

/** Expand Unity Build/*.json manifest into absolute asset URLs. */
export function expandBuildManifest(
	manifest: Record<string, unknown>,
	manifestUrl: string
): string[] {
	const urls: string[] = [];
	for (const key of MANIFEST_KEYS) {
		const val = manifest[key];
		if (typeof val === 'string' && val.trim()) {
			try {
				urls.push(new URL(val, manifestUrl).href);
			} catch {
				// skip
			}
		}
	}
	return urls;
}

/** Find UnityLoader.instantiate build JSON path. */
export function findUnityLoaderBuildJson(text: string): string | null {
	const match = text.match(/UnityLoader\.instantiate\s*\(\s*[^,]+,\s*["']([^"']+)["']/i);
	return match?.[1] ?? null;
}

/**
 * Scan minified Unity loader/framework JS for build file paths.
 * Unity bundles embed string literals like "Build/foo.data.unityweb" even when obfuscated.
 */
export function scanUnityLoaderBundle(text: string, baseUrl: string): string[] {
	const urls = new Set<string>();

	const patterns = [
		/Build\/[A-Za-z0-9_.-]+\.(?:loader|framework|data|wasm|symbols)\.(?:js|unityweb|br(?:\.part\d+)?)/gi,
		/[A-Za-z0-9_.-]+\.(?:data|wasm)\.br(?:\.part\d+)?/gi,
		/(?:dataUrl|frameworkUrl|codeUrl|loaderUrl|wasmCodeUrl|wasmFrameworkUrl)["']?\s*[:=]\s*["']([^"']+)["']/gi
	];

	for (const pattern of patterns) {
		pattern.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = pattern.exec(text)) !== null) {
			const ref = m[1] ?? m[0];
			addResolvedUrl(ref, baseUrl, urls, new Set());
		}
	}

	return [...urls];
}

/** Poki / abinbins master-loader shells reference site-root Unity scripts. */
export function discoverPokiRootAssets(text: string, iframeOrigin: string): string[] {
	if (!/master-loader\.js|poki-sdk|unityWebglLoaderUrl|UnityLoader/i.test(text)) {
		return [];
	}

	const root = `${iframeOrigin.replace(/\/$/, '')}/`;
	const candidates = [
		'master-loader.js',
		'poki-sdk.js',
		'unity.js',
		'unity-2020.js',
		'UnityLoader.js',
		'UnityLoader.2019.2.js',
		'UnityLoader.2020.3.js'
	];

	return candidates.map((f) => root + f);
}

export function isUnityShell(text: string): boolean {
	return /UnityLoader|createUnityInstance|master-loader\.js|unityWebglLoaderUrl|Build\/.*\.json/i.test(
		text
	);
}

/** Expand split Brotli part URLs from a base like .../Product.data.br */
export function buildSplitPartUrls(basePartUrl: string, partCount: number): string[] {
	const urls: string[] = [];
	for (let i = 0; i < partCount; i++) {
		urls.push(`${basePartUrl}.part${i}`);
	}
	return urls;
}

/** Parse DATA_PARTS / WASM_PARTS from Google Sites-style wrappers. */
export function parseSplitPartCounts(text: string): { dataParts: number; wasmParts: number } {
	const dataMatch = text.match(/var\s+DATA_PARTS\s*=\s*(\d+)/);
	const wasmMatch = text.match(/var\s+WASM_PARTS\s*=\s*(\d+)/);
	return {
		dataParts: dataMatch ? Number.parseInt(dataMatch[1], 10) : 0,
		wasmParts: wasmMatch ? Number.parseInt(wasmMatch[1], 10) : 0
	};
}

/** Infer product build prefix from discovered Build paths (e.g. Shrek2, adofaiii4). */
export function inferBuildProductName(text: string): string | null {
	const m = text.match(/Build\/([A-Za-z0-9_.-]+)\.(?:loader|framework|data|wasm)/i);
	return m?.[1] ?? null;
}

/**
 * Unity-focused discovery pass on text content — adds URLs to queue.
 */
export function discoverUnityAssetRefs(
	text: string,
	baseUrl: string,
	queue: Set<string>,
	seen: Set<string>
): void {
	collectGenericAssetRefs(text, baseUrl, queue, seen);

	const inlineConfig = parseCreateUnityInstanceConfig(text);
	for (const val of Object.values(inlineConfig)) {
		addResolvedUrl(val, baseUrl, queue, seen);
	}

	for (const url of scanUnityLoaderBundle(text, baseUrl)) {
		addResolvedUrl(url, baseUrl, queue, seen);
	}

	const buildJson = findUnityLoaderBuildJson(text);
	if (buildJson) {
		addResolvedUrl(buildJson, baseUrl, queue, seen);
	}

	try {
		const origin = new URL(baseUrl).origin;
		for (const url of discoverPokiRootAssets(text, origin)) {
			addResolvedUrl(url, baseUrl, queue, seen);
		}
	} catch {
		// ignore
	}

	const { dataParts, wasmParts } = parseSplitPartCounts(text);
	const product = inferBuildProductName(text);
	if (product && dataParts > 0) {
		const dataBase = new URL(`Build/${product}.data.br`, baseUrl).href;
		for (const u of buildSplitPartUrls(dataBase, dataParts)) {
			addResolvedUrl(u, baseUrl, queue, seen);
		}
	}
	if (product && wasmParts > 0) {
		const wasmBase = new URL(`Build/${product}.wasm.br`, baseUrl).href;
		for (const u of buildSplitPartUrls(wasmBase, wasmParts)) {
			addResolvedUrl(u, baseUrl, queue, seen);
		}
	}
}
