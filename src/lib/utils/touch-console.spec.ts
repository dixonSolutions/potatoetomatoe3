import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	DEFAULT_TOUCH_MAPPING,
	codesToLabel,
	formatTouchKeyCode,
	getEffectiveConfig,
	loadTouchConsoleSettings,
	translateTouchLayout
} from './touch-console';
import { KeyDispatcher, canUseTouchBridge, isLikelyInjectableUrl } from './touch-input-dispatch';

describe('touch-input-dispatch', () => {
	it('classifies offline and proxied play URLs as injectable', () => {
		expect(isLikelyInjectableUrl('/games/shrek-escape/offline/index.html')).toBe(true);
		expect(isLikelyInjectableUrl('/puller-games/foo/offline/index.html')).toBe(true);
		expect(isLikelyInjectableUrl('/api/unity-play/foo')).toBe(true);
		expect(isLikelyInjectableUrl('/api/game-live/foo')).toBe(true);
		expect(isLikelyInjectableUrl('blob:http://localhost/abc')).toBe(true);
	});

	it('rejects Unity player shell and online shells as non-injectable', () => {
		expect(isLikelyInjectableUrl('/unity/player.html?src=https://example.com')).toBe(false);
		expect(isLikelyInjectableUrl('/games/foo/online/index.html')).toBe(false);
	});

	it('classifies unity-play, game-live, and offline URLs as touch-bridge capable', () => {
		expect(canUseTouchBridge('/api/unity-play/mob-city')).toBe(true);
		expect(canUseTouchBridge('/api/game-live/ovo')).toBe(true);
		expect(canUseTouchBridge('http://127.0.0.1:18787/api/unity-play/mob-city')).toBe(true);
		expect(canUseTouchBridge('http://127.0.0.1:18787/api/game-live/ovo')).toBe(true);
		expect(canUseTouchBridge('/games/foo/offline/index.html')).toBe(true);
		expect(canUseTouchBridge('/puller-games/foo/offline/index.html')).toBe(true);
		expect(canUseTouchBridge('/browser-offline/foo/online/index.html')).toBe(true);
		expect(canUseTouchBridge('/unity/player.html?src=https://play.unity.com/x')).toBe(false);
		expect(canUseTouchBridge('https://games.crazygames.com/en_US/ovo/index.html')).toBe(false);
	});

	it('treats same-origin relay routes as injectable regardless of deployment', () => {
		/*
		 * On the public site `offline-sw.js` answers these paths with the game's own HTML,
		 * so the frame is same-origin and the console can dispatch straight into it. The
		 * loopback form is a different origin — bridge-capable via postMessage, but never
		 * DOM-injectable.
		 */
		vi.stubGlobal('window', { location: new URL('https://dixonsolutions.github.io/pt/games/x') });
		expect(isLikelyInjectableUrl('/pt/api/unity-play/foo')).toBe(true);
		expect(isLikelyInjectableUrl('https://dixonsolutions.github.io/pt/api/game-live/foo')).toBe(
			true
		);
		expect(isLikelyInjectableUrl('http://127.0.0.1:18787/api/unity-play/foo')).toBe(false);
		expect(canUseTouchBridge('http://127.0.0.1:18787/api/unity-play/foo')).toBe(true);
	});

	it('maps joystick vectors to direction key codes', () => {
		const mapping = DEFAULT_TOUCH_MAPPING.directions;
		expect(KeyDispatcher.directionsFromVector(0, 0, mapping)).toEqual([]);
		expect(KeyDispatcher.directionsFromVector(0, -1, mapping)).toEqual(mapping.up);
		expect(KeyDispatcher.directionsFromVector(1, 0, mapping)).toEqual(mapping.right);
		expect(KeyDispatcher.directionsFromVector(-0.9, 0.9, mapping).sort()).toEqual(
			[...mapping.left, ...mapping.down].sort()
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});
});

describe('touch-console helpers', () => {
	it('formats key codes for the mapping UI', () => {
		expect(formatTouchKeyCode('Space')).toBe('Space');
		expect(formatTouchKeyCode('ArrowUp')).toBe('Up');
		expect(formatTouchKeyCode('KeyW')).toBe('W');
		expect(codesToLabel(['ArrowUp', 'KeyW'])).toBe('Up + W');
	});

	it('loads default effective config', () => {
		const settings = loadTouchConsoleSettings();
		expect(settings.enabled).toBe(true);
		expect(settings.joystickScheme).toBe('arrows');
		expect(settings.mapping.directions.up).toEqual(['ArrowUp']);
		expect(settings.mapping.directions.up).not.toContain('KeyW');
		const cfg = getEffectiveConfig(null, 'landscape');
		expect(cfg.layout.joystick.size).toBeGreaterThan(0);
		expect(cfg.joystickScheme).toBe('arrows');
		expect(cfg.mapping.buttons.space).toEqual(['Space']);
		expect(cfg.layout.buttons.some((b) => b.id === 'space')).toBe(true);
	});

	it('translates the console frame and every child control together', () => {
		const layout = getEffectiveConfig(null, 'landscape').layout;
		const translated = translateTouchLayout(layout, 0.1, -0.05);
		expect(translated.console.xPct).toBeCloseTo(layout.console.xPct + 0.1);
		expect(translated.joystick.yPct).toBeCloseTo(layout.joystick.yPct - 0.05);
		expect(translated.buttons.map((button) => button.xPct)).toEqual(
			layout.buttons.map((button) => button.xPct + 0.1)
		);
	});
});
