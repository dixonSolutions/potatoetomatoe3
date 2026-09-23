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

import { parseControlsText } from './controls-text';

/**
 * Codes the console can emit. Anything else in a report is discarded.
 *
 * Kept in step with `EMITTABLE` in the native bridge. Every letter is listed because a
 * player can rebind a button to any key, and dropping a code here would drop it from the
 * declared set — which is the evidence that decides what gets hidden.
 */
const EMITTABLE = new Set([
	'ArrowUp',
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
	'Space',
	'Enter',
	'Escape',
	'ShiftLeft',
	'ControlLeft',
	'KeyA',
	'KeyB',
	'KeyC',
	'KeyD',
	'KeyE',
	'KeyF',
	'KeyG',
	'KeyH',
	'KeyI',
	'KeyJ',
	'KeyK',
	'KeyL',
	'KeyM',
	'KeyN',
	'KeyO',
	'KeyP',
	'KeyQ',
	'KeyR',
	'KeyS',
	'KeyT',
	'KeyU',
	'KeyV',
	'KeyW',
	'KeyX',
	'KeyY',
	'KeyZ',
	'Digit0',
	'Digit1',
	'Digit2',
	'Digit3',
	'Digit4',
	'Digit5',
	'Digit6',
	'Digit7',
	'Digit8',
	'Digit9'
]);

const MAX_CODES = 40;

export const KEY_PROFILE_MESSAGE = 'potato-tomato-key-profile';
export const KEY_PROFILE_CHANGED = 'potato-tomato-key-profile-changed';

/**
 * How much the console is allowed to act on what it knows.
 *
 * Only what the running game does counts. Text — a portal blurb, a "How to play" panel,
 * the catalog description — says what a page *claims*, and reading prose is guesswork
 * however careful the parser; it supplies captions and an "unconfirmed" list, never the
 * layout.
 *
 * - `none`   no runtime evidence yet — leave the layout exactly as the user configured it.
 * - `weak`   keys found in handler source, or seen handled. Enough to fade a control,
 *            never to remove one: one press of Space says Space matters, not that Z does
 *            not, and minified or wasm engines hide most of their comparisons.
 * - `strong` the game's engine registered its keys through its API (Phaser, PlayCanvas,
 *            GDevelop, Kaboom, Scratch blocks) — an exact list. Safe to hide the rest.
 */
export type KeyProfileConfidence = 'none' | 'weak' | 'strong';

export type KeyProfile = {
	gameId: string;
	/** True once any non-ad game frame reported at least one key listener. */
	listens: boolean;
	/** Total key listeners seen across reporting frames — diagnostics only. */
	listenerCount: number;
	/**
	 * Codes *mentioned* in text (controls blurbs, page panels, the catalog description).
	 * Unverified — shown as such, used for captions, never for the layout.
	 */
	declared: string[];
	/** Codes the game's engine registered through its own API — exact. */
	bound: string[];
	/** Purposes the engine itself names (Phaser `addKeys({ jump: 'SPACE' })`). */
	boundPurposes: Record<string, string>;
	/** Engine the bridge recognised, when any ("phaser3", "playcanvas", …). */
	engine: string;
	/** Codes read out of handler and script source. */
	inferred: string[];
	/**
	 * Codes the game was seen handling while it ran — it called `preventDefault` on a
	 * press, from the real keyboard or from the console. Grows as the player plays.
	 */
	used: string[];
	/** Code → what it does, from the game's controls text ("Jump"). */
	purposes: Record<string, string>;
	/** Codes the game handled only together with Ctrl / Alt / Meta — app shortcuts. */
	shortcuts: string[];
	/** The game has a text box the player typed into — letters there are typing, not play. */
	textEntry: boolean;
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
		bound: [],
		boundPurposes: {},
		engine: '',
		inferred: [],
		used: [],
		purposes: {},
		shortcuts: [],
		textEntry: false,
		frames: 0,
		updatedAt: 0
	};
}

const MAX_PURPOSE = 32;

