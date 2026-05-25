#!/usr/bin/env node

import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Download text content
const fetchUrl = (url) => {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : require('http');
        protocol
            .get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
                if (res.statusCode === 301 || res.statusCode === 302) {
                    // Follow redirects
                    return fetchUrl(res.headers.location).then(resolve).catch(reject);
                }

                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        resolve(data);
                    } else {
                        reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    }
                });
            })
            .on('error', reject);
    });
};

async function localizeGame(gameId) {
    const gameDir = join(__dirname, '..', 'static', 'games', 'html', gameId);
    const indexPath = join(gameDir, 'index.html');

    if (!existsSync(indexPath)) {
        console.error(`❌ ${gameId}: index.html not found`);
        return false;
    }

    try {
        const indexContent = readFileSync(indexPath, 'utf-8');

        // Extract iframe src
        const iframeMatch = indexContent.match(/<iframe[^>]*src=["']([^"']+)["'][^>]*>/i);
        if (!iframeMatch) {
            console.error(`❌ ${gameId}: No iframe found`);
            return false;
        }

        const iframeSrc = iframeMatch[1];
        console.log(`📥 ${gameId}: Downloading from ${iframeSrc}`);

        // Download the iframe content
        const gameContent = await fetchUrl(iframeSrc);

        // Create a clean HTML wrapper with the downloaded content
        const localHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${gameId}</title>
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
    </style>
</head>
<body>
${gameContent}
</body>
</html>`;

        // Backup original
        const backupPath = join(gameDir, 'index.html.backup');
        if (!existsSync(backupPath)) {
            writeFileSync(backupPath, indexContent);
        }

        // Write localized version
        writeFileSync(indexPath, localHtml);
        console.log(`✅ ${gameId}: Localized successfully`);
        return true;
    } catch (error) {
        console.error(`❌ ${gameId}: ${error.message}`);
        return false;
    }
}

async function restoreGame(gameId) {
    const gameDir = join(__dirname, '..', 'static', 'games', 'html', gameId);
    const indexPath = join(gameDir, 'index.html');
    const backupPath = join(gameDir, 'index.html.backup');

    if (!existsSync(backupPath)) {
        console.error(`❌ ${gameId}: No backup found`);
        return false;
    }

    try {
        const backupContent = readFileSync(backupPath, 'utf-8');
        writeFileSync(indexPath, backupContent);
        console.log(`✅ ${gameId}: Restored from backup`);
        return true;
    } catch (error) {
        console.error(`❌ ${gameId}: ${error.message}`);
        return false;
    }
}

async function main() {
    console.log('🎮 Game Localizer - Making games fully offline!\n');

    const args = process.argv.slice(2);

    if (args[0] === '--restore' || args[0] === '--undo') {
        const gamesToRestore = args.slice(1);

        if (gamesToRestore.length === 0 || gamesToRestore[0] === '--all') {
            const gamesDir = join(__dirname, '..', 'static', 'games', 'html');
            const gameFolders = readdirSync(gamesDir, { withFileTypes: true })
                .filter((dirent) => dirent.isDirectory())
                .map((dirent) => dirent.name);

            console.log(`Restoring ${gameFolders.length} games from backup...\n`);
            let success = 0;
            let failed = 0;

            for (const gameId of gameFolders) {
                const result = await restoreGame(gameId);
                if (result) success++;
                else failed++;
            }

            console.log(`\n📊 Summary:`);
            console.log(`   Restored: ${success}`);
            console.log(`   Failed: ${failed}`);
        } else {
            console.log(`Restoring ${gamesToRestore.length} game(s)...\n`);
            let success = 0;
            let failed = 0;

            for (const gameId of gamesToRestore) {
                const result = await restoreGame(gameId);
                if (result) success++;
                else failed++;
            }

            console.log(`\n📊 Summary:`);
            console.log(`   Restored: ${success}`);
            console.log(`   Failed: ${failed}`);
        }
        return;
    }

    if (args.length > 0 && args[0] !== '--all') {
        // Localize specific games
        console.log(`Localizing ${args.length} game(s)...\n`);
        let success = 0;
        let failed = 0;

        for (const gameId of args) {
            const result = await localizeGame(gameId);
            if (result) success++;
            else failed++;
            await new Promise((resolve) => setTimeout(resolve, 500));
        }

        console.log(`\n📊 Summary:`);
        console.log(`   Success: ${success}`);
        console.log(`   Failed: ${failed}`);
    } else {
        // Localize all games
        const gamesDir = join(__dirname, '..', 'static', 'games', 'html');
        const gameFolders = readdirSync(gamesDir, { withFileTypes: true })
            .filter((dirent) => dirent.isDirectory())
            .map((dirent) => dirent.name);

        console.log(`Found ${gameFolders.length} games to localize\n`);

        let success = 0;
        let failed = 0;
        let skipped = 0;

        for (const gameId of gameFolders) {
            const indexPath = join(gamesDir, gameId, 'index.html');
            const backupPath = join(gamesDir, gameId, 'index.html.backup');

            // Skip if already localized (has backup)
            if (existsSync(backupPath)) {
                console.log(`⏭️  ${gameId}: Already localized`);
                skipped++;
                continue;
            }

            const result = await localizeGame(gameId);
            if (result) success++;
            else failed++;

            // Rate limiting
            await new Promise((resolve) => setTimeout(resolve, 500));
        }

        console.log(`\n📊 Summary:`);
        console.log(`   Success: ${success}`);
        console.log(`   Skipped: ${skipped}`);
        console.log(`   Failed: ${failed}`);
    }

    console.log('\n💡 Tip: Original files are backed up as index.html.backup');
}

main().catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
