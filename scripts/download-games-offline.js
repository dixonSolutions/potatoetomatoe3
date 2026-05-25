
import {
    readdirSync,
    readFileSync,
    existsSync,
    mkdirSync,
    renameSync,
    writeFileSync,
    rmSync,
    statSync,
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { iterativelyFetchDiscoveredAssets } from './lib/mirror-deep-assets.mjs';
import {
    ensurePokiMasterLoaderChain,
    ensureStandalonePokiSdkBundle,
} from './lib/poki-master-loader-offline.mjs';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

/** Avoid buffering wget stderr/stdout in a large String (RAM); stream to terminal instead. */
function runWgetInherit(args) {
    return new Promise((resolve, reject) => {
        const child = spawn('wget', args, { stdio: 'inherit' });
        child.on('error', reject);
        child.on('close', (code) => resolve(code ?? 1));
    });
}

const GAMES_ROOT = join(__dirname, '../static/games');

/**
 * Unity build.json often lists absolute CDN URLs. path.join(localDir, "https://host/...") becomes
 * a bogus "https:/host/..." on disk — use a hostname/path layout instead and rewrite JSON to relative paths.
 */
function unityAssetRelativeLocalPath(asset) {
    if (/^https?:\/\//i.test(asset)) {
        const u = new URL(asset);
        const parts = [u.hostname, ...u.pathname.split('/').filter(Boolean)];
        return parts.join('/');
    }
    return asset.replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * After build.json is rewritten to `host/path/file` (no scheme), `new URL(that, iframePage)`
 * would incorrectly resolve against the game page URL. Detect host-first paths and use https.
 */
function unityAssetDownloadUrl(asset, jsonDirUrl) {
    if (/^https?:\/\//i.test(asset)) return asset;
    const trimmed = asset.replace(/^\/+/, '');
    if (/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}\//i.test(trimmed)) {
        return `https://${trimmed}`;
    }
    return new URL(asset, jsonDirUrl).href;
}

/**
 * Remove only the offline mirror folder — never delete `online/` (shell, metadata, assets).
 * Deleting the whole game id was wiping catalog entries when wget partially failed.
 */
function removeBrokenOfflineMirror(gameId, reason, keepBroken) {
    if (keepBroken) {
        console.log(`⚠️  Keeping broken offline mirror "${gameId}" (--keep-broken): ${reason}`);
        return;
    }
    console.log(`🗑️  Removing static/games/${gameId}/offline — ${reason}`);
    const offlineDir = join(GAMES_ROOT, gameId, 'offline');
    try {
        if (existsSync(offlineDir)) {
            rmSync(offlineDir, { recursive: true, force: true });
        }
    } catch (e) {
        console.error(`   ❌ Could not remove offline folder: ${e.message}`);
    }
}

/**
 * When Playwright fails for Poki, prefer clearing `offline/` and mirroring with `wget` instead of
 * deleting and stopping — except when the browser ran but the page was the known "has moved" stub
 * (wget usually hits the same stub).
 * @param {string} [reason]
 */
function pokiPlaywrightFailureShouldFallbackToWget(reason) {
    if (!reason || typeof reason !== 'string') return true;
    if (/^poki-stub:/i.test(reason.trim())) return false;
    return true;
}

/** True if we have a non-trivial index.html in the offline mirror dir */
function offlineMirrorLooksValid(offlineIndexPath) {
    if (!existsSync(offlineIndexPath)) return false;
    try {
        return statSync(offlineIndexPath).size >= 64;
    } catch {
        return false;
    }
}

const WGET_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Collect Unity WebGL manifest .json paths referenced in loader HTML (multiple patterns / builds). */
function collectUnityManifestRelPaths(htmlContent) {
    const paths = new Set();
    const patternSources = [
        /UnityLoader\.instantiate\s*\(\s*["'][^"']+["']\s*,\s*["']([^"']+\.json)["']/gi,
        /UnityLoader\.instantiate\s*\(\s*["'][^"']+["']\s*,\s*`([^`]+\.json)`/gi,
        /createUnityInstance\s*\(\s*[^,]+,\s*["']([^"']+\.json)["']/gi
    ];
    for (const re of patternSources) {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(htmlContent)) !== null) {
            if (m[1]) paths.add(m[1]);
        }
    }
    let m;
    const buildRe = /["'](Build\/[^"']+\.json)["']/gi;
    buildRe.lastIndex = 0;
    while ((m = buildRe.exec(htmlContent)) !== null) paths.add(m[1]);
    return [...paths];
}

/** Scan JS/HTML/CSS/JSON under the mirror for same-origin file references wget missed; repeat until stable. */
async function deepFetchRuntimeAssets(targetDir, iframeSrc, label) {
    await iterativelyFetchDiscoveredAssets(
        targetDir,
        iframeSrc,
        async (_rel, dest, url) => {
            await execAsync(
                `wget -q --tries=3 --timeout=90 --user-agent='${WGET_UA}' -O "${dest}" "${url}"`
            );
        },
        {
            maxRounds: 25,
            onRound: (round, count) => {
                if (count > 0) {
                    console.log(`   📎 Deep assets${label ? ` (${label})` : ''} round ${round}: +${count} file(s)`);
                }
            }
        }
    );
}

async function ensureUnityAssetsFromManifests(htmlContent, targetDir, gamePageBaseUrl) {
    const manifestPaths = collectUnityManifestRelPaths(htmlContent);
    if (manifestPaths.length === 0) return;

    const urlKeys = [
        'dataUrl',
        'wasmCodeUrl',
        'wasmFrameworkUrl',
        'codeUrl',
        'frameworkUrl',
        'asmCodeUrl',
        'asmFrameworkUrl',
        'asmMemoryUrl',
        'memUrl',
        'memoryUrl',
        'symbolsUrl',
        'backgroundUrl'
    ];

    for (const jsonPathRel of manifestPaths) {
        const jsonLocalPath = join(targetDir, jsonPathRel);
        const jsonUrl = new URL(jsonPathRel, gamePageBaseUrl + '/').href;

        if (!existsSync(jsonLocalPath)) {
            console.log(`   Downloading Unity manifest: ${jsonUrl}`);
            mkdirSync(dirname(jsonLocalPath), { recursive: true });
            try {
                await execAsync(
                    `wget -q --tries=3 --timeout=90 --user-agent='${WGET_UA}' -O "${jsonLocalPath}" "${jsonUrl}"`
                );
            } catch (e) {
                console.error(`   ❌ Failed to download Unity JSON ${jsonPathRel}: ${e.message}`);
            }
        }

        if (!existsSync(jsonLocalPath)) continue;

        try {
            const jsonContent = JSON.parse(readFileSync(jsonLocalPath, 'utf-8'));
            const jsonDirUrl = new URL('.', jsonUrl).href;
            const jsonLocalDir = dirname(jsonLocalPath);

            const assetsToDownload = [];
            for (const key of urlKeys) {
                if (jsonContent[key] && typeof jsonContent[key] === 'string') {
                    assetsToDownload.push(jsonContent[key]);
                }
            }

            for (const asset of assetsToDownload) {
                const rel = unityAssetRelativeLocalPath(asset);
                const assetLocalPath = join(jsonLocalDir, ...rel.split('/'));
                const assetUrl = unityAssetDownloadUrl(asset, jsonDirUrl);
                let need = !existsSync(assetLocalPath);
                if (!need) {
                    try {
                        need = statSync(assetLocalPath).size === 0;
                    } catch {
                        need = true;
                    }
                }
                if (!need) continue;

                console.log(`   Downloading Unity asset: ${assetUrl.slice(0, 120)}${assetUrl.length > 120 ? '…' : ''}`);
                try {
                    mkdirSync(dirname(assetLocalPath), { recursive: true });
                    await execAsync(
                        `wget -q --tries=3 --timeout=90 --user-agent='${WGET_UA}' -O "${assetLocalPath}" "${assetUrl}"`
                    );
                } catch (e) {
                    console.error(`     ❌ Failed to download asset: ${e.message}`);
                }
            }

            let modified = false;
            for (const key of urlKeys) {
                if (jsonContent[key] && typeof jsonContent[key] === 'string' && /^https?:\/\//i.test(jsonContent[key])) {
                    jsonContent[key] = unityAssetRelativeLocalPath(jsonContent[key]);
                    modified = true;
                }
            }
            if (modified) {
                writeFileSync(jsonLocalPath, `${JSON.stringify(jsonContent, null, 2)}\n`, 'utf-8');
            }

            const badHttps = join(targetDir, 'https:');
            if (existsSync(badHttps)) {
                try {
                    rmSync(badHttps, { recursive: true, force: true });
                } catch (e) {
                    console.error(`     ⚠️ Could not remove malformed https: folder: ${e.message}`);
                }
            }
        } catch (e) {
            console.error(`   ❌ Failed to parse or process Unity JSON ${jsonPathRel}: ${e.message}`);
        }
    }
}

/** Ruffle's self-hosted `ruffle.js` references a sibling `*.wasm` (webpack); wget often omits it → WASM magic error. */
async function ensureRufflePlayerWasm(targetDir, iframeSrc) {
    const rufflePath = join(targetDir, 'ruffle.js');
    if (!existsSync(rufflePath)) return;
    let raw;
    try {
        raw = readFileSync(rufflePath, 'utf-8');
    } catch {
        return;
    }
    const wasmNames = new Set();
    const re = /["']([a-f0-9]{8,}\.wasm)["']/gi;
    let m;
    while ((m = re.exec(raw)) !== null) {
        wasmNames.add(m[1]);
    }
    if (wasmNames.size === 0) return;

    const base = iframeSrc.endsWith('/') ? iframeSrc : `${iframeSrc}/`;
    for (const name of wasmNames) {
        const dest = join(targetDir, name);
        if (existsSync(dest)) {
            try {
                if (statSync(dest).size > 32) continue;
            } catch {
                /* refetch */
            }
        }
        const url = new URL(name, base).href;
        console.log(`   📥 Ruffle companion wasm: ${name}`);
        try {
            await execAsync(
                `wget -q --tries=3 --timeout=120 --user-agent='${WGET_UA}' -O "${dest}" "${url}"`
            );
        } catch (e) {
            console.error(`     ❌ Failed to fetch ${name}: ${e.message}`);
        }
    }
}

/**
 * WebGL builds often use src="/UnityLoader.js" (site root). Under /games/id/offline/ that requests the wrong origin.
 * Rewrite to a relative path when the file exists beside index.html.
 */
function rewriteRootAbsoluteRefs(html, offlineDir) {
    return html.replace(/(\s(?:src|href))=(["'])\/([^"']+)\2/gi, (full, attr, q, path) => {
        if (!path || path.startsWith('games/') || path.startsWith('http')) return full;
        const segments = path.split('/').filter(Boolean);
        if (segments.length === 0) return full;
        const localPath = join(offlineDir, ...segments);
        try {
            if (existsSync(localPath) && statSync(localPath).size > 0) {
                return `${attr}=${q}${path}${q}`;
            }
        } catch {
            /* keep */
        }
        return full;
    });
}

async function main() {
    const argv = process.argv.slice(2);
    const KEEP_BROKEN = argv.includes('--keep-broken');
    const FORCE_REMIRROR = argv.includes('--force');
    const DEEP_ONLY = argv.includes('--deep-only');
    const USE_WGET_POKI = argv.includes('--use-wget-poki');
    const idArgs = argv.filter(
        (a) =>
            a !== '--keep-broken' &&
            a !== '--force' &&
            a !== '--deep-only' &&
            a !== '--use-wget-poki'
    );

    let games = readdirSync(GAMES_ROOT, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name)
        .filter((name) => !name.startsWith('_'))
        .filter((name) => existsSync(join(GAMES_ROOT, name, 'online', 'index.html')));

    if (idArgs.length > 0) {
        games = games.filter((g) => idArgs.includes(g));
    }

    console.log(`Found ${games.length} games to process...`);

    for (const gameId of games) {
        try {
            const indexHtmlPath = join(GAMES_ROOT, gameId, 'online', 'index.html');
            if (!existsSync(indexHtmlPath)) {
                console.log(`⚠️  Skipping ${gameId}: No index.html found`);
                continue;
            }

            const htmlContentOnline = readFileSync(indexHtmlPath, 'utf-8');
            const iframeMatch = htmlContentOnline.match(/<iframe[^>]*src=["']([^"']+)["'][^>]*>/i);

            if (!iframeMatch) {
                console.log(`⚠️  Skipping ${gameId}: No iframe src found`);
                continue;
            }

            const src = iframeMatch[1];

            // Validate URL
            if (!src.startsWith('http')) {
                console.log(`⚠️  Skipping ${gameId}: Invalid src URL: ${src}`);
                continue;
            }

            const targetDir = join(GAMES_ROOT, gameId, 'offline');

            if (DEEP_ONLY) {
                const offlineIdx = join(targetDir, 'index.html');
                if (!existsSync(offlineIdx)) {
                    console.log(`⏭️  Skipping ${gameId} (--deep-only): no offline/index.html`);
                    continue;
                }
                console.log(`🔍 Deep asset pass: ${gameId}`);
                console.log(
                    `   ⏳ Scan + fetch (can take many minutes for large mirrors — progress logs every ~75 paths)…`
                );
                await deepFetchRuntimeAssets(targetDir, src, 'mirror');
                const offHtml = readFileSync(offlineIdx, 'utf-8');
                await ensureUnityAssetsFromManifests(offHtml, targetDir, src);
                await deepFetchRuntimeAssets(targetDir, src, 'post-unity');
                await ensureRufflePlayerWasm(targetDir, src);
                let offHtmlNext = readFileSync(offlineIdx, 'utf-8');
                const offRewritten = rewriteRootAbsoluteRefs(offHtmlNext, targetDir);
                if (offRewritten !== offHtmlNext) {
                    writeFileSync(offlineIdx, offRewritten, 'utf-8');
                    console.log(`   📝 Rewrote root-absolute src/href in offline/index.html`);
                }
                await ensurePokiMasterLoaderChain(targetDir);
                await ensureStandalonePokiSdkBundle(targetDir);
                console.log(`✅ ${gameId}: deep asset pass done`);
                continue;
            }

            mkdirSync(join(GAMES_ROOT, gameId, 'shared'), { recursive: true });
            if (existsSync(targetDir)) {
                if (!FORCE_REMIRROR) {
                    console.log(`⏭️  Skipping ${gameId}: Already exists in offline folder`);
                    continue;
                }
                console.log(`🔄 --force: removing existing offline mirror for ${gameId}`);
                rmSync(targetDir, { recursive: true, force: true });
            }

            // Create target directory
            mkdirSync(targetDir, { recursive: true });

            const isPokiGamesHost = /^https?:\/\/([^/]*\.)?games\.poki\.com\//i.test(src);
            let offlineIndexHtmlPath = join(targetDir, 'index.html');
            let renamed = true;
            let wgetHadError = false;
            /** When true, Playwright already filled offline/; skip wget. */
            let pokiPlaywrightDone = false;

            if (isPokiGamesHost && !USE_WGET_POKI) {
                console.log(`🎭 Playwright capture (Poki): ${gameId} ← ${src}`);
                let cap = { ok: false, reason: 'unknown' };
                try {
                    const { capturePokiGameOffline } = await import('./lib/poki-playwright-capture.mjs');
                    cap = await capturePokiGameOffline({ gameId, iframeSrc: src, targetDir });
                } catch (e) {
                    const msg = e?.message || String(e);
                    cap = { ok: false, reason: `Playwright could not run: ${msg.slice(0, 400)}` };
                }
                if (cap.ok) {
                    pokiPlaywrightDone = true;
                    console.log(`✅ ${gameId}: Playwright capture finished (network + index.html)`);
                } else {
                    const reason = cap.reason || '';
                    if (pokiPlaywrightFailureShouldFallbackToWget(reason)) {
                        const snippet = reason.length > 120 ? `${reason.slice(0, 120)}…` : reason;
                        console.warn(`⚠️  ${gameId}: Playwright unavailable (${snippet}); falling back to wget`);
                        if (existsSync(targetDir)) {
                            rmSync(targetDir, { recursive: true, force: true });
                        }
                        mkdirSync(targetDir, { recursive: true });
                        pokiPlaywrightDone = false;
                    } else {
                        console.error(`❌ ${gameId}: ${reason || 'Playwright capture failed'}`);
                        removeBrokenOfflineMirror(gameId, reason || 'playwright capture failed', KEEP_BROKEN);
                        continue;
                    }
                }
            }

            if (!pokiPlaywrightDone) {
                console.log(`Downloading ${gameId} from ${src}...`);

                const urlObj = new URL(src);
                const pathSegments = urlObj.pathname.split('/').filter((p) => p.length > 0);
                const cutDirs = pathSegments.length;

                const wgetArgs = [
                    '-q',
                    '--show-progress',
                    '--tries=3',
                    '--timeout=90',
                    `--user-agent=${WGET_UA}`,
                    '--mirror',
                    '--convert-links',
                    '--adjust-extension',
                    '--page-requisites',
                    '--no-parent',
                    '-e',
                    'robots=off',
                    '--no-host-directories',
                    `--cut-dirs=${cutDirs}`,
                    '-P',
                    targetDir,
                    src
                ];

                const wgetExit = await runWgetInherit(wgetArgs);
                if (wgetExit !== 0) {
                    wgetHadError = true;
                    console.warn(
                        `⚠️  wget exited with code ${wgetExit} for ${gameId} (validating mirror anyway)`
                    );
                }

                if (!wgetHadError) {
                    console.log(`✅ ${gameId} downloaded successfully`);
                }

                const files = readdirSync(targetDir);
                renamed = false;

                if (!files.includes('index.html')) {
                    const htmlFiles = files.filter((f) => f.endsWith('.html'));
                    if (htmlFiles.length === 1) {
                        const oldPath = join(targetDir, htmlFiles[0]);
                        renameSync(oldPath, offlineIndexHtmlPath);
                        console.log(`   Renamed ${htmlFiles[0]} to index.html`);
                        renamed = true;
                    } else if (htmlFiles.length > 1) {
                        const match = htmlFiles.find(
                            (f) =>
                                f.includes(gameId) ||
                                f.toLowerCase().includes(gameId.replace(/-/g, ''))
                        );
                        if (match) {
                            const oldPath = join(targetDir, match);
                            renameSync(oldPath, offlineIndexHtmlPath);
                            console.log(`   Renamed ${match} to index.html`);
                            renamed = true;
                        } else {
                            console.log(
                                `   ⚠️  Multiple HTML files found, not renaming: ${htmlFiles.join(', ')}`
                            );
                        }
                    }
                } else {
                    renamed = true;
                }

                if (!renamed || !offlineMirrorLooksValid(offlineIndexHtmlPath)) {
                    const reason = wgetHadError
                        ? 'wget errors and no usable index.html after mirror'
                        : !renamed
                          ? 'mirror produced no usable index.html'
                          : 'index.html missing or too small after mirror';
                    console.error(`❌ ${gameId}: ${reason}`);
                    removeBrokenOfflineMirror(gameId, reason, KEEP_BROKEN);
                    continue;
                }

                if (wgetHadError) {
                    console.log(`✅ ${gameId}: mirror usable despite wget exit code`);
                }
            }

            if (isPokiGamesHost && !USE_WGET_POKI && pokiPlaywrightDone) {
                if (!offlineMirrorLooksValid(offlineIndexHtmlPath)) {
                    const reason = 'Playwright produced no usable offline/index.html';
                    console.error(`❌ ${gameId}: ${reason}`);
                    removeBrokenOfflineMirror(gameId, reason, KEEP_BROKEN);
                    continue;
                }
            }

            console.log(`   ⏳ Deep asset pass for ${gameId} (scan + wget missing files — can take many minutes for large mirrors)…`);
            await deepFetchRuntimeAssets(targetDir, src, 'mirror');

            if (renamed && existsSync(offlineIndexHtmlPath)) {
                let htmlContent = readFileSync(offlineIndexHtmlPath, 'utf-8');

                // 1. Remove broken external scripts (like abinbins.github.io/js/main.js which returns 404)
                // We'll trust the user that this specific one is broken, but generally for offline we might want to be careful.
                // For now, let's just comment out http/https scripts that are not from the game directory if we can't verify them,
                // or just specifically target the reported one. The user said it's 404.
                htmlContent = htmlContent.replace(/<script[^>]*src=["']https:\/\/abinbins\.github\.io\/js\/main\.js["'][^>]*>[\s\S]*?<\/script>/g, '<!-- External script removed -->');

                await ensureUnityAssetsFromManifests(htmlContent, targetDir, src);
                await deepFetchRuntimeAssets(targetDir, src, 'post-unity');
                await ensureRufflePlayerWasm(targetDir, src);

                const unityManifests = collectUnityManifestRelPaths(htmlContent);
                let unityOk = true;
                for (const rel of unityManifests) {
                    const p = join(targetDir, rel);
                    if (!existsSync(p) || statSync(p).size < 8) {
                        unityOk = false;
                        const reason = `missing or empty Unity manifest after fetch: ${rel}`;
                        console.error(`❌ ${gameId}: ${reason}`);
                        removeBrokenOfflineMirror(gameId, reason, KEEP_BROKEN);
                        break;
                    }
                }
                if (!unityOk) continue;

                htmlContent = rewriteRootAbsoluteRefs(htmlContent, targetDir);
                writeFileSync(offlineIndexHtmlPath, htmlContent);
                await ensurePokiMasterLoaderChain(targetDir);
                await ensureStandalonePokiSdkBundle(targetDir);
            }

        } catch (error) {
            const msg = error?.message || String(error);
            console.error(`❌ Error processing ${gameId}:`, msg);
            removeBrokenOfflineMirror(gameId, `unexpected error: ${msg.slice(0, 120)}`, KEEP_BROKEN);
        }
    }
}

main().catch(console.error);
