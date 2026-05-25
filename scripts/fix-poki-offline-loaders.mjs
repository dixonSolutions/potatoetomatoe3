#!/usr/bin/env node
/**
 * Catalog-wide Poki SDK fix: abinbins **master-loader** shells and **standalone** `poki-sdk.js` scripts.
 * Does not run full wget/deep mirror — only fetches loader chain + patches HTML/JS.
 *
 * Usage:
 *   node scripts/fix-poki-offline-loaders.mjs              # fix all games with Poki offline shell
 *   node scripts/fix-poki-offline-loaders.mjs --scan-only  # report issues only
 *   node scripts/fix-poki-offline-loaders.mjs --dry-run    # print actions without writing
 *   node scripts/fix-poki-offline-loaders.mjs some-game-id  # limit to ids
 */
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
    ensurePokiMasterLoaderChain,
    ensureStandalonePokiSdkBundle,
    listGameIdsWithAnyPokiSdkOfflineNeed,
    scanPokiOfflineIssues,
} from './lib/poki-master-loader-offline.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = join(__dirname, '../static/games');

const argv = process.argv.slice(2);
const SCAN_ONLY = argv.includes('--scan-only');
const DRY_RUN = argv.includes('--dry-run');
const idArgs = argv.filter((a) => !a.startsWith('--'));

async function main() {
    let ids = listGameIdsWithAnyPokiSdkOfflineNeed(GAMES_ROOT);
    if (idArgs.length > 0) {
        ids = ids.filter((id) => idArgs.includes(id));
    }

    console.log(`Games with Poki SDK (master-loader and/or poki-sdk.js): ${ids.length}\n`);

    if (SCAN_ONLY) {
        let need = 0;
        for (const id of ids) {
            const offlineDir = join(GAMES_ROOT, id, 'offline');
            const q = scanPokiOfflineIssues(offlineDir);
            const problems = [
                q.remoteMasterLoader && 'remote master-loader URL',
                q.remotePokiSdkScript && 'remote https://abinbins.github.io/poki-sdk.js in index.html',
                q.masterLoaderUnpatched && 'master-loader still uses /poki-sdk.js',
                q.pokiSdkDynamicLoaderAbsolute && 'poki-sdk.js still uses /poki-sdk-core-… (site root)',
                q.needsUnityWebglUrl && 'missing unityWebglLoaderUrl',
                q.missingOrTinyFiles.length && `missing/tiny: ${q.missingOrTinyFiles.join(', ')}`,
            ].filter(Boolean);
            if (problems.length) {
                need++;
                console.log(`${id}`);
                for (const p of problems) {
                    console.log(`   • ${p}`);
                }
            }
        }
        console.log(`\nScan: ${need} game(s) need fixes, ${ids.length - need} clean.`);
        return;
    }

    let changed = 0;
    let noop = 0;
    for (const id of ids) {
        const offlineDir = join(GAMES_ROOT, id, 'offline');
        console.log(`\n🎮 ${id}`);
        const r1 = await ensurePokiMasterLoaderChain(offlineDir, { dryRun: DRY_RUN, quiet: false });
        let r2 = { status: 'skipped', actions: [] };
        if (r1.status === 'skipped' && r1.actions[0] === 'not a Poki master-loader shell') {
            r2 = await ensureStandalonePokiSdkBundle(offlineDir, { dryRun: DRY_RUN, quiet: false });
        }
        const touched =
            r1.status === 'changed' ||
            r1.status === 'dry-run' ||
            r2.status === 'changed' ||
            r2.status === 'dry-run';
        if (touched) {
            changed++;
            if (DRY_RUN) {
                console.log(
                    `   [dry-run] ${[...(r1.actions || []), ...(r2.actions || [])].join('; ') || 'no actions'}`
                );
            }
        } else {
            noop++;
            console.log('   (already OK)');
        }
    }

    console.log(
        `\nDone: ${changed} ${DRY_RUN ? 'would change' : 'updated'}, ${noop} already satisfied, ${ids.length} total.`
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
