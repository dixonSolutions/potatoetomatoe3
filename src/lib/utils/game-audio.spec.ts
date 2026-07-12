import { describe, expect, it, beforeEach } from 'vitest';
import { shouldMuteForFocusLoss } from './game-audio';

describe('shouldMuteForFocusLoss', () => {
	beforeEach(() => {
		/* Default app-window-focus module state is focused=true */
	});

	it('mutes when the tab is hidden', () => {
		const doc = {
			visibilityState: 'hidden'
		} as unknown as Document;
		expect(shouldMuteForFocusLoss(doc)).toBe(true);
	});

	it('does not mute when the app window is focused and tab is visible', () => {
		const doc = {
			visibilityState: 'visible'
		} as unknown as Document;
		expect(shouldMuteForFocusLoss(doc)).toBe(false);
	});
});
