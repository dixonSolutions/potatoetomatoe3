import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./offline-deployment', () => ({
	getAppDeployment: vi.fn(() => 'local-app'),
	isLocalAppDeployment: vi.fn(() => true),
	isPublicSiteDeployment: vi.fn(() => false),
	isTauriApp: vi.fn(() => true),
	shouldProbePullerBackend: vi.fn(() => true)
}));

vi.mock('./offline-downloader-puller', () => ({
	isPullerAvailable: vi.fn(async () => false)
}));

import { getOfflineBackend, invalidateOfflineBackendCache } from './offline-runtime';
import { isPullerAvailable } from './offline-downloader-puller';
import { shouldProbePullerBackend, isPublicSiteDeployment } from './offline-deployment';

describe('offline-runtime', () => {
	beforeEach(() => {
		invalidateOfflineBackendCache();
		vi.mocked(shouldProbePullerBackend).mockReturnValue(true);
		vi.mocked(isPublicSiteDeployment).mockReturnValue(false);
		vi.mocked(isPullerAvailable).mockResolvedValue(false);
	});

	afterEach(() => {
		vi.clearAllMocks();
		invalidateOfflineBackendCache();
	});

	it('re-probes after cache invalidation once a puller becomes available', async () => {
		vi.mocked(isPullerAvailable).mockResolvedValueOnce(false);
		expect(await getOfflineBackend(true)).not.toBe('puller');

		vi.mocked(isPullerAvailable).mockResolvedValue(true);
		invalidateOfflineBackendCache();
		expect(await getOfflineBackend(true)).toBe('puller');
	});

	it('never selects puller on public-site deployments', async () => {
		vi.mocked(isPublicSiteDeployment).mockReturnValue(true);
		vi.mocked(shouldProbePullerBackend).mockReturnValue(false);
		vi.mocked(isPullerAvailable).mockResolvedValue(true);
		expect(await getOfflineBackend(true)).not.toBe('puller');
	});
});
