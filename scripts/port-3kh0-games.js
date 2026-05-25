#!/usr/bin/env node

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));

const fetchUrl = (url) => {
    return new Promise((resolve, reject) => {
        https
            .get(url, { headers: { 'User-Agent': 'node' } }, (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        resolve({ ok: true, json: () => JSON.parse(data), text: () => data });
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    }
                });
            })
            .on('error', reject);
    });
};

const downloadFile = (url, filepath) => {
    return new Promise((resolve, reject) => {
        https
            .get(url, { headers: { 'User-Agent': 'node' } }, (res) => {
                if (res.statusCode === 200) {
                    const chunks = [];
                    res.on('data', (chunk) => chunks.push(chunk));
                    res.on('end', () => {
                        writeFileSync(filepath, Buffer.concat(chunks));
                        resolve();
                    });
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                }
            })
            .on('error', reject);
    });
};

const GITHUB_API = 'https://api.github.com/repos/3khogames/3kh0/contents/unblocked';
const GITHUB_RAW = 'https://raw.githubusercontent.com/3khogames/3kh0/main/unblocked';
const THUMBNAIL_RAW = 'https://raw.githubusercontent.com/3khogames/3kh0/main/ikone';

async function fetchGameList() {
    console.log('📡 Fetching game list from 3kh0 GitHub...\n');
    const response = await fetchUrl(GITHUB_API);
    const files = await response.json();
    return files.filter((file) => file.name.endsWith('.html')).map((file) => file.name);
}

async function fetchGameHtml(filename) {
    const url = `${GITHUB_RAW}/${filename}`;
    const response = await fetchUrl(url);
    return await response.text();
}

function extractGameData(htmlContent) {
    const iframeMatch = htmlContent.match(/<iframe[^>]*src=["']([^"']+)["'][^>]*>/i);
    const src = iframeMatch ? iframeMatch[1] : null;

    const titleMatch = htmlContent.match(/<title>([^<]+)<\/title>/i);
    let title = titleMatch
        ? titleMatch[1]
              .replace(/ - Unblocked 76 EZ/i, '')
              .replace(/ - 3kh0/i, '')
              .trim()
        : 'Unknown Game';

    return { src, title };
}

