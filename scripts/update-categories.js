#!/usr/bin/env node

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Game categories mapping
const GAME_CATEGORIES = {
	// Action/Shooter
	'10-minutes-till-dawn': 'action',
	'bullet-force': 'shooter',
	'funny-shooter-2': 'shooter',
	'getaway-shootout': 'shooter',
	'gun-mayhem': 'shooter',
	'gun-mayhem-2': 'shooter',
	'gun-mayhem-3': 'shooter',
	'gunspin': 'shooter',
	'hammer-2-reloaded': 'shooter',
	'happy-room': 'action',
	'leader-strike': 'shooter',
	'masked-forces': 'shooter',
	'pixel-gun-survival': 'shooter',
	'pixwars-2': 'shooter',
	'recoil': 'shooter',
	'rooftop-snipers': 'shooter',
	'rooftop-snipers-2': 'shooter',
	'shoot-stickman': 'shooter',
	'sniper-gun-shooting': 'shooter',
	'swatforce-vs-terrorists': 'shooter',
	'temple-of-boom': 'shooter',
	'cat-gunner-super-zombie-shoot': 'shooter',
	'stupid-zombies': 'shooter',
	'zombie-derby-pixel-survival': 'action',

	// Sports - Soccer/Football
	'1v1-lol': 'sports',
	'a-small-world-cup': 'sports',
	'bumper-cars-soccer': 'sports',
	'foot-chinko': 'sports',
	'football-legends': 'sports',
	'football-masters': 'sports',
	'free-kick-shooter': 'sports',
	'gravity-soccer': 'sports',
	'head-soccer-2023': 'sports',
	'heads-arena-soccer-all-stars': 'sports',
	'kix-dream-soccer': 'sports',
	'penalty-kick-online': 'sports',
	'penalty-shooters-2': 'sports',
	'rocket-soccer-derby': 'sports',
	'soccar': 'sports',
	'soccer-random': 'sports',
	'soccer-skills-champions-league': 'sports',
	'soccer-skills-euro-cup': 'sports',
	'soccer-skills-world-cup': 'sports',
	'super-liquid-soccer': 'sports',
	'street-ball-jam': 'sports',

	// Sports - Basketball
	'basket-and-ball': 'sports',
	'basket-bros': 'sports',
	'basket-champs': 'sports',
	'basket-random': 'sports',
	'basket-swooshes': 'sports',
	'basketball-legends': 'sports',
	'basketball-line': 'sports',
	'basketball-stars': 'sports',
	'blumgi-ball': 'sports',
	'dunkbrush': 'sports',
	'dunkers': 'sports',

	// Sports - Other
	'8-ball-pool': 'sports',
	'air-hockey-championship-deluxe': 'sports',
	'archery-world-tour': 'sports',
	'athletics-hero': 'sports',
	'big-shot-boxing': 'sports',
	'bowling-stars': 'sports',
	'boxing-physics-2': 'sports',
	'boxing-random': 'sports',
	'cricket-world-cup': 'sports',
	'golf-champions': 'sports',
	'golfinity': 'sports',
	'ping-pong-html5': 'sports',
	'pool-club': 'sports',
	'power-badminton': 'sports',
	'stickman-boxing-ko-champion': 'sports',
	'stickman-golf': 'sports',
	'tennis-masters': 'sports',
	'thumb-fighter': 'sports',
	'thumb-fighter-christmas': 'sports',
	'volleyball-challenge': 'sports',
	'volley-random': 'sports',
	'4th-and-goal-2022': 'sports',
	'linebacker-alley-2': 'sports',
	'retro-bowl': 'sports',
	'rowdy-city-wrestling': 'sports',
	'rowdy-wrestling': 'sports',
	'wrassling': 'sports',

	// Racing - Car
	'3d-car-simulator': 'racing',
	'4x4-drive-offroad': 'racing',
	'adventure-drivers': 'racing',
	'blocky-cars': 'racing',
	'burnin-rubber-5-xs': 'racing',
	'burnin-rubber-crash-n-burn': 'racing',
	'burnout-drift-seaport-max': 'racing',
	'car-climb-racing': 'racing',
	'car-rush': 'racing',
	'cars-thief': 'racing',
	'cars-thief-tank-edition': 'racing',
	'city-car-driving-stunt-master': 'racing',
	'crazy-cars': 'racing',
	'cyber-cars-punk-racing': 'racing',
	'death-chase': 'racing',
	'demolition-derby-crash-racing': 'racing',
	'drift-boss': 'racing',
	'drift-hunters': 'racing',
	'drive-mad': 'racing',
	'earn-to-die': 'racing',
	'evo-city-driving': 'racing',
	'extreme-car-driving-simulator': 'racing',
	'extreme-car-parking': 'racing',
	'flying-car-simulator': 'racing',
	'furious-racing-3d': 'racing',
	'go-kart-go-ultra': 'racing',
	'grand-prix-hero': 'racing',
	'hover-racer': 'racing',
	'hover-racer-drive': 'racing',
	'kart-race-3d': 'racing',
	'mad-day': 'racing',
	'mad-truck-challenge-special': 'racing',
	'madalin-stunt-cars-2': 'racing',
	'madalin-stunt-cars-3': 'racing',
	'merge-cyber-racers': 'racing',
	'merge-round-racers': 'racing',
	'noob-drive': 'racing',
	'offroader-v5': 'racing',
	'rally-champion': 'racing',
	'real-cars-in-city': 'racing',
	'real-city-driving-2': 'racing',
	'school-bus-demolition-derby': 'racing',
	'smash-karts': 'racing',
	'speed-boat-extreme-racing': 'racing',
	'stock-car-hero': 'racing',
	'stunt-car-challenge-3': 'racing',
	'super-racing-gt-drag-pro': 'racing',
	'super-star-car': 'racing',
	'tinytownracing': 'racing',
	'top-speed-3d': 'racing',
	'top-speed-racing-3d': 'racing',
	'traffic-mania': 'racing',
	'traffic-rider': 'racing',
	'truck-traffic': 'racing',
	'ultimate-car-driving': 'racing',

	// Racing - Moto/Bike
	'3d-moto-simulator-2': 'racing',
	'bike-trials-offroad-1': 'racing',
	'bike-trials-winter-1': 'racing',
	'bike-trials-winter-2': 'racing',
	'blocky-trials': 'racing',
	'city-bike-stunt-2': 'racing',
	'moto-maniac': 'racing',
	'moto-maniac-2': 'racing',
	'moto-road-rash-3d': 'racing',
	'moto-trial-racing-2': 'racing',
	'moto-x3m': 'racing',
	'moto-x3m-2': 'racing',
	'moto-x3m-pool-party': 'racing',
	'moto-x3m-spooky-land': 'racing',
	'moto-x3m-winter': 'racing',
	'stickman-bike': 'racing',
	'stickman-bike-pr': 'racing',
	'superbike-hero': 'racing',
	'super-bike-the-champion': 'racing',
	'tanuki-sunset': 'racing',
	'turbo-moto-racer': 'racing',
	'unicycle-hero': 'racing',

	// Racing - Monster Truck
	'brain-for-monster-truck': 'racing',
	'impossible-monster-truck-race': 'racing',
	'monster-tracks': 'racing',
	'monsters-wheels-special': 'racing',
	'real-simulator-monster-truck': 'racing',

	// Puzzle
	'2048': 'puzzle',
	'2048-multitask': 'puzzle',
	'amazing-sudoku': 'puzzle',
	'arithmetica': 'puzzle',
	'block-the-pig': 'puzzle',
	'bloxorz': 'puzzle',
	'b-cubed': 'puzzle',
	'brain-test-2-tricky-stories': 'puzzle',
	'brain-test-3-tricky-quests': 'puzzle',
	'brain-test-tricky-puzzles': 'puzzle',
	'cat-trap': 'puzzle',
	'detective-loupe-puzzle': 'puzzle',
	'factory-balls-forever': 'puzzle',
	'free-the-key': 'puzzle',
	'hextris': 'puzzle',
	'impossible-tic-tac-toe': 'puzzle',
	'infinity-loop': 'puzzle',
	'master-chess': 'puzzle',
	'maze-path-of-light': 'puzzle',
	'maze-planet-3d': 'puzzle',
	'minesweeper': 'puzzle',
	'mosaic-puzzle-art': 'puzzle',
	'online-sudoku': 'puzzle',
	'solitaire': 'puzzle',
	'sudoku': 'puzzle',
	'terris': 'puzzle',
	'tetris-flash': 'puzzle',
	'the-impossible-quiz': 'puzzle',
	'three-goblets': 'puzzle',
	'tictactoe': 'puzzle',
	'ultimate-sudoku': 'puzzle',
	'water-color-sort': 'puzzle',
	'who-is': 'puzzle',
	'word-city-crossed': 'puzzle',
	'word-city-uncrossed': 'puzzle',
	'wordle-unlimited': 'puzzle',
	'words-search-classic-edition': 'puzzle',
	'worlds-hardest-game-2': 'puzzle',
	'worlds-hardest-game-3': 'puzzle',

	// Platformer/Running
	'cluster-rush': 'platformer',
	'crossy-road': 'platformer',
	'death-run-3d': 'platformer',
	'doodle-jump': 'platformer',
	'dreadhead-parkour': 'platformer',
	'electron-dash': 'platformer',
	'fancy-pants': 'platformer',
	'fancy-pants-2': 'platformer',
	'fancy-pants-3': 'platformer',
	'geometry-dash': 'platformer',
	'g-switch-3': 'platformer',
	'icy-purple-head-3': 'platformer',
	'ovo': 'platformer',
	'parkour-block-3d': 'platformer',
	'red-ball-4': 'platformer',
	'run-3-editor': 'platformer',
	'running-fred': 'platformer',
	'skiing-fred': 'platformer',
	'slope': 'platformer',
	'slope-2': 'platformer',
	'slope-2-multiplayer': 'platformer',
	'slope-3': 'platformer',
	'slope-city': 'platformer',
	'slope-tunnel': 'platformer',
	'snow-rider-3d': 'platformer',
	'stair-race-3d': 'platformer',
	'subway-runner': 'platformer',
	'subway-surfers': 'platformer',
	'subway-surfers-beijing': 'platformer',
	'subway-surfers-houston': 'platformer',
	'subway-surfers-monaco': 'platformer',
	'subway-surfers-newyork': 'platformer',
	'super-tunnel-rush': 'platformer',
	'temple-run-2': 'platformer',
	'tomb-of-the-mask': 'platformer',
	'tomb-of-the-mask-color': 'platformer',
	'tunnel-rush': 'platformer',
	'vex-4': 'platformer',
	'vex-5': 'platformer',
	'vex-6': 'platformer',
	'vex-7': 'platformer',

	// Skill/Arcade
	'a-dance-of-fire-and-ice': 'skill',
	'ape-sling': 'skill',
	'battle-wheels': 'skill',
	'bunny-hop': 'skill',
	'cannon-strike': 'skill',
	'candy-jump': 'skill',
	'chrome-dino': 'skill',
	'color-switch': 'skill',
	'color-tunnel-2': 'skill',
	'crazy-tunnel-3d': 'skill',
	'curve-ball-3d': 'skill',
	'dinosaur-game': 'skill',
	'draw-the-hill': 'skill',
	'drunken-duel': 'skill',
	'eggy-car': 'skill',
	'flappy-bird': 'skill',
	'flappy-bird-origin': 'skill',
	'gobble': 'skill',
	'heart-star-html5': 'skill',
	'house-of-hazards': 'skill',
	'iron-snout': 'skill',
	'jelly-truck': 'skill',
	'jet-boy': 'skill',
	'jumping-shell': 'skill',
	'marble-dash': 'skill',
	'onion-boy': 'skill',
	'poor-bunny': 'skill',
	'rabbit-samurai': 'skill',
	'rolling-sky': 'skill',
	'rolly-vortex': 'skill',
	'roly-poly-monsters': 'skill',
	'rusher-crusher': 'skill',
	'sausage-flip': 'skill',
	'shortcut-race': 'skill',
	'short-life': 'skill',
	'short-ride': 'skill',
	'slime-road': 'skill',
	'squish-run': 'skill',
	'stack': 'skill',
	'stack-ball': 'skill',
	'stack-bump-3d': 'skill',
	'stacktris': 'skill',
	'stickman-climb-2': 'skill',
	'stickman-hook': 'skill',
	'stickman-ragdoll-crash-fun': 'skill',
	'stickman-school-run': 'skill',
	'swingo': 'skill',
	'tag': 'skill',
	'tag-2': 'skill',
	'tower-of-destiny': 'skill',
	'tricks': 'skill',
	'tube-jumpers': 'skill',
	'two-ball-3d-dark': 'skill',
	'two-neon-boxes': 'skill',

	// Idle/Clicker
	'cookie-clicker': 'idle',
	'doge-miner': 'idle',
	'idle-ants': 'idle',
	'idle-breakout': 'idle',
	'idle-digging-tycoon': 'idle',
	'idle-lumber-inc': 'idle',
	'idle-miner': 'idle',
	'idle-mining-empire': 'idle',
	'idle-startup-tycoon': 'idle',

	// Merge
	'chicken-merge': 'merge',
	'merge-cakes': 'merge',
	'merge-harvest': 'merge',
	'stick-merge': 'merge',
	'super-hexbee-merger': 'merge',

	// Simulation
	'bitlife': 'simulation',
	'coffee-shop': 'simulation',
	'deer-simulator': 'simulation',
	'dog-simulator-3d': 'simulation',
	'horse-simulator-3d': 'simulation',
	'lemonade-stand': 'simulation',
	'life-the-game': 'simulation',
	'monkey-mart': 'simulation',
	'my-pony-my-little-race': 'simulation',
	'panda-simulator-3d': 'simulation',
	'tiger-simulator-3d': 'simulation',

	// Strategy/Tower Defense
	'age-of-war': 'strategy',
	'awesome-tanks': 'strategy',
	'awesome-tanks-2': 'strategy',
	'bloons-tower-defense-1': 'strategy',
	'fortz': 'strategy',
	'grindcraft': 'strategy',
	'grindcraft-remastered': 'strategy',
	'pre-civilization-bronze-age': 'strategy',
	'stick-defenders': 'strategy',

	// Fighting/Battle
	'12-minibattles': 'fighting',
	'minibattles': 'fighting',
	'stick-fighter': 'fighting',
	'stickman-army-team-battle': 'fighting',
	'stickman-army-the-resistance': 'fighting',
	'stickman-fighter-epic-battle-2': 'fighting',
	'stickman-fighter-mega-brawl': 'fighting',
	'striker-dummies': 'fighting',
	'superbattle-2': 'fighting',

	// Adventure
	'11-11': 'adventure',
	'among-us': 'adventure',
	'bearsus': 'adventure',
	'big-tall-small': 'adventure',
	'bob-the-robber-4': 'adventure',
	'breaking-the-bank': 'adventure',
	'burrito-bison': 'adventure',
	'deepest-sword': 'adventure',
	'doodle-champion-island': 'adventure',
	'duck-life': 'adventure',
	'duck-life-2-world-champion': 'adventure',
	'duck-life-3-evolution': 'adventure',
	'duck-life-4': 'adventure',
	'escaping-the-prison': 'adventure',
	'eugenes-life': 'adventure',
	'five-nights-at-freddys': 'adventure',
	'five-nights-at-freddys-2': 'adventure',
	'five-nights-at-freddys-3': 'adventure',
	'fleeing-the-complex': 'adventure',
	'jetpack-joyride': 'adventure',
	'jollyworld': 'adventure',
	'murder': 'adventure',
	'n-gon': 'adventure',
	'orbital-survival': 'adventure',
	'paper-io-2': 'adventure',
	'puppet-master': 'adventure',
	'riddle-school': 'adventure',
	'rio-rex': 'adventure',
	'stealing-the-diamond': 'adventure',
	'super-mario-64': 'adventure',
	'super-mario-bros': 'adventure',
	'survivor-in-rainbow-monster': 'adventure',
	'the-little-giant': 'adventure',
	'the-spear-stickman': 'adventure',
	'there-is-no-game': 'adventure',
	'we-become-what-we-behold': 'adventure',
	'where-is-my-cat': 'adventure',
	'wizard-mike': 'adventure',

	// Casual
	'aqua-thrills': 'casual',
	'blumgi-castle': 'casual',
	'blumgi-rocket': 'casual',
	'blumgi-slime': 'casual',
	'bomb-it-7': 'casual',
	'bubble-shooter': 'casual',
	'bubble-trouble': 'casual',
	'bubble-trouble-3': 'casual',
	'burger-bounty': 'casual',
	'cats': 'casual',
	'cubes-king': 'casual',
	'cubito-mayhem': 'casual',
	'elastic-man': 'casual',
	'eliza-mall-mania': 'casual',
	'energy': 'casual',
	'fairy-dressup': 'casual',
	'gold-digger-frvr': 'casual',
	'google-feud': 'casual',
	'google-snake': 'casual',
	'horse-shoeing': 'casual',
	'kawaii-dressup': 'casual',
	'ludo-multiplayer': 'casual',
	'neon-war': 'casual',
	'panda-bubble-shooter': 'casual',
	'paper-fighter-3d': 'casual',
	'parking-fury': 'casual',
	'parking-fury-2': 'casual',
	'parking-fury-3d-bounty-hunter': 'casual',
	'parking-fury-3d-night-thief': 'casual',
	'perfect-peel': 'casual',
	'plactions': 'casual',
	'pop-it-master': 'casual',
	'raft-wars': 'casual',
	'raft-wars-2': 'casual',
	'raft-wars-multiplayer': 'casual',
	'rocket-pult': 'casual',
	'sketchbook-04': 'casual',
	'stickman-bridge-constructor': 'casual',
	'tiny-fishing': 'casual',
	'toon-off': 'casual',
	'wood-blocks-3d': 'casual',

	// Sandbox/Creative
	'minecraft-1.5.2': 'sandbox',
	'minecraft-1.8.8': 'sandbox',
	'minecraft-builder': 'sandbox',
	'precision-client': 'sandbox',

	// Music/Rhythm
	'friday-night-funkin': 'music',

	// Other/Misc
	'city-rider': 'action',
	'mob-city': 'action',
	'scrap-metal': 'action',
	'super-hot': 'action',
	'super-santa-kicker': 'casual',
	'tank-trouble-2': 'action',
	'battle-wheels': 'action'
};

