import { describe, expect, it } from 'vitest';
import { EXTERNAL_IFRAME_NEEDS_PULLER } from './browser-offline-download';

describe('browser offline full-scrape gate', () => {
	it('exports a clear CTA when cross-origin iframes cannot be scraped in-browser', () => {
		expect(EXTERNAL_IFRAME_NEEDS_PULLER).toMatch(/puller/i);
		expect(EXTERNAL_IFRAME_NEEDS_PULLER).toMatch(/desktop app|local puller/i);
		expect(EXTERNAL_IFRAME_NEEDS_PULLER).not.toMatch(/shell only/i);
	});
});
