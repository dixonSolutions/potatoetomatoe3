#!/usr/bin/env node

import { writeFileSync, mkdirSync, existsSync, readFileSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Popular HTML5 game repositories on GitHub
const GAME_REPOS = [
    // Individual games
    { repo: 'gabrielecirulli/2048', name: '2048', category: 'puzzle' },
    { repo: 'jakesgordon/javascript-tetris', name: 'Tetris', category: 'puzzle' },
    { repo: 'IvanSotelo/FlappyBird', name: 'Flappy Bird', category: 'arcade' },
    { repo: 'ellisonleao/clumsy-bird', name: 'Clumsy Bird', category: 'arcade' },
    { repo: 'budnix/ball-pool', name: 'Ball Pool', category: 'puzzle' },
    { repo: 'Zolmeister/prism', name: 'Prism', category: 'puzzle' },
    { repo: 'Zolmeister/pond', name: 'Pond', category: 'strategy' },
    { repo: 'redbluegames/game-off-2013', name: 'Missile Game', category: 'action' },
    { repo: 'Loopeex/space-huggers', name: 'Space Huggers', category: 'action' },
    { repo: 'Couchfriends/breakout', name: 'Breakout', category: 'arcade' },
    { repo: 'MattSurabian/DuckHunt-JS', name: 'Duck Hunt', category: 'action' },
    { repo: 'Zolmeister/multivac', name: 'Multivac', category: 'puzzle' },
    { repo: 'Zolmeister/Galactic-Backfire', name: 'Galactic Backfire', category: 'action' },
    { repo: 'Zolmeister/Astray', name: 'Astray', category: 'puzzle' },
    { repo: 'Zolmeister/Hextris', name: 'Hextris', category: 'puzzle' },
    { repo: 'doublespeakgames/adarkroom', name: 'A Dark Room', category: 'adventure' },
    { repo: 'Zolmeister/Pond', name: 'Pond', category: 'strategy' },
    { repo: 'particle-clicker/particle-clicker', name: 'Particle Clicker', category: 'idle' },
    { repo: 'Zolmeister/Hextris', name: 'Hextris', category: 'puzzle' },
    { repo: 'ncase/trust', name: 'The Evolution of Trust', category: 'educational' },
    { repo: 'ncase/wbwwb', name: 'We Become What We Behold', category: 'educational' },
    { repo: 'ncase/loopy', name: 'Loopy', category: 'puzzle' },
    { repo: 'ncase/ballot', name: 'To Build a Better Ballot', category: 'educational' },
    { repo: 'Zolmeister/Pond', name: 'Pond', category: 'strategy' },
    { repo: 'jakesgordon/javascript-breakout', name: 'Breakout', category: 'arcade' },
    { repo: 'jakesgordon/javascript-pong', name: 'Pong', category: 'arcade' },
    { repo: 'jakesgordon/javascript-racer', name: 'Javascript Racer', category: 'racing' },
    { repo: 'jakesgordon/javascript-snakes', name: 'Snakes', category: 'arcade' },
    { repo: 'goldfire/Hextris', name: 'Hextris', category: 'puzzle' },
    { repo: 'Zolmeister/Hextris', name: 'Hextris', category: 'puzzle' },
    { repo: 'Zolmeister/Astray', name: 'Astray', category: 'puzzle' },
];

function createGameId(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function createMetadata(id, name, repo, category) {
    return {
        id,
        name,
        author: `GitHub: ${repo.split('/')[0]}`,
        description: `${name} - Open source HTML5 game from GitHub`,
        thumbnail: `/games/${id}/online/assets/thumbnail.png`,
        category,
        source: `https://github.com/${repo}`,
        license: 'Open Source'
    };
}

async function cloneAndPortGame(repoInfo, existingGames, tempDir) {
    const { repo, name, category } = repoInfo;
    const gameId = createGameId(name);

    try {
        console.log(`\n🎮 Processing: ${name} (${repo})`);

        // Skip if game already exists
        if (existingGames.includes(gameId)) {
            console.log(`⏭️  ${gameId} (already exists)`);
            return { skipped: true, gameId };
        }

        const repoName = repo.split('/')[1];
        const clonePath = join(tempDir, repoName);
        const gameDir = join(__dirname, '..', 'static', 'games', 'html', gameId);
        const assetsDir = join(gameDir, 'assets');

        // Clone the repository
        console.log(`   📥 Cloning repository...`);
        execSync(`git clone --depth 1 https://github.com/${repo}.git ${clonePath}`, {
            stdio: 'ignore'
        });

        // Create game directories
        if (!existsSync(gameDir)) {
            mkdirSync(gameDir, { recursive: true });
        }
        if (!existsSync(assetsDir)) {
            mkdirSync(assetsDir, { recursive: true });
        }

        // Find the main HTML file
        let indexFile = null;
        const possibleIndexFiles = ['index.html', 'game.html', 'play.html', 'demo.html'];
        
        for (const file of possibleIndexFiles) {
            const filePath = join(clonePath, file);
            if (existsSync(filePath)) {
                indexFile = file;
                break;
            }
        }

        if (!indexFile) {
            console.error(`   ❌ No index.html found in repository`);
            return null;
        }

        console.log(`   📄 Found ${indexFile}`);

        // Copy all game files
        console.log(`   📦 Copying game files...`);
        const filesToCopy = ['*.html', '*.js', '*.css', '*.json', 'assets', 'img', 'images', 'sounds', 'audio', 'fonts', 'style', 'js', 'css', 'src'];
        
        try {
            // Copy the entire repo content (excluding .git)
            const files = execSync(`ls -A ${clonePath}`, { encoding: 'utf-8' })
                .split('\n')
                .filter(f => f && f !== '.git' && f !== '.github');
            
            for (const file of files) {
                const srcPath = join(clonePath, file);
                const destPath = join(gameDir, file);
                try {
                    cpSync(srcPath, destPath, { recursive: true });
                } catch (err) {
                    // Ignore copy errors for individual files
                }
            }
        } catch (error) {
            console.error(`   ⚠️  Error copying files: ${error.message}`);
        }

        // Rename main file to index.html if needed
        if (indexFile !== 'index.html') {
            const oldPath = join(gameDir, indexFile);
            const newPath = join(gameDir, 'index.html');
            if (existsSync(oldPath)) {
                cpSync(oldPath, newPath);
            }
        }

        // Create metadata
        const metadata = createMetadata(gameId, name, repo, category);
        writeFileSync(join(gameDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

        // Create placeholder for thumbnail
        writeFileSync(join(assetsDir, '.gitkeep'), `# Add thumbnail.png here\n`);

        console.log(`✅ ${gameId} (${name})`);

        return { gameId, skipped: false };
    } catch (error) {
        console.error(`❌ Error porting ${name}:`, error.message);
        return null;
    }
}

async function main() {
    console.log('🚀 GitHub Games Porter Starting...\n');

    const args = process.argv.slice(2);
    
    // Load existing games
    const gamesListPath = join(__dirname, '..', 'static', 'games', 'games-list.json');
    let existingGames = [];
    if (existsSync(gamesListPath)) {
        existingGames = JSON.parse(readFileSync(gamesListPath, 'utf-8'));
    }

    console.log(`📚 Found ${existingGames.length} existing games\n`);
    console.log(`🎮 Found ${GAME_REPOS.length} GitHub repositories to port\n`);

    // Create temp directory for cloning
    const tempDir = join(__dirname, '..', 'temp', 'github-clones');
    if (!existsSync(tempDir)) {
        mkdirSync(tempDir, { recursive: true });
    }

    const portedGames = [];
    const skippedGames = [];
    const failedGames = [];

    for (const repoInfo of GAME_REPOS) {
        const result = await cloneAndPortGame(repoInfo, existingGames, tempDir);
        if (result) {
            if (result.skipped) {
                skippedGames.push(result.gameId);
            } else {
                portedGames.push(result.gameId);
            }
        } else {
            failedGames.push(repoInfo.name);
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
    console.log(`   ❌ Failed: ${failedGames.length} games`);

    if (failedGames.length > 0) {
        console.log(`\n   Failed games: ${failedGames.join(', ')}`);
    }

    if (portedGames.length > 0) {
        console.log('\n💡 Run "node scripts/generate-games-list.js" to update the games list!');
    }
}

main().catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
