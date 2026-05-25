/**
 * abinbins "Poki template" games use master-loader.js, which loads /poki-sdk.js (site root) and
 * may default unityWebglLoaderUrl to /UnityLoader*.js — all break when hosted under /games/<id>/offline/.
 */
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, rmSync, copyFileSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const ABINBINS_SITE = 'https://abinbins.github.io';

export const WGET_UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/** Files always served from abinbins site root for classic Poki shells. */
const CORE_CHAIN = ['master-loader.js', 'poki-sdk.js'];

/**
 * Default SDK semver in minified poki-sdk (e("ab")||"v2.263.0").
 */
export function extractPokiSdkDefaultVersion(sdkJs) {
    const m = sdkJs.match(/e\("ab"\)\s*\|\|\s*"([^"]+)"/);
    return m ? m[1] : 'v2.263.0';
}

/**
 * poki-sdk.js then loads `/poki-sdk-core-<ver>.js` (site root) — same subpath bug as /poki-sdk.js.
 * Strip the leading slash so it loads beside index.html; mirror the core (and kids if present) from abinbins.
 */
export async function ensurePokiSdkDynamicCore(targetDir, options = {}) {
    const { dryRun = false, quiet = false } = options;
    const actions = [];
    const log = quiet ? () => {} : console.log;
    const sdkPath = join(targetDir, 'poki-sdk.js');
    if (!existsSync(sdkPath) || statSync(sdkPath).size < 64) {
        return { actions, changed: false };
    }
    let sdk = readFileSync(sdkPath, 'utf-8');
    const ver = extractPokiSdkDefaultVersion(sdk);
    const coreName = `poki-sdk-core-${ver}.js`;
    /** `poki-sdk-kids-*.js` is not mirrored at abinbins root; kids mode (?tag=kids) is rare for offline. */

    const needsSlashPatch = sdk.includes('"/poki-sdk-"') || sdk.includes("'/poki-sdk-'");
    if (needsSlashPatch) {
        if (!dryRun) {
            const next = sdk.replace(/"\/poki-sdk-"/g, '"poki-sdk-"').replace(/'\/poki-sdk-'/g, "'poki-sdk-'");
            if (next !== sdk) {
                writeFileSync(sdkPath, next, 'utf-8');
                sdk = next;
                actions.push('patch poki-sdk.js (dynamic core/kids path)');
                log(`   📝 Patched poki-sdk.js (load poki-sdk-core from game folder)`);
            }
        } else {
            actions.push('would patch poki-sdk.js (dynamic core)');
        }
    }

    const destCore = join(targetDir, coreName);
    const FALLBACK_CORE = 'poki-sdk-core-v2.263.0.js';

    if (!existsSync(destCore) || statSync(destCore).size < 64) {
        actions.push(`fetch ${coreName}`);
        if (!dryRun) {
            const url = `${ABINBINS_SITE}/${coreName}`;
            log(`   📥 Poki SDK dynamic: ${coreName}`);
            let ok = false;
            try {
                await execAsync(
                    `wget -q --tries=3 --timeout=120 --user-agent='${WGET_UA}' -O "${destCore}" "${url}"`
                );
                ok = existsSync(destCore) && statSync(destCore).size >= 64;
                if (!ok) {
                    try {
                        rmSync(destCore, { force: true });
                    } catch {
                        /* */
                    }
                }
            } catch (e) {
                log(`     ⚠️  ${coreName}: ${e.message}`);
            }
            if (!ok && coreName !== FALLBACK_CORE) {
                const tmp = join(targetDir, `.tmp-${FALLBACK_CORE}`);
                try {
                    await execAsync(
                        `wget -q --tries=2 --timeout=90 --user-agent='${WGET_UA}' -O "${tmp}" "${ABINBINS_SITE}/${FALLBACK_CORE}"`
                    );
                    if (existsSync(tmp) && statSync(tmp).size >= 64) {
                        copyFileSync(tmp, destCore);
                        actions.push(`fallback: ${FALLBACK_CORE} → ${coreName}`);
                        log(
                            `   ⚠️  ${coreName} not on abinbins; using ${FALLBACK_CORE} as fallback (SDK may still work)`
                        );
                    }
                } catch {
                    /* */
                } finally {
                    try {
                        rmSync(tmp, { force: true });
                    } catch {
                        /* */
                    }
                }
            }
        }
    }

    /**
     * Poki CDN uses same-origin `null.html?https://…` as a fetch/script indirection. Offline, that resolves
     * to this app’s HTML shell → JSON.parse / “expected '<'” when the SDK treats responses as JS/JSON.
     * Pointing at `https://…` directly matches production behavior without a local proxy.
     */
    if (existsSync(destCore) && statSync(destCore).size >= 64) {
        const core = readFileSync(destCore, 'utf-8');
        if (core.includes('null.html?https://')) {
            if (dryRun) {
                actions.push(`would patch ${coreName} (null.html proxy URLs)`);
            } else {
                const next = core.replace(/null\.html\?https:\/\//g, 'https://');
                if (next !== core) {
                    writeFileSync(destCore, next, 'utf-8');
                    actions.push(`patch ${coreName} (null.html proxy URLs)`);
                    log(`   📝 Patched ${coreName} (null.html?https → https for offline)`);
                }
            }
        }
    }

    return { actions, changed: actions.length > 0 };
}

/**
 * Construct / other games: `<script src="https://abinbins.github.io/poki-sdk.js">` without master-loader.
 * Pulls poki-sdk.js locally, rewrites HTML, then runs {@link ensurePokiSdkDynamicCore}.
 */
export async function ensureStandalonePokiSdkBundle(targetDir, options = {}) {
    const { dryRun = false, quiet = false } = options;
    const actions = [];
    const log = quiet ? () => {} : console.log;
    const idx = join(targetDir, 'index.html');
    if (!existsSync(idx)) {
        return { status: 'skipped', actions: ['no index.html'] };
    }
    const htmlRead = readFileSync(idx, 'utf-8');
    if (/master-loader\.js/.test(htmlRead) && htmlRead.includes('window.config')) {
        return { status: 'skipped', actions: ['master-loader shell'] };
    }

    const hasSdkScript = /<script[^>]*src=["'][^"']*poki-sdk[^"']*["']/i.test(htmlRead);
    const sdkPath = join(targetDir, 'poki-sdk.js');
    if (!hasSdkScript && !existsSync(sdkPath)) {
        return { status: 'skipped', actions: ['no poki-sdk'] };
    }

    const remoteRe = /https:\/\/abinbins\.github\.io\/poki-sdk\.js/g;
    if (remoteRe.test(htmlRead)) {
        actions.push('standalone: wget poki-sdk.js + rewrite index.html');
        if (!dryRun) {
            const dest = join(targetDir, 'poki-sdk.js');
            if (!existsSync(dest) || statSync(dest).size < 64) {
                log(`   📥 Standalone: poki-sdk.js`);
                try {
                    await execAsync(
                        `wget -q --tries=3 --timeout=120 --user-agent='${WGET_UA}' -O "${dest}" "${ABINBINS_SITE}/poki-sdk.js"`
                    );
                } catch (e) {
                    log(`     ❌ ${e.message}`);
                    return { status: 'skipped', actions: [`wget poki-sdk failed: ${e.message}`] };
                }
            }
            let html = readFileSync(idx, 'utf-8');
            html = html.replace(remoteRe, 'poki-sdk.js');
            writeFileSync(idx, html, 'utf-8');
            log(`   📝 Standalone: use local poki-sdk.js in index.html`);
        }
    }

    const coreRes = await ensurePokiSdkDynamicCore(targetDir, options);
    actions.push(...coreRes.actions);

    if (actions.length === 0) {
        return { status: 'noop', actions };
    }
    return { status: dryRun ? 'dry-run' : 'changed', actions };
}

/**
 * Infer which UnityLoader filename master-loader.js would assign when unityWebglLoaderUrl is missing
 * (matches minified switch on unityVersion year/minor).
 */
export function inferUnityWebglLoaderFilename(html) {
    const m = html.match(/unityVersion:\s*['"]([^'"]+)['"]/);
    if (!m) return 'UnityLoader.js';
    const parts = m[1].split('.');
    const year = parts[0];
    const minor = parts.length > 1 ? parseInt(parts[1], 10) : NaN;
    if (year === '2019' && !Number.isNaN(minor)) {
        return minor === 1 ? 'UnityLoader.2019.1.js' : 'UnityLoader.2019.2.js';
    }
    return 'UnityLoader.js';
}

/**
 * Which abinbins root assets to mirror beside index.html for this HTML.
 */
export function collectPokiChainFilenames(html) {
    const out = new Set(CORE_CHAIN);
    const loaderMatch = html.match(/loader:\s*['"]([^'"]+)['"]/);
    const loader = loaderMatch ? loaderMatch[1] : 'unity';

    if (loader === 'unity-2020') {
        out.add('unity-2020.js');
        out.add(inferUnityWebglLoaderFilename(html));
        return [...out];
    }
    if (loader === 'unity-beta') {
        out.add('unity.js');
        return [...out];
    }

    out.add('unity.js');
    out.add(inferUnityWebglLoaderFilename(html));
    return [...out];
}

function addPokiSdkFileCoreIssues(offlineDir, missing, issues) {
    const sdkPathScan = join(offlineDir, 'poki-sdk.js');
    if (!existsSync(sdkPathScan) || statSync(sdkPathScan).size <= 64) return;
    const sdkTxt = readFileSync(sdkPathScan, 'utf-8');
    const absCore = /"\/poki-sdk-"/.test(sdkTxt) || /'\/poki-sdk-'/.test(sdkTxt);
    issues.pokiSdkDynamicLoaderAbsolute = issues.pokiSdkDynamicLoaderAbsolute || absCore;
    const ver = extractPokiSdkDefaultVersion(sdkTxt);
    const corePath = join(offlineDir, `poki-sdk-core-${ver}.js`);
    if (!existsSync(corePath) || statSync(corePath).size < 64) {
        missing.add(`poki-sdk-core-${ver}.js`);
    }
}

/**
 * Detect problems before/without applying fixes (for reports and --dry-run).
 * Covers abinbins **master-loader** shells and **standalone** `<script src="…poki-sdk…">` / local `poki-sdk.js`.
 */
export function scanPokiOfflineIssues(offlineDir) {
    const idx = join(offlineDir, 'index.html');
    const issues = {
        hasPokiShell: false,
        hasStandalonePokiSdk: false,
        remoteMasterLoader: false,
        remotePokiSdkScript: false,
        masterLoaderUnpatched: false,
        pokiSdkDynamicLoaderAbsolute: false,
        missingOrTinyFiles: [],
        needsUnityWebglUrl: false,
        suggestedUnityLoader: null,
    };
    if (!existsSync(idx)) return issues;
    let html;
    try {
        html = readFileSync(idx, 'utf-8');
    } catch {
        return issues;
    }

    const hasMasterShell = /master-loader\.js/.test(html) && html.includes('window.config');
    const hasSdkScript = /<script[^>]*src=["'][^"']*poki-sdk[^"']*["']/i.test(html);
    const sdkPath = join(offlineDir, 'poki-sdk.js');
    const hasSdkFile = existsSync(sdkPath);

    if (!hasMasterShell && !hasSdkScript && !hasSdkFile) {
        return issues;
    }

    const missing = new Set();

    if (hasMasterShell) {
        issues.hasPokiShell = true;
        issues.remoteMasterLoader = /https:\/\/abinbins\.github\.io\/master-loader\.js/.test(html);
        issues.suggestedUnityLoader = inferUnityWebglLoaderFilename(html);
        if (
            !/unityWebglLoaderUrl/.test(html) &&
            (/loader:\s*['"]unity['"]/.test(html) || /loader:\s*['"]unity-2020['"]/.test(html))
        ) {
            issues.needsUnityWebglUrl = true;
        }

        const mlPath = join(offlineDir, 'master-loader.js');
        if (existsSync(mlPath) && statSync(mlPath).size > 64) {
            const ml = readFileSync(mlPath, 'utf-8');
            issues.masterLoaderUnpatched = /sdkScript\.src\s*=\s*["']\/poki-sdk\.js["']/.test(ml);
        }

        for (const name of collectPokiChainFilenames(html)) {
            const p = join(offlineDir, name);
            if (!existsSync(p) || statSync(p).size < 64) {
                missing.add(name);
            }
        }
        addPokiSdkFileCoreIssues(offlineDir, missing, issues);
    }

    if (!hasMasterShell && (hasSdkScript || hasSdkFile)) {
        issues.hasStandalonePokiSdk = true;
        issues.remotePokiSdkScript = /https:\/\/abinbins\.github\.io\/poki-sdk\.js/.test(html);
        if (issues.remotePokiSdkScript && (!hasSdkFile || statSync(sdkPath).size < 64)) {
            missing.add('poki-sdk.js');
        }
        addPokiSdkFileCoreIssues(offlineDir, missing, issues);
    }

    issues.missingOrTinyFiles = [...missing];
    return issues;
}

/**
 * @param {string} targetDir - static/games/<id>/offline
 * @param {{ dryRun?: boolean, quiet?: boolean }} [options]
 * @returns {Promise<{ status: 'skipped' | 'noop' | 'changed' | 'dry-run', actions: string[] }>}
 */
export async function ensurePokiMasterLoaderChain(targetDir, options = {}) {
    const { dryRun = false, quiet = false } = options;
    const actions = [];
    const log = quiet ? () => {} : console.log;

    const idx = join(targetDir, 'index.html');
    if (!existsSync(idx)) {
        return { status: 'skipped', actions: ['no index.html'] };
    }
    const originalHtml = readFileSync(idx, 'utf-8');
    let html = originalHtml;
    if (!/master-loader\.js/.test(html) || !html.includes('window.config')) {
        return { status: 'skipped', actions: ['not a Poki master-loader shell'] };
    }

    const chainFiles = collectPokiChainFilenames(html);
    const loaderMatch = html.match(/loader:\s*['"]([^'"]+)['"]/);
    const loader = loaderMatch ? loaderMatch[1] : 'unity';
    if (loader === 'unity-beta') {
        actions.push('warn: loader unity-beta — unity-beta.js not hosted at abinbins root; may still fail');
        log(`   ⚠️  unity-beta: upstream loader path may be missing; manual mirror may be needed`);
    }

    for (const name of chainFiles) {
        const dest = join(targetDir, name);
        let need = true;
        if (existsSync(dest)) {
            try {
                if (statSync(dest).size >= 64) need = false;
            } catch {
                /* refetch */
            }
        }
        if (!need) continue;
        actions.push(`fetch ${name}`);
        if (dryRun) continue;
        const url = `${ABINBINS_SITE}/${name}`;
        log(`   📥 Poki loader chain: ${name}`);
        try {
            await execAsync(
                `wget -q --tries=3 --timeout=120 --user-agent='${WGET_UA}' -O "${dest}" "${url}"`
            );
        } catch (e) {
            log(`     ❌ Failed to fetch ${name}: ${e.message}`);
        }
    }

    const coreRes = await ensurePokiSdkDynamicCore(targetDir, { dryRun, quiet });
    actions.push(...coreRes.actions);

    const mlPath = join(targetDir, 'master-loader.js');
    if (!dryRun && existsSync(mlPath) && statSync(mlPath).size > 64) {
        let ml = readFileSync(mlPath, 'utf-8');
        const next = ml.replace(
            /sdkScript\.src\s*=\s*["']\/poki-sdk\.js["']/,
            'sdkScript.src=root+"poki-sdk.js"'
        );
        if (next !== ml) {
            writeFileSync(mlPath, next, 'utf-8');
            actions.push('patch master-loader.js (poki-sdk path)');
            log(`   📝 Patched master-loader.js (poki-sdk uses script base path)`);
        }
    } else if (dryRun && existsSync(mlPath)) {
        const ml = readFileSync(mlPath, 'utf-8');
        if (/sdkScript\.src\s*=\s*["']\/poki-sdk\.js["']/.test(ml)) {
            actions.push('would patch master-loader.js');
        }
    }

    html = html.replace(/https:\/\/abinbins\.github\.io\/master-loader\.js/g, 'master-loader.js');
    if (html !== originalHtml) {
        actions.push('use local master-loader.js in index.html');
    }

    const injectLoader = inferUnityWebglLoaderFilename(html);
    if (!/unityWebglLoaderUrl/.test(html)) {
        const beforeInject = html;
        if (/loader:\s*['"]unity['"]/.test(html)) {
            html = html.replace(
                /(loader:\s*['"]unity['"],)/,
                `$1\n\t\tunityWebglLoaderUrl: '${injectLoader}',`
            );
        } else if (/loader:\s*['"]unity-2020['"]/.test(html)) {
            html = html.replace(
                /(loader:\s*['"]unity-2020['"],)/,
                `$1\n\t\tunityWebglLoaderUrl: '${injectLoader}',`
            );
        }
        if (html !== beforeInject) {
            actions.push(`inject unityWebglLoaderUrl: '${injectLoader}'`);
            log(`   📝 Injected unityWebglLoaderUrl (${injectLoader})`);
        }
    }

    if (!dryRun && html !== originalHtml) {
        writeFileSync(idx, html, 'utf-8');
    }

    if (actions.length === 0) {
        return { status: 'noop', actions };
    }
    return { status: dryRun ? 'dry-run' : 'changed', actions };
}

/**
 * All game ids under gamesRoot that have offline/index.html referencing Poki master-loader.
 */
export function listGameIdsWithPokiOfflineShell(gamesRoot) {
    return readdirSync(gamesRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
        .map((d) => d.name)
        .filter((id) => {
            const p = join(gamesRoot, id, 'offline', 'index.html');
            if (!existsSync(p)) return false;
            try {
                const html = readFileSync(p, 'utf-8');
                return /master-loader\.js/.test(html) && html.includes('window.config');
            } catch {
                return false;
            }
        });
}

/**
 * Master-loader Poki games **or** any offline bundle that references `poki-sdk` (script tag or `poki-sdk.js` on disk).
 */
export function listGameIdsWithAnyPokiSdkOfflineNeed(gamesRoot) {
    const out = new Set();
    for (const d of readdirSync(gamesRoot, { withFileTypes: true })) {
        if (!d.isDirectory() || d.name.startsWith('_')) continue;
        const id = d.name;
        const offline = join(gamesRoot, id, 'offline');
        const idx = join(offline, 'index.html');
        if (!existsSync(idx)) continue;
        let html;
        try {
            html = readFileSync(idx, 'utf-8');
        } catch {
            continue;
        }
        const hasMaster = /master-loader\.js/.test(html) && html.includes('window.config');
        const hasSdkScript = /<script[^>]*src=["'][^"']*poki-sdk[^"']*["']/i.test(html);
        const hasSdkFile = existsSync(join(offline, 'poki-sdk.js'));
        if (hasMaster || hasSdkScript || hasSdkFile) {
            out.add(id);
        }
    }
    return [...out].sort();
}
