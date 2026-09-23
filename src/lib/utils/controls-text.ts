/**
 * Read a game's controls text the way a player would: which keys it names, and what each
 * one does.
 *
 * Portal shells and catalog descriptions carry the control scheme as prose —
 * "Arrow keys = move, Press J to jump, Space = dash", "Move: WASD / Jump: Z",
 * "Use the arrow keys to move and X to shoot". The key detector already turns that into
 * a set of codes; this adds the *purpose*, so the controls menu can say "J · Jump" and
 * the console can caption the buttons it adds.
 *
 * Conservative on purpose. A key named in the text is strong evidence — it decides which
 * console buttons get hidden — so a sentence that only *might* name a key ("press a key
 * to start", "collect a key") is left alone. Missing a key costs a caption; inventing one
 * costs the player a control.
 */

export type ParsedControls = {
	/** Codes the text names, in the order they appear. */
	codes: string[];
	/** Code → what it does ("Jump"), when the text says. */
	purposes: Record<string, string>;
};

const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const WASD = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];

/* Words that sit in a keys phrase without being keys. */
const FILLER = new Set([
	'press',
	'pressing',
	'hold',
	'holding',
	'tap',
	'tapping',
	'use',
	'using',
	'hit',
	'the',
	'or',
	'and',
	'key',
	'keys',
	'button',
	'buttons',
	'to',
	'with',
	'then',
	'also',
	'can',
	'you'
]);

/* Mouse / touch phrasing — a clause about these names no keyboard key. */
const POINTER = /\b(mouse|click|clicks|clicking|tap on|touch|swipe|drag|cursor|scroll)\b/i;

function uniq(list: string[]): string[] {
	return [...new Set(list)];
}

/**
 * Keys named in a short phrase that is known to be *about* keys (the left of
 * "X = jump", the right of "Jump: X", the part before "to" in "press X to jump").
 */
/**
 * How far to trust a lone letter or digit in a phrase.
 *
 * - `all`     explicitly paired with an action ("E - interact", "1-4 = switch weapon").
 * - `letters` before "to" ("X to shoot"): letters yes, but "2 to 4 players" is a count.
 * - `cue`     only when the phrase says it is a key ("press E", "the E key").
 *
 * The catalog scan is why: numbered lists, scores, chapter numbers and initials in
 * thousands of descriptions all look like one-character keys.
 */
export type SingleKeyTrust = 'all' | 'letters' | 'cue';

const KEY_CUE = /\b(press|pressing|hold|holding|tap|hit|key|keys|button)\b/i;

