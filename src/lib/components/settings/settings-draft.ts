/**
 * Pure helpers behind a section's unsaved-changes count. Kept free of runes so the
 * server test project can cover them.
 */

/** JSON with object keys sorted, so two equal values always serialise the same way. */
export function stableStringify(value: unknown): string {
	return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value).sort()) {
			out[key] = sortKeys((value as Record<string, unknown>)[key]);
		}
		return out;
	}
	return value;
}

/** One serialised baseline per field, so the count says how many fields changed. */
export function snapshotFields<T extends Record<string, unknown>>(
	value: T
): Record<keyof T, string> {
	const out = {} as Record<keyof T, string>;
	for (const key of Object.keys(value) as (keyof T)[]) {
		out[key] = stableStringify(value[key]);
	}
	return out;
}

export function changedFields<T extends Record<string, unknown>>(
	value: T,
	baseline: Record<keyof T, string>
): (keyof T)[] {
	return (Object.keys(value) as (keyof T)[]).filter(
		(key) => stableStringify(value[key]) !== baseline[key]
	);
}
