import type { SettingsSearchSectionDef } from './settings-search-types';

/** Index for global search: section-wide or per-subsection keyword hits. */
export const SETTINGS_SEARCH_INDEX: SettingsSearchSectionDef[] = [
	{
		id: 'search-sec-privacy',
		title: 'Privacy mode',
		panel: 'privacy',
		sectionKeywords:
			'privacy mode tab disguise lock passcode timing google microsoft docs word excel powerpoint screen passcode protection keyboard shortcut hotkey',
		subsections: [
			{
				id: 'sub-disguise-settings',
				label: 'Disguise settings',
				scrollTargetId: 'settings-section-pm-disguise-settings',
				keywords:
					'disguise provider google microsoft service docs sheets slides word excel powerpoint outlook onedrive tab title icon lock screen'
			},
			{
				id: 'sub-disguise',
				label: 'When to disguise',
				scrollTargetId: 'settings-section-pm-disguise',
				keywords: 'disguise tab title icon background lock screen when background always off'
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
	},
	{
		id: 'search-sec-games',
		title: 'Games',
		panel: 'games',
		sectionKeywords:
			'games play online offline default version unity download bundled pause resume shortcut tray quit close',
		subsections: [
			{
				id: 'sub-games-default-mode',
				label: 'Default play source',
				scrollTargetId: 'settings-section-games-default-mode',
				keywords: 'default online offline play source version bundled download'
			},
			{
				id: 'sub-games-pause-shortcut',
				label: 'Pause / resume shortcut',
				scrollTargetId: 'settings-section-games-pause-shortcut',
				keywords: 'pause resume shortcut backtick hotkey keyboard game xonotic'
			},
			{
				id: 'sub-games-close-to-tray',
				label: 'Close to tray',
				scrollTargetId: 'settings-section-games-close-to-tray',
				keywords: 'tray close quit background gnome silverblue desktop appindicator'
			}
		]
	},
	{
		id: 'search-sec-touch',
		title: 'Touch Controls',
		panel: 'touch',
		sectionKeywords:
			'touch mobile gamepad overlay joystick buttons virtual controller console glass toggle',
		subsections: [
			{
				id: 'sub-touch-enabled',
				label: 'Enable touch console',
				scrollTargetId: 'settings-section-touch-enabled',
				keywords: 'enable touch overlay mobile gamepad console'
			},
			{
				id: 'sub-touch-availability',
				label: 'When to show the toggle',
				scrollTargetId: 'settings-section-touch-availability',
				keywords: 'availability auto always off mobile desktop toggle'
			},
			{
				id: 'sub-touch-appearance',
				label: 'Appearance',
				scrollTargetId: 'settings-section-touch-appearance',
				keywords: 'opacity scale size haptics vibration appearance'
			},
			{
				id: 'sub-touch-layout',
				label: 'Layout',
				scrollTargetId: 'settings-section-touch-layout',
				keywords: 'layout landscape portrait position size drag preview reset copy'
			},
			{
				id: 'sub-touch-mapping',
				label: 'Key mapping',
				scrollTargetId: 'settings-section-touch-mapping',
				keywords: 'mapping keys remap arrows wasd space enter escape button binding'
			}
		]
	},
	{
		id: 'search-sec-updates',
		title: 'Updates',
		panel: 'updates',
		sectionKeywords: 'update apk android download release github about version latest',
		subsections: [
			{
				id: 'sub-updates-android',
				label: 'Android APK download',
				scrollTargetId: 'settings-section-updates-android',
				keywords: 'android apk download latest github release update install'
			}
		]
	}
];
