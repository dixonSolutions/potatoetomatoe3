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

function belongsToGame(entry: PlayLogEntry, gameId?: string): boolean {
	if (!gameId) return true;
	const detail = entry.detail;
	if (!detail) return false;
	const token = `game=${gameId}`;
	const index = detail.indexOf(token);
	if (index === -1) return false;
	const nextChar = detail[index + token.length];
	return nextChar === undefined || nextChar === ' ';
}

export function getPlayLogEntries(gameId?: string): readonly PlayLogEntry[] {
	return gameId ? entries.filter((entry) => belongsToGame(entry, gameId)) : entries;
}

export function clearPlayLog(gameId?: string): void {
	if (!gameId) {
		entries.length = 0;
	} else {
		for (let index = entries.length - 1; index >= 0; index--) {
			if (belongsToGame(entries[index], gameId)) entries.splice(index, 1);
		}
	}
	emitChanged();
}

export function formatPlayLogForCopy(gameId?: string): string {
	return getPlayLogEntries(gameId)
		.map((e) => {
			const ts = new Date(e.at).toISOString();
			const detail = e.detail ? `\n  ${e.detail}` : '';
			return `[${ts}] ${e.level.toUpperCase()} (${e.scope}) ${e.message}${detail}`;
		})
		.join('\n');
}
