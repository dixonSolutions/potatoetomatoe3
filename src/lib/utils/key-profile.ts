/**
 * What the running game actually reads from the keyboard.
 *
 * The native bridge (`src-tauri/gen/android/app/src/main/res/raw/native_touch_bridge.js`)
 * sits inside every game frame from document start and posts
 * `potato-tomato-key-profile` up to this frame as it learns. This module is the other
 * half: it merges those reports per game, remembers them for the session, and hands the
 * console a set of codes worth showing.
 *
 * Reports arrive over `postMessage` from cross-origin game frames, so treat every field
 * as untrusted input: shapes are validated, codes are filtered against a fixed
 * allow-list, and array lengths are capped before anything reaches the UI.
 */

/** Codes the console can emit. Anything else in a report is discarded. */
const EMITTABLE = new Set([
	'ArrowUp',
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
	'KeyW',
	'KeyA',
	'KeyS',
	'KeyD',
	'Space',
	'Enter',
	'Escape',
	'ShiftLeft',
	'ControlLeft',
	'KeyQ',
	'KeyE',
	'KeyR',
	'KeyF',
	'KeyC',
	'KeyV',
	'KeyX',
	'KeyZ',
	'KeyJ',
	'KeyK',
	'KeyL',
	'KeyM',
	'KeyN',
	'KeyP',
	'Digit1',
	'Digit2',
	'Digit3',
	'Digit4',
	'Digit5',
	'Digit6',
	'Digit7',
	'Digit8',
	'Digit9',
	'Digit0'
]);

const MAX_CODES = 40;

export const KEY_PROFILE_MESSAGE = 'potato-tomato-key-profile';
export const KEY_PROFILE_CHANGED = 'potato-tomato-key-profile-changed';

/**
 * How much the console is allowed to act on what it knows.
 *
 * - `none`   nothing reported yet — leave the layout exactly as the user configured it.
 * - `weak`   codes were read out of handler source. Minified engines and wasm hide most
 *            of their comparisons, so an absent code is not evidence of an unused key:
 *            enough to fade a control, never enough to remove one.
 * - `strong` the game's own control blurb named the keys. Safe to hide the rest.
 */
export type KeyProfileConfidence = 'none' | 'weak' | 'strong';

export type KeyProfile = {
	gameId: string;
	/** True once any non-ad game frame reported at least one key listener. */
	listens: boolean;
	/** Total key listeners seen across reporting frames — diagnostics only. */
	listenerCount: number;
	/** Codes named by the game's own controls text. */
	declared: string[];
	/** Codes read out of handler and script source. */
	inferred: string[];
	/** How many distinct frames have reported. */
	frames: number;
	updatedAt: number;
};

export function emptyKeyProfile(gameId: string): KeyProfile {
	return {
		gameId,
		listens: false,
		listenerCount: 0,
		declared: [],
		inferred: [],
		frames: 0,
		updatedAt: 0
	};
}

function sanitizeCodes(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	const out: string[] = [];
	for (const entry of raw) {
		if (typeof entry !== 'string' || !EMITTABLE.has(entry)) continue;
		if (out.includes(entry)) continue;
		out.push(entry);
		if (out.length >= MAX_CODES) break;
	}
	return out;
}

type RawReport = {
	url: string;
	listens: boolean;
	listenerCount: number;
	declared: string[];
	inferred: string[];
};

/** Null when the message is not a well-formed profile report. */
export function parseKeyProfileMessage(data: unknown): RawReport | null {
	if (!data || typeof data !== 'object') return null;
	const d = data as Record<string, unknown>;
	if (d.type !== KEY_PROFILE_MESSAGE || d.v !== 1) return null;
	const count = typeof d.listenerCount === 'number' && d.listenerCount >= 0 ? d.listenerCount : 0;
	return {
		url: typeof d.url === 'string' ? d.url.slice(0, 300) : '',
		listens: d.listens === true,
		listenerCount: Math.min(count, 10000),
		declared: sanitizeCodes(d.declared),
		inferred: sanitizeCodes(d.inferred)
	};
}

/**
 * Fold one frame's report into the running profile.
 *
 * Frames are merged with OR rather than replaced: a portal shell knows the declared
 * controls while the nested game frame knows whether anything listens, and neither can
 * see what the other found. Returns a new object when something changed, or `previous`
 * unchanged so callers can skip re-rendering.
 */
