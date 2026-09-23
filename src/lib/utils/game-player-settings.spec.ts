import { describe, expect, it } from 'vitest';
import {
	DEFAULT_GAME_PLAYER_SETTINGS,
	menuButtonMetrics,
	normalizeGamePlayerSettings,
	resolveMenuButtonSize,
	showsMenuButton,
	usesHoverZone
} from './game-player-settings';

const F = { code: 'KeyF', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };

describe('game player settings', () => {
	it('defaults: auto fullscreen on, menu button top-left, no fullscreen key', () => {
		expect(normalizeGamePlayerSettings(undefined)).toEqual(DEFAULT_GAME_PLAYER_SETTINGS);
		expect(DEFAULT_GAME_PLAYER_SETTINGS).toMatchObject({
			autoFullscreen: true,
			menuAccess: 'button',
			menuButtonSize: 'auto',
			menuCorner: 'top-left',
			fullscreenShortcutEnabled: false,
			fullSpeedInPowerSaver: true,
			renderAtDisplayScale: true
		});
	});

	it('keeps valid values and replaces anything it does not know', () => {
		expect(
			normalizeGamePlayerSettings({
				autoFullscreen: false,
				menuAccess: 'hover',
				menuButtonSize: 'large',
				menuCorner: 'bottom-right',
				fullscreenShortcutEnabled: true,
				fullSpeedInPowerSaver: false,
				renderAtDisplayScale: false
			})
		).toEqual({
			autoFullscreen: false,
			menuAccess: 'hover',
			menuButtonSize: 'large',
			menuCorner: 'bottom-right',
			fullscreenShortcutEnabled: true,
			fullSpeedInPowerSaver: false,
			renderAtDisplayScale: false
		});
		expect(
			normalizeGamePlayerSettings({
				autoFullscreen: 'yes',
				menuAccess: 'swipe',
				menuButtonSize: 3,
				menuCorner: 'middle',
				fullSpeedInPowerSaver: 'on',
				renderAtDisplayScale: 1
			})
		).toEqual(DEFAULT_GAME_PLAYER_SETTINGS);
	});

	describe('fullscreen shortcut migration', () => {
		it('the old default F saved by every install does not turn the shortcut on', () => {
			expect(normalizeGamePlayerSettings(undefined, F).fullscreenShortcutEnabled).toBe(false);
			expect(normalizeGamePlayerSettings({}, null).fullscreenShortcutEnabled).toBe(false);
		});

		it('a key the user recorded keeps working', () => {
			const recorded = { ...F, code: 'KeyG' };
			expect(normalizeGamePlayerSettings(undefined, recorded).fullscreenShortcutEnabled).toBe(true);
			const withShift = { ...F, shiftKey: true };
			expect(normalizeGamePlayerSettings(undefined, withShift).fullscreenShortcutEnabled).toBe(
				true
			);
		});

		it('an explicit choice always wins over the migration', () => {
			const recorded = { ...F, code: 'KeyG' };
			expect(
				normalizeGamePlayerSettings({ fullscreenShortcutEnabled: false }, recorded)
					.fullscreenShortcutEnabled
			).toBe(false);
			expect(
				normalizeGamePlayerSettings({ fullscreenShortcutEnabled: true }, F)
					.fullscreenShortcutEnabled
			).toBe(true);
		});
	});

	it('auto size is small with a mouse and medium on touch', () => {
		expect(resolveMenuButtonSize('auto', false)).toBe('small');
		expect(resolveMenuButtonSize('auto', true)).toBe('medium');
		expect(resolveMenuButtonSize('large', false)).toBe('large');
	});

	it('keeps a touch target of at least 32 px even for the small button', () => {
		const small = menuButtonMetrics('small', true);
		expect(small.hit).toBeGreaterThanOrEqual(32);
		expect(small.visual).toBeLessThan(small.hit);
		expect(menuButtonMetrics('small', false).hit).toBe(menuButtonMetrics('small', false).visual);
	});

	it('touch always gets the button, since it cannot hover', () => {
		expect(showsMenuButton('hover', false)).toBe(false);
		expect(showsMenuButton('hover', true)).toBe(true);
		expect(showsMenuButton('button', false)).toBe(true);
		expect(showsMenuButton('both', false)).toBe(true);
		expect(usesHoverZone('button')).toBe(false);
		expect(usesHoverZone('hover')).toBe(true);
		expect(usesHoverZone('both')).toBe(true);
	});
});
