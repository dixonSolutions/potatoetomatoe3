import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyGameBrowserProfile, type GameBrowserProfile } from './game-browser-profile';

const store = vi.hoisted(() => ({
	saved: null as GameBrowserProfile | null,
	writes: 0,
	release: [] as Array<() => void>
}));

vi.mock('./game-browser-storage', () => ({
	loadGameBrowserProfile: async () => store.saved,
	/* A slow store: each write waits until the test lets it finish. */
	saveGameBrowserProfile: (_id: string, profile: GameBrowserProfile) =>
		new Promise<void>((resolve) => {
			store.writes++;
			store.release.push(() => {
				store.saved = JSON.parse(JSON.stringify(profile)) as GameBrowserProfile;
				resolve();
			});
		})
}));

const { captureGameStorageFromIframe } = await import('./game-storage-bridge');

function pushFrom(origin: string, key: string, value: string): HTMLIFrameElement {
	const profile = emptyGameBrowserProfile();
	profile.updatedAt = Date.now();
	profile.profile.Default.localStorage[origin] = { [key]: value };
	return {
		contentWindow: { __ptStorageBridge: { takeDirtySnapshot: () => profile } }
	} as unknown as HTMLIFrameElement;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('game-storage-bridge saves', () => {
	beforeEach(() => {
		store.saved = null;
		store.writes = 0;
		store.release = [];
	});

	it('folds pushes that arrive during a slow write into one next write', async () => {
		const first = captureGameStorageFromIframe(pushFrom('https://a', 'n', '1'), 'g');
		await tick();
		expect(store.writes).toBe(1);

		/* Three more pushes while the first write is still running. */
		const rest = [
			captureGameStorageFromIframe(pushFrom('https://a', 'n', '2'), 'g'),
			captureGameStorageFromIframe(pushFrom('https://b', 'm', '1'), 'g'),
			captureGameStorageFromIframe(pushFrom('https://a', 'n', '3'), 'g')
		];
		store.release.shift()?.();
		await first;
		await tick();
		expect(store.writes).toBe(2);
		store.release.shift()?.();
		await Promise.all(rest);

		expect(store.writes).toBe(2);
		expect(store.saved?.profile.Default.localStorage).toEqual({
			'https://a': { n: '3' },
			'https://b': { m: '1' }
		});
	});
});
