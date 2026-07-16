/**
 * Chronological operation timeline for harness UIs.
 */

export type TimelineLevel = 'info' | 'warn' | 'error' | 'success';

export interface TimelineEntry {
	id: number;
	at: number;
	level: TimelineLevel;
	label: string;
	detail?: string;
}

let nextId = 1;

export function createTimelineEntry(
	level: TimelineLevel,
	label: string,
	detail?: string
): TimelineEntry {
	return {
		id: nextId++,
		at: Date.now(),
		level,
		label,
		detail: detail?.slice(0, 4000)
	};
}

export function formatTimelineForExport(entries: readonly TimelineEntry[]): string {
	return entries
		.map((entry) => {
			const ts = new Date(entry.at).toISOString();
			const detail = entry.detail ? `\n  ${entry.detail}` : '';
			return `[${ts}] ${entry.level.toUpperCase()} ${entry.label}${detail}`;
		})
		.join('\n');
}