function sanitizePurposes(raw: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	if (!raw || typeof raw !== 'object') return out;
	let n = 0;
	for (const [code, text] of Object.entries(raw as Record<string, unknown>)) {
		if (!EMITTABLE.has(code) || typeof text !== 'string') continue;
		const clean = text
			.replace(/[\p{Cc}<>]/gu, '')
			.trim()
			.slice(0, MAX_PURPOSE);
		if (!clean) continue;
		out[code] = clean;
		if (++n >= MAX_CODES) break;
	}
	return out;
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
	used: string[];
	bound?: string[];
	boundPurposes?: Record<string, string>;
	engine?: string;
	purposes: Record<string, string>;
	/** Codes named by `controlsText`, read on this side. */
	declaredText?: string[];
	shortcuts: string[];
	textEntry: boolean;
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
		inferred: sanitizeCodes(d.inferred),
		/* Optional: the Android bridge does not observe live use. */
		used: sanitizeCodes(d.used),
		...controlsFromText(d.controlsText),
		shortcuts: sanitizeCodes(d.shortcuts),
		textEntry: d.textEntry === true,
		bound: sanitizeCodes(d.bound),
		boundPurposes: sanitizePurposes(d.boundPurposes),
		engine: typeof d.engine === 'string' && /^[a-z0-9]{1,16}$/.test(d.engine) ? d.engine : ''
	};
}

/**
 * The bridge forwards the game's controls text as-is; it is read here, where it can be
 * tested and where the reading can improve without touching code that runs inside games.
 */
