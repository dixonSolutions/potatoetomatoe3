import { describe, expect, it } from 'vitest';
import { computeGlobalSearchResults, groupSearchResultsBySection } from './settings-search-engine';
import { SETTINGS_SEARCH_INDEX } from './settings-search-index';
import type { SettingsSearchSectionDef } from './settings-search-types';
import { SETTINGS_SECTION_ORDER, resolveSettingsSectionId } from '../settings-section-ids';

describe('settings search', () => {
	it('points every index entry at a section that exists', () => {
		for (const entry of SETTINGS_SEARCH_INDEX) {
			expect(SETTINGS_SECTION_ORDER).toContain(resolveSettingsSectionId(entry.panel));
		}
	});

	it('routes the pre-regroup panel names to the new sections', () => {
		expect(resolveSettingsSectionId('games')).toBe('playing');
		expect(resolveSettingsSectionId('touch')).toBe('controls');
		expect(resolveSettingsSectionId('audio')).toBe('sound');
		expect(resolveSettingsSectionId('analytics')).toBe('play-time');
		expect(resolveSettingsSectionId('updates')).toBe('app');
		expect(resolveSettingsSectionId('privacy')).toBe('privacy');
	});

	it('finds a setting by one of its words and names the section it opens', () => {
		const groups = groupSearchResultsBySection(computeGlobalSearchResults('volume'));
		expect(groups.map((g) => g.section)).toEqual(['sound']);
		expect(groups[0].hits.map((h) => h.scrollTargetId)).toContain('settings-section-audio-volume');
	});

	it('merges entries for the same section and follows navigation order', () => {
		const index: SettingsSearchSectionDef[] = [
			{
				id: 'a',
				title: 'Sound',
				panel: 'sound',
				sectionKeywords: '',
				subsections: [{ id: 's1', label: 'Mute', scrollTargetId: 't1', keywords: 'shared' }]
			},
			{
				id: 'b',
				title: 'Games',
				panel: 'games',
				sectionKeywords: '',
				subsections: [{ id: 's2', label: 'Menu', scrollTargetId: 't2', keywords: 'shared' }]
			},
			{
				id: 'c',
				title: 'Playing extra',
				panel: 'playing',
				sectionKeywords: '',
				subsections: [{ id: 's3', label: 'Fullscreen', scrollTargetId: 't3', keywords: 'shared' }]
			}
		];
		const groups = groupSearchResultsBySection(computeGlobalSearchResults('shared', index));
		expect(groups.map((g) => g.section)).toEqual(['playing', 'sound']);
		expect(groups[0].hits.map((h) => h.id)).toEqual(['s2', 's3']);
	});

	it('leaves out sections this build does not show', () => {
		const groups = groupSearchResultsBySection(
			computeGlobalSearchResults('apk'),
			(id) => id !== 'app'
		);
		expect(groups).toEqual([]);
	});
});