export function keysInPhrase(phrase: string, trust: SingleKeyTrust = 'all'): string[] {
	const raw = phrase.trim();
	if (!raw) return [];
	const t = raw.toLowerCase();
	const out: string[] = [];

	if (/\bwasd\b/.test(t)) out.push(...WASD);

	/* Specific arrows first ("up arrow", "arrow left", "←"); the generic phrase only when none. */
	const specific: string[] = [];
	const dirRe = /\b(up|down|left|right)\s*arrows?\b|\barrow\s*(up|down|left|right)\b/g;
	let m: RegExpExecArray | null;
	while ((m = dirRe.exec(t))) {
		const dir = (m[1] || m[2]) as 'up' | 'down' | 'left' | 'right';
		specific.push(`Arrow${dir[0].toUpperCase()}${dir.slice(1)}`);
	}
	const glyphs: Record<string, string> = {
		'↑': 'ArrowUp',
		'↓': 'ArrowDown',
		'←': 'ArrowLeft',
		'→': 'ArrowRight'
	};
	for (const ch of raw) if (glyphs[ch]) specific.push(glyphs[ch]);
	if (specific.length) out.push(...specific);
	else if (/\barrows?\b|\barrow\s*keys?\b|\bcursor keys\b/.test(t)) out.push(...ARROWS);
	else if (
		trust === 'all' &&
		!/\b(?:left|right)\s+(?:shift|ctrl|control|alt|click|mouse|button|stick|joystick|trigger)\b/.test(
			t
		)
	) {
		/* "Up = shoot", "Left/Right = roll": bare directions, when paired with an action. */
		const bare = /\b(up|down|left|right)\b/g;
		while ((m = bare.exec(t))) out.push(`Arrow${m[1][0].toUpperCase()}${m[1].slice(1)}`);
	}

	if (/\bspace\s*bar\b|\bspacebar\b|\bspace\b/.test(t)) out.push('Space');
	/*
	 * "Return" and "Escape" are verbs as often as keys ("Return to the castle", "Escape the
	 * maze"): outside an explicit pairing they need a cue ("press escape", "return key").
	 */
	const verbKeysOk = trust === 'all' || KEY_CUE.test(raw);
	if (/\benter\b/.test(t) || (verbKeysOk && /\breturn\b/.test(t))) out.push('Enter');
	if (/\besc\b/.test(t) || (verbKeysOk && /\bescape\b/.test(t))) out.push('Escape');
	if (/\bshift\b/.test(t)) out.push('ShiftLeft');
	if (/\bctrl\b|\bcontrol\b/.test(t)) out.push('ControlLeft');

	/* Digit ranges: "1-4", "1 – 5". */
	const rangeRe = /\b([0-9])\s*[-–—]\s*([0-9])\b/g;
	let ranged = raw;
	while ((m = rangeRe.exec(raw))) {
		const a = Number(m[1]);
		const b = Number(m[2]);
		if (b > a && b - a <= 9 && (trust === 'all' || KEY_CUE.test(raw))) {
			for (let d = a; d <= b; d++) out.push(`Digit${d}`);
		}
		ranged = ranged.replace(m[0], ' ');
	}

	/*
	 * Single characters left over are keys. A long phrase is probably a sentence, so there
	 * only capitals count ("the Z key"); lowercase `a` is always the article. Tokens are
	 * split on Unicode letters, so the "B" of "Bài" is part of a word, not a key.
	 */
	const long = raw.length > 32;
	const cue = KEY_CUE.test(raw);
	const allowLetters = trust !== 'cue' || cue;
	const allowDigits = trust === 'all' || cue;
	const stripped = ranged.replace(
		/\b(?:wasd|space\s*bar|spacebar|space|enter|return|esc|escape|shift|ctrl|control|arrows?|up|down|left|right)\b/gi,
		' '
	);
	for (const token of stripped.split(/[^\p{L}\p{N}'’]+/u)) {
		if (token.length !== 1 || FILLER.has(token.toLowerCase())) continue;
		if (token >= '0' && token <= '9') {
			if (allowDigits) out.push(`Digit${token}`);
			continue;
		}
		if (!/[A-Za-z]/.test(token) || !allowLetters) continue;
		if (token === 'a') continue;
		if (long && token !== token.toUpperCase()) continue;
		out.push(`Key${token.toUpperCase()}`);
	}
	return uniq(out);
}

/**
 * True when a phrase is nothing but keys ("WASD", "Z or X", "arrow keys and space").
 * A bare phrase without "=" or "to" only counts as naming keys in that case — otherwise
 * "A fun game about cats" would declare the A key.
 */
function isPureKeyList(phrase: string): boolean {
	const rest = phrase
		.replace(
			/\b(?:wasd|space\s*bar|spacebar|space|enter|return|esc|escape|shift|ctrl|control|arrows?|up|down|left|right|cursor)\b/gi,
			' '
		)
		.replace(/[↑↓←→]/g, ' ')
		.split(/[^\p{L}\p{N}'’]+/u)
		.filter((t) => t && !FILLER.has(t.toLowerCase()));
	return rest.every((t) => t.length === 1);
}

/** "to jump over walls." → "Jump over walls" (short enough for a caption). */
function cleanAction(raw: string): string {
	let s = raw
		.replace(/^[\s\-–—:•*([]+/, '')
		.replace(/^\s*(?:to|will|lets you|allows you to|is|are|for)\s+/i, '')
		.replace(/\s*\(.*?\)\s*/g, ' ')
		.replace(/[()[\]{}]/g, ' ')
		.replace(/[.!?:;,\s]+$/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	s = s.split(/\s+(?:or|and then)\s+(?=[a-z]+\b)/i)[0] ?? s;
	if (!s || s.length < 2) return '';
	if (!/\p{L}/u.test(s)) return '';
	/* Handles, links and emoji are never what a key does. */
	if (/[@#]|https?:|www\.|\p{Extended_Pictographic}/u.test(s)) return '';
	/* A heading is not a purpose: "How to play: WASD" says nothing about what WASD does. */
	if (
		/^(how to play|controll?s?|controllers?|instructions?|gameplay|keys?|keyboard|tutorial|notes?|tips?|play)$/i.test(
			s
		)
	) {
		return '';
	}
	/* Nor is a sentence about the player ("You can play this game by: WASD"). */
	if (/^(you|i|we|this|it|there|here)\b/i.test(s)) return '';
	if (s.length > 28) {
		const cut = s.slice(0, 28);
		s = cut.slice(0, Math.max(cut.lastIndexOf(' '), 12)).trim();
	}
	return s.charAt(0).toUpperCase() + s.slice(1);
}

function assign(
	into: ParsedControls,
	codes: string[],
	action: string,
	opts: { overwrite?: boolean } = {}
): void {
	const purpose = cleanAction(action);
	for (const code of codes) {
		if (!into.codes.includes(code)) into.codes.push(code);
		if (purpose && (opts.overwrite || !into.purposes[code])) into.purposes[code] = purpose;
	}
}

function stripMarkup(text: string): string {
	return (
		text
			/* Links first: "watch?v=Xyz" is a URL, not the V key. */
			.replace(/\bhttps?:\/\/\S+|\bwww\.\S+|\b\S+\.(?:com|io|net|org|gg|be|ly)\/\S*/gi, ' ')
			/* Clock times ("6:00 PM") are not "6: …" bindings. */
			.replace(/\b\d{1,2}:\d{2}\b/g, ' ')
			.replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
			.replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
			.replace(/\\u003c/gi, '<')
			.replace(/\\u003e/gi, '>')
			.replace(/\\n/g, '\n')
			.replace(/<\s*(br|\/p|\/li|\/h\d|\/div)\b[^>]*>/gi, '\n')
			.replace(/<[^>]*>/g, ' ')
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
	);
}

/**
 * Split into clauses. Sentence ends and line breaks always split; commas and "and"
 * are handled per clause, because "WASD, arrow keys = move" must stay together while
 * "Space = jump, X = shoot" must not.
 */
function clausesOf(text: string): string[] {
	return (
		stripMarkup(text)
			/* Numbered-list markers ("1. ", "2) ", "(3)") are not keys. */
			.replace(/(^|[\s>:])\d{1,2}[.)](?=\s)/g, '$1 ')
			.replace(/\(\d{1,2}\)/g, ' ')
			/* Key lists stay one phrase: "W,A,S,D", "W | S | A | D", "A/D". */
			.replace(/\b([A-Za-z0-9])\s*[,/|]\s*(?=[A-Za-z0-9]\b)/g, '$1 ')
			.replace(/\b([A-Za-z0-9])\s*[,/|]\s*(?=[A-Za-z0-9]\b)/g, '$1 ')
			/* Emoticons (":D", ":x", ":P") are faces, not keys. */
			.replace(/(^|\s)[:;]-?[A-Za-z](?=\s|$|[.!?,])/g, '$1 ')
			.split(/\n+|[;•|]+|(?<=[\p{L})])[.!?]+(?=\s|$|\p{Lu})/iu)
			.map((c) => c.trim())
			.filter(Boolean)
	);
}

const DELIM = /\s*(?:=|:|\s[-–—]\s|[–—])\s*/;

/**
 * Where the next "label:" starts inside an action, so "WASD: Move TAB: Pause" reads as
 * two pairs. The label is the last word before the next delimiter — or, for a key list,
 * the run of single characters ("A D", "Q & R") that ends there.
 */
function nextLabelStart(text: string): number {
	const d = text.search(DELIM);
	if (d <= 0) return -1;
	const before = text.slice(0, d);
	const words = [...before.matchAll(/\S+/g)];
	if (words.length < 2) return -1;
	let i = words.length - 1;
	const single = (w: string) => /^[A-Za-z0-9&+]$/.test(w);
	if (single(words[i][0])) while (i > 0 && single(words[i - 1][0])) i--;
	return i === 0 ? -1 : (words[i].index ?? -1);
}

/** Whether a phrase reads as something a key does. */
function isAction(text: string): boolean {
	return cleanAction(text) !== '';
}

/** Keys on the left of `=`/`:`/dash, or — "Jump: Space" — on the right. */
function parseDelimited(clause: string, into: ParsedControls): boolean {
	const segments = clause.split(/,(?![^()]*\))|\s\/\s/);
	let pending: string[] = [];
	let any = false;
	for (let segment of segments) {
		for (let guard = 0; guard < 12 && segment; guard++) {
			const m = segment.match(/^(.*?)\s*(?:=|:|\s[-–—]\s|[–—])\s*(.*)$/);
			if (!m) {
				/* A sentence inside a list ("…, Press J to jump, …") carries its own action. */
				if (/\b(?:to|with|using)\s+\S/i.test(segment)) {
					parseSentence(segment, into);
					pending = [];
					any = true;
				} else {
					/* "WASD, arrow keys = move": a bare key list waits for the next action. */
					const keys =
						POINTER.test(segment) || !isPureKeyList(segment) ? [] : keysInPhrase(segment, 'cue');
					if (keys.length) pending.push(...keys);
				}
				break;
			}
			const left = m[1];
			let right = m[2];
			/* "Controls: W:Thrust S:Reverse" — a heading in front of more pairs; drop it. */
			if (!isPureKeyList(left) && !isAction(left) && DELIM.test(right)) {
				segment = right;
				continue;
			}
			let rest = '';
			const cut = nextLabelStart(right);
			if (cut > 0) {
				rest = right.slice(cut);
				right = right.slice(0, cut);
			}
			const leftKeys = POINTER.test(left) || !isPureKeyList(left) ? [] : keysInPhrase(left);
			/* Numbers alone ("3: Added a new level", "Version 1: …") need a short, verb-like action. */
			const digitsOnly = leftKeys.length > 0 && leftKeys.every((c) => c.startsWith('Digit'));
			const numberOk =
				!digitsOnly ||
				(right.trim().split(/\s+/).length <= 3 &&
					(segment.slice(left.length, left.length + 4).includes('=') || KEY_CUE.test(left)));
			if (leftKeys.length && isAction(right) && numberOk) {
				assign(into, uniq([...pending, ...leftKeys]), right);
				any = true;
			} else if (!leftKeys.length) {
				/* "Jump: Space" — the left must read as an action, not a sentence or nothing. */
				const action = left.trim();
				const actionLike =
					action.length >= 2 && action.length <= 32 && !/[!?@#]|https?:/.test(action);
				const rightKeys =
					!actionLike || POINTER.test(right) || !isPureKeyList(right)
						? []
						: keysInPhrase(right, 'letters');
				if (rightKeys.length) {
					/* "Controls: arrow keys and space" names keys even though "Controls" is no purpose. */
					assign(into, uniq([...pending, ...rightKeys]), isAction(left) ? left : '');
					any = true;
				}
			}
			pending = [];
			segment = rest;
		}
	}
	return any;
}

/** "Press Space to jump and X to shoot", "Use the arrow keys to move", "Jump with Z". */
function parseSentence(clause: string, into: ParsedControls): void {
	const parts = clause.split(/,|&|\band\b(?!\s+then)/i);
	let pending: string[] = [];
	for (const part of parts) {
		const p = part.trim();
		if (!p || POINTER.test(p.split(/\bto\b/i)[0])) {
			pending = [];
			continue;
		}
		const toMatch = p.match(/^(.*?)\bto\s+(.+)$/i);
		if (toMatch) {
			const keysPart = toMatch[1];
			const keys = isPureKeyList(keysPart) ? keysInPhrase(keysPart, 'letters') : [];
			if (keys.length) {
				assign(into, uniq([...pending, ...keys]), toMatch[2]);
				pending = [];
				continue;
			}
		}
		const withMatch = p.match(/^(.+?)\s+(?:with|using|by pressing|by holding)\s+(.+)$/i);
		if (withMatch) {
			const keys = isPureKeyList(withMatch[2]) ? keysInPhrase(withMatch[2], 'cue') : [];
			if (keys.length) {
				assign(into, uniq([...pending, ...keys]), withMatch[1]);
				pending = [];
				continue;
			}
		}
		/* "Press Space" alone, or a key list that the next part gives an action to. */
		const verbOnly = p.match(/^\s*(?:press|hold|tap|use|hit)\s+(.{1,24})$/i);
		const bare = verbOnly ? verbOnly[1] : p;
		const keys = isPureKeyList(bare) ? keysInPhrase(bare, verbOnly ? 'all' : 'cue') : [];
		if (keys.length) pending.push(...keys);
	}
	/* Keys named with no action still count as named. */
	for (const code of pending) if (!into.codes.includes(code)) into.codes.push(code);
}

export function parseControlsText(text: string | null | undefined): ParsedControls {
	const out: ParsedControls = { codes: [], purposes: {} };
	if (!text) return out;
	for (const raw of clausesOf(String(text).slice(0, 4000))) {
		/* A heading run into its first line ("Controls Arrow keys = move") is not part of it. */
		const clause = raw.replace(
			/^(?:controls|how to play|instructions?|keyboard(?: controls)?|keys)\b\s*[:\-–—]?\s+(?=\S)/i,
			''
		);
		if (/[=:–—]|\s-\s/.test(clause) && parseDelimited(clause, out)) continue;
		parseSentence(clause, out);
	}
	return out;
}
