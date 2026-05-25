import { SETTINGS_SEARCH_INDEX } from './settings-search-index';
import type { SearchResultSection } from './settings-search-types';

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

export function computeGlobalSearchResults(q: string): SearchResultSection[] {
	const query = q.trim();
	if (!query) return [];
	const out: SearchResultSection[] = [];
	for (const sec of SETTINGS_SEARCH_INDEX) {
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
