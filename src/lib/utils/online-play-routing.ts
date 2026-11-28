/**
 * How an online launch reaches the game, and what it falls back to when that fails.
 *
 * Every platform starts the same way the public site always has: the game's own URL in a
 * plain iframe. The desktop webview injects the in-frame
 * bridge into the game's frames itself (`native-game-frames.ts`), so no relay is needed
 * for ordinary games.
 *
 * What remains are games that a plain iframe cannot show, each with its own fix:
 *
 * | Games                                  | Why direct fails                       | Route   |
 * | -------------------------------------- | -------------------------------------- | ------- |
 * | Drive U 7 (catalog `localEmbed`)       | Sites refuses framing; jsDelivr serves | `local` |
 * |                                        | HTML as `text/plain`                   |         |
 * | Other HTML on a `text/plain` host      | wrong content type                     | `shell` |
 * | Cross-origin HTML, web and Android     | no bridge inside, so no touch controls | `shell` |
 * |                                        | (hosts that allow CORS reads), then    | direct  |
 * | Flash `.swf` on prod.addictinggames    | `X-Frame-Options`, no CORS for Ruffle  | `relay` |
 * | Anything whose direct frame stays dead | (seen by the launch watchdog)          | next    |
 *
 * `local` and `shell` build an app-made document (a blob with `<base href>` back at the
 * origin and the bridge first in `<head>`), played in a sandbox so the third-party HTML
 * never runs with the app's origin; that works on every platform with no server. The
 * desktop app plays `local` through its relay instead, and tries the relay before a shell,
 * so a game there keeps an origin of its own with real storage.
 * `relay` is the desktop app's in-process relay (`src-tauri/src/relay.rs`). When the chain runs out, the page offers the system browser.
 *
 * The chain itself is pure so it can be tested without a network.
 */

export type PlayRouteKind = 'direct' | 'local' | 'shell' | 'relay';

/** Serve `.html` as `text/plain`, so a frame shows the source instead of the game. */
const TEXT_PLAIN_HTML_HOSTS = ['cdn.jsdelivr.net'];

/**
 * Hosts that refuse to be framed by anyone, so a direct launch is a guaranteed blank frame
 * (which still fires `load`, so no timeout can see it). Checked against a catalog embed each
 * on 2026-09-23:
 *
 *   prod.addictinggames.com  x-frame-options: SAMEORIGIN, frame-ancestors 'self'
 *
 * `sites.google.com` (DENY) is not listed because every catalog entry on it ships the game
 * document as `online/embed.html`, which is what plays. `www.coolmathgames.com` used to send
 * SAMEORIGIN; the `public_games/` URLs the catalog uses no longer do.
 */
const FRAME_BLOCKED_HOSTS = ['prod.addictinggames.com'];

/**
 * Hosts whose game HTML a page on another origin cannot read (no
 * `Access-Control-Allow-Origin` on the entry document), checked 2026-11-28. Without a
 * relay, nothing can put the bridge inside their frames, so the web and Android play them
 * direct, with no touch controls. Every other host is tried as a shell first there:
 * Unity Play, Yandex game storage, addictinggames' cdn2 and GameDistribution all answer
 * `*`; a host that does not costs one failed fetch before the direct frame.
 */
const CORS_CLOSED_HTML_HOSTS = [
	'games.crazygames.com',
	'www.coolmathgames.com',
	'fnf-games.io',
	'www.playgeography.com',
	'foony.com',
	'www.modd.io'
];

function hostOf(url: string | null | undefined): string {
	const raw = url?.trim();
	if (!raw) return '';
	try {
		return new URL(raw).hostname.toLowerCase();
	} catch {
		return '';
	}
}

function hostMatches(host: string, list: readonly string[]): boolean {
	return Boolean(host) && list.some((h) => host === h || host.endsWith(`.${h}`));
}

