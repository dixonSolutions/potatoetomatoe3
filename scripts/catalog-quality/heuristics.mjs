/**
 * Title / description heuristics for the catalog quality classifier.
 *
 * Every pattern here was checked against the catalog by hand (see docs/catalog-quality.md
 * for the spot-check). They are deliberately narrow: a false "test" hides a real game by
 * default, which is worse than letting one junk upload through to the "ok" tier.
 */

import { normalizeTitleKey } from '../lib/catalog-quality.mjs';

/**
 * Portal suffixes/prefixes the importers left in display names:
 *   "Sprunki 🥴 Play on CrazyGames", "1 Push - Play it Online at Coolmath Games",
 *   "Play 1 Square: Hop and remove | Coolmath Games", "A Clockmaker&#039;s Tale - …".
 */
export function cleanDisplayName(name) {
	const cleaned = String(name || '')
		.replace(/&#x([0-9a-f]{1,6});/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
		.replace(/&#(\d{1,7});/g, (_, dec) => String.fromCodePoint(Number(dec)))
		.replace(/&apos;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/&amp;/g, '&')
		.replace(/\s*(?:🕹️|🕹|🎮)?\s*Play on CrazyGames\s*$/iu, '')
		.replace(/^🎮\s*/u, '')
		.replace(/^Play\s+(.+?)(?::[^|]*)?\s*\|\s*Coolmath Games\s*$/i, '$1')
		.replace(
			/\s*[-–—]\s*(?:come\s+)?play(?:\s+it)?(?:\s+(?:online|now))*\s+at\s+cool\s?math\s?games(?:\.com)?\s*$/i,
			''
		)
		.replace(/\s*\|[^|]*\bat Coolmath Games\s*$/i, '')
		.replace(/\s*\|\s*Coolmath Games\s*$/i, '')
		.replace(/\s+/g, ' ')
		.trim();
	return cleaned || String(name || '').trim();
}

/** A comparable title key: lower case, portal noise and "unblocked" stripped. */
export function titleKey(name) {
	return normalizeTitleKey(cleanDisplayName(name).replace(/\+/g, ' plus'))
		.replace(/\b(unblocked|html5|html 5|the)\b/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** The default description Unity's microgame templates publish with. */
const MICROGAME_DEFAULT_RE = /^\s*my latest microgame\.?\s*$/i;

/** Importer placeholder when the portal gave no description at all. */
const PLACEHOLDER_DESC_RE =
	/^Play .+ on Potato Tomato \((?:mirrored from Unity Play|via [a-z0-9-]+)\)\.?$/i;

/**
 * Names that are build numbers, dates or version strings: "002", "0.14.3", "07151",
 * "v0.0.39", "1.2ver_pre", "10202022", "27-may".
 */
const VERSION_NAME_RE =
	/^(?:v(?:er(?:sion)?)?\s*)?[\d][\d._ -]*(?:[a-z_]{0,8}\d*)?$|^\d{1,2}[-_ ](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*$/i;

/** Unity/editor defaults and throwaway names. Whole-name matches only. */
const DEFAULT_NAME_RE =
	/^(?:my project|my first game|my game|new unity project|unity project|untitled|test|testing|test game|test build|asdf+|qwerty|sample(?: scene)?|samplescene|demo|prototype|project|build|webgl|webgl build|game|new game|scene|main|temp|placeholder)(?:[ _-]?\(?\d+\)?)?$/i;

/** Names that say "this is a build of something", anywhere in the name. */
const TEST_NAME_PART_RE =
	/\b(?:webgl (?:demo|build|test)|test ?build|build test|tech demo|prototype|testing|test level|test scene|playtest)\b/i;

/** Unity Learn pathway and tutorial projects, uploaded as coursework — in the name. */
const TUTORIAL_NAME_RE =
	/\b(?:junior programmer|create with code|cwc ?\d|unity learn|roll[- ]?a[- ]?ball|ruby'?s adventure|john lemon|haunted jaunt|karting microgame|lego microgame|fps microgame|platformer microgame|prototype ?\d|challenge \d|lab \d|mod the cube|player control|unit \d|lesson \d|assignment|homework|coursework|tutorial|school project|class project|final project|student project|exercise \d|sprint \d|week \d|practice project|test scene|testing build|brackeys|code ?monkey)\b/i;

/**
 * The same, in the description. Narrower: plenty of real games mention "the tutorial" or
 * "Unit 3" in passing, so only phrases that say the upload *is* the coursework count.
 */
const TUTORIAL_DESC_RE =
	/learn\.unity\.com|learn\.u3d\.cn|\bcreate (?:with|from) code\b|\bjunior programmer\b|\bcreator kit\b|\bmicrogame tutorial\b|\b(?:made|created|built|done|following|followed|based on)\b[^.]{0,40}\b(?:tutorial|course|brackeys|code ?monkey)\b|\b(?:prototype|unit|week|lesson|challenge) \d+ (?:of|for|from|in)\b|\bproject for (?:unit|week|lesson|class)\b|\btutorial (?:thingy|project|build|series)\b|\bbrackeys\b/i;

/** Descriptions that say out loud that this is a test or unfinished. */
const TEST_DESC_RE =
	/\b(?:this is (?:just )?a test|test build|testing build|work in progress|not finished|unfinished|my first (?:ever )?game|first game i(?:'ve| have)? made|made (?:it )?in class|for (?:a|my) (?:class|school|course|assignment)|school assignment|unity blue belt|unity (?:junior|create with code))\b/i;

/** Uploads that exist only to send players elsewhere ("please play here: <ad site>"). */
const REDIRECT_DESC_RE =
	/\b(?:play (?:it )?here|play the (?:full|fixed|new) version (?:at|on|here)|moved to)\b[^.]*https?:\/\//i;

/**
 * Meme / "brainrot" games: kept, but ranked below everything playable and serious.
 * Name matches only — descriptions mention memes in passing too often.
 */
const JOKE_RE =
	/\b(?:brainrots?|skibidi|sprunki|rizz|gyatt|fanum|sigma (?:boy|male|rule)|mewing|ohio|amogus|tung[ -]?tung|tralalero|bombardiro|sahur|cappuccin[oa]|lirili|patapim|six[ -]?seven|67|meme(?:s)?|shitpost|trollface|rip[ -]?off|cringe|nextbots?|obunga|huggy wuggy|chungus|doge|pepe|troll(?:ing)? (?:game|simulator))\b/i;

/** Piracy / cheat / giveaway spam that rides on game portals' search ranking. */
const SPAM_RE =
	/\b(?:full ?movie|filmyzilla|watch online free|download (?:free|full|hd)|free (?:robux|v-?bucks|gems|diamonds)|robux generator|hack(?:ed)? apk|mod apk|cheat codes?|free download|telegram|whatsapp|casino bonus|betting tips)\b/i;

/** Mathematical-alphanumeric letters are how spam titles dodge search filters. */
const FANCY_UNICODE_RE = /[\u{1D400}-\u{1D7FF}]/u;

/** Near-random names such as "5yop57sg54gr5b2x". */
export function looksLikeGibberish(name) {
	const compact = String(name || '').toLowerCase();
	/* Letters and digits only: "19-(6x4-(1+4))=0" is a puzzle's name, not a keyboard mash. */
	if (compact.length < 8 || !/^[a-z0-9]+$/.test(compact) || !/[a-z]/.test(compact)) return false;
	const digits = (compact.match(/\d/g) || []).length;
	const vowels = (compact.match(/[aeiouy]/g) || []).length;
	return digits >= 3 && vowels / compact.length < 0.25;
}

/**
 * @param {{ name: string, description?: string, sourcePortal?: string }} game
 * @returns {{ test: string[], joke: string[], lowEffort: string[] }}
 */
export function titleSignals(game) {
	const name = cleanDisplayName(game.name).trim();
	const description = String(game.description || '').trim();
	const test = [];
	const joke = [];
	const lowEffort = [];

	if (DEFAULT_NAME_RE.test(name) || TEST_NAME_PART_RE.test(name)) test.push('default-name');
	if (VERSION_NAME_RE.test(name)) test.push('version-name');
	if (looksLikeGibberish(name)) test.push('gibberish-name');
	if (TUTORIAL_NAME_RE.test(name) || TUTORIAL_DESC_RE.test(description.slice(0, 600))) {
		test.push('tutorial');
	}
	if (
		SPAM_RE.test(name) ||
		SPAM_RE.test(description.slice(0, 300)) ||
		FANCY_UNICODE_RE.test(name)
	) {
		test.push('spam');
	}
	if (TEST_DESC_RE.test(description.slice(0, 400))) test.push('test-description');
	if (REDIRECT_DESC_RE.test(description.slice(0, 400))) test.push('redirect-description');
	if (MICROGAME_DEFAULT_RE.test(description)) lowEffort.push('microgame-template');
	if (PLACEHOLDER_DESC_RE.test(description) || !description) lowEffort.push('no-description');
	if (JOKE_RE.test(name)) joke.push('meme-title');
	return { test, joke, lowEffort };
}

/** Words that say nothing about which game a page is. */
const GENERIC_TITLE_WORDS = new Set(
	`unity webgl player game games play online unblocked html5 html flash webassembly waflash
	google com classroom resources index page loading clicker fusion developer runtime clickteam
	construct godot phaser pixi made with studio gamemaker new version full free io the and for
	you your of in on at to by with`
		.split(/\s+/)
		.filter(Boolean)
);

function titleTokens(text) {
	return normalizeTitleKey(text)
		.split(' ')
		.filter((word) => word.length >= 3 && !GENERIC_TITLE_WORDS.has(word));
}

/**
 * True when a page title clearly names a different game than the catalog entry — the
 * Drive U 7 mirror often points several entries at one unrelated file.
 */
export function isTitleMismatch(catalogName, pageTitle) {
	if (!pageTitle) return false;
	const page = titleTokens(pageTitle.replace(/^Unity WebGL Player \|/i, ''));
	const specific = page.filter((word) => word.length >= 4);
	if (!specific.length) return false;
	const mine = titleTokens(cleanDisplayName(catalogName));
	if (!mine.length) return false;
	const overlap = page.some((word) =>
		mine.some(
			(other) =>
				other === word ||
				(word.length >= 4 && other.length >= 4 && word.slice(0, 4) === other.slice(0, 4))
		)
	);
	return !overlap;
}
