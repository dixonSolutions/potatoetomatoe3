import type { SettingsSearchSectionDef } from './settings-search-types';

/** Index for global search: section-wide or per-subsection keyword hits. */
export const SETTINGS_SEARCH_INDEX: SettingsSearchSectionDef[] = [
	{
		id: 'search-sec-privacy',
		title: 'Privacy mode',
		panel: 'privacy',
		sectionKeywords:
			'privacy mode tab disguise lock passcode timing google docs screen passcode protection keyboard shortcut hotkey',
		subsections: [
			{
				id: 'sub-disguise',
				label: 'Disguise',
				scrollTargetId: 'settings-section-pm-disguise',
				keywords: 'disguise google docs tab title icon background lock screen when'
			},
			{
				id: 'sub-tab-title',
				label: 'Tab title when disguised',
				scrollTargetId: 'settings-section-pm-tab-title',
				keywords: 'tab title document untitled browser disguised'
			},
			{
				id: 'sub-lock-delay',
				label: 'Lock delay',
				scrollTargetId: 'settings-section-pm-lock-delay',
				keywords: 'lock delay seconds away passcode immediately focus leave tab window'
			},
			{
				id: 'sub-lock-shortcut',
				label: 'Lock shortcut',
				scrollTargetId: 'settings-section-pm-lock-shortcut',
				keywords: 'keyboard shortcut hotkey lock privacy immediately press key combination'
			},
			{
				id: 'sub-pause-game',
				label: 'Pause game while locked',
				scrollTargetId: 'settings-section-pm-pause-game',
				keywords: 'pause game iframe overlay screen hide lock'
			},
			{
				id: 'sub-turn-off',
				label: 'Turn off privacy mode',
				scrollTargetId: 'settings-section-pm-turn-off',
				keywords: 'turn off disable privacy remove passcode protection'
			},
			{
				id: 'sub-change-pw',
				label: 'Change password',
				scrollTargetId: 'settings-section-pm-change-password',
				keywords: 'change password current new update'
			}
		]
	},
	{
		id: 'search-sec-audio',
		title: 'Audio',
		panel: 'audio',
		sectionKeywords: 'audio mute volume playback sound',
		subsections: [
			{
				id: 'sub-mute',
				label: 'Mute audio',
				scrollTargetId: 'settings-section-audio-mute',
				keywords: 'mute audio scope background focus tab video'
			},
			{
				id: 'sub-master-volume',
				label: 'Master volume',
				scrollTargetId: 'settings-section-audio-volume',
				keywords: 'master volume slider percent level html'
			},
			{
				id: 'sub-embeds',
				label: 'Embeds note',
				scrollTargetId: 'settings-section-audio-embeds',
				keywords: 'embeds cross-origin web audio browser tab'
			}
		]
	},
	{
		id: 'search-sec-analytics',
		title: 'Analytics',
		panel: 'analytics',
		sectionKeywords:
			'analytics playtime recommendation category taste daily limit local storage algorithm tensor flow',
		subsections: [
			{
				id: 'sub-analytics-limit',
				label: 'Daily playtime limit',
				scrollTargetId: 'settings-section-analytics-limit',
				keywords:
					'daily playtime limit cap minutes today tracked utc global toggle optional enable disable'
			},
			{
				id: 'sub-analytics-taste',
				label: 'Category taste',
				scrollTargetId: 'settings-section-analytics-taste',
				keywords: 'category taste recommendation slider thumbs boost down-rank affinity'
			},
			{
				id: 'sub-analytics-more',
				label: 'Full playtime page',
				scrollTargetId: 'settings-section-analytics-more',
				keywords: 'playtime statistics table per-game sessions full page algorithm preview'
			}
		]
	}
];
