/**
 * How an online launch reaches the game, and what it falls back to when that fails.
 *
 * Every platform starts the same way the public site always has: the game's own URL in a
 * plain iframe. The desktop app used to send launches through the Node puller instead —
 * a relay that re-fetched and rewrote every asset of the game — which made launches slow
 * and the app hard to run. It no longer needs to: the desktop webview injects the in-frame
 * bridge into the game's frames itself (`native-game-frames.ts`), which is what the relay
 * existed for.
 *
 * What remains are games that a plain iframe cannot show, each with its own fix:
 *
 * | Games                                  | Why direct fails                       | Route   |
 * | -------------------------------------- | -------------------------------------- | ------- |
 * | Drive U 7 (catalog `localEmbed`)       | Sites refuses framing; jsDelivr serves | `local` |
 * |                                        | HTML as `text/plain`                   |         |
 * | Other HTML on a `text/plain` host      | wrong content type                     | `shell` |
 * | Flash `.swf` on prod.addictinggames    | `X-Frame-Options`, no CORS for Ruffle  | `relay` |
 * | Anything whose direct frame stays dead | (seen by the launch watchdog)          | next    |
 *
 * `local` and `shell` build an app-made document (a blob with `<base href>` back at the
 * origin and the bridge first in `<head>`), played in a sandbox so the third-party HTML
 * never runs with the app's origin; that works on every platform with no server. The
 * desktop app plays `local` through its relay instead, and tries the relay before a shell,
 * so a game there keeps an origin of its own with real storage.
 * `relay` is the desktop app's in-process relay (`src-tauri/src/relay.rs`). `puller` is the
 * legacy Node relay, used only if one happens to be running already — the app never starts
 * it to play a game. When the chain runs out, the page offers the system browser.
 *
 * The chain itself is pure so it can be tested without a network.
 */

export type PlayRouteKind = 'direct' | 'local' | 'shell' | 'relay' | 'puller';

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
 *
 * `pullerSupported` is what the page passes for "desktop app" (it predates the in-process
 * relay); the name is kept so the call site does not change.
 */
export function isUnframeableInApp(input: {
	localApp: boolean;
	pullerSupported: boolean;
	frameBlockedHost: boolean;
}): boolean {
	return input.localApp && !input.pullerSupported && input.frameBlockedHost;
}

export interface PlayRouteInput {
	/** The desktop app, which has the in-process relay. */
	desktopApp: boolean;
	/** A puller already answers on this machine. It is never started for play. */
	pullerRunning: boolean;
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
		chain.push('direct');
	}
	if (input.desktopApp && embed && !chain.includes('relay')) chain.push('relay');
	if (input.pullerRunning) chain.push('puller');
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

function readFailed(gameId: string): PlayRouteKind[] {
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
	const failed = readFailed(gameId);
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
