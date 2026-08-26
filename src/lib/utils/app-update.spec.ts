import { describe, expect, it } from 'vitest';
import {
	compareVersions,
	isTrustedApkUrl,
	selectLatestApkAsset,
	versionsBehind
} from './app-update';

describe('app-update', () => {
	it('selects the Potato Tomato APK from the latest GitHub release', () => {
		const selected = selectLatestApkAsset({
			tag_name: 'release-55',
			html_url: 'https://github.com/dixonSolutions/potatoetomatoe3/releases/tag/release-55',
			published_at: '2026-07-14T00:00:00Z',
			assets: [
				{
					name: 'notes.txt',
					browser_download_url:
						'https://github.com/dixonSolutions/potatoetomatoe3/releases/download/release-55/notes.txt'
				},
				{
					name: 'potato-tomato-0.0.55.apk',
					browser_download_url:
						'https://github.com/dixonSolutions/potatoetomatoe3/releases/download/release-55/potato-tomato-0.0.55.apk',
					content_type: 'application/vnd.android.package-archive',
					size: 188402968
				}
			]
		});

		expect(selected).toEqual({
			tag: 'release-55',
			versionName: '0.0.55',
			apkName: 'potato-tomato-0.0.55.apk',
			apkUrl:
				'https://github.com/dixonSolutions/potatoetomatoe3/releases/download/release-55/potato-tomato-0.0.55.apk',
			releaseUrl: 'https://github.com/dixonSolutions/potatoetomatoe3/releases/tag/release-55',
			publishedAt: '2026-07-14T00:00:00Z',
			apkSize: 188402968
		});
	});

	it('rejects releases without a trusted APK asset', () => {
		expect(
			selectLatestApkAsset({
				tag_name: 'release-55',
				html_url: 'https://github.com/dixonSolutions/potatoetomatoe3/releases/tag/release-55',
				assets: [
					{
						name: 'evil.apk',
						browser_download_url: 'https://evil.example/potato.apk'
					}
				]
			})
		).toBeNull();
	});

	it('only trusts APK URLs served from this repo', () => {
		expect(
			isTrustedApkUrl(
				'https://github.com/dixonSolutions/potatoetomatoe3/releases/download/release-73/potato-tomato-0.0.73.apk'
			)
		).toBe(true);
		/* Right repo, wrong extension — ACTION_VIEW on an .html would open a page, not a download. */
		expect(
			isTrustedApkUrl(
				'https://github.com/dixonSolutions/potatoetomatoe3/releases/download/release-73/index.html'
			)
		).toBe(false);
		expect(isTrustedApkUrl('https://evil.example/potato-tomato-0.0.73.apk')).toBe(false);
		expect(isTrustedApkUrl('http://github.com/dixonSolutions/potatoetomatoe3/x.apk')).toBe(false);
	});

	it('orders versions so a local build always looks older than a release', () => {
		expect(compareVersions('0.0.75', '0.0.74')).toBeGreaterThan(0);
		expect(compareVersions('0.0.74', '0.0.75')).toBeLessThan(0);
		expect(compareVersions('0.0.75', '0.0.75')).toBe(0);
		/* Locally built APKs report 0.0.1 — every real release must beat that. */
		expect(compareVersions('0.0.75', '0.0.1')).toBeGreaterThan(0);
		/* 10 > 9 numerically, not lexically. */
		expect(compareVersions('0.0.10', '0.0.9')).toBeGreaterThan(0);
		/* Garbage segments sort as 0 rather than NaN-poisoning the comparison. */
		expect(compareVersions('0.0.x', '0.0.1')).toBeLessThan(0);
	});

	it('counts releases behind for the update badge', () => {
		expect(versionsBehind('0.0.73', '0.0.75')).toBe(2);
		expect(versionsBehind('0.0.75', '0.0.75')).toBe(0);
		/* Already ahead of the published release — never render a negative badge. */
		expect(versionsBehind('0.0.76', '0.0.75')).toBe(0);
		/* Off the 0.0.N line: report "1 update" rather than an invented count. */
		expect(versionsBehind('1.2.3', '0.0.75')).toBe(0);
		expect(versionsBehind('0.0.x', '0.0.75')).toBe(1);
	});
});
