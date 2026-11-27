/**
 * Ad and tracker hosts blocked inside game frames.
 *
 * Games bundle ad SDKs, analytics and tracking pixels; none of it is needed to play, all of
 * it costs memory, network and pop-ups. The list is enforced in three places, each with its
 * own copy because none of them can import this module:
 *
 *   - static/game-storage-bridge.child.js  in every frame the bridge runs in (every frame in
 *     the Tauri app; same-origin game frames on the web): fetch, XHR, sendBeacon and
 *     script / iframe / img sources;
 *   - static/offline-sw.js                 requests from pages the service worker controls;
 *   - src-tauri/src/game_frames.js          stops ad frames that load anyway (Tauri).
 *
 * ad-hosts.spec.ts fails when the copies drift apart. Only pure ad / measurement hosts: a
 * host a game needs to start (its CDN, fonts, a portal SDK that gates the game) never goes
 * here.
 */
export const AD_HOSTS: readonly string[] = [
	'doubleclick.net',
	'googlesyndication.com',
	'googletagservices.com',
	'googletagmanager.com',
	'google-analytics.com',
	'googleadservices.com',
	'adservice.google.com',
	'imasdk.googleapis.com',
	'amazon-adsystem.com',
	'criteo.com',
	'criteo.net',
	'pubmatic.com',
	'adnxs.com',
	'moatads.com',
	'rubiconproject.com',
	'openx.net',
	'casalemedia.com',
	'smartadserver.com',
	'taboola.com',
	'outbrain.com',
	'scorecardresearch.com',
	'quantserve.com',
	'hotjar.com',
	'clarity.ms',
	'mc.yandex.ru',
	'adsafeprotected.com',
	'33across.com',
	'sharethrough.com',
	'teads.tv',
	'yieldmo.com',
	'lijit.com',
	'indexww.com',
	'adform.net',
	'cpmstar.com',
	'adinplay.com',
	'venatusmedia.com',
	'playwire.com',
	'aniview.com',
	'springserve.com',
	'lkqd.net'
];

/** Is this host (or URL) an ad or tracker host, or a subdomain of one? */
export function isAdHost(hostOrUrl: string | null | undefined): boolean {
	if (!hostOrUrl) return false;
	let host = hostOrUrl.trim().toLowerCase();
	if (host.includes('/')) {
		try {
			host = new URL(host, 'http://local/').hostname;
		} catch {
			return false;
		}
	}
	return AD_HOSTS.some((d) => host === d || host.endsWith('.' + d));
}
