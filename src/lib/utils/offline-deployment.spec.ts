import { describe, expect, it } from 'vitest';
import {
	isLocalAppHost,
	parseDeploymentOverride,
	resolveAppDeployment
} from './offline-deployment';

describe('offline-deployment', () => {
	it('treats tauri.localhost and *.localhost as local app hosts', () => {
		expect(isLocalAppHost('tauri.localhost')).toBe(true);
		expect(isLocalAppHost('asset.localhost')).toBe(true);
		expect(isLocalAppHost('127.0.0.1')).toBe(true);
		expect(isLocalAppHost('dixonsolutions.github.io')).toBe(false);
	});

	it('parses deployment overrides', () => {
		expect(parseDeploymentOverride('public-site')).toBe('public-site');
		expect(parseDeploymentOverride('local-app')).toBe('local-app');
		expect(parseDeploymentOverride('local')).toBe('local-app');
		expect(parseDeploymentOverride(undefined)).toBeNull();
	});

	it('classifies packaged Tauri webviews as local-app even without legacy globals', () => {
		expect(
			resolveAppDeployment({
				hasWindow: true,
				isTauri: false,
				isDev: false,
				hasTauriPlatform: true,
				hostname: 'tauri.localhost'
			})
		).toBe('local-app');

		expect(
			resolveAppDeployment({
				hasWindow: true,
				isTauri: false,
				isDev: false,
				hasTauriPlatform: false,
				hostname: 'tauri.localhost'
			})
		).toBe('local-app');
	});

	it('keeps public-site override even when Tauri signals are present', () => {
		expect(
			resolveAppDeployment({
				override: 'public-site',
				isTauri: true,
				hasTauriPlatform: true,
				hostname: 'tauri.localhost'
			})
		).toBe('public-site');
	});

	it('classifies production hosts without Tauri signals as public-site', () => {
		expect(
			resolveAppDeployment({
				hasWindow: true,
				isTauri: false,
				isDev: false,
				hasTauriPlatform: false,
				hostname: 'dixonsolutions.github.io'
			})
		).toBe('public-site');
	});
});
