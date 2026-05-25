#!/usr/bin/env node

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import https from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));

const fetchUrl = (url) => {
    return new Promise((resolve, reject) => {
        https
            .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    return fetchUrl(res.headers.location).then(resolve).catch(reject);
                }
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        resolve({ ok: true, json: () => JSON.parse(data), text: () => data });
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}`));
                    }
                });
            })
            .on('error', reject);
    });
};

const downloadFile = (url, filepath) => {
    return new Promise((resolve, reject) => {
        https
            .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    return downloadFile(res.headers.location, filepath).then(resolve).catch(reject);
                }
                if (res.statusCode === 200) {
                    const chunks = [];
                    res.on('data', (chunk) => chunks.push(chunk));
                    res.on('end', () => {
                        writeFileSync(filepath, Buffer.concat(chunks));
                        resolve();
                    });
                } else {
                    reject(new Error(`HTTP ${res.statusCode}`));
                }
            })
            .on('error', reject);
    });
};

// js13kGames winners and notable entries from recent years
const JS13K_GAMES = [
    // 2023
    { year: 2023, id: 2301, name: 'Triskaidekaphobia', author: 'xem', category: 'puzzle' },
    { year: 2023, id: 2302, name: 'Dante', author: 'KilledByAPixel', category: 'action' },
    { year: 2023, id: 2303, name: 'Underrun', author: 'phoboslab', category: 'racing' },
    
    // 2022
    { year: 2022, id: 2201, name: 'Soul Jumper', author: 'Salvatore Previti', category: 'platformer' },
    { year: 2022, id: 2202, name: 'Choch', author: 'xem', category: 'puzzle' },
    { year: 2022, id: 2203, name: 'Rogue Fable IV', author: 'Pixel Forge Games', category: 'rpg' },
    
    // 2021
    { year: 2021, id: 2101, name: 'Back to Space', author: 'Salvatore Previti', category: 'action' },
    { year: 2021, id: 2102, name: 'Letchworth Village', author: 'Eoin McGrath', category: 'adventure' },
    { year: 2021, id: 2103, name: 'Rogue Fable III', author: 'Pixel Forge Games', category: 'rpg' },
    
    // 2020
    { year: 2020, id: 2001, name: 'Ninja vs EVILCORP', author: 'Salvatore Previti', category: 'action' },
    { year: 2020, id: 2002, name: 'Rogue Fable II', author: 'Pixel Forge Games', category: 'rpg' },
    { year: 2020, id: 2003, name: 'Bounce Back', author: 'Eoin McGrath', category: 'puzzle' },
];

function createGameId(name, year) {
    return `js13k-${year}-${name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')}`;
}

function createMetadata(id, name, author, year, category) {
    return {
        id,
        name: `${name} (js13k ${year})`,
        author: author,
        description: `${name} - A 13KB JavaScript game from js13kGames ${year}`,
        thumbnail: `/games/${id}/online/assets/thumbnail.png`,
        category,
        source: 'js13kGames',
        license: 'Open Source',
        year
    };
}

async function portJs13kGame(gameInfo, existingGames) {
    const { year, id, name, author, category } = gameInfo;
    const gameId = createGameId(name, year);

    try {
        console.log(`\n🎮 Processing: ${name} (${year})`);

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

        // Note: js13kGames entries are typically hosted on their platform
        // We create a wrapper that loads from their CDN or GitHub
        // For actual offline support, you'd need to download the zip files
        
        const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${name}</title>
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
            background: #000;
            color: #fff;
            font-family: Arial, sans-serif;
        }
        .container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            padding: 20px;
        }
        .info {
            text-align: center;
            margin-bottom: 20px;
        }
        .game-frame {
            width: 100%;
            max-width: 1024px;
            height: 80vh;
            border: 2px solid #333;
            background: #111;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="info">
            <h1>${name}</h1>
            <p>by ${author} | js13kGames ${year}</p>
            <p><small>A 13KB JavaScript game</small></p>
        </div>
        <iframe class="game-frame" src="https://js13kgames.com/games/${name.toLowerCase().replace(/\s+/g, '-')}/index.html" frameborder="0"></iframe>
    </div>
</body>
</html>`;

        writeFileSync(join(gameDir, 'index.html'), indexHtml);

        // Create metadata
        const metadata = createMetadata(gameId, name, author, year, category);
        writeFileSync(join(gameDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

        // Create placeholder for thumbnail
        writeFileSync(join(assetsDir, '.gitkeep'), `# Add thumbnail.png here\n`);

        console.log(`✅ ${gameId}`);

        return { gameId, skipped: false };
    } catch (error) {
        console.error(`❌ Error porting ${name}:`, error.message);
        return null;
    }
}

async function main() {
    console.log('🚀 js13kGames Porter Starting...\n');
    console.log('📦 js13kGames are ultra-small (13KB) open-source JavaScript games\n');

    // Load existing games
    const gamesListPath = join(__dirname, '..', 'static', 'games', 'games-list.json');
    let existingGames = [];
    if (existsSync(gamesListPath)) {
        existingGames = JSON.parse(readFileSync(gamesListPath, 'utf-8'));
    }

    console.log(`📚 Found ${existingGames.length} existing games\n`);
    console.log(`🎮 Porting ${JS13K_GAMES.length} js13kGames entries\n`);

    const portedGames = [];
    const skippedGames = [];

    for (const gameInfo of JS13K_GAMES) {
        const result = await portJs13kGame(gameInfo, existingGames);
        if (result) {
            if (result.skipped) {
                skippedGames.push(result.gameId);
            } else {
                portedGames.push(result.gameId);
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Ported: ${portedGames.length} new games`);
    console.log(`   ⏭️  Skipped: ${skippedGames.length} existing games`);

    console.log(`\n💡 Note: These games load from js13kgames.com`);
    console.log(`   For true offline support, download the ZIP files from:`);
    console.log(`   https://js13kgames.com/entries/YEAR`);

    if (portedGames.length > 0) {
        console.log('\n💡 Run "node scripts/generate-games-list.js" to update the games list!');
    }
}

main().catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
