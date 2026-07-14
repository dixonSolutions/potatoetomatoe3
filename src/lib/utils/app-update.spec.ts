import { describe, expect, it } from 'vitest';
import { selectLatestApkAsset } from './app-update';

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
					content_type: 'application/vnd.android.package-archive'
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
			publishedAt: '2026-07-14T00:00:00Z'
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
});
