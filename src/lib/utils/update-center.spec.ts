import { describe, expect, it } from 'vitest';
import { pickNewestApkRelease, type GithubRelease } from './app-update';
import {
	CHECK_INTERVAL_MS,
	DEFAULT_UPDATE_SETTINGS,
	connectionKind,
	detectUpdatePlatform,
	downloadAllowed,
	isCheckDue,
	loadUpdateSettings,
	phaseFromAndy,
	saveUpdateSettings,
	showsUpdateBadge,
	updatesInApp,
	type UpdatePhase
} from './update-center.svelte';

function memoryStore(init: Record<string, string> = {}) {
	const data = { ...init };
	return {
		data,
		getItem: (k: string) => (k in data ? data[k] : null),
		setItem: (k: string, v: string) => {
			data[k] = v;
		}
	};
}

const REPO = 'dixonSolutions/potatoetomatoe3';
function release(n: number, opts: Partial<GithubRelease> = {}): GithubRelease {
	return {
		tag_name: `release-${n}`,
		html_url: `https://github.com/${REPO}/releases/tag/release-${n}`,
		assets: [
			{
				name: `potato-tomato-0.0.${n}.apk`,
				browser_download_url: `https://github.com/${REPO}/releases/download/release-${n}/potato-tomato-0.0.${n}.apk`,
				size: 1
			}
		],
		...opts
	};
}

describe('update platforms', () => {
	it.each([
		[{ tauri: false, android: false, live: false }, 'web', false],
		[{ tauri: true, android: false, live: false }, 'desktop', false],
		[{ tauri: true, android: true, live: false }, 'android-apk', true],
		[{ tauri: true, android: true, live: true }, 'android-live', true]
	] as const)('%o → %s (in-app updates: %s)', (env, platform, inApp) => {
		expect(detectUpdatePlatform(env)).toBe(platform);
		expect(updatesInApp(platform)).toBe(inApp);
	});

	it('shows the badge only on Android, only with an update to act on', () => {
		const phases: UpdatePhase[] = [
			'idle',
			'checking',
			'up-to-date',
			'available',
			'downloading',
			'staged',
			'error'
		];
		for (const platform of ['web', 'desktop'] as const) {
			for (const phase of phases) expect(showsUpdateBadge(platform, phase)).toBe(false);
		}
		for (const platform of ['android-apk', 'android-live'] as const) {
			expect(phases.filter((p) => showsUpdateBadge(platform, p))).toEqual([
				'available',
				'downloading',
				'staged'
			]);
		}
	});
});

describe('update settings', () => {
	it('defaults: Wi-Fi on, mobile data off, automatic on, apply on next start', () => {
		expect(DEFAULT_UPDATE_SETTINGS).toEqual({
			wifi: true,
			mobileData: false,
			automatic: true,
			applyMode: 'next-start'
		});
		expect(loadUpdateSettings(memoryStore())).toEqual(DEFAULT_UPDATE_SETTINGS);
		expect(loadUpdateSettings(null)).toEqual(DEFAULT_UPDATE_SETTINGS);
	});

	it('round-trips and ignores junk', () => {
		const store = memoryStore();
		saveUpdateSettings(
			{ wifi: false, mobileData: true, automatic: false, applyMode: 'live' },
			store
		);
		expect(loadUpdateSettings(store)).toEqual({
			wifi: false,
			mobileData: true,
			automatic: false,
			applyMode: 'live'
		});
		expect(
			loadUpdateSettings(memoryStore({ 'potato-tomato-update-settings': '{"applyMode":"now"' }))
		).toEqual(DEFAULT_UPDATE_SETTINGS);
	});

	it('keeps an old "automatic updates off" choice', () => {
		const store = memoryStore({ 'potato-tomato-auto-apk-update': 'off' });
		expect(loadUpdateSettings(store).automatic).toBe(false);
	});

	it.each([
		[{ connection: { type: 'wifi' } }, 'wifi', true],
		[{ connection: { type: 'cellular' } }, 'cellular', false],
		[{ onLine: false, connection: { type: 'wifi' } }, 'none', false],
		[{}, 'unknown', true]
	] as const)('connection %o → %s, downloads by default: %s', (nav, kind, allowed) => {
		expect(connectionKind(nav)).toBe(kind);
		expect(downloadAllowed(DEFAULT_UPDATE_SETTINGS, kind)).toBe(allowed);
	});

	it('mobile data downloads only when switched on; Wi-Fi off stops Wi-Fi downloads', () => {
		expect(downloadAllowed({ ...DEFAULT_UPDATE_SETTINGS, mobileData: true }, 'cellular')).toBe(
			true
		);
		expect(downloadAllowed({ ...DEFAULT_UPDATE_SETTINGS, wifi: false }, 'wifi')).toBe(false);
	});
});

describe('checks and releases', () => {
	it('checks at least every hour', () => {
		expect(CHECK_INTERVAL_MS).toBeLessThanOrEqual(60 * 60 * 1000);
		expect(isCheckDue(0, CHECK_INTERVAL_MS)).toBe(true);
		expect(isCheckDue(1000, 1000 + CHECK_INTERVAL_MS - 1)).toBe(false);
	});

	it('jumps to the newest release, not the next one (v → v+5)', () => {
		const list = [release(102), release(105), release(101), release(103), release(104)];
		expect(pickNewestApkRelease(list)?.versionName).toBe('0.0.105');
	});

	it('skips a newest release whose APK is not attached yet, and drafts / prereleases', () => {
		const list = [
			release(106, { assets: [] }),
			release(107, { draft: true }),
			release(108, { prerelease: true }),
			release(105)
		];
		expect(pickNewestApkRelease(list)?.versionName).toBe('0.0.105');
	});

	it.each([
		[{ state: 'up_to_date' }, 'up-to-date'],
		[{ state: 'downloading', percent: 40 }, 'downloading'],
		[{ state: 'staged', release: '0.0.98', runningVersion: '0.0.97' }, 'staged'],
		[{ state: 'staged', release: '0.0.98', runningVersion: '0.0.98' }, 'up-to-date'],
		[{ state: 'shell_update' }, 'available'],
		[{}, 'idle']
	] as const)('AndySU %o → %s', (s, phase) => {
		expect(phaseFromAndy(s)).toBe(phase);
	});
});
