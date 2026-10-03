import { afterEach, describe, expect, it, vi } from 'vitest';

/* The desktop app's window, slow to answer the way a real compositor can be. */
const win = vi.hoisted(() => ({
	fullscreen: false,
	/** How long each window call takes. */
	delayMs: 30
}));

vi.mock('$lib/utils/offline-deployment', () => ({
	isTauriApp: () => true,
	isTauriMobileBuild: () => false
}));
vi.mock('@tauri-apps/api/window', () => {
	const slow = () => new Promise<void>((resolve) => setTimeout(resolve, win.delayMs));
	return {
		getCurrentWindow: () => ({
			isFullscreen: async () => {
				await slow();
				return win.fullscreen;
			},
			setFullscreen: async (on: boolean) => {
				await slow();
				win.fullscreen = on;
			}
		})
	};
});

const { enterGameFullscreen, exitGameFullscreen, pickChromeFullscreen } = await import(
	'./game-fullscreen-mode'
);

function surface() {
	const classes = new Set<string>();
	return {
		classList: {
			add: (c: string) => classes.add(c),
			remove: (c: string) => classes.delete(c),
			contains: (c: string) => classes.has(c)
		},
		classes
	};
}

afterEach(async () => {
	await exitGameFullscreen(null);
	win.fullscreen = false;
});

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

describe('the desktop window follows the last call', () => {
	it('leaves the window windowed when exit comes in while enter is still waiting on it', async () => {
		const s = surface();
		const el = s as unknown as Element;
		const entering = enterGameFullscreen(el);
		const leaving = exitGameFullscreen(el);
		await Promise.all([entering, leaving]);
		expect(win.fullscreen).toBe(false);
		expect(s.classes.size).toBe(0);
	});

	it('stays fullscreen when enter comes in while exit is still waiting on the window', async () => {
		const el = surface() as unknown as Element;
		await enterGameFullscreen(el);
		expect(win.fullscreen).toBe(true);
		const leaving = exitGameFullscreen(el);
		const entering = enterGameFullscreen(el);
		await Promise.all([leaving, entering]);
		expect(win.fullscreen).toBe(true);
		/* And the next exit gives the window back: the enter owns it. */
		await exitGameFullscreen(el);
		expect(win.fullscreen).toBe(false);
	});
});
