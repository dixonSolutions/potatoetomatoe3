export type SettingsSearchSub = {
	id: string;
	label: string;
	scrollTargetId: string;
	keywords: string;
};

export type SettingsSearchSectionDef = {
	id: string;
	title: string;
	panel: 'privacy' | 'audio' | 'mode' | 'analytics';
	sectionKeywords: string;
	subsections: SettingsSearchSub[];
};

export type SearchResultSection = SettingsSearchSectionDef & {
	matchingSubsections: SettingsSearchSub[];
};
