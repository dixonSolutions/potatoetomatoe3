/**
 * Curated 30-game matrix for console-test and puller-test harnesses.
 * Online proxy + offline mirror both supported; offline is not required at selection time.
 */

export type HarnessPullStrategy = 'embed' | 'generic' | 'local-embed';
export type HarnessEngine = 'unity' | 'html5';
export type HarnessCategory =
	| 'action'
	| 'platformer'
	| 'racing'
	| 'sports'
	| 'skill'
	| 'fighting'
	| 'adventure'
	| 'arcade';

export interface HarnessTestGame {
	id: string;
	name: string;
	engine: HarnessEngine;
	category: HarnessCategory;
	sourcePortal: string;
	pullStrategy: HarnessPullStrategy;
	/** True when a known offline mirror ships with the repo or is commonly present. */
	likelyOffline: boolean;
	/** Why this title is useful for touch / puller debugging. */
	notes: string;
}

/**
 * Exactly 30 control-oriented titles spanning portals, engines, and pull strategies.
 * Availability (online proxy / offline mirror) is resolved at runtime.
 */
export const HARNESS_TEST_GAMES: readonly HarnessTestGame[] = [
	{
		id: 'shrek-escape',
		name: 'Shrek Escape',
		engine: 'unity',
		category: 'action',
		sourcePortal: 'playhop',
		pullStrategy: 'embed',
		likelyOffline: true,
		notes: 'Bundled offline + embed strategy anchor'
	},
	{
		id: '1v1-lol',
		name: '1v1.LOL',
		engine: 'html5',
		category: 'sports',
		sourcePortal: 'legacy',
		pullStrategy: 'generic',
		likelyOffline: true,
		notes: 'Large legacy mirror; FPS-style controls'
	},
	{
		id: 'ovo',
		name: 'OvO',
		engine: 'html5',
		category: 'platformer',
		sourcePortal: 'legacy',
		pullStrategy: 'generic',
		likelyOffline: true,
		notes: 'Platformer canvas controls'
	},
	{
		id: 'g-switch-3',
		name: 'G-Switch 3',
		engine: 'html5',
		category: 'platformer',
		sourcePortal: 'legacy',
		pullStrategy: 'generic',
		likelyOffline: true,
		notes: 'Gravity-runner keyboard timing'
	},
	{
		id: 'vex-5',
		name: 'Vex 5',
		engine: 'html5',
		category: 'platformer',
		sourcePortal: 'legacy',
		pullStrategy: 'generic',
		likelyOffline: true,
		notes: 'Classic platformer input'
	},
	{
		id: '2d-platformer',
		name: '2D Platformer',
		engine: 'unity',
		category: 'arcade',
		sourcePortal: 'unity-play',
		pullStrategy: 'generic',
		likelyOffline: true,
		notes: 'Unity Play generic pull'
	},
	{
		id: 'ufs-unity-flight-simulator',
		name: 'Unity Flight Simulator',
		engine: 'unity',
		category: 'arcade',
		sourcePortal: 'unity-play',
		pullStrategy: 'generic',
		likelyOffline: true,
		notes: 'Flight axis controls'
	},
	{
		id: 'prototype-v-box-master',
		name: 'Prototype V Box Master',
		engine: 'unity',
		category: 'arcade',
		sourcePortal: 'unity-play',
		pullStrategy: 'generic',
		likelyOffline: true,
		notes: 'Unity canvas + WASM'
	},
	{
		id: 'scrap-metal',
		name: 'Scrap Metal',
		engine: 'unity',
		category: 'action',
		sourcePortal: 'legacy',
		pullStrategy: 'generic',
		likelyOffline: true,
		notes: 'Driving / action Unity'
	},
	{
		id: 'a-dance-of-fire-and-ice',
		name: 'A Dance of Fire and Ice',
		engine: 'html5',
		category: 'skill',
		sourcePortal: 'legacy',
		pullStrategy: 'generic',
		likelyOffline: true,
		notes: 'Rhythm timing keys'
	},
	{
		id: 'snow-rider-3d',
		name: 'Snow Rider 3D',
		engine: 'html5',
		category: 'racing',
		sourcePortal: 'legacy',
		pullStrategy: 'generic',
		likelyOffline: true,
		notes: 'Racing / lean controls'
	},
	{
		id: 'flappy-bird',
		name: 'Flappy Bird',
		engine: 'html5',
		category: 'skill',
		sourcePortal: 'legacy',
		pullStrategy: 'generic',
		likelyOffline: true,
		notes: 'Simple Space / tap control'
	},
	{
		id: 'vex-6',
		name: 'Vex 6',
		engine: 'html5',
		category: 'platformer',
		sourcePortal: 'legacy',
		pullStrategy: 'generic',
		likelyOffline: true,
		notes: 'Thin legacy mirror candidate'
	},
	{
		id: 'addicting-angry-flappy-birds',
		name: 'Angry Flappy Birds',
		engine: 'html5',
		category: 'action',
		sourcePortal: 'addictinggames',
		pullStrategy: 'generic',
		likelyOffline: false,
		notes: 'AddictingGames portal + action'
	},
	{
		id: 'addicting-18-holes',
		name: '18 Holes',
		engine: 'html5',
		category: 'sports',
		sourcePortal: 'addictinggames',
		pullStrategy: 'generic',
		likelyOffline: false,
		notes: 'Sports portal sample'
	},
	{
		id: 'coolmath-1-push',
		name: '1 Push',
		engine: 'html5',
		category: 'arcade',
		sourcePortal: 'coolmath',
		pullStrategy: 'generic',
		likelyOffline: false,
		notes: 'Coolmath arcade'
	},
	{
		id: 'crazygames-10-bullets-html-5',
		name: '10 Bullets',
		engine: 'html5',
		category: 'arcade',
		sourcePortal: 'crazygames',
		pullStrategy: 'generic',
		likelyOffline: false,
		notes: 'CrazyGames live relay'
	},
	{
		id: '1-on-1-basketball',
		name: '1 on 1 Basketball',
		engine: 'html5',
		category: 'sports',
		sourcePortal: 'drive-u-7',
		pullStrategy: 'local-embed',
		likelyOffline: false,
		notes: 'Drive U 7 local-embed'
	},
	{
		id: '4-wheel-madness',
		name: '4 Wheel Madness',
		engine: 'html5',
		category: 'racing',
		sourcePortal: 'drive-u-7',
		pullStrategy: 'local-embed',
		likelyOffline: false,
		notes: 'Drive U 7 racing'
	},
	{
		id: '10-minutes-till-dawn',
		name: '10 Minutes Till Dawn',
		engine: 'html5',
		category: 'action',
		sourcePortal: 'legacy',
		pullStrategy: 'generic',
		likelyOffline: false,
		notes: 'Twin-stick style action'
	},
	{
		id: '12-minibattles',
		name: '12 MiniBattles',
		engine: 'html5',
		category: 'fighting',
		sourcePortal: 'legacy',
		pullStrategy: 'generic',
		likelyOffline: false,
		notes: 'Fighting inputs'
	},
	{
		id: 'cluster-rush',
		name: 'Cluster Rush',
		engine: 'html5',
		category: 'platformer',
		sourcePortal: 'legacy',
		pullStrategy: 'generic',
		likelyOffline: false,
		notes: 'Runner platformer'
	},
	{
		id: '3d-car-simulator',
		name: '3D Car Simulator',
		engine: 'html5',
		category: 'racing',
		sourcePortal: 'legacy',
		pullStrategy: 'generic',
		likelyOffline: false,
		notes: 'Driving keys'
	},
	{
		id: 'asterax-space-shooter',
		name: 'Asterax Space Shooter',
		engine: 'unity',
		category: 'action',
		sourcePortal: 'unity-play',
		pullStrategy: 'generic',
		likelyOffline: false,
		notes: 'Unity Play shooter'
	},
	{
		id: 'apian-wish-tsa-2024',
		name: 'Apian Wish',
		engine: 'unity',
		category: 'adventure',
		sourcePortal: 'unity-play',
		pullStrategy: 'generic',
		likelyOffline: false,
		notes: 'Unity adventure'
	},
	{
		id: 'playhop-1-speed-escape-prison-505214',
		name: 'Speed Escape Prison',
		engine: 'html5',
		category: 'arcade',
		sourcePortal: 'playhop',
		pullStrategy: 'generic',
		likelyOffline: false,
		notes: 'Playhop arcade relay'
	},
	{
		id: 'playhop-1-jump-on-the-keyboard-540983',
		name: 'Jump on the Keyboard',
		engine: 'html5',
		category: 'arcade',
		sourcePortal: 'playhop',
		pullStrategy: 'generic',
		likelyOffline: false,
		notes: 'Keyboard-themed Playhop title'
	},
	{
		id: 'addicting-3d-air-hockey',
		name: '3D Air Hockey',
		engine: 'html5',
		category: 'sports',
		sourcePortal: 'addictinggames',
		pullStrategy: 'generic',
		likelyOffline: false,
		notes: 'Sports pointer/keys'
	},
	{
		id: '3-slices',
		name: '3 Slices',
		engine: 'html5',
		category: 'arcade',
		sourcePortal: 'drive-u-7',
		pullStrategy: 'local-embed',
		likelyOffline: false,
		notes: 'Drive U 7 arcade'
	},
	{
		id: '4th-and-goal-2022',
		name: '4th and Goal 2022',
		engine: 'html5',
		category: 'sports',
		sourcePortal: 'legacy',
		pullStrategy: 'generic',
		likelyOffline: false,
		notes: 'Sports playbook controls'
	}
] as const;

