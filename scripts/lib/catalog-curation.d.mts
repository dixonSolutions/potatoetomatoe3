/** Types for catalog-curation.mjs (so TS users don't type-check the script chain it imports). */
export type CurationGame = { id: string; name?: string; sourcePortal?: string };
export type CurationQuality = { tier: string; q?: number; why?: string[] };
export type CurationPlan = {
	replace: { id: string; by: string; reason: string }[];
	remove: { id: string; reason: string }[];
	keep: number;
	aborted?: string;
};
export type CurationFile = {
	version: 1;
	generatedAt: string;
	removed: Record<string, string>;
	aliases: Record<string, string>;
};
export const HARD_REASONS: Set<string>;
export const PORTAL_PREFERENCE: string[];
export function parseReason(why: string): { code: string; ref: string | null };
export function hardReason(
	quality: CurationQuality | undefined | null
): { code: string; ref: string | null } | null;
export function isDistinctiveTitle(key: string): boolean;
export function curateCatalog(
	games: CurationGame[],
	quality: Map<string, CurationQuality> | Record<string, CurationQuality>,
	opts?: { keepIds?: Set<string>; maxRemoveShare?: number }
): CurationPlan;
export function toCurationFile(plan: CurationPlan, generatedAt?: string): CurationFile;
export function resolveAlias(
	aliases: Record<string, string>,
	id: string,
	max?: number
): string | null;
