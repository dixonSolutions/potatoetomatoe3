import { describe, expect, it } from 'vitest';
import { andysuAvailable, statusText } from './andysu';

describe('AndySU status text', () => {
	it('reports unavailable when the bridge is absent', () => {
		expect(andysuAvailable()).toBe(false);
	});
	it('describes every state without claiming an unchecked state is current', () => {
		for (const state of ['idle', 'error', 'unknown', 'deferred']) {
			expect(statusText({ state, runningVersion: '1' })).not.toContain('Up to date');
		}
		expect(statusText({ state: 'up_to_date', runningVersion: '1' })).toBe('Up to date · version 1');
		expect(statusText({ state: 'staged', release: '1', runningVersion: '1' })).toBe(
			'Up to date · version 1'
		);
		expect(statusText({ state: 'staged', release: '2', runningVersion: '1' })).toContain(
			'Update ready'
		);
		expect(statusText({ state: 'checking' })).toBe('Checking…');
		expect(statusText({ state: 'downloading', percent: 40 })).toBe('Downloading update · 40%');
		expect(statusText({ state: 'applying' })).toContain('Applying');
		expect(statusText({ state: 'shell_update' })).toContain('new app install');
		expect(statusText({ state: 'available' })).toContain('available');
	});
});