export const HARNESS_TEST_GAME_COUNT = 30;

export function getHarnessTestGame(id: string): HarnessTestGame | undefined {
	return HARNESS_TEST_GAMES.find((game) => game.id === id);
}

export function listHarnessTestGameIds(): string[] {
	return HARNESS_TEST_GAMES.map((game) => game.id);
}

export interface HarnessGamesValidationIssue {
	code: 'count' | 'duplicate' | 'empty-id' | 'invalid-strategy' | 'invalid-engine';
	message: string;
	gameId?: string;
}

const VALID_STRATEGIES = new Set<HarnessPullStrategy>(['embed', 'generic', 'local-embed']);
const VALID_ENGINES = new Set<HarnessEngine>(['unity', 'html5']);

/** Structural validation (no filesystem / catalog IO). */
export function validateHarnessTestGames(
	games: readonly HarnessTestGame[] = HARNESS_TEST_GAMES
): HarnessGamesValidationIssue[] {
	const issues: HarnessGamesValidationIssue[] = [];
	if (games.length !== HARNESS_TEST_GAME_COUNT) {
		issues.push({
			code: 'count',
			message: `Expected ${HARNESS_TEST_GAME_COUNT} games, found ${games.length}`
		});
	}
	const seen = new Set<string>();
	for (const game of games) {
		if (!game.id?.trim()) {
			issues.push({ code: 'empty-id', message: 'Game entry has empty id' });
			continue;
		}
		if (seen.has(game.id)) {
			issues.push({
				code: 'duplicate',
				message: `Duplicate game id: ${game.id}`,
				gameId: game.id
			});
		}
		seen.add(game.id);
		if (!VALID_STRATEGIES.has(game.pullStrategy)) {
			issues.push({
				code: 'invalid-strategy',
				message: `Invalid pullStrategy for ${game.id}: ${game.pullStrategy}`,
				gameId: game.id
			});
		}
		if (!VALID_ENGINES.has(game.engine)) {
			issues.push({
				code: 'invalid-engine',
				message: `Invalid engine for ${game.id}: ${game.engine}`,
				gameId: game.id
			});
		}
	}
	return issues;
}
