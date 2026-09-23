import { Clock, Gamepad2, Joystick, Shield, Smartphone, Volume2 } from 'lucide-svelte';
import { isTauriAndroidBuild, isTauriApp, isTauriMobileBuild } from '$lib/utils/offline-deployment';
import { SETTINGS_SECTION_ORDER, type SettingsSectionId } from './settings-section-ids';

export type { SettingsSectionId } from './settings-section-ids';

export type SettingsSectionDef = {
	id: SettingsSectionId;
	title: string;
	/** One line under the title; also the second line in the phone list. */
	description: string;
	/** A lucide icon; they share one component type. */
	icon: typeof Gamepad2;
};

const DEFS: Record<SettingsSectionId, Omit<SettingsSectionDef, 'id'>> = {
	playing: { title: 'Playing', description: 'How games open and behave.', icon: Gamepad2 },
	controls: {
		title: 'Controls',
		description: 'On-screen joystick and buttons for touch play.',
		icon: Joystick
	},
	sound: { title: 'Sound', description: 'Volume, and when to mute.', icon: Volume2 },
	privacy: { title: 'Privacy', description: 'Password lock and tab disguise.', icon: Shield },
	'play-time': {
		title: 'Play time',
		description: 'Daily limit and what gets recommended.',
		icon: Clock
	},
	app: { title: 'App', description: 'Updates, and what closing the window does.', icon: Smartphone }
};

export const SETTINGS_SECTIONS: readonly SettingsSectionDef[] = SETTINGS_SECTION_ORDER.map(
	(id) => ({ id, ...DEFS[id] })
);

/**
 * The App section only has something to show in an installed app: updates where it can
 * update itself (Android), the close-to-tray switch on the desktop.
 */
export function isSettingsSectionAvailable(id: SettingsSectionId): boolean {
	if (id === 'app') return isTauriAndroidBuild() || (isTauriApp() && !isTauriMobileBuild());
	return true;
}

export function getSettingsSection(id: SettingsSectionId): SettingsSectionDef {
	return SETTINGS_SECTIONS.find((s) => s.id === id) ?? SETTINGS_SECTIONS[0];
}
