import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearPlayRouteFailures,
	failedPlayRoutes,
	isFlashUrl,
	isFrameBlockedHost,
	isTextPlainHtmlHost,
	isUnframeableInApp,
	markPlayRouteFailed,
	nextPlayRoute,
	planOnlineRoutes,
	type PlayRouteInput
} from './online-play-routing';

const desktop: PlayRouteInput = {
	desktopApp: true,
	pullerRunning: false,
	embedUrl: 'https://games.crazygames.com/en_US/slope/index.html',
	localEmbed: false
};
const web: PlayRouteInput = { ...desktop, desktopApp: false };

describe('planOnlineRoutes', () => {
	it('plays an ordinary embed straight from its host, with the relay as the fallback', () => {
		/* Regression: the desktop app used to force these through the Node relay. */
		expect(planOnlineRoutes(desktop)).toEqual(['direct', 'relay']);
	});

	it('plays direct on the web and on Android, which have no relay', () => {
		expect(planOnlineRoutes(web)).toEqual(['direct']);
	});

	it('never starts or waits for a puller; one that is already running is the last resort', () => {
		expect(planOnlineRoutes({ ...desktop, pullerRunning: true })).toEqual([
			'direct',
			'relay',
			'puller'
		]);
	});

	it('plays Drive U 7 from the catalog’s own embed.html, then the jsDelivr HTML itself', () => {
		const jsdelivr = {
			...desktop,
			localEmbed: true,
			embedUrl: 'https://cdn.jsdelivr.net/gh/u/r@abc/index.html'
		};
		expect(planOnlineRoutes(jsdelivr)).toEqual(['local', 'shell', 'relay']);
		expect(planOnlineRoutes({ ...jsdelivr, desktopApp: false })).toEqual(['local', 'shell']);
	});

	it('never frames a Google Sites page, which refuses everyone', () => {
		const sites = {
			...web,
			localEmbed: true,
			embedUrl: 'https://sites.google.com/view/drive-u-7-home/x'
		};
		expect(planOnlineRoutes(sites)).toEqual(['local']);
		expect(planOnlineRoutes({ ...sites, desktopApp: true })).toEqual(['local', 'relay']);
	});

	it('hands Flash files to the relay (Ruffle) and has nothing to offer without one', () => {
		const swf = { ...desktop, embedUrl: 'https://prod.addictinggames.com/f/tank_0.swf' };
		expect(planOnlineRoutes(swf)).toEqual(['relay']);
		expect(planOnlineRoutes({ ...swf, desktopApp: false })).toEqual([]);
	});

	it('frames a same-origin catalog shell as it is', () => {
		expect(planOnlineRoutes({ ...desktop, embedUrl: null })).toEqual(['direct']);
		expect(planOnlineRoutes({ ...web, embedUrl: null })).toEqual(['direct']);
	});
});

describe('nextPlayRoute', () => {
	it('skips what already failed', () => {
		expect(nextPlayRoute(['direct', 'relay', 'puller'], ['direct'])).toBe('relay');
		expect(nextPlayRoute(['direct', 'relay'], ['direct', 'relay'])).toBeNull();
		expect(nextPlayRoute([], [])).toBeNull();
	});
});

describe('failed route memory', () => {
	beforeEach(() => {
		const data = new Map<string, string>();
		vi.stubGlobal('sessionStorage', {
			getItem: (k: string) => data.get(k) ?? null,
			setItem: (k: string, v: string) => void data.set(k, String(v)),
			removeItem: (k: string) => void data.delete(k)
		});
	});
	afterEach(() => vi.unstubAllGlobals());

	it('remembers each failed route once, per game, for the session', () => {
		markPlayRouteFailed('g', 'direct');
		markPlayRouteFailed('g', 'direct');
		markPlayRouteFailed('g', 'shell');
		expect(failedPlayRoutes('g')).toEqual(['direct', 'shell']);
		expect(failedPlayRoutes('other')).toEqual([]);
		clearPlayRouteFailures('g');
		expect(failedPlayRoutes('g')).toEqual([]);
	});
});

describe('host facts', () => {
	it('knows which hosts refuse framing, checked against a real catalog embed', () => {
		expect(isFrameBlockedHost('https://prod.addictinggames.com/f/x.swf')).toBe(true);
		/* No X-Frame-Options on the public_games URLs the catalog uses (2026-09-23). */
		expect(
			isFrameBlockedHost('https://www.coolmathgames.com/sites/default/files/public_games/1/')
		).toBe(false);
		expect(isFrameBlockedHost('https://games.crazygames.com/en_US/slope/index.html')).toBe(false);
		expect(isFrameBlockedHost('https://cdn2.addictinggames.com/games/x/index.html')).toBe(false);
	});

	it('is not fooled by a lookalike suffix', () => {
		expect(isFrameBlockedHost('https://notprod.addictinggames.com.evil/x')).toBe(false);
	});

	it('tolerates empty and unparseable input', () => {
		expect(isFrameBlockedHost(null)).toBe(false);
		expect(isFrameBlockedHost('')).toBe(false);
		expect(isFrameBlockedHost('/games/x/online/index.html')).toBe(false);
		expect(isFlashUrl('not a url')).toBe(false);
	});

	it('recognises HTML served as text and Flash files', () => {
		expect(isTextPlainHtmlHost('https://cdn.jsdelivr.net/gh/u/r/index.html')).toBe(true);
		expect(isTextPlainHtmlHost('https://play.unity.com/x')).toBe(false);
		expect(isFlashUrl('https://prod.addictinggames.com/files/Game_0.SWF')).toBe(true);
		expect(isFlashUrl('https://prod.addictinggames.com/files/game.swf.html')).toBe(false);
	});
});

describe('isUnframeableInApp', () => {
	it('flags a frame-blocked host on a build with no relay (Android)', () => {
		expect(
			isUnframeableInApp({ localApp: true, pullerSupported: false, frameBlockedHost: true })
		).toBe(true);
	});

	it('stays false on desktop, where the in-process relay handles it', () => {
		expect(
			isUnframeableInApp({ localApp: true, pullerSupported: true, frameBlockedHost: true })
		).toBe(false);
	});

	it('stays false on the public site and for hosts that allow framing', () => {
		expect(
			isUnframeableInApp({ localApp: false, pullerSupported: false, frameBlockedHost: true })
		).toBe(false);
		expect(
			isUnframeableInApp({ localApp: true, pullerSupported: false, frameBlockedHost: false })
		).toBe(false);
	});
});
