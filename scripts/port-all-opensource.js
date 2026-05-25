#!/usr/bin/env node

import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const scripts = [
    { name: 'GitHub Games', script: 'port-github-games.js', description: 'Individual open-source game repos' },
    { name: 'js13kGames', script: 'port-js13k-games.js', description: '13KB JavaScript games' },
    { name: 'itch.io Games', script: 'port-itch-games.js', description: 'Indie games from itch.io' },
    { name: 'Phaser Examples', script: 'port-phaser-examples.js', description: 'Phaser framework examples' },
    { name: 'PlayCanvas Games', script: 'port-playcanvas-games.js', description: 'WebGL games from PlayCanvas' },
];

async function runScript(scriptInfo) {
    const { name, script } = scriptInfo;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 Running: ${name}`);
    console.log(`${'='.repeat(60)}\n`);

    try {
        execSync(`node ${join(__dirname, script)}`, {
            stdio: 'inherit',
            cwd: __dirname
        });
    } catch (error) {
        console.error(`\n❌ Error running ${name}: ${error.message}`);
    }
}

async function main() {
    console.log('🎮 OPEN SOURCE GAMES MASS PORTER 🎮\n');
    console.log('This will port games from multiple open-source platforms:\n');

    scripts.forEach((s, i) => {
        console.log(`${i + 1}. ${s.name} - ${s.description}`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('Starting in 3 seconds...');
    console.log('='.repeat(60) + '\n');

    await new Promise((resolve) => setTimeout(resolve, 3000));

    for (const scriptInfo of scripts) {
        await runScript(scriptInfo);
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ ALL PORTING COMPLETE!');
    console.log('='.repeat(60) + '\n');

    console.log('📊 Next steps:');
    console.log('   1. Run: node scripts/generate-games-list.js');
    console.log('   2. Add thumbnails to games that need them');
    console.log('   3. Test the games in your browser');
    console.log('   4. Commit and deploy!\n');
}

main().catch((error) => {
    console.error('💥 Fatal error:', error);
    process.exit(1);
});
