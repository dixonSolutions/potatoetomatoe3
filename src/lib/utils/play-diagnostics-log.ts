/**
 * In-memory ring buffer for play / offline diagnostics shown in the game page
 * "View logs" dialog. Survives within the SPA session only.
 */

export type PlayLogLevel = 'info' | 'warn' | 'error';

export interface PlayLogEntry {
	id: number;
	at: number;
	level: PlayLogLevel;
	scope: string;
	message: string;
	detail?: string;
}

const MAX_ENTRIES = 200;
let nextId = 1;
const entries: PlayLogEntry[] = [];

export const PLAY_LOG_CHANGED = 'potato-tomato-play-log-changed';

function emitChanged(): void {
	if (typeof window === 'undefined') return;
	window.dispatchEvent(new CustomEvent(PLAY_LOG_CHANGED));
}

export function appendPlayLog(
	level: PlayLogLevel,
	scope: string,
	message: string,
	detail?: string
): void {
	entries.push({
		id: nextId++,
		at: Date.now(),
		level,
		scope,
		message,
		detail: detail?.slice(0, 4000)
	});
	while (entries.length > MAX_ENTRIES) entries.shift();
	emitChanged();
}

export function getPlayLogEntries(): readonly PlayLogEntry[] {
	return entries;
}

export function clearPlayLog(): void {
	entries.length = 0;
	emitChanged();
}

export function formatPlayLogForCopy(): string {
	return entries
		.map((e) => {
			const ts = new Date(e.at).toISOString();
			const detail = e.detail ? `\n  ${e.detail}` : '';
			return `[${ts}] ${e.level.toUpperCase()} (${e.scope}) ${e.message}${detail}`;
		})
		.join('\n');
}
