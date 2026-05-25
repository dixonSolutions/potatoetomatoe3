#!/usr/bin/env node

import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Polyfill fetch for older Node versions
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

// Download binary file (for images)
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

const GITHUB_API = 'https://api.github.com/repos/tag2game/tag2game.github.io/contents/play';
const GITHUB_RAW = 'https://raw.githubusercontent.com/tag2game/tag2game.github.io/main/play';

async function fetchGameList() {
    console.log('📡 Fetching game list from GitHub...\n');
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
        ? titleMatch[1].replace(/ - tag2game\.github\.io/i, '').trim()
        : 'Unknown Game';

    const thumbMatch = htmlContent.match(/property="og:image"[^>]*content=["']([^"']+)["']/i);
    const thumbnail = thumbMatch ? thumbMatch[1] : null;

    return { src, title, thumbnail };
}

function createGameId(filename) {
    return filename.replace('.html', '').toLowerCase();
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

function createMetadata(id, title, thumbnail) {
    const thumbFilename = thumbnail ? thumbnail.split('/').pop() : 'thumbnail.png';
    return {
        id,
        name: title,
        author: 'Ported',
        description: `Play ${title} - an exciting unblocked game`,
        thumbnail: `/games/${id}/online/assets/${thumbFilename}`,
        category: 'action'
    };
}

async function portGame(filename, htmlContent, downloadThumbnails = true) {
    try {
        const { src, title, thumbnail } = extractGameData(htmlContent);

        if (!src) {
            console.error(`❌ Could not find iframe src in ${filename}`);
            return null;
        }

        const gameId = createGameId(filename);
        const gameRoot = join(__dirname, '..', 'static', 'games', gameId);
        const gameDir = join(gameRoot, 'online');
        const assetsDir = join(gameDir, 'assets');

        if (!existsSync(join(gameRoot, 'shared'))) {
            mkdirSync(join(gameRoot, 'shared'), { recursive: true });
        }
        if (!existsSync(gameDir)) {
            mkdirSync(gameDir, { recursive: true });
        }
        if (!existsSync(assetsDir)) {
            mkdirSync(assetsDir, { recursive: true });
        }

        const indexHtml = createIndexHtml(src, title);
        writeFileSync(join(gameDir, 'index.html'), indexHtml);

        const metadata = createMetadata(gameId, title, thumbnail);
        writeFileSync(join(gameDir, 'metadata.json'), JSON.stringify(metadata, null, 2));

        // Download thumbnail if available
        let thumbnailDownloaded = false;
        if (downloadThumbnails && thumbnail) {
            try {
                const thumbFilename = thumbnail.split('/').pop();
                const thumbPath = join(assetsDir, thumbFilename);
                await downloadFile(thumbnail, thumbPath);
                thumbnailDownloaded = true;
            } catch (error) {
                console.error(`   ⚠️  Failed to download thumbnail: ${error.message}`);
            }
        }

        if (!thumbnailDownloaded) {
            writeFileSync(
                join(assetsDir, '.gitkeep'),
                `# Add ${thumbnail ? thumbnail.split('/').pop() : 'thumbnail.png'} here\n`
            );
        }

        console.log(`✅ ${gameId}${thumbnailDownloaded ? ' 🖼️' : ''}`);

        return { gameId, thumbnail, thumbnailDownloaded };
    } catch (error) {
        console.error(`❌ Error porting ${filename}:`, error.message);
        return null;
    }
}

function updateGamesTs(gameIds) {
    console.log(`\n✅ Ported ${gameIds.length} games`);
    console.log('💡 Games are automatically discovered from /static/games/<id>/online/');
    console.log('   No need to manually update games.ts!');
}

async function downloadThumbnailsOnly() {
    console.log('� GDownloading thumbnails for existing games...\n');

    const gamesDir = join(__dirname, '..', 'static', 'games');
    const gameFolders = readdirSync(gamesDir, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith('_'))
        .map((dirent) => dirent.name);

    let downloaded = 0;
    let skipped = 0;
    let failed = 0;

    for (const gameId of gameFolders) {
        const metadataPath = join(gamesDir, gameId, 'online', 'metadata.json');
        if (!existsSync(metadataPath)) {
            continue;
        }

        const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'));
        const thumbnailUrl = metadata.thumbnail;

        if (!thumbnailUrl || !thumbnailUrl.startsWith('http')) {
            // Convert relative path to absolute URL
            const thumbFilename = thumbnailUrl ? thumbnailUrl.split('/').pop() : null;
            if (!thumbFilename) {
                skipped++;
                continue;
            }

            // Try to construct the URL from abinbins.github.io
            const url = `https://abinbins.github.io/thumb/${thumbFilename}`;
            const assetsDir = join(gamesDir, gameId, 'online', 'assets');
            const thumbPath = join(assetsDir, thumbFilename);

            // Skip if already exists
            if (existsSync(thumbPath)) {
                console.log(`⏭️  ${gameId} (already exists)`);
                skipped++;
                continue;
            }

            try {
                if (!existsSync(assetsDir)) {
                    mkdirSync(assetsDir, { recursive: true });
                }
                await downloadFile(url, thumbPath);
                console.log(`✅ ${gameId} 🖼️`);
                downloaded++;
            } catch (error) {
                console.error(`❌ ${gameId}: ${error.message}`);
                failed++;
            }

            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Downloaded: ${downloaded}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Failed: ${failed}`);
}

async function main() {
    console.log('🚀 Game Porter Starting...\n');

    const args = process.argv.slice(2);
    const downloadThumbnails = !args.includes('--no-thumbnails');

    if (args[0] === '--thumbnails-only') {
        await downloadThumbnailsOnly();
        return;
    }

    if (args[0] === '--local') {
        const files = args.slice(1).filter((f) => f !== '--no-thumbnails');
        if (files.length === 0) {
            console.log('Usage: node port-game.js --local <html-file> [<html-file2> ...]');
            console.log('Options: --no-thumbnails (skip thumbnail downloads)');
            process.exit(1);
        }

        console.log('🎮 Starting local game porting...\n');
        const portedGames = [];

        for (const file of files) {
            const htmlContent = readFileSync(file, 'utf-8');
            const result = await portGame(file.split('/').pop(), htmlContent, downloadThumbnails);
            if (result) {
                portedGames.push(result.gameId);
            }
        }

        if (portedGames.length > 0) {
            console.log('\n📝 Add these to src/lib/utils/games.ts:');
            console.log(`const GAME_IDS = [${portedGames.map((id) => `'${id}'`).join(', ')}];`);
        }
    } else {
        console.log('🎮 Starting GitHub game porting...\n');
        if (downloadThumbnails) {
            console.log('📥 Thumbnails will be downloaded automatically\n');
        }

        try {
            const gameFiles = await fetchGameList();
            console.log(`Found ${gameFiles.length} games to port\n`);

            const portedGames = [];
            const failedThumbnails = [];
            let successfulThumbnails = 0;

            for (const filename of gameFiles) {
                const htmlContent = await fetchGameHtml(filename);
                const result = await portGame(filename, htmlContent, downloadThumbnails);
                if (result) {
                    portedGames.push(result.gameId);
                    if (result.thumbnailDownloaded) {
                        successfulThumbnails++;
                    } else if (result.thumbnail) {
                        failedThumbnails.push({ id: result.gameId, url: result.thumbnail });
                    }
                }
                await new Promise((resolve) => setTimeout(resolve, 100));
            }

            if (portedGames.length > 0) {
                updateGamesTs(portedGames);

                console.log(`\n🎉 Successfully ported ${portedGames.length} games!`);
                if (downloadThumbnails) {
                    console.log(`📸 Downloaded ${successfulThumbnails} thumbnails`);
                    if (failedThumbnails.length > 0) {
                        console.log(`⚠️  ${failedThumbnails.length} thumbnails failed to download`);
                    }
                }
            }
        } catch (error) {
            console.error('❌ Error:', error.message);
            process.exit(1);
        }
    }
}

main().catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
