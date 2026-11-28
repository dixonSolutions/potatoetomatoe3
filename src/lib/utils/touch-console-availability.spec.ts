import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./offline-deployment', async (orig) => ({
	...(await orig<typeof import('./offline-deployment')>()),
	isLocalAppDeployment: () => true
}));

const store = new Map<string, string>();
beforeEach(() => {
	store.clear();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k),
		clear: () => store.clear(),
		key: () => null,
		length: 0
	});
});

describe('touch console availability in the local app', () => {
	it("keeps 'auto', so a key press can still hide the controls (A10)", async () => {
		const { getEffectiveConfig } = await import('./touch-console');
		const config = getEffectiveConfig(null, 'landscape');
		expect(config.enabled).toBe(true);
		expect(config.availability).toBe('auto');
	});

	it("turns 'off' into 'auto': the console stays available", async () => {
		store.set('potato-tomato-touch-console-v1', JSON.stringify({ availability: 'off' }));
		const { getEffectiveConfig } = await import('./touch-console');
		expect(getEffectiveConfig(null, 'landscape').availability).toBe('auto');
	});
});
