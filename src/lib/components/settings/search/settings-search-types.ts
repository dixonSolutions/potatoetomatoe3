import type { LegacySettingsPanelId, SettingsSectionId } from '../settings-section-ids';

export type SettingsSearchSub = {
	id: string;
	label: string;
	scrollTargetId: string;
	keywords: string;
};

export type SettingsSearchSectionDef = {
	id: string;
	title: string;
	/** Section the hits open. Panel names from before the regroup ('games', 'audio', …) still work. */
	panel: SettingsSectionId | LegacySettingsPanelId;
	sectionKeywords: string;
	subsections: SettingsSearchSub[];
};

export type SearchResultSection = SettingsSearchSectionDef & {
	matchingSubsections: SettingsSearchSub[];
};

/** Hits gathered under the section they open, in navigation order. */
export type SearchResultGroup = {
	section: SettingsSectionId;
	hits: SettingsSearchSub[];
};