function createGameId(filename) {
    return filename.replace('.html', '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function getThumbnailFilename(gameId) {
    // Map game ID to potential thumbnail names
    const thumbnailMap = {
        '10-min-till-dawn': '10mintilldawn.webp',
        '10-minutes-till-dawn': '10mintilldawn.webp',
        '1v1-lol': '1v1lol.webp',
        '3d-free-kick': '3dfreekick.webp',
        '99-balls': '99balls.webp',
        'achievement-unlocked': 'achievementunlocked.webp',
        'a-dance-of-fire-and-ice': 'adanceoffireandice.webp',
        'adventure-drivers': 'adventuredrivers.webp',
        'alien-hominid': 'alienhominid.webp',
        'amazing-rope-police': 'amazingropepolice.webp',
        'amidst-the-clouds': 'amidsttheclouds.webp',
        'among-us': 'amongus.webp',
        'aqua-park-io': 'aquaparkio.webp',
        'archery-world-tour': 'archeryworldtour.webp',
        'a-small-world-cup': 'asmallworldcup.webp',
        'aspiring-artist': 'aspiringartist.webp',
        'awesome-tanks-2': 'awesometanks2.webp',
        'backflip-dive-3d': 'backflipdive3d.webp',
        'bad-ice-cream-2': 'badicecream2.webp',
        'baldis-basics': 'baldisbasics.webp',
        'basketball-legends': 'basketballlegends.webp',
        'basketball-stars': 'basketballstars.webp',
        'basket-random': 'basketrandom.webp',
        'big-tower-tiny-square': 'bigtowertinysquare.webp',
        'bitlife': 'bitlife.webp',
        'block-post': 'blockpost.webp',
        'blocky-snakes': 'blockysnakes.webp',
        'bloons-td-2': 'bloonstd2.webp',
        'bloxorz': 'bloxors.webp',
        'bob-the-robber-2': 'bobtherobber2.webp',
        'bottle-flip-3d': 'bottleflip3d.webp',
        'boxing-random': 'boxingrandom.webp',
        'breaking-the-bank': 'breakingthebank.webp',
        'burrito-bison': 'burritobison.webp',
        'cannon-basketball-4': 'cannonbasketball4.webp',
        'cars-simulator': 'carssimulator.webp',
        'chrome-dino': 'chromedino.webp',
        'circlo': 'circlo.webp',
        'color-switch-2': 'colorswitch2.webp',
        'connect-3': 'connect3.webp',
        'cookie-clicker': 'cookieclicker.webp',
        'craftmine': 'craftmine.webp',
        'creative-kill-chamber': 'creativekillchamber.webp',
        'crossy-road': 'crossyroad.webp',
        'cupcakes-2048': 'cupcakes2048.webp',
        'cut-the-rope': 'cuttherope.webp',
        'cut-the-rope-holiday': 'cuttheropeholiday.webp',
        'deal-or-no-deal': 'dealornodeal.webp',
        'death-car-io': 'deathcario.webp',
        'death-run-3d': 'deathrun3d.webp',
        'doge-miner': 'dogeminer.webp',
        'drift-boss': 'driftboss.webp',
        'drift-hunters': 'drifthunters.webp',
        'drive-mad': 'drivemad.webp',
        'duke-dashington-remastered': 'dukedashingtonremastered.webp',
        'eggy-car': 'eggycar.webp',
        'endless-war-3': 'endlesswar3.webp',
        'euro-cup-soccer-skills': 'eurocupsoccerskills.webp',
        'fireboy-watergirl-forest-temple': 'fireboywatergirlforesttemple.webp',
        'flappy-bird': 'flappybird.webp',
        'geo-dash-2': 'geodash2.webp',
        'geometry-dash': 'geometrydash.webp',
        'getaway-shootout': 'getawayshootout.webp',
        'gravity-soccer': 'gravitysoccer.webp',
        'grindcraft': 'grindcraft.webp',
        'gun-mayhem-2': 'gunmayhem2.webp',
        'happy-wheels': 'happywheels.webp',
        'hill-climb-racing': 'hillclimbracing.webp',
        'house-of-hazards': 'houseofhazards.webp',
        'idle-breakout': 'idlebreakout.webp',
        'iron-snout-2': 'ironsnout2.webp',
        'jelly-truck': 'jellytruck.webp',
        'jetpack-joyride': 'jetpackjoyride.webp',
        'just-fall-lol': 'justfalllol.webp',
        'kart-fight-io': 'kartfightio.webp',
        'learn-to-fly': 'learntofly.webp',
        'madalin-cars-multiplayer': 'madalincarsmultiplayer.webp',
        'madalin-stunt-cars-2': 'madalinstuntcars2.webp',
        'madalin-stunt-cars-3': 'madalinstuntcars3.webp',
        'merge-round-racers': 'mergeroundracers.webp',
        'minecraft-classic': 'minecraftclassic.webp',
        'minesweeper': 'minesweeper.webp',
        'monkey-mart': 'monkeymart.webp',
        'moto-x3m-2': 'motox3m2.webp',
        'moto-x3m-pool-party': 'motox3mpoolparty.webp',
        'moto-x3m-spooky-land': 'motox3mspookyland.webp',
        'moto-x3m-winter': 'motox3mwinter.webp',
        'ovo': 'ovo.webp',
        'ovo-3-dimensions': 'ovo3dimensions.webp',
        'pacman': 'pacman.webp',
        'papas-burgeria': 'papasburgeria.webp',
        'papas-pizzaria': 'papaspizzaria.webp',
        'paper-io-2': 'paperio2.webp',
        'pixel-gun-survival': 'pixelgunsurvival.webp',
        'quake': 'quake.webp',
        'rabbit-samurai-2': 'rabbitsamurai2.webp',
        'red-driver-5': 'reddriver5.webp',
        'retro-bowl': 'retrobowl.webp',
        'riddle-school-5': 'riddleschool5.webp',
        'riddle-transfer-2': 'riddletransfer2.webp',
        'rise-of-neon-square': 'riseofneonsquare.webp',
        'roblox': 'roblox.webp',
        'rooftop-snipers': 'rooftopsnipers.webp',
        'rooftop-snipers-2': 'rooftopsnipers2.webp',
        'run-3': 'run3.webp',
        'running-fred': 'runningfred.webp',
        'sausage-flip': 'sausageflip.webp',
        'scrap-metal-3': 'scrapmetal3.webp',
        'shell-shockers': 'shellshockers.webp',
        'short-life-2': 'shortlife2.webp',
        'short-ride': 'shortride.webp',
        'skiing-fred': 'skiingfred.webp',
        'skyblock': 'skyblock.webp',
        'slime-rush-td': 'slimerushtd.webp',
        'slope': 'slope.webp',
        'slope-2': 'slope2.webp',
        'slope-ball': 'slopeball.webp',
        'smash-karts': 'smash-karts.webp',
        'snow-battle-io': 'snowbattleio.webp',
        'snow-rider-3d': 'snowrider3d.webp',
        'soccer-random': 'soccerrandom.webp',
        'solitaire': 'solitaire.webp',
        'sonic': 'sonic.webp',
        'stack-bump-3d': 'stackbump3d.webp',
        'stealing-the-diamond': 'stealingthediamond.webp',
        'stick-archers-battle': 'stickarchersbattle.webp',
        'stick-duel-battle': 'stickduelbattle.webp',
        'stickman-boost': 'stickmanboost.webp',
        'stickman-boost-2': 'stickmanboost2.webp',
        'stickman-dismounting': 'stickmandismounting.webp',
        'stickman-hook': 'stickmanhook.webp',
        'subway-surfers': 'subwaysurfers.webp',
        'subway-surfers-bali': 'subwaysurfersbali.webp',
        'subway-surfers-new-york': 'subwaysurfersnewyork.webp',
        'subway-surfers-san-francisco': 'subwaysurferssanfrancisco.webp',
        'super-mario-64': 'supermario64.webp',
        'tank-trouble-2': 'tanktrouble2.webp',
        'tanuki-sunset': 'tanukisunset.webp',
        'temple-run-2': 'templerun2.webp',
        'tetris': 'tetris.webp',
        'the-bowling-club': 'thebowlingclub.webp',
        'the-final-earth': 'thefinalearth.webp',
        'the-final-earth-2': 'thefinalearth2.webp',
        'the-heist': 'theheist.webp',
        'the-impossible-quiz': 'theimpossiblequiz.webp',
        'the-impossible-quiz-2': 'theimpossiblequiz2.webp',
        'there-is-no-game': 'thereisnogame.webp',
        'time-shooter-3': 'timeshooter3.webp',
        'tiny-fishing': 'tinyfishing.webp',
        'tube-jumpers': 'tubejumpers.webp',
        'tunnel-rush': 'tunnelrush.webp',
        'tunnel-rush-2': 'tunnelrush2.webp',
        'vex-3': 'vex3.webp',
        'vex-4': 'vex4.webp',
        'vex-5': 'vex5.webp',
        'vex-6': 'vex6.webp',
        'vex-7': 'vex7.webp',
        'volley-random': 'volleyrandom.webp',
        'wheely-8': 'wheely8.webp',
        'wordle': 'wordle.webp',
        'worlds-hardest-game': 'worldshardestgame.webp',
        'worlds-hardest-game-2': 'worldshardestgame2.webp',
        'yohoho-io': 'yohohoio.webp'
    };

    return thumbnailMap[gameId] || null;
}

function createIndexHtml(src, title) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        html, body {
            width: 100%;
            height: 100%;
            overflow: hidden;
        }
        .game-iframe {
            width: 100%;
            height: 100%;
            border: none;
            display: block;
        }
    </style>
</head>
<body>
    <iframe class="game-iframe" id="game-area" src="${src}" scrolling="none" allowfullscreen></iframe>
</body>
</html>`;
}

function createMetadata(id, title, thumbnailFilename) {
    return {
        id,
        name: title,
        author: 'Ported from 3kh0',
        description: `Play ${title} - an exciting unblocked game`,
        thumbnail: thumbnailFilename
            ? `/games/${id}/online/assets/${thumbnailFilename}`
            : `/games/${id}/online/assets/thumbnail.png`,
        category: 'action'
    };
}

async function portGame(filename, htmlContent, existingGames, downloadThumbnails = true) {
    try {
        const { src, title } = extractGameData(htmlContent);

        if (!src) {
            console.error(`❌ Could not find iframe src in ${filename}`);
            return null;
        }

        const gameId = createGameId(filename);

        // Skip if game already exists
        if (existingGames.includes(gameId)) {
            console.log(`⏭️  ${gameId} (already exists)`);
            return { skipped: true, gameId };
        }

        const gameDir = join(__dirname, '..', 'static', 'games', 'html', gameId);
        const assetsDir = join(gameDir, 'assets');

        if (!existsSync(gameDir)) {
            mkdirSync(gameDir, { recursive: true });
        }
        if (!existsSync(assetsDir)) {
            mkdirSync(assetsDir, { recursive: true });
        }

        const indexHtml = createIndexHtml(src, title);
        writeFileSync(join(gameDir, 'index.html'), indexHtml);

        // Try to download thumbnail
        const thumbnailFilename = getThumbnailFilename(gameId);
        let thumbnailDownloaded = false;

        if (downloadThumbnails && thumbnailFilename) {
            try {
                const thumbnailUrl = `${THUMBNAIL_RAW}/${thumbnailFilename}`;
                const thumbPath = join(assetsDir, thumbnailFilename);
                await downloadFile(thumbnailUrl, thumbPath);
                thumbnailDownloaded = true;
            } catch (error) {
                console.error(`   ⚠️  Failed to download thumbnail: ${error.message}`);
            }
        }

        const metadata = createMetadata(gameId, title, thumbnailFilename);
        writeFileSync(join(gameDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

        if (!thumbnailDownloaded && thumbnailFilename) {
            writeFileSync(
                join(assetsDir, '.gitkeep'),
                `# Add ${thumbnailFilename} here\n`
            );
        }

        console.log(`✅ ${gameId}${thumbnailDownloaded ? ' 🖼️' : ''}`);

        return { gameId, thumbnailDownloaded, skipped: false };
    } catch (error) {
        console.error(`❌ Error porting ${filename}:`, error.message);
        return null;
    }
}

