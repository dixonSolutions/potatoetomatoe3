#!/usr/bin/env node

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Popular free HTML5 games on itch.io with permissive licenses
const ITCH_GAMES = [
    { url: 'https://managore.itch.io/you-have-to-burn-the-rope', name: 'You Have to Burn the Rope', author: 'Managore', category: 'puzzle' },
    { url: 'https://ncase.itch.io/wbwwb', name: 'We Become What We Behold', author: 'Nicky Case', category: 'educational' },
    { url: 'https://ncase.itch.io/trust', name: 'The Evolution of Trust', author: 'Nicky Case', category: 'educational' },
    { url: 'https://ncase.itch.io/loopy', name: 'Loopy', author: 'Nicky Case', category: 'puzzle' },
    { url: 'https://ncase.itch.io/door', name: 'Coming Out Simulator', author: 'Nicky Case', category: 'educational' },
    { url: 'https://managore.itch.io/js13k-2020', name: 'Managore js13k 2020', author: 'Managore', category: 'puzzle' },
];

function createGameId(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function createMetadata(id, name, author, category, itchUrl) {
    return {
        id,
        name,
        author,
        description: `${name} - Free HTML5 game from itch.io`,
        thumbnail: `/games/${id}/online/assets/thumbnail.png`,
        category,
        source: itchUrl,
        license: 'Check itch.io page for license'
    };
}

function createIndexHtml(itchUrl, name) {
    // Extract game ID from itch.io URL
    const embedUrl = `${itchUrl}?embed=true`;
    
    return `<!DOCTYPE html>
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
    <iframe class="game-iframe" src="${embedUrl}" frameborder="0" allowfullscreen></iframe>
</body>
</html>`;
}

async function portItchGame(gameInfo, existingGames) {
    const { url, name, author, category } = gameInfo;
    const gameId = createGameId(name);

    try {
        console.log(`\n🎮 Processing: ${name}`);

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

        // Create index.html with itch.io embed
        const indexHtml = createIndexHtml(url, name);
        writeFileSync(join(gameDir, 'index.html'), indexHtml);

        // Create metadata
        const metadata = createMetadata(gameId, name, author, category, url);
        writeFileSync(join(gameDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

        // Create placeholder for thumbnail
        writeFileSync(join(assetsDir, '.gitkeep'), `# Add thumbnail.png here\n# Download from: ${url}\n`);

        console.log(`✅ ${gameId}`);

        return { gameId, skipped: false };
    } catch (error) {
        console.error(`❌ Error porting ${name}:`, error.message);
        return null;
    }
}

async function main() {
    console.log('🚀 itch.io Games Porter Starting...\n');
    console.log('🎨 itch.io hosts thousands of indie HTML5 games\n');

    const args = process.argv.slice(2);

    // Load existing games
    const gamesListPath = join(__dirname, '..', 'static', 'games', 'games-list.json');
    let existingGames = [];
    if (existsSync(gamesListPath)) {
        existingGames = JSON.parse(readFileSync(gamesListPath, 'utf-8'));
    }

    console.log(`📚 Found ${existingGames.length} existing games\n`);
    console.log(`🎮 Porting ${ITCH_GAMES.length} itch.io games\n`);

    const portedGames = [];
    const skippedGames = [];

    for (const gameInfo of ITCH_GAMES) {
        const result = await portItchGame(gameInfo, existingGames);
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

    console.log(`\n💡 To add more itch.io games:`);
    console.log(`   1. Find HTML5 games on itch.io`);
    console.log(`   2. Check the license (look for CC0, MIT, or "free to use")`);
    console.log(`   3. Add to ITCH_GAMES array in this script`);
    console.log(`   4. For offline support, download the game files from itch.io`);

    if (portedGames.length > 0) {
        console.log('\n💡 Run "node scripts/generate-games-list.js" to update the games list!');
    }
}

main().catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