function controlsFromText(raw: unknown): {
	purposes: Record<string, string>;
	declaredText: string[];
} {
	if (typeof raw !== 'string' || !raw) return { purposes: {}, declaredText: [] };
	const parsed = parseControlsText(raw.slice(0, 4000));
	return {
		purposes: sanitizePurposes(parsed.purposes),
		declaredText: sanitizeCodes(parsed.codes)
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
	const declared = [
		...new Set([...previous.declared, ...report.declared, ...(report.declaredText ?? [])])
	].sort();
	const inferred = [...new Set([...previous.inferred, ...report.inferred])].sort();
	const used = [...new Set([...previous.used, ...report.used])].sort();
	const shortcuts = [...new Set([...previous.shortcuts, ...report.shortcuts])].sort();
	const bound = [...new Set([...previous.bound, ...(report.bound ?? [])])].sort();
	const boundPurposes = { ...(report.boundPurposes ?? {}), ...previous.boundPurposes };
	const engine = previous.engine || report.engine || '';
	const textEntry = previous.textEntry || report.textEntry;
	/* First purpose wins: the controls text does not change while a game runs. */
	const purposes = { ...report.purposes, ...previous.purposes };
	const purposesSame = Object.keys(purposes).length === Object.keys(previous.purposes).length;
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
		used.length === previous.used.length &&
		declared.every((c, i) => c === previous.declared[i]) &&
		inferred.every((c, i) => c === previous.inferred[i]) &&
		used.every((c, i) => c === previous.used[i]) &&
		shortcuts.length === previous.shortcuts.length &&
		textEntry === previous.textEntry &&
		bound.length === previous.bound.length &&
		Object.keys(boundPurposes).length === Object.keys(previous.boundPurposes).length &&
		engine === previous.engine &&
		purposesSame;
	if (unchanged) return previous;
	return {
		gameId: previous.gameId,
		listens,
		listenerCount,
		declared,
		inferred,
		used,
		bound,
		boundPurposes,
		engine,
		purposes,
		shortcuts,
		textEntry,
		frames: previous.frames + 1,
		updatedAt: now
	};
}

export function keyProfileConfidence(profile: KeyProfile): KeyProfileConfidence {
	if (profile.bound.length > 0) return 'strong';
	if (profile.inferred.length > 0 || profile.used.length > 0) return 'weak';
	return 'none';
}

/** Every code the running game gave evidence for. Text mentions are not evidence. */
export function keyProfileCodes(profile: KeyProfile): Set<string> {
	return new Set([...profile.bound, ...profile.used, ...profile.inferred]);
}

/**
 * How we know about one code, most reliable first.
 *
 * - `used`     the game handled a press of it
 * - `bound`    its engine registered it
 * - `inferred` it appears in key-handler source
 * - `declared` only *mentioned* in text — unconfirmed
 */
export type KeyEvidence = 'used' | 'bound' | 'inferred' | 'declared' | 'none';

export function keyEvidence(profile: KeyProfile, code: string): KeyEvidence {
	if (profile.used.includes(code)) return 'used';
	if (profile.bound.includes(code)) return 'bound';
	if (profile.inferred.includes(code)) return 'inferred';
	if (profile.declared.includes(code)) return 'declared';
	return 'none';
}

/** What a key does: the engine's own name for it first, then the controls text. */
export function keyPurpose(profile: KeyProfile, code: string): string {
	return profile.boundPurposes[code] ?? profile.purposes[code] ?? '';
}

/**
 * Fold the catalog's own description into a profile.
 *
 * Catalog blurbs often name the controls ("Use the arrow keys to move and Space to
 * jump"). That is text, so it only adds *mentions* and captions — never layout decisions.
 */
export function withControlsHint(
	profile: KeyProfile,
	hintText: string | null | undefined
): KeyProfile {
	if (!hintText) return profile;
	const parsed = parseControlsText(hintText);
	const codes = sanitizeCodes(parsed.codes);
	if (!codes.length) return profile;
	const declared = [...new Set([...profile.declared, ...codes])].sort();
	const purposes = { ...sanitizePurposes(parsed.purposes), ...profile.purposes };
	if (
		declared.length === profile.declared.length &&
		Object.keys(purposes).length === Object.keys(profile.purposes).length
	) {
		return profile;
	}
	return { ...profile, declared, purposes };
}

/**
 * What a key is for, as far as the console is concerned.
 *
 * - `gameplay` press it on the console.
 * - `shortcut` the game only handled it with Ctrl / Alt / Meta held (save, undo, devtools):
 *              listed for completeness, never added to the pad.
 * - `typing`   a letter or digit that feeds a text box — a name entry, a chat, a code.
 *              The device keyboard does that better than any button, so the console
 *              offers to open it instead of growing a key per letter.
 *
 * The hard part is a letter that is both: a game can read W for movement *and* have a
 * name field. Anything the controls text names, or that was seen driving play, stays
 * `gameplay`; only keys with no such evidence fall to `typing`.
 */
export type KeyKind = 'gameplay' | 'shortcut' | 'typing';

const TEXT_CODE = /^(Key[A-Z]|Digit[0-9])$/;

/**
 * A handler that compares against most of the alphabet is reading text, not controls —
 * no game binds twenty letters to actions.
 */
export function keyProfileLooksLikeTyping(profile: KeyProfile): boolean {
	if (profile.textEntry) return true;
	const letters = profile.inferred.filter((c) => c.startsWith('Key')).length;
	return letters >= 18 && profile.declared.filter((c) => c.startsWith('Key')).length === 0;
}

export function keyKind(profile: KeyProfile, code: string): KeyKind {
	const named = profile.bound.includes(code) || profile.used.includes(code);
	if (profile.shortcuts.includes(code) && !named) return 'shortcut';
	if (TEXT_CODE.test(code) && !named && keyProfileLooksLikeTyping(profile)) return 'typing';
	return 'gameplay';
}

export type DetectedControl = {
	code: string;
	evidence: KeyEvidence;
	kind: KeyKind;
	purpose: string;
};

const EVIDENCE_RANK: Record<KeyEvidence, number> = {
	used: 0,
	bound: 1,
	inferred: 2,
	declared: 3,
	none: 4
};
const KIND_RANK: Record<KeyKind, number> = { gameplay: 0, shortcut: 1, typing: 2 };

/** Every key with any evidence, gameplay first, strongest first. */
export function detectedControls(profile: KeyProfile): DetectedControl[] {
	const codes = new Set([...keyProfileCodes(profile), ...profile.declared, ...profile.shortcuts]);
	const out: DetectedControl[] = [];
	for (const code of codes) {
		const seen = keyEvidence(profile, code);
		/* A shortcut was seen handled — with a modifier, but seen all the same. */
		const evidence = seen === 'none' && profile.shortcuts.includes(code) ? 'used' : seen;
		out.push({
			code,
			evidence,
			kind: keyKind(profile, code),
			purpose: keyPurpose(profile, code)
		});
	}
	return out.sort(
		(a, b) =>
			KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
			EVIDENCE_RANK[a.evidence] - EVIDENCE_RANK[b.evidence] ||
			Number(Boolean(b.purpose)) - Number(Boolean(a.purpose)) ||
			a.code.localeCompare(b.code)
	);
}

const DIRECTION_SETS = [
	['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
	['KeyW', 'KeyA', 'KeyS', 'KeyD']
];

/**
 * Keys the game needs that the console does not have yet — what makes the pad dynamic.
 *
 * Only strong evidence earns a button (named in the controls, or seen in use), and only
 * gameplay keys. `covered` is every code the visible console already sends. The other
 * direction set is skipped when it only duplicates the stick ("WASD or arrows = move");
 * a second set with its own purpose (player two, aiming) still gets buttons.
 */
export function planExtraControls(
	profile: KeyProfile,
	covered: Iterable<string>,
	max = 4
): DetectedControl[] {
	const have = new Set(covered);
	const stickPurposes = new Set(
		[...have].map((c) => keyPurpose(profile, c)).filter((p): p is string => Boolean(p))
	);
	return detectedControls(profile)
		.filter((c) => c.kind === 'gameplay')
		.filter((c) => c.evidence === 'used' || c.evidence === 'bound')
		.filter((c) => !have.has(c.code))
		.filter((c) => {
			const set = DIRECTION_SETS.find((s) => s.includes(c.code));
			if (!set) return true;
			return Boolean(c.purpose) && !stickPurposes.has(c.purpose);
		})
		.slice(0, max);
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

/** What the console should do with one control, given what the profile knows. */
export type ControlFate = 'show' | 'dim' | 'hide';

export type ControlSpec = { id: string; codes: string[] };

/**
 * Decide the fate of every console control in one pass.
 *
 * It has to be one pass rather than a per-control test, because of the floor at the end:
 * a verdict that would leave nothing on screen is not a finding, it is a parse error.
 * Declared codes come from prose written for people, and prose parsing will eventually
 * misread something — one bogus code that matches no control at all would make every
 * button and the joystick qualify as unused, and the console would render empty. No real
 * game has an empty control scheme, so that outcome drops the whole trim back to fading.
 * It costs nothing when the parse is right, because then something always matches.
 */
export function planControlVisibility(
	profile: KeyProfile,
	controls: ControlSpec[]
): Record<string, ControlFate> {
	const confidence = keyProfileConfidence(profile);
	/* Exact evidence: the engine bound it, or the game was seen handling it. */
	const sure = new Set([...profile.bound, ...profile.used]);
	const likely = new Set(profile.inferred);
	const plan: Record<string, ControlFate> = {};
	let anyShown = false;

	for (const control of controls) {
		if (!control.codes.length || confidence === 'none') {
			plan[control.id] = 'show';
			anyShown = true;
			continue;
		}
		if (control.codes.some((c) => sure.has(c))) {
			plan[control.id] = 'show';
			anyShown = true;
			continue;
		}
		if (confidence === 'weak') {
			plan[control.id] = likely.size && control.codes.some((c) => likely.has(c)) ? 'show' : 'dim';
			if (plan[control.id] === 'show') anyShown = true;
			continue;
		}
		/*
		 * Strong: the engine's list is exact for the engine, but a game can also bind a raw
		 * DOM listener beside it (a pause key, say) — a key found in handler source fades
		 * instead of vanishing.
		 */
		plan[control.id] = control.codes.some((c) => likely.has(c)) ? 'dim' : 'hide';
	}

	if (!anyShown) {
		for (const id of Object.keys(plan)) {
			if (plan[id] === 'hide') plan[id] = 'dim';
		}
	}
	return plan;
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
			used: sanitizeCodes(parsed.used),
			bound: sanitizeCodes(parsed.bound),
			boundPurposes: sanitizePurposes(parsed.boundPurposes),
			engine: typeof parsed.engine === 'string' ? parsed.engine.slice(0, 16) : '',
			purposes: sanitizePurposes(parsed.purposes),
			shortcuts: sanitizeCodes(parsed.shortcuts),
			textEntry: parsed.textEntry === true,
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
