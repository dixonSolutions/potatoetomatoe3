#!/usr/bin/env node
/**
 * Bounded, resumable offline mirroring for low-RAM / long-term scheduled runs.
 * Processes one game per child process (spawn) so Node heap is freed between games.
 *
 * Usage:
 *   node scripts/offline-mirror-worker.mjs                    # default: 100 games per run
 *   node scripts/offline-mirror-worker.mjs --max-games 5 --max-minutes 120
 *   node scripts/offline-mirror-worker.mjs --pause-ms 2000
 *   node scripts/offline-mirror-worker.mjs --deep-only
 *   OFFLINE_MAX_GAMES=1 OFFLINE_MAX_MINUTES=60 node scripts/offline-mirror-worker.mjs
 *
 * Env (defaults if flags omitted): OFFLINE_MAX_GAMES, OFFLINE_MAX_MINUTES, OFFLINE_PAUSE_MS,
 * OFFLINE_STATE_FILE, OFFLINE_SKIP_GENERATE
 */

import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const GAMES_ROOT = join(ROOT, 'static', 'games');
const DEFAULT_STATE = join(__dirname, 'data', 'offline-mirror-state.json');
/** Default games per run when no --max-games and no OFFLINE_MAX_GAMES. */
const DEFAULT_MAX_GAMES_PER_RUN = 100;

function offlineMirrorLooksValid(offlineIndexPath) {
    if (!existsSync(offlineIndexPath)) return false;
    try {
        return statSync(offlineIndexPath).size >= 64;
    } catch {
        return false;
    }
}

function offlineBundleIndex(id) {
    return join(GAMES_ROOT, id, 'offline', 'index.html');
}

function hasHttpIframe(id) {
    const indexHtmlPath = join(GAMES_ROOT, id, 'online', 'index.html');
    if (!existsSync(indexHtmlPath)) return false;
    const html = readFileSync(indexHtmlPath, 'utf-8');
    const m = html.match(/<iframe[^>]*src=["']([^"']+)["'][^>]*>/i);
    if (!m) return false;
    return m[1].startsWith('http');
}

