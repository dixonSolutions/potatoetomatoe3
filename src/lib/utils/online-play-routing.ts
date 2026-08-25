/**
 * Decides whether an *online* launch goes straight to the game's own URL (what the
 * public web build does, and what works) or through the local puller relay.
 *
 * Background: the desktop app used to force every catalog game that had an
 * `onlineEmbedUrl` through `/api/game-live/:id`. That relay re-fetches and rewrites
 * every asset in Node, so the same games that load instantly in a browser stalled,
 * froze, or never started in the app. The relay is only genuinely required when we
 * must run code *inside* a cross-origin game document — i.e. the touch console.
 *
 * Everything here is pure so the policy can be unit tested without a puller.
 */

export type OnlineRelayReason =
	| 'public-site'
	| 'no-puller-platform'
	| 'same-origin'
	| 'frame-blocked-host'
	| 'console-needs-bridge'
	| 'direct-launch-failed'
	| 'unity-embed'
	| 'direct';

/**
 * Hosts that refuse to be framed by anyone, so a direct launch renders a blank frame.
 * Verified with response headers against a real catalog embed for each host:
 *
 *   www.coolmathgames.com    x-frame-options: SAMEORIGIN
 *   prod.addictinggames.com  x-frame-options: SAMEORIGIN + frame-ancestors 'self'
 *   sites.google.com         x-frame-options: DENY
 *
 * These are the only catalog hosts that need the relay unconditionally — the big ones
 * (games.crazygames.com, play.unity.com, cdn2.addictinggames.com, cdn.jsdelivr.net)
 * send no framing restrictions and play fine on their own URL.
 *
 * A frame refusal still fires the iframe `load` event, so the launch watchdog cannot
 * detect it; this list is what keeps those games working.
 */
const FRAME_BLOCKED_HOSTS = ['coolmathgames.com', 'prod.addictinggames.com', 'sites.google.com'];

/** True when `url`'s host is known to send X-Frame-Options / restrictive frame-ancestors. */
export function isFrameBlockedHost(url: string | null | undefined): boolean {
	const raw = url?.trim();
	if (!raw) return false;
	let host: string;
	try {
		host = new URL(raw).hostname.toLowerCase();
	} catch {
		return false;
	}
	return FRAME_BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

/**
 * True when a direct launch is a guaranteed blank frame *and* no relay exists to rescue
 * it — i.e. the Tauri mobile builds, which ship no puller sidecar.
 *
 * `decideOnlineRelay` short-circuits on `!pullerSupported` before it ever reaches the
 * `frameBlockedHost` branch, which is correct (there is no relay to route to) but left
 * Android rendering a dead iframe for every `sites.google.com` / CoolMath /
 * addictinggames title. Verified on a Galaxy Tab Active3: the frame navigates to
 * `chrome-error://chromewebdata/` after the host refuses with
 * `frame-ancestors https://google-admin.corp.google.com/`.
 *
 * The UI uses this to offer the system browser instead of a frame that cannot load.
 */
export function isUnframeableInApp(input: {
	localApp: boolean;
	pullerSupported: boolean;
	frameBlockedHost: boolean;
}): boolean {
	return input.localApp && !input.pullerSupported && input.frameBlockedHost;
}

export interface OnlineRelayInput {
	/** Desktop/mobile app build rather than the hosted public site. */
	localApp: boolean;
	/** The puller sidecar can run on this platform (false for Tauri mobile builds). */
	pullerSupported: boolean;
	/** The user has the touch console switched on for this game. */
	consoleWanted: boolean;
	/** Online play resolves to a different origin than the app shell. */
	externalEmbed: boolean;
	/** A previous direct launch of this game did not produce a loaded frame. */
	directLaunchFailed: boolean;
	/** Catalog `engine` field. */
	engine?: string | null;
	/** Online play resolves to a host that refuses framing (see `isFrameBlockedHost`). */
	frameBlockedHost?: boolean;
}

export interface OnlineRelayDecision {
	/** Route through the puller relay. */
	relay: boolean;
	/**
	 * Relay is worth having but not worth waiting for — launch direct rather than
	 * blocking when the puller is not already healthy.
	 */
	relayOptional: boolean;
	reason: OnlineRelayReason;
}

const DIRECT = (reason: OnlineRelayReason): OnlineRelayDecision => ({
	relay: false,
	relayOptional: false,
	reason
});

/**
 * Relay policy for a single online launch.
 *
 * `relayOptional` distinguishes "the relay improves this game" (Unity ad/framework
 * patching) from "the relay is the only thing that can work" (touch console into a
 * cross-origin document). Callers must never block a launch on an optional relay.
 */
export function decideOnlineRelay(input: OnlineRelayInput): OnlineRelayDecision {
	/* The public site has no local puller; it launches direct and that path works. */
	if (!input.localApp) return DIRECT('public-site');
	/* Tauri mobile ships no sidecar — behave exactly like the web build. */
	if (!input.pullerSupported) return DIRECT('no-puller-platform');
	/* Same-origin catalog shells are already injectable; a relay adds only latency. */
	if (!input.externalEmbed) return DIRECT('same-origin');

	/*
	 * The host refuses framing outright, so a direct launch is a guaranteed blank frame.
	 * Nothing but the relay can play these.
	 */
	if (input.frameBlockedHost) {
		return { relay: true, relayOptional: false, reason: 'frame-blocked-host' };
	}

	/* Only a proxy can put our input bridge inside a third-party game document. */
	if (input.consoleWanted) {
		return { relay: true, relayOptional: false, reason: 'console-needs-bridge' };
	}

	/* The frame watchdog saw this game fail to load direct — the relay is the retry. */
	if (input.directLaunchFailed) {
		return { relay: true, relayOptional: false, reason: 'direct-launch-failed' };
	}

	/*
	 * Unity embeds benefit from the proxy host (ad stubs + framework path patches),
	 * but a cold puller must not add a multi-second stall to every Unity launch.
	 */
	if ((input.engine ?? '').toLowerCase() === 'unity') {
		return { relay: true, relayOptional: true, reason: 'unity-embed' };
	}

	return DIRECT('direct');
}

const DIRECT_FAILED_PREFIX = 'potato-tomato-direct-launch-failed:';

/** Session-scoped: a direct online launch of this game produced no loaded frame. */
export function markDirectLaunchFailed(gameId: string): void {
	if (typeof sessionStorage === 'undefined' || !gameId) return;
	try {
		sessionStorage.setItem(DIRECT_FAILED_PREFIX + gameId, '1');
	} catch {
		/* private mode / quota */
	}
}

export function clearDirectLaunchFailed(gameId: string): void {
	if (typeof sessionStorage === 'undefined' || !gameId) return;
	try {
		sessionStorage.removeItem(DIRECT_FAILED_PREFIX + gameId);
	} catch {
		/* private mode / quota */
	}
}

export function hasDirectLaunchFailed(gameId: string): boolean {
	if (typeof sessionStorage === 'undefined' || !gameId) return false;
	try {
		return sessionStorage.getItem(DIRECT_FAILED_PREFIX + gameId) === '1';
	} catch {
		return false;
	}
}
