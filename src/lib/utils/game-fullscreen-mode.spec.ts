import { describe, expect, it } from 'vitest';
import { pickChromeFullscreen } from './game-fullscreen-mode';

describe('pickChromeFullscreen', () => {
	it('uses the native window in the desktop app, whatever the gesture state', () => {
		expect(
			pickChromeFullscreen({ tauriDesktop: true, documentApi: false, userActivation: false })
		).toBe('tauri-window');
	});

	it('uses the document Fullscreen API when a gesture may still be active', () => {
		expect(
			pickChromeFullscreen({ tauriDesktop: false, documentApi: true, userActivation: true })
		).toBe('document');
		/* Engines without navigator.userActivation: try, and fall back if refused. */
		expect(
			pickChromeFullscreen({ tauriDesktop: false, documentApi: true, userActivation: null })
		).toBe('document');
	});

	it('does not ask without a gesture, or without the API (iPhone)', () => {
		expect(
			pickChromeFullscreen({ tauriDesktop: false, documentApi: true, userActivation: false })
		).toBe('none');
		expect(
			pickChromeFullscreen({ tauriDesktop: false, documentApi: false, userActivation: true })
		).toBe('none');
	});
});
