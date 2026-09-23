/**
 * Section ids and their order, without the icons, so search and its tests can use them.
 * Titles, descriptions and icons live in `settings-sections.ts`.
 */

export type SettingsSectionId = 'playing' | 'controls' | 'sound' | 'privacy' | 'play-time' | 'app';

/** The order the navigation lists them in, and the order search groups its hits. */
export const SETTINGS_SECTION_ORDER: readonly SettingsSectionId[] = [
	'playing',
	'controls',
	'sound',
	'privacy',
	'play-time',
	'app'
];

/** Panel names from before the regroup, still accepted in the search index. */
export type LegacySettingsPanelId = 'games' | 'touch' | 'audio' | 'analytics' | 'updates';

const LEGACY_PANEL_IDS: Record<LegacySettingsPanelId, SettingsSectionId> = {
	games: 'playing',
	touch: 'controls',
	audio: 'sound',
	analytics: 'play-time',
	updates: 'app'
};

export function resolveSettingsSectionId(
	panel: SettingsSectionId | LegacySettingsPanelId
): SettingsSectionId {
	return (LEGACY_PANEL_IDS as Record<string, SettingsSectionId>)[panel] ?? panel;
}
