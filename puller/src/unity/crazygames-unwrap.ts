/**
 * CrazyGames portal shells are NOT Unity documents. They load a gameframe that
 * brings its own SDK + nested Unity. Do not unwrap into a synthetic UnityLoader
 * host for online play — that drops CrazySDK and breaks the game. Proxy the
 * shell via game-live instead.
 */

export type CrazyGamesUnityBuild = {
	moduleJsonUrl: string;
	unityLoaderUrl: string;
};

export function extractCrazyGamesUnityBuild(html: string): CrazyGamesUnityBuild | null {
	const mod = html.match(/"moduleJsonUrl"\s*:\s*"(https?:\/\/[^"]+)"/i);
	const loader = html.match(/"unityLoaderUrl"\s*:\s*"(https?:\/\/[^"]+)"/i);
	if (!mod?.[1] || !loader?.[1]) return null;
	return { moduleJsonUrl: mod[1], unityLoaderUrl: loader[1] };
}

/** True when HTML is a CrazyGames gameframe shell (not a raw Unity WebGL page). */
export function isCrazyGamesShellHtml(html: string): boolean {
	if (extractCrazyGamesUnityBuild(html)) return true;
	return /Crazygames\.load\s*\(|useLocalGF\s*=|gfBuildPath\s*=/i.test(html);
}
