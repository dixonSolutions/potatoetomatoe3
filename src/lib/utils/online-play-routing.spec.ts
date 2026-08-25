import { describe, expect, it } from 'vitest';
import {
	decideOnlineRelay,
	isFrameBlockedHost,
	type OnlineRelayInput
} from './online-play-routing';

const base: OnlineRelayInput = {
	localApp: true,
	pullerSupported: true,
	consoleWanted: false,
	externalEmbed: true,
	directLaunchFailed: false,
	engine: 'html5'
};

describe('decideOnlineRelay', () => {
	it('launches direct for a plain external embed in the desktop app', () => {
		/* Regression: this is the case that used to be forced through /api/game-live. */
		expect(decideOnlineRelay(base)).toEqual({
			relay: false,
			relayOptional: false,
			reason: 'direct'
		});
	});

	it('never relays on the public site', () => {
		expect(decideOnlineRelay({ ...base, localApp: false, consoleWanted: true }).relay).toBe(false);
	});

	it('never relays on platforms without a puller sidecar (Tauri mobile)', () => {
		const decision = decideOnlineRelay({
			...base,
			pullerSupported: false,
			consoleWanted: true,
			engine: 'unity'
		});
		expect(decision).toEqual({
			relay: false,
			relayOptional: false,
			reason: 'no-puller-platform'
		});
	});

	it('keeps same-origin catalog shells off the relay', () => {
		expect(decideOnlineRelay({ ...base, externalEmbed: false, engine: 'unity' }).reason).toBe(
			'same-origin'
		);
	});

	it('requires the relay when the touch console needs a cross-origin bridge', () => {
		expect(decideOnlineRelay({ ...base, consoleWanted: true })).toEqual({
			relay: true,
			relayOptional: false,
			reason: 'console-needs-bridge'
		});
	});

	it('escalates to the relay after a direct launch failed', () => {
		expect(decideOnlineRelay({ ...base, directLaunchFailed: true })).toEqual({
			relay: true,
			relayOptional: false,
			reason: 'direct-launch-failed'
		});
	});

	it('treats the Unity proxy host as optional so a cold puller cannot stall launch', () => {
		expect(decideOnlineRelay({ ...base, engine: 'unity' })).toEqual({
			relay: true,
			relayOptional: true,
			reason: 'unity-embed'
		});
		expect(decideOnlineRelay({ ...base, engine: 'Unity' }).relayOptional).toBe(true);
	});

	it('prefers the mandatory console relay over the optional Unity relay', () => {
		expect(decideOnlineRelay({ ...base, engine: 'unity', consoleWanted: true }).relayOptional).toBe(
			false
		);
	});

	it('relays hosts that refuse framing, which no watchdog can detect', () => {
		expect(decideOnlineRelay({ ...base, frameBlockedHost: true })).toEqual({
			relay: true,
			relayOptional: false,
			reason: 'frame-blocked-host'
		});
	});

	it('does not relay a frame-blocked host on the public site, where nothing can', () => {
		expect(decideOnlineRelay({ ...base, localApp: false, frameBlockedHost: true }).relay).toBe(
			false
		);
	});
});

describe('isFrameBlockedHost', () => {
	it('matches the hosts whose headers were checked against a real catalog embed', () => {
		expect(isFrameBlockedHost('https://www.coolmathgames.com/0-run-3/play')).toBe(true);
		expect(isFrameBlockedHost('https://prod.addictinggames.com/games/x/index.html')).toBe(true);
		expect(isFrameBlockedHost('https://sites.google.com/view/x/home')).toBe(true);
	});

	it('leaves the framable majority of the catalog alone', () => {
		expect(isFrameBlockedHost('https://games.crazygames.com/en_US/slope/index.html')).toBe(false);
		expect(isFrameBlockedHost('https://play.unity.com/webgl/abc')).toBe(false);
		expect(isFrameBlockedHost('https://cdn2.addictinggames.com/games/x/index.html')).toBe(false);
	});

	it('is not fooled by a lookalike suffix', () => {
		expect(isFrameBlockedHost('https://notcoolmathgames.com/play')).toBe(false);
	});

	it('tolerates empty and unparseable input', () => {
		expect(isFrameBlockedHost(null)).toBe(false);
		expect(isFrameBlockedHost('')).toBe(false);
		expect(isFrameBlockedHost('/games/x/online/index.html')).toBe(false);
	});
});