function updateGameCategory(gameId, category) {
	const metadataPath = join(
		__dirname,
		'..',
		'static',
		'games',
		'html',
		gameId,
		'metadata.json'
	);

	if (!existsSync(metadataPath)) {
		console.error(`❌ ${gameId}: metadata.json not found`);
		return false;
	}

	try {
		const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
		metadata.category = category;
		writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
		return true;
	} catch (error) {
		console.error(`❌ ${gameId}: ${error.message}`);
		return false;
	}
}

function main() {
	console.log('🏷️  Updating game categories...\n');

	let updated = 0;
	let failed = 0;
	let notFound = 0;

	// Get all game folders
	const gamesDir = join(__dirname, '..', 'static', 'games', 'html');
	const allGames = readdirSync(gamesDir, { withFileTypes: true })
		.filter((dirent) => dirent.isDirectory())
		.map((dirent) => dirent.name);

	// Update games with known categories
	for (const [gameId, category] of Object.entries(GAME_CATEGORIES)) {
		if (updateGameCategory(gameId, category)) {
			console.log(`✅ ${gameId} → ${category}`);
			updated++;
		} else {
			failed++;
		}
	}

	// Report games without categories
	const uncategorized = allGames.filter((game) => !GAME_CATEGORIES[game]);
	if (uncategorized.length > 0) {
		console.log(`\n⚠️  ${uncategorized.length} games without categories:`);
		uncategorized.slice(0, 10).forEach((game) => console.log(`   - ${game}`));
		if (uncategorized.length > 10) {
			console.log(`   ... and ${uncategorized.length - 10} more`);
		}
	}

	console.log(`\n📊 Summary:`);
	console.log(`   Updated: ${updated}`);
	console.log(`   Failed: ${failed}`);
	console.log(`   Uncategorized: ${uncategorized.length}`);
	console.log(`   Total games: ${allGames.length}`);
}

main();
