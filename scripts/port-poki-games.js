#!/usr/bin/env node

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));

const fetchUrl = (url) => {
    return new Promise((resolve, reject) => {
        https
            .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    // Follow redirect
                    return fetchUrl(res.headers.location).then(resolve).catch(reject);
                }
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
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                }
            })
            .on('error', reject);
    });
};

function createGameId(gameName) {
    return gameName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function createIndexHtml(gameUrl, title) {
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
    <iframe class="game-iframe" id="game-area" src="${gameUrl}" scrolling="none" allowfullscreen></iframe>
</body>
</html>`;
}

function createMetadata(id, title, description, thumbnailFilename, category = 'action') {
    return {
        id,
        name: title,
        author: 'Ported from Poki',
        description: description || `Play ${title} - an exciting game from Poki`,
        thumbnail: thumbnailFilename
            ? `/games/${id}/online/assets/${thumbnailFilename}`
            : `/games/${id}/online/assets/thumbnail.png`,
        category
    };
}

async function fetchPokiGameData(gameSlug) {
    try {
        // Try to fetch game data from Poki's API
        const apiUrl = `https://poki.com/api/v2/games/${gameSlug}`;
        const response = await fetchUrl(apiUrl);
        const data = await response.json();
        return data;
    } catch (error) {
        console.error(`   ⚠️  Could not fetch API data: ${error.message}`);
        return null;
    }
}

async function portPokiGame(gameSlug, existingGames, downloadThumbnails = true) {
    try {
        console.log(`\n🎮 Processing: ${gameSlug}`);

        const gameId = createGameId(gameSlug);

        // Skip if game already exists
        if (existingGames.includes(gameId)) {
            console.log(`⏭️  ${gameId} (already exists)`);
            return { skipped: true, gameId };
        }

        // Fetch game data from Poki
        const gameData = await fetchPokiGameData(gameSlug);
        
        let title = gameSlug
            .split('-')
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
        let description = `Play ${title} online`;
        let thumbnailUrl = null;
        let category = 'action';

        if (gameData) {
            title = gameData.title || title;
            description = gameData.description || description;
            thumbnailUrl = gameData.image || gameData.thumbnail;
            category = gameData.category || category;
        }

        const gameDir = join(__dirname, '..', 'static', 'games', 'html', gameId);
        const assetsDir = join(gameDir, 'assets');

        if (!existsSync(gameDir)) {
            mkdirSync(gameDir, { recursive: true });
        }
        if (!existsSync(assetsDir)) {
            mkdirSync(assetsDir, { recursive: true });
        }

        // Create index.html with Poki game URL
        const gameUrl = `https://poki.com/en/g/${gameSlug}`;
        const indexHtml = createIndexHtml(gameUrl, title);
        writeFileSync(join(gameDir, 'index.html'), indexHtml);

        // Download thumbnail if available
        let thumbnailDownloaded = false;
        let thumbnailFilename = 'thumbnail.png';

        if (downloadThumbnails && thumbnailUrl) {
            try {
                thumbnailFilename = thumbnailUrl.split('/').pop().split('?')[0] || 'thumbnail.png';
                if (!thumbnailFilename.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
                    thumbnailFilename = 'thumbnail.png';
                }
                const thumbPath = join(assetsDir, thumbnailFilename);
                await downloadFile(thumbnailUrl, thumbPath);
                thumbnailDownloaded = true;
            } catch (error) {
                console.error(`   ⚠️  Failed to download thumbnail: ${error.message}`);
                thumbnailFilename = null;
            }
        }

        const metadata = createMetadata(gameId, title, description, thumbnailFilename, category);
        writeFileSync(join(gameDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

        if (!thumbnailDownloaded) {
            writeFileSync(join(assetsDir, '.gitkeep'), `# Add thumbnail here\n`);
        }

        console.log(`✅ ${gameId}${thumbnailDownloaded ? ' 🖼️' : ''}`);

        return { gameId, thumbnailDownloaded, skipped: false };
    } catch (error) {
        console.error(`❌ Error porting ${gameSlug}:`, error.message);
        return null;
    }
}

async function main() {
    console.log('🚀 Poki Game Porter Starting...\n');

    const args = process.argv.slice(2);
    const downloadThumbnails = !args.includes('--no-thumbnails');

    if (args.length === 0 || args[0] === '--help') {
        console.log('Usage: node port-poki-games.js <game-slug> [<game-slug2> ...] [--no-thumbnails]');
        console.log('\nExamples:');
        console.log('  node port-poki-games.js subway-surfers');
        console.log('  node port-poki-games.js stickman-hook temple-run-2 --no-thumbnails');
        console.log('\nGame slugs are the URL path from poki.com/en/g/<slug>');
        process.exit(0);
    }

    // Load existing games
    const gamesListPath = join(__dirname, '..', 'static', 'games', 'games-list.json');
    let existingGames = [];
    if (existsSync(gamesListPath)) {
        existingGames = JSON.parse(readFileSync(gamesListPath, 'utf-8'));
    }

    console.log(`📚 Found ${existingGames.length} existing games\n`);

    const gameSlugs = args.filter((arg) => !arg.startsWith('--'));
    console.log(`🎮 Porting ${gameSlugs.length} game(s) from Poki...\n`);

    if (downloadThumbnails) {
        console.log('📥 Thumbnails will be downloaded automatically\n');
    }

    const portedGames = [];
    const skippedGames = [];
    let successfulThumbnails = 0;

    for (const gameSlug of gameSlugs) {
        const result = await portPokiGame(gameSlug, existingGames, downloadThumbnails);
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
        // Rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
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
}

main().catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
