import { afterEach, describe, expect, it, vi } from 'vitest';

const deployment = vi.hoisted(() => ({ publicSite: false }));
vi.mock('./offline-deployment', async (importOriginal) => ({
	...(await importOriginal<typeof import('./offline-deployment')>()),
	isPublicSiteDeployment: () => deployment.publicSite
}));

import { isBundledOfflineGame } from './offline-downloader';

describe('isBundledOfflineGame', () => {
	afterEach(() => {
		deployment.publicSite = false;
	});

	it('counts the shipped copy in the desktop and Android apps', () => {
		expect(isBundledOfflineGame('shrek-escape')).toBe(true);
		expect(isBundledOfflineGame('slope')).toBe(false);
	});

	it('does not on the public site, where those files are only on the server', () => {
		deployment.publicSite = true;
		expect(isBundledOfflineGame('shrek-escape')).toBe(false);
	});
});