async function main() {
    console.log('🚀 3kh0 Game Porter Starting...\n');

    const args = process.argv.slice(2);
    const downloadThumbnails = !args.includes('--no-thumbnails');

    // Load existing games
    const gamesListPath = join(__dirname, '..', 'static', 'games', 'games-list.json');
    let existingGames = [];
    if (existsSync(gamesListPath)) {
        existingGames = JSON.parse(readFileSync(gamesListPath, 'utf-8'));
    }

    console.log(`📚 Found ${existingGames.length} existing games\n`);
    console.log('🎮 Starting GitHub game porting from 3kh0...\n');

    if (downloadThumbnails) {
        console.log('📥 Thumbnails will be downloaded automatically\n');
    }

    try {
        const gameFiles = await fetchGameList();
        console.log(`Found ${gameFiles.length} games in 3kh0 repo\n`);

        const portedGames = [];
        const skippedGames = [];
        let successfulThumbnails = 0;

        for (const filename of gameFiles) {
            const htmlContent = await fetchGameHtml(filename);
            const result = await portGame(filename, htmlContent, existingGames, downloadThumbnails);
            if (result) {
                if (result.skipped) {
                    skippedGames.push(result.gameId);
                } else {
                    portedGames.push(result.gameId);
                    if (result.thumbnailDownloaded) {
                        successfulThumbnails++;
                    }
                }
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        console.log(`\n📊 Summary:`);
        console.log(`   ✅ Ported: ${portedGames.length} new games`);
        console.log(`   ⏭️  Skipped: ${skippedGames.length} existing games`);
        if (downloadThumbnails) {
            console.log(`   🖼️  Downloaded: ${successfulThumbnails} thumbnails`);
        }

        if (portedGames.length > 0) {
            console.log('\n💡 Run "node scripts/generate-games-list.js" to update the games list!');
        }
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
