import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./offline-deployment', () => ({
	getAppDeployment: vi.fn(() => 'local-app'),
	isLocalAppDeployment: vi.fn(() => true),
	isPublicSiteDeployment: vi.fn(() => false),
	isTauriApp: vi.fn(() => false)
}));

import { getOfflineBackend, invalidateOfflineBackendCache } from './offline-runtime';
import { isPublicSiteDeployment } from './offline-deployment';

describe('offline-runtime', () => {
	beforeEach(() => {
		invalidateOfflineBackendCache();
		vi.mocked(isPublicSiteDeployment).mockReturnValue(false);
	});

	afterEach(() => {
		vi.clearAllMocks();
		invalidateOfflineBackendCache();
	});

	it('offers browser storage on the public site when IndexedDB and a worker exist', async () => {
		/* The web build can download into IndexedDB. */
		vi.mocked(isPublicSiteDeployment).mockReturnValue(true);
		vi.stubGlobal('window', {});
		vi.stubGlobal('indexedDB', {});
		vi.stubGlobal('navigator', { serviceWorker: {} });
		try {
			expect(await getOfflineBackend(true)).toBe('browser');
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
