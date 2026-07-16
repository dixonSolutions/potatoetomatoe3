import { describe, expect, it } from 'vitest';
import {
	isDevBuild,
	isDevHarnessRouteAllowed,
	parseHarnessMode
} from './harness-guard';

describe('harness guard', () => {
	it('parses only known harness modes', () => {
		expect(parseHarnessMode('console-test')).toBe('console-test');
		expect(parseHarnessMode('puller-test')).toBe('puller-test');
		expect(parseHarnessMode('production')).toBeNull();
		expect(parseHarnessMode('')).toBeNull();
	});

	it('allows routes only in Vite DEV builds', () => {
		expect(isDevHarnessRouteAllowed()).toBe(isDevBuild());
	});
});