function gameIdsWithMetadata() {
    return readdirSync(GAMES_ROOT, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
        .map((d) => d.name)
        .filter((id) => existsSync(join(GAMES_ROOT, id, 'online', 'metadata.json')));
}

/**
 * @param {'mirror' | 'deep'} mode
 */
function buildPendingQueue(mode) {
    const ids = gameIdsWithMetadata().filter(hasHttpIframe);
    const pending = [];
    for (const id of ids) {
        const offlineIdx = offlineBundleIndex(id);
        if (mode === 'deep') {
            if (offlineMirrorLooksValid(offlineIdx)) pending.push(id);
        } else if (!offlineMirrorLooksValid(offlineIdx)) {
            pending.push(id);
        }
    }
    return pending.sort((a, b) => a.localeCompare(b));
}

function needsForceRemirror(id) {
    const offlineDir = join(GAMES_ROOT, id, 'offline');
    const offlineIdx = join(offlineDir, 'index.html');
    return existsSync(offlineDir) && !offlineMirrorLooksValid(offlineIdx);
}

function hashPending(list) {
    return createHash('sha256').update(list.join('|')).digest('hex').slice(0, 16);
}

function parseArgs(argv) {
    const out = {
        maxGames: 0,
        maxMinutes: 0,
        pauseMs: 0,
        deepOnly: false,
        keepBroken: false,
        stateFile: process.env.OFFLINE_STATE_FILE || DEFAULT_STATE,
        skipGenerate: process.env.OFFLINE_SKIP_GENERATE === '1' || argv.includes('--skip-generate'),
        help: argv.includes('--help') || argv.includes('-h')
    };

    const envGames = parseInt(process.env.OFFLINE_MAX_GAMES || '', 10);
    const envMin = parseInt(process.env.OFFLINE_MAX_MINUTES || '', 10);
    const envPause = parseInt(process.env.OFFLINE_PAUSE_MS || '', 10);

    const gIdx = argv.indexOf('--max-games');
    const mIdx = argv.indexOf('--max-minutes');
    const pIdx = argv.indexOf('--pause-ms');

    out.maxGames =
        gIdx >= 0 && argv[gIdx + 1]
            ? parseInt(argv[gIdx + 1], 10)
            : Number.isFinite(envGames) && envGames > 0
              ? envGames
              : DEFAULT_MAX_GAMES_PER_RUN;
    out.maxGames = Math.max(1, out.maxGames);
    out.maxMinutes =
        mIdx >= 0 && argv[mIdx + 1]
            ? parseInt(argv[mIdx + 1], 10)
            : Number.isFinite(envMin) && envMin > 0
              ? envMin
              : 0;
    out.pauseMs =
        pIdx >= 0 && argv[pIdx + 1]
            ? parseInt(argv[pIdx + 1], 10)
            : Number.isFinite(envPause) && envPause >= 0
              ? envPause
              : 0;

    out.deepOnly = argv.includes('--deep-only');
    out.keepBroken = argv.includes('--keep-broken');

    const sIdx = argv.indexOf('--state-file');
    if (sIdx >= 0 && argv[sIdx + 1]) out.stateFile = argv[sIdx + 1];

    return out;
}

function loadState(path) {
    if (!existsSync(path)) {
        return { version: 1, mode: 'mirror', nextIndex: 0, pendingHash: '', lastRunAt: null };
    }
    try {
        return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
        return { version: 1, mode: 'mirror', nextIndex: 0, pendingHash: '', lastRunAt: null };
    }
}

function saveState(path, state) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

function runNodeScript(scriptRelative, args, inheritIo = true) {
    const scriptPath = join(ROOT, scriptRelative);
    const r = spawnSync(process.execPath, [scriptPath, ...args], {
        cwd: ROOT,
        stdio: inheritIo ? 'inherit' : 'pipe',
        encoding: 'utf-8',
        env: process.env
    });
    return r.status ?? 1;
}

function sleepMs(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function main() {
    const argv = process.argv.slice(2);
    const opts = parseArgs(argv);

    if (opts.help) {
        console.log(`offline-mirror-worker.mjs — bounded offline mirroring for scheduled / low-RAM runs

Options:
  --max-games N     Games to process this run (default: 100, or OFFLINE_MAX_GAMES)
  --max-minutes N   Stop after N wall-clock minutes (0 = no limit, or OFFLINE_MAX_MINUTES)
  --pause-ms N      Pause between games (OFFLINE_PAUSE_MS)
  --deep-only       Pass --deep-only to download-games-offline.js (games with offline/ already)
  --keep-broken     Pass --keep-broken to download-games-offline.js
  --state-file PATH State file (default: scripts/data/offline-mirror-state.json)
  --skip-generate   Do not run generate-games-list.js at the end
  Env: OFFLINE_MAX_GAMES, OFFLINE_MAX_MINUTES, OFFLINE_PAUSE_MS, OFFLINE_STATE_FILE, OFFLINE_SKIP_GENERATE
`);
        process.exit(0);
    }

    const mode = opts.deepOnly ? 'deep' : 'mirror';
    const pending = buildPendingQueue(mode);
    const pHash = hashPending(pending);

    let state = loadState(opts.stateFile);
    if (state.mode !== mode || state.pendingHash !== pHash) {
        state.nextIndex = 0;
        state.mode = mode;
        state.pendingHash = pHash;
    }

    let start = Math.min(Math.max(0, state.nextIndex | 0), pending.length);
    if (start >= pending.length) {
        start = 0;
    }

    const t0 = Date.now();
    const maxMs = opts.maxMinutes > 0 ? opts.maxMinutes * 60 * 1000 : Infinity;

    console.log(
        `[offline-mirror-worker] mode=${mode} pending=${pending.length} startIndex=${start} maxGames=${opts.maxGames} maxMinutes=${opts.maxMinutes || 'none'}`
    );

    if (pending.length === 0) {
        console.log('[offline-mirror-worker] Nothing to do.');
        saveState(opts.stateFile, {
            ...state,
            nextIndex: 0,
            pendingHash: pHash,
            lastRunAt: new Date().toISOString(),
            lastMessage: 'empty queue'
        });
        if (!opts.skipGenerate) {
            runNodeScript('scripts/generate-games-list.js', []);
        }
        return;
    }

    let processed = 0;
    let i = start;

    while (i < pending.length && processed < opts.maxGames) {
        if (Date.now() - t0 >= maxMs) {
            console.log(`[offline-mirror-worker] Time limit reached (--max-minutes ${opts.maxMinutes}).`);
            break;
        }

        const id = pending[i];
        const dlArgs = [];
        if (opts.deepOnly) dlArgs.push('--deep-only');
        if (opts.keepBroken) dlArgs.push('--keep-broken');
        if (!opts.deepOnly && needsForceRemirror(id)) dlArgs.push('--force');
        dlArgs.push(id);

        console.log(`\n[offline-mirror-worker] (${processed + 1}/${opts.maxGames} this run) ${id}\n`);

        const code = runNodeScript('scripts/download-games-offline.js', dlArgs, true);
        processed++;
        i++;

        state.nextIndex = i;
        state.pendingHash = pHash;
        state.mode = mode;
        state.lastRunAt = new Date().toISOString();
        state.lastProcessedId = id;
        state.lastExitCode = code;
        saveState(opts.stateFile, state);

        if (code !== 0) {
            console.warn(`[offline-mirror-worker] download-games-offline exited ${code} for ${id}`);
        }

        if (opts.pauseMs > 0 && processed < opts.maxGames && i < pending.length) {
            if (Date.now() - t0 >= maxMs) break;
            await sleepMs(opts.pauseMs);
        }

        if (Date.now() - t0 >= maxMs) {
            console.log(`[offline-mirror-worker] Time limit reached after pause.`);
            break;
        }
    }

    if (i >= pending.length) {
        state.nextIndex = 0;
        state.pendingHash = hashPending(buildPendingQueue(mode));
        saveState(opts.stateFile, state);
        console.log('\n[offline-mirror-worker] Reached end of current pending queue; nextIndex reset.');
    }

    console.log(`\n[offline-mirror-worker] Done. Processed ${processed} game(s). nextIndex=${state.nextIndex}`);

    if (!opts.skipGenerate) {
        console.log('[offline-mirror-worker] Regenerating games list…');
        runNodeScript('scripts/generate-games-list.js', []);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
