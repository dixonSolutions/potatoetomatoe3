#!/usr/bin/env node

import { writeFileSync, mkdirSync, existsSync, readFileSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Phaser 3 example games that are complete and playable
const PHASER_EXAMPLES = [
    { path: 'games/breakout', name: 'Breakout', category: 'arcade' },
    { path: 'games/invaders', name: 'Space Invaders', category: 'action' },
    { path: 'games/snake', name: 'Snake', category: 'arcade' },
    { path: 'games/firstgame', name: 'First Game Tutorial', category: 'platformer' },
    { path: 'games/tanks', name: 'Tanks', category: 'action' },
];

const PHASER_REPO = 'https://github.com/photonstorm/phaser3-examples.git';

function createGameId(name) {
    return `phaser-${name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')}`;
}

function createMetadata(id, name, category) {
    return {
        id,
        name: `${name} (Phaser)`,
        author: 'Phaser Examples',
        description: `${name} - Built with Phaser game framework`,
        thumbnail: `/games/${id}/online/assets/thumbnail.png`,
        category,
        source: 'Phaser 3 Examples',
        license: 'MIT'
    };
}

async function portPhaserExample(exampleInfo, existingGames, phaserPath) {
    const { path, name, category } = exampleInfo;
    const gameId = createGameId(name);

    try {
        console.log(`\n🎮 Processing: ${name}`);

        // Skip if game already exists
        if (existingGames.includes(gameId)) {
            console.log(`⏭️  ${gameId} (already exists)`);
            return { skipped: true, gameId };
        }

        const examplePath = join(phaserPath, 'public', path);
        const gameDir = join(__dirname, '..', 'static', 'games', 'html', gameId);
        const assetsDir = join(gameDir, 'assets');

        // Check if example exists
        if (!existsSync(examplePath)) {
            console.error(`   ❌ Example not found at ${path}`);
            return null;
        }

        // Create game directories
        if (!existsSync(gameDir)) {
            mkdirSync(gameDir, { recursive: true });
        }
        if (!existsSync(assetsDir)) {
            mkdirSync(assetsDir, { recursive: true });
        }

        console.log(`   📦 Copying game files...`);

        // Copy example files
        try {
            cpSync(examplePath, gameDir, { recursive: true });
        } catch (error) {
            console.error(`   ⚠️  Error copying files: ${error.message}`);
            return null;
        }

        // Create metadata
        const metadata = createMetadata(gameId, name, category);
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
    console.log('🚀 Phaser Examples Porter Starting...\n');
    console.log('🎮 Phaser is a popular HTML5 game framework\n');

    // Load existing games
    const gamesListPath = join(__dirname, '..', 'static', 'games', 'games-list.json');
    let existingGames = [];
    if (existsSync(gamesListPath)) {
        existingGames = JSON.parse(readFileSync(gamesListPath, 'utf-8'));
    }

    console.log(`📚 Found ${existingGames.length} existing games\n`);

    // Create temp directory for cloning
    const tempDir = join(__dirname, '..', 'temp', 'phaser-examples');
    if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
    }

    console.log(`📥 Cloning Phaser examples repository...`);
    console.log(`   (This may take a moment)\n`);

    try {
        execSync(`git clone --depth 1 ${PHASER_REPO} ${tempDir}`, {
            stdio: 'ignore'
        });
    } catch (error) {
        console.error(`❌ Failed to clone repository: ${error.message}`);
        process.exit(1);
    }

    console.log(`🎮 Porting ${PHASER_EXAMPLES.length} Phaser examples\n`);

    const portedGames = [];
    const skippedGames = [];

    for (const exampleInfo of PHASER_EXAMPLES) {
        const result = await portPhaserExample(exampleInfo, existingGames, tempDir);
        if (result) {
            if (result.skipped) {
                skippedGames.push(result.gameId);
            } else {
                portedGames.push(result.gameId);
            }
        }
    }

    // Cleanup temp directory
    console.log(`\n🧹 Cleaning up temporary files...`);
    try {
        execSync(`rm -rf ${tempDir}`, { stdio: 'ignore' });
    } catch (error) {
        console.error(`   ⚠️  Could not clean temp directory: ${error.message}`);
    }

    console.log(`\n📊 Summary:`);
    console.log(`   ✅ Ported: ${portedGames.length} new games`);
    console.log(`   ⏭️  Skipped: ${skippedGames.length} existing games`);

    if (portedGames.length > 0) {
        console.log('\n💡 Run "node scripts/generate-games-list.js" to update the games list!');
    }
}

main().catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
