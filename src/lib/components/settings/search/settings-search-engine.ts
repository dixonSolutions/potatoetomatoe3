import { SETTINGS_SEARCH_INDEX } from './settings-search-index';
import type {
	SearchResultGroup,
	SearchResultSection,
	SettingsSearchSectionDef
} from './settings-search-types';
import {
	SETTINGS_SECTION_ORDER,
	resolveSettingsSectionId,
	type SettingsSectionId
} from '../settings-section-ids';

export function wordsQuery(q: string): string[] {
	return q
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.filter((p) => p.length > 0);
}

export function wordsMatchQuery(q: string, blob: string): boolean {
	const words = wordsQuery(q);
	if (words.length === 0) return false;
	const hay = blob.toLowerCase();
	return words.every((w) => hay.includes(w));
}

export function computeGlobalSearchResults(
	q: string,
	index: readonly SettingsSearchSectionDef[] = SETTINGS_SEARCH_INDEX
): SearchResultSection[] {
	const query = q.trim();
	if (!query) return [];
	const out: SearchResultSection[] = [];
	for (const sec of index) {
		const sectionHit = wordsMatchQuery(query, sec.sectionKeywords);
		if (sectionHit) {
			out.push({ ...sec, matchingSubsections: [...sec.subsections] });
		} else {
			const subs = sec.subsections.filter((s) => wordsMatchQuery(query, s.keywords));
			if (subs.length > 0) {
				out.push({ ...sec, matchingSubsections: subs });
			}
		}
	}
	return out;
}

/**
 * Merge hits by the section they open (several index entries can feed one section),
 * drop sections this build does not show, and order them like the navigation.
 */
export function groupSearchResultsBySection(
	results: readonly SearchResultSection[],
	isAvailable: (id: SettingsSectionId) => boolean = () => true
): SearchResultGroup[] {
	const bySection = new Map<SettingsSectionId, SearchResultGroup>();
	for (const result of results) {
		const section = resolveSettingsSectionId(result.panel);
		if (!isAvailable(section)) continue;
		const group = bySection.get(section) ?? { section, hits: [] };
		for (const hit of result.matchingSubsections) {
			if (!group.hits.some((h) => h.scrollTargetId === hit.scrollTargetId)) group.hits.push(hit);
		}
		bySection.set(section, group);
	}
	return SETTINGS_SECTION_ORDER.flatMap((id) => {
		const group = bySection.get(id);
		return group && group.hits.length > 0 ? [group] : [];
	});
}

/** Filter settings sections by search query (all words must appear in the combined blob). */
export function sectionMatches(searchQuery: string, ...blobs: string[]): boolean {
	const q = searchQuery.trim().toLowerCase();
	if (!q) return true;
	const haystack = blobs.join(' ').toLowerCase();
	return q
		.split(/\s+/)
		.filter((p) => p.length > 0)
		.every((part) => haystack.includes(part));
}