/** True when `url`'s host is known to send X-Frame-Options / restrictive frame-ancestors. */
export function isFrameBlockedHost(url: string | null | undefined): boolean {
	return hostMatches(hostOf(url), FRAME_BLOCKED_HOSTS);
}

/** True for hosts known to refuse cross-origin reads of their game HTML. */
export function isCorsClosedHtmlHost(url: string | null | undefined): boolean {
	return hostMatches(hostOf(url), CORS_CLOSED_HTML_HOSTS);
}

/**
 * Hosts whose games cannot run from a shell even though their HTML can be read (checked
 * 2026-11-28 against the public site):
 * - play.unity.com: the build's `loader.js` on cdn.play.unity.com sends no CORS headers, so
 *   an opaque-origin document can never fetch it. On the web the direct route plays Unity
 *   games in the app's own player (same origin, real storage) anyway.
 * - html5.gamedistribution.com: the SDK locks the game to a domain, and a shell has none.
 */
const SHELL_INCOMPATIBLE_HOSTS = ['play.unity.com', 'html5.gamedistribution.com'];

export function isShellIncompatibleHost(url: string | null | undefined): boolean {
	return hostMatches(hostOf(url), SHELL_INCOMPATIBLE_HOSTS);
}

/** True for hosts that label HTML `text/plain` (a frame would show source text). */
export function isTextPlainHtmlHost(url: string | null | undefined): boolean {
	return hostMatches(hostOf(url), TEXT_PLAIN_HTML_HOSTS);
}

/** A Flash file: no browser plays one in a frame; only Ruffle can, given its bytes. */
export function isFlashUrl(url: string | null | undefined): boolean {
	const raw = url?.trim();
	if (!raw) return false;
	try {
		return new URL(raw).pathname.toLowerCase().endsWith('.swf');
	} catch {
		return false;
	}
}

/**
 * True when a direct launch is a guaranteed blank frame *and* this platform has no relay to
 * rescue it — the mobile builds. The desktop app has its in-process relay; the page offers
 * the system browser instead of a frame that cannot load.
 */
export function isUnframeableInApp(input: {
	localApp: boolean;
	desktopApp: boolean;
	frameBlockedHost: boolean;
}): boolean {
	return input.localApp && !input.desktopApp && input.frameBlockedHost;
}

export interface PlayRouteInput {
	/** The desktop app, which has the in-process relay. */
	desktopApp: boolean;
	/** The catalog's online URL (`onlineEmbedUrl`, else `remotePlayUrl`). */
	embedUrl: string | null;
	/** The catalog ships the playable document as `online/embed.html`. */
	localEmbed: boolean;
}

/**
 * Every way to play this game online, best first. Empty means nothing in the app can show
 * it (a Flash file on a platform without the relay) — offer the system browser.
 */
export function planOnlineRoutes(input: PlayRouteInput): PlayRouteKind[] {
	const embed = input.embedUrl?.trim() || null;
	const chain: PlayRouteKind[] = [];
	if (input.localEmbed) chain.push('local');
	if (!embed) {
		/* A catalog shell under /games/<id>/online/ — same origin, framed as it is. */
		if (!input.localEmbed) chain.push('direct');
	} else if (isFlashUrl(embed)) {
		/* Only the relay can hand Ruffle the bytes. */
	} else if (isTextPlainHtmlHost(embed)) {
		/*
		 * The relay gives the page an origin of its own, with real storage; a shell runs it
		 * sandboxed, with storage the bridge keeps in memory. Where both exist, relay first.
		 */
		if (input.desktopApp) chain.push('relay');
		chain.push('shell');
	} else if (!isFrameBlockedHost(embed) && hostOf(embed) !== 'sites.google.com') {
		/*
		 * Off the desktop (no native frame injection, no relay) the bridge reaches a
		 * cross-origin game only from inside a shell, and the bridge is what carries touch
		 * controls, saves and key remapping. Try one where the host lets the HTML be read;
		 * the direct frame stays the fallback.
		 */
		if (!input.desktopApp && !isCorsClosedHtmlHost(embed) && !isShellIncompatibleHost(embed))
			chain.push('shell');
		chain.push('direct');
	}
	if (input.desktopApp && embed && !chain.includes('relay')) chain.push('relay');
	return chain;
}

