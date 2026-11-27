import { describe, expect, it } from 'vitest';
import { EXTERNAL_IFRAME_UNSUPPORTED } from './browser-offline-download';

describe('browser offline full-scrape gate', () => {
	it('exports a clear message when cross-origin iframes cannot be saved in-browser', () => {
		expect(EXTERNAL_IFRAME_UNSUPPORTED).toMatch(/third-party/i);
		expect(EXTERNAL_IFRAME_UNSUPPORTED).not.toMatch(/shell only/i);
	});
});
