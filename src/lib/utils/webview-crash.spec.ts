import { describe, expect, it, vi } from 'vitest';
import { createWebviewCrashReader, isWebviewCrash, type WebviewCrash } from './webview-crash';

const crash: WebviewCrash = {
	gameId: 'addictinggames-x',
	reason: 'crashed',
	url: 'tauri://localhost/games/addictinggames-x',
	at: 1
};

describe('webview crash notice', () => {
	it('reads the crash from the app once and shares it', async () => {
		const invoke = vi.fn(async () => crash);
		const reader = createWebviewCrashReader(invoke as never, () => true);
		expect(await reader.crashOnLoad()).toEqual(crash);
		expect(await reader.crashOnLoad()).toEqual(crash);
		expect(invoke).toHaveBeenCalledTimes(1);
		expect(invoke).toHaveBeenCalledWith('take_webview_crash');
	});

	it('hands the crash to its game page once, and to no other game', async () => {
		const reader = createWebviewCrashReader((async () => crash) as never, () => true);
		expect(await reader.takeCrashOfGame('another-game')).toBeNull();
		/* The page loads the game twice on the way in (mount and navigation): one notice. */
		const [first, second] = await Promise.all([
			reader.takeCrashOfGame('addictinggames-x'),
			reader.takeCrashOfGame('addictinggames-x')
		]);
		expect([first, second].filter(Boolean)).toEqual([crash]);
		/* Coming back to the game later in this page load starts it as usual. */
		expect(await reader.takeCrashOfGame('addictinggames-x')).toBeNull();
	});

	it('says nothing outside the desktop app, when the command fails, or for junk', async () => {
		const invoke = vi.fn(async () => crash);
		expect(await createWebviewCrashReader(invoke as never, () => false).crashOnLoad()).toBeNull();
		expect(invoke).not.toHaveBeenCalled();
		const failing = createWebviewCrashReader(
			(async () => {
				throw new Error('no such command');
			}) as never,
			() => true
		);
		expect(await failing.crashOnLoad()).toBeNull();
		expect(isWebviewCrash({ gameId: 3 })).toBe(false);
		expect(isWebviewCrash({ ...crash, gameId: null })).toBe(true);
	});
});
