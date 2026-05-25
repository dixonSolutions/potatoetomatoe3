#!/usr/bin/env node

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Public PlayCanvas projects that can be embedded
const PLAYCANVAS_GAMES = [
    { projectId: '406050', name: 'Swooop', author: 'PlayCanvas', category: 'action' },
    { projectId: '354998', name: 'Master Archer', author: 'PlayCanvas', category: 'action' },
    { projectId: '452634', name: 'Star-Lord', author: 'PlayCanvas', category: 'action' },
    { projectId: '405804', name: 'Flappy Bird', author: 'PlayCanvas', category: 'arcade' },
    { projectId: '186', name: 'Dungeon Fury', author: 'PlayCanvas', category: 'action' },
];

function createGameId(name) {
    return `playcanvas-${name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')}`;
}

function createMetadata(id, name, author, category, projectId) {
    return {
        id,
        name: `${name} (PlayCanvas)`,
        author,
        description: `${name} - Built with PlayCanvas 3D engine`,
        thumbnail: `/games/${id}/online/assets/thumbnail.png`,
        category,
        source: `https://playcanvas.com/project/${projectId}`,
        license: 'Check PlayCanvas project for license'
    };
}

function createIndexHtml(projectId, name) {
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
            background: #000;
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
    <iframe class="game-iframe" src="https://playcanv.as/p/${projectId}/" allowfullscreen></iframe>
</body>
</html>`;
}

async function portPlayCanvasGame(gameInfo, existingGames) {
    const { projectId, name, author, category } = gameInfo;
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

        // Create index.html with PlayCanvas embed
        const indexHtml = createIndexHtml(projectId, name);
        writeFileSync(join(gameDir, 'index.html'), indexHtml);

        // Create metadata
        const metadata = createMetadata(gameId, name, author, category, projectId);
        writeFileSync(join(gameDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

        // Create placeholder for thumbnail
        writeFileSync(
            join(assetsDir, '.gitkeep'),
            `# Add thumbnail.png here\n# Project: https://playcanvas.com/project/${projectId}\n`
        );

        console.log(`✅ ${gameId}`);

        return { gameId, skipped: false };
    } catch (error) {
        console.error(`❌ Error porting ${name}:`, error.message);
        return null;
    }
}

async function main() {
    console.log('🚀 PlayCanvas Games Porter Starting...\n');
    console.log('🎮 PlayCanvas is a WebGL game engine\n');

    // Load existing games
    const gamesListPath = join(__dirname, '..', 'static', 'games', 'games-list.json');
    let existingGames = [];
    if (existsSync(gamesListPath)) {
        existingGames = JSON.parse(readFileSync(gamesListPath, 'utf-8'));
    }

    console.log(`📚 Found ${existingGames.length} existing games\n`);
    console.log(`🎮 Porting ${PLAYCANVAS_GAMES.length} PlayCanvas games\n`);

    const portedGames = [];
    const skippedGames = [];

    for (const gameInfo of PLAYCANVAS_GAMES) {
        const result = await portPlayCanvasGame(gameInfo, existingGames);
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

    console.log(`\n💡 To add more PlayCanvas games:`);
    console.log(`   1. Browse https://playcanvas.com/explore`);
    console.log(`   2. Find public projects with embed enabled`);
    console.log(`   3. Get the project ID from the URL`);
    console.log(`   4. Add to PLAYCANVAS_GAMES array in this script`);

    if (portedGames.length > 0) {
        console.log('\n💡 Run "node scripts/generate-games-list.js" to update the games list!');
    }
}

main().catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
