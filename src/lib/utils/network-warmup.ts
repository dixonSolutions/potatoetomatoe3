/**
 * Warm the network for a game before it is asked to start.
 *
 * A game's first frame costs a DNS lookup, a TCP handshake and a TLS handshake to its
 * embed host before a single byte of the game arrives — three or four round trips, which
 * on school Wi-Fi (60 ms+ RTT, plus the distance to the portal's CDN) is a few hundred
 * milliseconds of a blank frame. Two things can be done earlier than the frame:
 *
 * - on hover / touchstart of a game card, fetch the game's `metadata.json` (the player
 *   page's first request, so it is then served from cache) and, once it is known, open a
 *   connection to the embed host;
 * - on the player page, open that connection as soon as the metadata is known, while the
 *   play URL is still being resolved.
 *
 * Both are hints: nothing waits on them and every failure is ignored.
 *
 * What each buys, measured in Chromium (2026-09): the metadata prefetch takes a request
 * off the click-to-Play path everywhere. The preconnect does not help the game frame
 * there — Chromium partitions connections by top-level site *and* frame site, and a
 * frame for games.crazygames.com inside this app is a different partition from this
 * page, so the frame's navigation opened its own connection with or without the hint.
 * It is kept for engines that pool connections per host (unverified for WebKitGTK) and
 * because an unused preconnect costs one idle socket.
 */
import { base } from '$app/paths';
import type { GameMetadata } from '$lib/utils/games';

/**
 * Chrome keeps an unused preconnected socket for ~10 s and warns past a handful of them.
 * A pointer sweeping across a grid must not open a connection per card.
 */
const MAX_WARM_ORIGINS = 6;
const MAX_METADATA_PREFETCHES = 24;

/** Hosts a Unity Play frame loads its loader and build files from. */
const UNITY_PLAY_ORIGINS = ['https://play.unity.com', 'https://cdn.play.unity.com'];

const warmedOrigins: string[] = [];
const metadataPrefetches = new Map<string, Promise<GameMetadata | null>>();

function httpOrigin(url: string | undefined | null): string | null {
	const trimmed = url?.trim();
	if (!trimmed) return null;
	try {
		const parsed = new URL(trimmed);
		return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : null;
	} catch {
		return null;
	}
}

/**
 * The cross-origin hosts a game's first frame will connect to, most important first. Only
 * the embed document's own host is certain; Unity Play frames also pull their loader from
 * a known CDN.
 */
export function gameLaunchOrigins(
	meta: Pick<GameMetadata, 'engine' | 'onlineEmbedUrl' | 'remotePlayUrl'> | null | undefined,
	pageOrigin?: string
): string[] {
	if (!meta) return [];
	const out: string[] = [];
	const add = (origin: string | null) => {
		if (origin && origin !== pageOrigin && !out.includes(origin)) out.push(origin);
	};
	const embedOrigin = httpOrigin(meta.onlineEmbedUrl) ?? httpOrigin(meta.remotePlayUrl);
	add(embedOrigin);
	if (meta.engine === 'unity' || embedOrigin === UNITY_PLAY_ORIGINS[0]) {
		for (const origin of UNITY_PLAY_ORIGINS) add(origin);
	}
	return out;
}

/** Add `<link rel="preconnect">` for an origin, once per page, within the budget. */
export function preconnectOrigin(origin: string): void {
	if (typeof document === 'undefined') return;
	if (warmedOrigins.includes(origin)) return;
	if (warmedOrigins.length >= MAX_WARM_ORIGINS) {
		/* Oldest hint first: the card the pointer left long ago is the least likely click. */
		const stale = warmedOrigins.shift();
		document.head.querySelector(`link[data-warmup="${CSS.escape(stale ?? '')}"]`)?.remove();
	}
	warmedOrigins.push(origin);
	const link = document.createElement('link');
	link.rel = 'preconnect';
	link.href = origin;
	link.dataset.warmup = origin;
	document.head.appendChild(link);
}

/** Preconnect to everything this game's first frame will need. */
export function warmGameLaunchFromMetadata(meta: GameMetadata | null | undefined): void {
	if (typeof window === 'undefined') return;
	for (const origin of gameLaunchOrigins(meta, window.location.origin)) {
		preconnectOrigin(origin);
	}
}

/**
 * Hover / touchstart on a game card: fetch its metadata (same URL `loadGameMetadata`
 * requests, so the player page reads it from the HTTP or service-worker cache) and
 * preconnect to its embed host. Safe to call on every pointer event.
 */
export function warmGameLaunch(gameId: string): void {
	if (typeof window === 'undefined' || !gameId) return;
	if (metadataPrefetches.has(gameId)) return;
	if (metadataPrefetches.size >= MAX_METADATA_PREFETCHES) {
		const oldest = metadataPrefetches.keys().next().value;
		if (oldest !== undefined) metadataPrefetches.delete(oldest);
	}
	const pending = fetch(`${base}/games/${gameId}/online/metadata.json`)
		.then((res) => (res.ok ? (res.json() as Promise<GameMetadata>) : null))
		.catch(() => null);
	metadataPrefetches.set(gameId, pending);
	void pending.then((meta) => warmGameLaunchFromMetadata(meta));
}