export function mergeKeyProfile(previous: KeyProfile, report: RawReport, now: number): KeyProfile {
	const declared = [...new Set([...previous.declared, ...report.declared])].sort();
	const inferred = [...new Set([...previous.inferred, ...report.inferred])].sort();
	const listens = previous.listens || report.listens;
	const listenerCount = Math.max(previous.listenerCount, report.listenerCount);
	/*
	 * The first report always lands, even when it carries nothing.
	 *
	 * "No listeners, no codes" is identical in shape to a profile nobody has reported yet,
	 * so a plain content comparison threw away the one message that says the game ignores
	 * the keyboard — the console kept its full layout and never showed the badge. `frames`
	 * is what separates "known to be empty" from "not heard from".
	 */
	const unchanged =
		previous.frames > 0 &&
		listens === previous.listens &&
		listenerCount === previous.listenerCount &&
		declared.length === previous.declared.length &&
		inferred.length === previous.inferred.length &&
		declared.every((c, i) => c === previous.declared[i]) &&
		inferred.every((c, i) => c === previous.inferred[i]);
	if (unchanged) return previous;
	return {
		gameId: previous.gameId,
		listens,
		listenerCount,
		declared,
		inferred,
		frames: previous.frames + 1,
		updatedAt: now
	};
}

export function keyProfileConfidence(profile: KeyProfile): KeyProfileConfidence {
	if (profile.declared.length > 0) return 'strong';
	if (profile.inferred.length > 0) return 'weak';
	return 'none';
}

/** Every code the profile has any evidence for. */
export function keyProfileCodes(profile: KeyProfile): Set<string> {
	return new Set([...profile.declared, ...profile.inferred]);
}

/**
 * True once we can say the game ignores the keyboard entirely.
 *
 * Needs a frame to have actually reported — silence is "not yet known", not "no". The
 * bridge sweeps on DOMContentLoaded and again at 2.5s and 8s, so a game that binds
 * nothing still sends `listens: false` rather than saying nothing at all.
 */
export function keyProfileSaysNoKeyboard(profile: KeyProfile): boolean {
	return profile.frames > 0 && !profile.listens && keyProfileCodes(profile).size === 0;
}

const STORAGE_PREFIX = 'potato-tomato-key-profile:';

export function readCachedKeyProfile(gameId: string): KeyProfile {
	const base = emptyKeyProfile(gameId);
	if (!gameId || typeof sessionStorage === 'undefined') return base;
	try {
		const raw = sessionStorage.getItem(STORAGE_PREFIX + gameId);
		if (!raw) return base;
		const parsed = JSON.parse(raw) as Partial<KeyProfile>;
		return {
			gameId,
			listens: parsed.listens === true,
			listenerCount: typeof parsed.listenerCount === 'number' ? parsed.listenerCount : 0,
			declared: sanitizeCodes(parsed.declared),
			inferred: sanitizeCodes(parsed.inferred),
			frames: typeof parsed.frames === 'number' ? parsed.frames : 0,
			updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0
		};
	} catch {
		return base;
	}
}

function writeCachedKeyProfile(profile: KeyProfile): void {
	if (!profile.gameId || typeof sessionStorage === 'undefined') return;
	try {
		sessionStorage.setItem(STORAGE_PREFIX + profile.gameId, JSON.stringify(profile));
	} catch {
		/* private mode / quota — the profile is a nicety, not state worth failing over */
	}
}

/**
 * Watch for reports about `gameId` until the returned function is called.
 *
 * Starts from the session cache so a game re-opened in the same session gets its trimmed
 * console on the first frame instead of flickering from the full layout down to it.
 */
export function observeKeyProfile(
	gameId: string,
	onChange: (profile: KeyProfile) => void
): () => void {
	let profile = readCachedKeyProfile(gameId);
	if (profile.frames > 0) onChange(profile);
	if (typeof window === 'undefined') return () => {};

	const onMessage = (event: MessageEvent) => {
		/* Our own frame never reports; anything claiming to is not the game. */
		if (event.source === window) return;
		const report = parseKeyProfileMessage(event.data);
		if (!report) return;
		const next = mergeKeyProfile(profile, report, Date.now());
		if (next === profile) return;
		profile = next;
		writeCachedKeyProfile(profile);
		onChange(profile);
		try {
			window.dispatchEvent(new CustomEvent(KEY_PROFILE_CHANGED, { detail: profile }));
		} catch {
			/* older engine without CustomEvent constructor */
		}
	};

	window.addEventListener('message', onMessage);
	return () => window.removeEventListener('message', onMessage);
}