/** The first route of `plan` that has not already failed for this game. */
export function nextPlayRoute(
	plan: readonly PlayRouteKind[],
	failed: readonly PlayRouteKind[]
): PlayRouteKind | null {
	return plan.find((kind) => !failed.includes(kind)) ?? null;
}

/* ------------------------------------------------------------------------------------
 * Which routes failed for a game, this session
 * ---------------------------------------------------------------------------------- */

const FAILED_PREFIX = 'potato-tomato-play-route-failed:';

/*
 * Games whose shell failed for a reason that will not go away (the game needs its own
 * origin): kept across visits, so they start on the next route straight away. A short
 * list of ids, newest last.
 */
const SHELL_INCOMPATIBLE_KEY = 'potato-tomato-shell-incompatible';
const SHELL_INCOMPATIBLE_MAX = 500;

function shellIncompatibleGames(): string[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(SHELL_INCOMPATIBLE_KEY) ?? '[]');
		return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
	} catch {
		return [];
	}
}

/** This game cannot play from a shell, on this device, from now on. */
export function rememberShellIncompatible(gameId: string): void {
	if (typeof localStorage === 'undefined' || !gameId) return;
	const ids = shellIncompatibleGames().filter((id) => id !== gameId);
	ids.push(gameId);
	try {
		localStorage.setItem(
			SHELL_INCOMPATIBLE_KEY,
			JSON.stringify(ids.slice(-SHELL_INCOMPATIBLE_MAX))
		);
	} catch {
		/* private mode / quota */
	}
}

function readFailed(gameId: string): PlayRouteKind[] {
	const failed = readSessionFailed(gameId);
	if (gameId && !failed.includes('shell') && shellIncompatibleGames().includes(gameId)) {
		failed.push('shell');
	}
	return failed;
}

function readSessionFailed(gameId: string): PlayRouteKind[] {
	if (typeof sessionStorage === 'undefined' || !gameId) return [];
	try {
		const raw = sessionStorage.getItem(FAILED_PREFIX + gameId);
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed)
			? (parsed.filter((k) => typeof k === 'string') as PlayRouteKind[])
			: [];
	} catch {
		return [];
	}
}

/** Session-scoped: this route did not produce a running game frame. */
export function markPlayRouteFailed(gameId: string, kind: PlayRouteKind): void {
	if (typeof sessionStorage === 'undefined' || !gameId) return;
	const failed = readSessionFailed(gameId);
	if (failed.includes(kind)) return;
	try {
		sessionStorage.setItem(FAILED_PREFIX + gameId, JSON.stringify([...failed, kind]));
	} catch {
		/* private mode / quota */
	}
}

export function failedPlayRoutes(gameId: string): PlayRouteKind[] {
	return readFailed(gameId);
}

export function clearPlayRouteFailures(gameId: string): void {
	if (typeof sessionStorage === 'undefined' || !gameId) return;
	try {
		sessionStorage.removeItem(FAILED_PREFIX + gameId);
	} catch {
		/* private mode / quota */
	}
}

/** @deprecated The chain has more than one step now; use `markPlayRouteFailed`. */
export function markDirectLaunchFailed(gameId: string): void {
	markPlayRouteFailed(gameId, 'direct');
}

/** @deprecated Use `clearPlayRouteFailures`. */
export function clearDirectLaunchFailed(gameId: string): void {
	clearPlayRouteFailures(gameId);
}

/** @deprecated Use `failedPlayRoutes`. */
export function hasDirectLaunchFailed(gameId: string): boolean {
	return readFailed(gameId).includes('direct');
}
