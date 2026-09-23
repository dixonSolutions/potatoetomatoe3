import type { SettingsSearchSectionDef } from './settings-search-types';

/** Index for global search: section-wide or per-subsection keyword hits. */
export const SETTINGS_SEARCH_INDEX: SettingsSearchSectionDef[] = [
	{
		id: 'search-sec-privacy',
		title: 'Privacy',
		panel: 'privacy',
		sectionKeywords:
			'privacy mode tab disguise lock passcode timing google microsoft docs word excel powerpoint screen passcode protection keyboard shortcut hotkey',
		subsections: [
			{
				id: 'sub-disguise-settings',
				label: 'Look like (Google, Microsoft)',
				scrollTargetId: 'settings-section-pm-disguise-settings',
				keywords:
					'disguise provider google microsoft service docs sheets slides word excel powerpoint outlook onedrive tab title icon lock screen'
			},
			{
				id: 'sub-disguise',
				label: 'Disguise the tab',
				scrollTargetId: 'settings-section-pm-disguise',
				keywords: 'disguise tab title icon background lock screen when background always off'
			},
			{
				id: 'sub-lock-delay',
				label: 'Lock after leaving',
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
				label: 'Turn privacy mode on or off',
				scrollTargetId: 'settings-section-pm-enabled',
				keywords: 'turn on off enable disable privacy remove passcode password protection'
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
		title: 'Sound',
		panel: 'sound',
		sectionKeywords: 'audio mute volume playback sound',
		subsections: [
			{
				id: 'sub-mute',
				label: 'Mute',
				scrollTargetId: 'settings-section-audio-mute',
				keywords: 'mute audio scope background focus tab video'
			},
			{
				id: 'sub-master-volume',
				label: 'Volume',
				scrollTargetId: 'settings-section-audio-volume',
				keywords: 'master volume slider percent level html'
			},
			{
				id: 'sub-embeds',
				label: 'Embedded games',
				scrollTargetId: 'settings-section-audio-embeds',
				keywords: 'embeds cross-origin web audio browser tab'
			}
		]
	},
	{
		id: 'search-sec-analytics',
		title: 'Play time',
		panel: 'play-time',
		sectionKeywords:
			'analytics playtime recommendation category taste daily limit local storage algorithm tensor flow',
		subsections: [
			{
				id: 'sub-analytics-limit',
				label: 'Daily limit',
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
				label: 'Play time and picks page',
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
			'games play online offline default version unity download bundled pause resume shortcut tray quit close fullscreen in-game menu while playing',
		subsections: [
			{
				id: 'sub-games-default-mode',
				label: 'Default play source',
				scrollTargetId: 'settings-section-games-default-mode',
				keywords: 'default online offline play source version bundled download'
			},
			{
				id: 'sub-games-auto-fullscreen',
				label: 'Open games in fullscreen',
				scrollTargetId: 'settings-section-games-auto-fullscreen',
				keywords: 'open games fullscreen full screen auto automatic immersive start while playing'
			},
			{
				id: 'sub-games-menu',
				label: 'In-game menu',
				scrollTargetId: 'settings-section-games-menu',
				keywords:
					'in-game menu button hover edge corner position size touch overlay exit fullscreen back'
			},
			{
				id: 'sub-games-pause-shortcut',
				label: 'Pause / resume shortcut',
				scrollTargetId: 'settings-section-games-pause-shortcut',
				keywords: 'pause resume shortcut backtick hotkey keyboard game xonotic'
			},
			{
				id: 'sub-games-fullscreen-shortcut',
				label: 'Fullscreen shortcut',
				scrollTargetId: 'settings-section-games-fullscreen-shortcut',
				keywords: 'fullscreen full screen shortcut hotkey keyboard f key toggle'
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
		title: 'Controls',
		panel: 'controls',
		sectionKeywords:
			'touch mobile gamepad overlay joystick buttons virtual controller console glass toggle',
		subsections: [
			{
				id: 'sub-touch-enabled',
				label: 'Touch console',
				scrollTargetId: 'settings-section-touch-enabled',
				keywords: 'enable touch overlay mobile gamepad console'
			},
			{
				id: 'sub-touch-availability',
				label: 'Show the console button',
				scrollTargetId: 'settings-section-touch-availability',
				keywords: 'availability auto always off never mobile desktop toggle button'
			},
			{
				id: 'sub-touch-auto-enable',
				label: 'Open on touch-only devices',
				scrollTargetId: 'settings-section-touch-auto-enable',
				keywords: 'auto enable open default touch-only tablet phone keyboard'
			},
			{
				id: 'sub-touch-appearance',
				label: 'Opacity, size and vibration',
				scrollTargetId: 'settings-section-touch-appearance',
				keywords: 'opacity scale size haptics vibration vibrate appearance look'
			},
			{
				id: 'sub-touch-layout',
				label: 'Layout',
				scrollTargetId: 'settings-section-touch-layout',
				keywords: 'layout landscape portrait position size drag preview reset copy'
			},
			{
				id: 'sub-touch-mapping',
				label: 'Keys',
				scrollTargetId: 'settings-section-touch-mapping',
				keywords: 'mapping keys remap arrows wasd space enter escape button binding joystick'
			}
		]
	},
	{
		id: 'search-sec-updates',
		title: 'App',
		panel: 'app',
		sectionKeywords: 'update apk android download release github about version latest',
		subsections: [
			{
				id: 'sub-updates-android',
				label: 'Version and updates',
				scrollTargetId: 'settings-section-updates-android',
				keywords: 'android apk download latest github release update install'
			}
		]
	}
];
