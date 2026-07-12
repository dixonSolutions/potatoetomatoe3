import { describe, expect, it } from 'vitest';
import { isFocusInsideEmbeddedFrame, shouldMuteForFocusLoss } from './game-audio';

describe('shouldMuteForFocusLoss', () => {
	it('mutes when the tab is hidden', () => {
		const doc = {
			visibilityState: 'hidden',
			hasFocus: () => false,
			activeElement: null,
			querySelectorAll: () => []
		} as unknown as Document;
		expect(shouldMuteForFocusLoss(doc)).toBe(true);
	});

	it('does not mute when the document has focus', () => {
		const doc = {
			visibilityState: 'visible',
			hasFocus: () => true,
			activeElement: null,
			querySelectorAll: () => []
		} as unknown as Document;
		expect(shouldMuteForFocusLoss(doc)).toBe(false);
	});

	it('does not mute when focus is inside a game iframe', () => {
		const iframe = { tagName: 'IFRAME' } as HTMLIFrameElement;
		const doc = {
			visibilityState: 'visible',
			hasFocus: () => false,
			activeElement: iframe,
			querySelectorAll: () => []
		} as unknown as Document;
		expect(shouldMuteForFocusLoss(doc)).toBe(false);
		expect(isFocusInsideEmbeddedFrame(doc)).toBe(true);
	});

	it('mutes when focus left the window and no iframe is active', () => {
		const doc = {
			visibilityState: 'visible',
			hasFocus: () => false,
			activeElement: null,
			querySelectorAll: () => []
		} as unknown as Document;
		expect(shouldMuteForFocusLoss(doc)).toBe(true);
	});
});
