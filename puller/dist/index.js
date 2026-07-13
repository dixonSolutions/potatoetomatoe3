var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/config.ts
var config_exports = {};
__export(config_exports, {
  CATALOG_DIR: () => CATALOG_DIR,
  CORS_ORIGIN: () => CORS_ORIGIN,
  DOWNLOAD_CONCURRENCY: () => DOWNLOAD_CONCURRENCY,
  EMBED_STRATEGY_GAME_IDS: () => EMBED_STRATEGY_GAME_IDS,
  GAMES_DATA_DIR: () => GAMES_DATA_DIR,
  MIN_OFFLINE_INDEX_BYTES: () => MIN_OFFLINE_INDEX_BYTES,
  PORT: () => PORT,
  REPO_ROOT: () => REPO_ROOT,
  WGET_INSECURE_SSL: () => WGET_INSECURE_SSL,
  WGET_USER_AGENT: () => WGET_USER_AGENT,
  wgetCommonArgs: () => wgetCommonArgs
});
import path from "node:path";
import { fileURLToPath } from "node:url";
function wgetCommonArgs() {
  const args = ["-U", WGET_USER_AGENT];
  if (WGET_INSECURE_SSL) args.push("--no-check-certificate");
  return args;
}
var __dirname, REPO_ROOT, GAMES_DATA_DIR, CATALOG_DIR, PORT, CORS_ORIGIN, MIN_OFFLINE_INDEX_BYTES, WGET_USER_AGENT, WGET_INSECURE_SSL, DOWNLOAD_CONCURRENCY, EMBED_STRATEGY_GAME_IDS;
var init_config = __esm({
  "src/config.ts"() {
    "use strict";
    __dirname = path.dirname(fileURLToPath(import.meta.url));
    REPO_ROOT = path.resolve(__dirname, "../..");
    GAMES_DATA_DIR = process.env.GAMES_DATA_DIR ?? path.join(REPO_ROOT, "static", "games");
    CATALOG_DIR = process.env.CATALOG_DIR ?? GAMES_DATA_DIR;
    PORT = Number.parseInt(process.env.PULLER_PORT ?? "18787", 10);
    CORS_ORIGIN = process.env.PULLER_CORS_ORIGIN ?? "*";
    MIN_OFFLINE_INDEX_BYTES = 64;
    WGET_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    WGET_INSECURE_SSL = process.env.PULLER_WGET_STRICT_SSL === "1" || process.env.PULLER_WGET_STRICT_SSL === "true" ? false : true;
    DOWNLOAD_CONCURRENCY = Number.parseInt(
      process.env.PULLER_DOWNLOAD_CONCURRENCY ?? "12",
      10
    );
    EMBED_STRATEGY_GAME_IDS = new Set(
      (process.env.EMBED_STRATEGY_GAMES ?? "shrek-escape").split(",").filter(Boolean)
    );
  }
});

// src/cancel-registry.ts
var cancel_registry_exports = {};
__export(cancel_registry_exports, {
  DownloadCancelledError: () => DownloadCancelledError,
  beginDownloadAbort: () => beginDownloadAbort,
  cancelDownloadAbort: () => cancelDownloadAbort,
  clearDownloadAbort: () => clearDownloadAbort,
  getDownloadAbortSignal: () => getDownloadAbortSignal,
  throwIfCancelled: () => throwIfCancelled
});
function beginDownloadAbort(gameId) {
  cancelDownloadAbort(gameId);
  const controller = new AbortController();
  controllers.set(gameId, controller);
  return controller.signal;
}
function cancelDownloadAbort(gameId) {
  controllers.get(gameId)?.abort();
}
function clearDownloadAbort(gameId) {
  controllers.delete(gameId);
}
function getDownloadAbortSignal(gameId) {
  return controllers.get(gameId)?.signal;
}
function throwIfCancelled(signal) {
  if (signal?.aborted) {
    throw new DownloadCancelledError();
  }
}
var controllers, DownloadCancelledError;
var init_cancel_registry = __esm({
  "src/cancel-registry.ts"() {
    "use strict";
    controllers = /* @__PURE__ */ new Map();
    DownloadCancelledError = class extends Error {
      constructor(message = "Download cancelled") {
        super(message);
        this.name = "DownloadCancelledError";
      }
    };
  }
});

// src/unity-embed/scan-assets.ts
import fs4 from "node:fs/promises";
import path6 from "node:path";
function scanContentForMediaUrls(content) {
  const found = /* @__PURE__ */ new Set();
  for (const part of content.split(/https?:\/\//)) {
    if (!part) continue;
    const chunk = `https://${part.slice(0, 512)}`;
    const match = chunk.match(/^https:\/\/[a-zA-Z0-9.-]+(?:\/[^\s"'\x00<>]*)?/);
    if (!match) continue;
    let url = match[0].replace(/[)\]},;]+$/, "");
    url = url.replace(
      /(\.(?:png|jpe?g|gif|webp|svg|mp3|ogg|wav|webm|bmp|ico|ttf|woff2?)(?:@2x|@3x)?).*/i,
      "$1"
    );
    if (isDownloadableMediaUrl(url)) {
      found.add(url);
    }
  }
  const regex = /https?:\/\/[^\s"'<>]+?\.(?:png|jpe?g|gif|webp|svg|mp3|ogg|wav|webm|bmp|ico|ttf|woff2?)(?:@2x|@3x)?/gi;
  for (const url of content.match(regex) ?? []) {
    if (isDownloadableMediaUrl(url)) {
      found.add(url);
    }
  }
  return [...found];
}
function isDownloadableMediaUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (BLOCKED_HOSTS.has(parsed.hostname)) return false;
    if (!MEDIA_EXT.test(parsed.pathname)) return false;
    if (parsed.hostname.includes("jsdelivr.net") && parsed.pathname.includes("777kze777/shreh")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
function externalUrlToRelativePath(url) {
  const parsed = new URL(url);
  const cleanPath = parsed.pathname.replace(/^\/+/, "");
  return path6.posix.join("assets", parsed.hostname, cleanPath);
}
async function scanGameDirectory(outDir, gameHtml) {
  const urls = new Set(scanContentForMediaUrls(gameHtml));
  const filesToScan = [
    "Build/Shrek2.framework.js",
    "Build/Shrek2.loader.js",
    "Build/Shrek2.data.br",
    "Build/Shrek2.wasm.br"
  ];
  for (const rel of filesToScan) {
    const filePath = path6.join(outDir, rel);
    try {
      const buf = await fs4.readFile(filePath);
      const text = buf.toString("latin1");
      for (const url of scanContentForMediaUrls(text)) {
        urls.add(url);
      }
    } catch {
    }
  }
  return [...urls].sort();
}
function buildAssetRouteMap(urls) {
  const map = {};
  for (const url of urls) {
    const rel = externalUrlToRelativePath(url);
    map[url] = rel.replace(/\\/g, "/");
  }
  return map;
}
var MEDIA_EXT, BLOCKED_HOSTS;
var init_scan_assets = __esm({
  "src/unity-embed/scan-assets.ts"() {
    "use strict";
    MEDIA_EXT = /\.(png|jpe?g|gif|webp|svg|mp3|ogg|wav|webm|bmp|ico|ttf|woff2?)(@2x|@3x)?$/i;
    BLOCKED_HOSTS = /* @__PURE__ */ new Set([
      "docs.unity3d.com",
      "www.notion.so",
      "ash-message-bf4.notion.site",
      "t.me",
      "localhost",
      "scripts.sil.org",
      "go.microsoft.com",
      "www.w3.org",
      "schemas.microsoft.com",
      "www.ascendercorp.com",
      "newtypography.co.uk"
    ]);
  }
});

// src/unity-embed/extract.ts
var extract_exports = {};
__export(extract_exports, {
  buildAssetUrls: () => buildAssetUrls,
  extractAssetUrls: () => extractAssetUrls,
  extractHtmlFromWrapper: () => extractHtmlFromWrapper,
  parseGameHtml: () => parseGameHtml,
  parseGameXml: () => parseGameXml,
  urlToRelativePath: () => urlToRelativePath
});
function extractHtmlFromWrapper(raw) {
  const cdataMatch = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cdataMatch) return cdataMatch[1];
  if (raw.includes("<!DOCTYPE html>") || raw.includes("<html")) return raw;
  return raw;
}
function parseGameHtml(html) {
  const content = extractHtmlFromWrapper(html);
  const cdnMatch = content.match(CDN_REGEX);
  const dataMatch = content.match(DATA_PARTS_REGEX);
  const wasmMatch = content.match(WASM_PARTS_REGEX);
  const cdnBase = cdnMatch?.[1]?.replace(/\/Build$/, "") ?? "";
  const mediaUrls = extractAssetUrls(content).filter(
    (url) => !url.endsWith("/Build") && !url.includes("/Build/")
  );
  return {
    cdnBase,
    dataParts: dataMatch ? Number.parseInt(dataMatch[1], 10) : 8,
    wasmParts: wasmMatch ? Number.parseInt(wasmMatch[1], 10) : 4,
    mediaUrls
  };
}
function extractAssetUrls(html) {
  const urls = html.match(ABSOLUTE_URL_REGEX) ?? [];
  return [...new Set(urls)].filter((url) => {
    try {
      const pathname = new URL(url).pathname;
      const filename = pathname.split("/").pop() ?? "";
      return ASSET_FILENAME.test(filename) || ASSET_FILENAME.test(pathname);
    } catch {
      return false;
    }
  });
}
function urlToRelativePath(url, cdnBase) {
  if (isDownloadableMediaUrl(url)) {
    return externalUrlToRelativePath(url);
  }
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const ghMatch = pathname.match(/\/gh\/[^/]+\/[^/]+@[^/]+\/(.+)$/);
    if (ghMatch) {
      return decodeURIComponent(ghMatch[1]);
    }
    const legacy = pathname.split("/gh/777kze777/shreh@main/")[1];
    if (legacy) {
      return decodeURIComponent(legacy);
    }
    const cdn = new URL(cdnBase);
    if (parsed.origin === cdn.origin && parsed.pathname.startsWith(cdn.pathname)) {
      const rel = parsed.pathname.slice(cdn.pathname.length).replace(/^\//, "");
      return decodeURIComponent(rel);
    }
    const filename = pathname.split("/").pop() ?? "";
    if (filename.startsWith("Shrek2.") || ["background.jpg", "logo.png", "style.css"].includes(filename)) {
      if (filename.includes(".js") || filename.includes(".br")) {
        return `Build/${filename}`;
      }
      return filename;
    }
  } catch {
    return null;
  }
  return null;
}
function buildAssetUrls(info, productName = "Shrek2") {
  const urls = /* @__PURE__ */ new Set();
  for (const url of info.networkAssetUrls) {
    if (urlToRelativePath(url, info.cdnBase)) {
      urls.add(url);
    }
  }
  for (const url of info.externalAssetUrls) {
    urls.add(url);
  }
  const buildBase = `${info.cdnBase}/Build`;
  urls.add(`${buildBase}/${productName}.framework.js`);
  urls.add(`${buildBase}/${productName}.loader.js`);
  for (let i = 0; i < info.dataParts; i++) {
    urls.add(`${buildBase}/${productName}.data.br.part${i}`);
  }
  for (let i = 0; i < info.wasmParts; i++) {
    urls.add(`${buildBase}/${productName}.wasm.br.part${i}`);
  }
  for (const media of info.mediaUrls) {
    urls.add(media);
  }
  return [...urls].filter((u) => !u.endsWith("/Build"));
}
var CDN_REGEX, DATA_PARTS_REGEX, WASM_PARTS_REGEX, ABSOLUTE_URL_REGEX, ASSET_FILENAME, parseGameXml;
var init_extract = __esm({
  "src/unity-embed/extract.ts"() {
    "use strict";
    init_scan_assets();
    CDN_REGEX = /var\s+CDN\s*=\s*["']([^"']+)["']/;
    DATA_PARTS_REGEX = /var\s+DATA_PARTS\s*=\s*(\d+)/;
    WASM_PARTS_REGEX = /var\s+WASM_PARTS\s*=\s*(\d+)/;
    ABSOLUTE_URL_REGEX = /https?:\/\/[^"'\s)]+/g;
    ASSET_FILENAME = /(?:Shrek2\.(?:data|wasm)\.br(?:\.part\d+)?|Shrek2\.(?:framework|loader)\.js|background\.jpg|logo\.png|style\.css)$/i;
    parseGameXml = parseGameHtml;
  }
});

// src/server.ts
init_config();
import http from "node:http";
import fs22 from "node:fs/promises";
import { createReadStream, existsSync as existsSync11 } from "node:fs";
import path24 from "node:path";

// src/download-manager.ts
import fs19 from "node:fs/promises";
import path21 from "node:path";

// src/catalog.ts
init_config();
import fs2 from "node:fs/promises";
import path3 from "node:path";

// src/offline-manifest.ts
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path2 from "node:path";
init_config();
var OFFLINE_MANIFEST_FILENAME = "offline-manifest.json";
function normalizeOfflineEntryRel(entry) {
  const normalized = path2.normalize(entry).replace(/^(\.\.(\/|\\|$))+/, "");
  if (normalized.includes("..") || path2.isAbsolute(normalized)) {
    throw new Error("Invalid offline entry path");
  }
  return normalized.split(path2.sep).join("/");
}
function offlineManifestPathForDir(offlineRoot) {
  return path2.join(offlineRoot, OFFLINE_MANIFEST_FILENAME);
}
async function readOfflineManifestFromDir(offlineRoot) {
  try {
    const raw = await fs.readFile(offlineManifestPathForDir(offlineRoot), "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.entry !== "string" || !parsed.entry.trim()) return null;
    return { ...parsed, entry: normalizeOfflineEntryRel(parsed.entry) };
  } catch {
    return null;
  }
}
async function writeOfflineManifest(offlineRoot, manifest) {
  const payload = {
    ...manifest,
    entry: normalizeOfflineEntryRel(manifest.entry),
    savedAt: manifest.savedAt ?? (/* @__PURE__ */ new Date()).toISOString()
  };
  await fs.writeFile(
    offlineManifestPathForDir(offlineRoot),
    `${JSON.stringify(payload, null, 2)}
`,
    "utf-8"
  );
}
async function entryFileValid(offlineRoot, entryRel) {
  try {
    const stat = await fs.stat(path2.join(offlineRoot, entryRel));
    return stat.isFile() && stat.size >= MIN_OFFLINE_INDEX_BYTES;
  } catch {
    return false;
  }
}
async function resolveOfflineEntryRelForDir(offlineRoot) {
  if (!existsSync(offlineRoot)) return null;
  const manifest = await readOfflineManifestFromDir(offlineRoot);
  if (manifest && await entryFileValid(offlineRoot, manifest.entry)) {
    return manifest.entry;
  }
  if (await entryFileValid(offlineRoot, "index.html")) {
    return "index.html";
  }
  return null;
}
async function resolveOfflineEntryRel(gameId) {
  for (const root of [offlineDir(gameId), path2.join(catalogGameRoot(gameId), "offline")]) {
    const entry = await resolveOfflineEntryRelForDir(root);
    if (entry) return entry;
  }
  return null;
}

// src/catalog.ts
var GAME_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;
var cachedGameIds = null;
var cachedListMtimeMs = null;
function isValidGameId(gameId) {
  if (!GAME_ID_PATTERN.test(gameId)) return false;
  if (gameId.startsWith("_")) return false;
  return !gameId.includes("..") && !gameId.includes("/");
}
async function gamesListMtimeMs() {
  try {
    const st = await fs2.stat(path3.join(CATALOG_DIR, "games-list.json"));
    return st.mtimeMs;
  } catch {
    return null;
  }
}
async function loadGameIds() {
  const listPath = path3.join(CATALOG_DIR, "games-list.json");
  const mtime = await gamesListMtimeMs();
  if (cachedGameIds && (mtime != null && mtime === cachedListMtimeMs || mtime == null && cachedListMtimeMs == null)) {
    return cachedGameIds;
  }
  try {
    const raw = await fs2.readFile(listPath, "utf-8");
    const parsed = JSON.parse(raw);
    cachedGameIds = Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string" && isValidGameId(id)) : [];
    cachedListMtimeMs = mtime;
  } catch {
    cachedGameIds = await listGameIdsFromDisk(CATALOG_DIR);
    cachedListMtimeMs = null;
  }
  return cachedGameIds;
}
async function isGameInCatalog(gameId) {
  const ids = await loadGameIds();
  if (ids.includes(gameId)) return true;
  invalidateCatalogCache();
  const refreshed = await loadGameIds();
  return refreshed.includes(gameId);
}
function invalidateCatalogCache() {
  cachedGameIds = null;
  cachedListMtimeMs = null;
}
async function listGameIdsFromDisk(root) {
  try {
    const entries = await fs2.readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith("_") && isValidGameId(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
}
function gameDataRoot(gameId) {
  return path3.join(GAMES_DATA_DIR, gameId);
}
function catalogGameRoot(gameId) {
  return path3.join(CATALOG_DIR, gameId);
}
function catalogOnlineDir(gameId) {
  return path3.join(catalogGameRoot(gameId), "online");
}
function offlineDir(gameId) {
  return path3.join(gameDataRoot(gameId), "offline");
}
function offlineIndexPath(gameId) {
  return path3.join(offlineDir(gameId), "index.html");
}
async function hasOnlineShell(gameId) {
  for (const indexPath of [
    path3.join(catalogOnlineDir(gameId), "index.html"),
    path3.join(gameDataRoot(gameId), "online", "index.html")
  ]) {
    try {
      const stat = await fs2.stat(indexPath);
      if (stat.size >= MIN_OFFLINE_INDEX_BYTES) return true;
    } catch {
    }
  }
  return false;
}
async function hasOfflineMirror(gameId) {
  const entryRel = await resolveOfflineEntryRel(gameId);
  if (!entryRel) return false;
  for (const root of [offlineDir(gameId), path3.join(catalogGameRoot(gameId), "offline")]) {
    try {
      const stat = await fs2.stat(path3.join(root, entryRel));
      if (stat.isFile() && stat.size >= MIN_OFFLINE_INDEX_BYTES) return true;
    } catch {
    }
  }
  return false;
}
function resolveOfflineFilePath(gameId, fileRel) {
  const normalized = path3.normalize(fileRel).replace(/^(\.\.(\/|\\|$))+/, "");
  const candidates = [
    path3.join(offlineDir(gameId), normalized),
    path3.join(catalogGameRoot(gameId), "offline", normalized)
  ];
  for (const candidate of candidates) {
    const dataRoot = path3.resolve(path3.dirname(candidate));
    const allowedRoots = [
      path3.resolve(GAMES_DATA_DIR),
      path3.resolve(CATALOG_DIR)
    ];
    const ok = allowedRoots.some(
      (root) => dataRoot.startsWith(root + path3.sep) || dataRoot === root
    );
    if (ok) return candidate;
  }
  return null;
}
async function readGameMetadata(gameId) {
  const candidates = [
    path3.join(catalogOnlineDir(gameId), "metadata.json"),
    path3.join(catalogGameRoot(gameId), "shared", "metadata.json"),
    path3.join(catalogGameRoot(gameId), "metadata.json"),
    path3.join(gameDataRoot(gameId), "online", "metadata.json")
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(await fs2.readFile(p, "utf-8"));
    } catch {
    }
  }
  return null;
}
async function getPullStrategy(gameId) {
  const { EMBED_STRATEGY_GAME_IDS: EMBED_STRATEGY_GAME_IDS2 } = await Promise.resolve().then(() => (init_config(), config_exports));
  if (EMBED_STRATEGY_GAME_IDS2.has(gameId)) return "embed";
  const meta = await readGameMetadata(gameId);
  const strategy = meta?.pullStrategy;
  if (strategy === "embed" || strategy === "generic") return strategy;
  return "generic";
}
async function seedBundledOfflineFromCatalog() {
  if (path3.resolve(CATALOG_DIR) === path3.resolve(GAMES_DATA_DIR)) return;
  const ids = await loadGameIds();
  for (const gameId of ids) {
    const catalogOffline = path3.join(catalogGameRoot(gameId), "offline");
    const entry = await resolveOfflineEntryRelForDir(catalogOffline);
    if (!entry) continue;
    try {
      await fs2.access(offlineIndexPath(gameId));
      continue;
    } catch {
      await fs2.mkdir(offlineDir(gameId), { recursive: true });
      await fs2.cp(catalogOffline, offlineDir(gameId), {
        recursive: true
      });
      console.log(`[puller] Seeded bundled offline copy: ${gameId}`);
    }
  }
}

// src/download-manager.ts
init_config();
init_cancel_registry();

// src/download-cache.ts
import fs3 from "node:fs/promises";
import { existsSync as existsSync2 } from "node:fs";
import path4 from "node:path";
var CACHE_FILENAME = ".download-cache.json";
function downloadCachePath(gameId) {
  return path4.join(offlineDir(gameId), CACHE_FILENAME);
}
async function writeDownloadCache(gameId, meta) {
  const dir = offlineDir(gameId);
  await fs3.mkdir(dir, { recursive: true });
  await fs3.writeFile(downloadCachePath(gameId), JSON.stringify(meta, null, 2), "utf-8");
}
async function readDownloadCache(gameId) {
  const p = downloadCachePath(gameId);
  if (!existsSync2(p)) return null;
  try {
    return JSON.parse(await fs3.readFile(p, "utf-8"));
  } catch {
    return null;
  }
}
async function clearDownloadCache(gameId) {
  try {
    await fs3.rm(downloadCachePath(gameId), { force: true });
  } catch {
  }
}
async function countOfflineFiles(gameId) {
  const dir = offlineDir(gameId);
  if (!existsSync2(dir)) return 0;
  let count = 0;
  async function walk(current) {
    const entries = await fs3.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path4.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.name !== CACHE_FILENAME && entry.isFile()) {
        count++;
      }
    }
  }
  try {
    await walk(dir);
  } catch {
    return 0;
  }
  return count;
}
async function hasPartialDownloadCache(gameId) {
  const cache = await readDownloadCache(gameId);
  if (cache && cache.fileCount > 0) return true;
  return await countOfflineFiles(gameId) > 0;
}

// src/jobs.ts
var jobs = /* @__PURE__ */ new Map();
var activeByGame = /* @__PURE__ */ new Map();
var lastFinishedByGame = /* @__PURE__ */ new Map();
var FINISHED_JOB_TTL_MS = 12e4;
function getActiveJobForGame(gameId) {
  const jobId = activeByGame.get(gameId);
  return jobId ? jobs.get(jobId) : void 0;
}
function getProgressJobForGame(gameId) {
  const active = getActiveJobForGame(gameId);
  if (active) return active;
  const finished = lastFinishedByGame.get(gameId);
  if (!finished) return void 0;
  const age = Date.now() - (finished.finishedAt ?? finished.startedAt);
  if (age > FINISHED_JOB_TTL_MS) {
    lastFinishedByGame.delete(gameId);
    return void 0;
  }
  return finished;
}
function createJob(gameId) {
  const existing = getActiveJobForGame(gameId);
  if (existing && (existing.state === "pending" || existing.state === "running")) {
    return existing;
  }
  const jobId = `${gameId}-${Date.now()}`;
  const job = {
    gameId,
    state: "pending",
    progress: 0,
    message: "Queued",
    startedAt: Date.now()
  };
  jobs.set(jobId, job);
  activeByGame.set(gameId, jobId);
  return job;
}
function updateJob(gameId, patch) {
  const jobId = activeByGame.get(gameId);
  if (!jobId) return;
  const job = jobs.get(jobId);
  if (!job) return;
  Object.assign(job, patch);
  if (patch.state === "done" || patch.state === "error" || patch.state === "cancelled") {
    lastFinishedByGame.set(gameId, { ...job });
    activeByGame.delete(gameId);
  }
}
function isGameDownloading(gameId) {
  const job = getActiveJobForGame(gameId);
  return job?.state === "pending" || job?.state === "running";
}
function listDownloadingGameIds() {
  const set = /* @__PURE__ */ new Set();
  for (const [gameId, jobId] of activeByGame) {
    const job = jobs.get(jobId);
    if (job && (job.state === "pending" || job.state === "running")) {
      set.add(gameId);
    }
  }
  return set;
}

// src/strategies/embed.ts
init_cancel_registry();
init_config();
import fs9 from "node:fs/promises";
import { chromium as chromium2 } from "playwright";

// src/unity-embed/config.ts
init_config();
import path5 from "node:path";
var DEFAULT_CDN_BASE = "https://cdn.jsdelivr.net/gh/777kze777/shreh@main";
var PAGE_TIMEOUT_MS = 6e4;
function outDirForGame(gamesDataDir, gameId) {
  return path5.join(gamesDataDir, gameId, "offline");
}

// src/unity-embed/discover.ts
import { chromium } from "playwright";

// src/unity-embed/embed.ts
init_scan_assets();
var FILE_URL_REGEX = /const\s+FILE_URL\s*=\s*['"]([^'"]+)['"]/;
var GAME_ASSET_PATTERN = /(?:Shrek2|background\.jpg|logo\.png|style\.css|\.data\.br|\.wasm\.br|framework\.js|loader\.js)/i;
function isGameAssetUrl(url) {
  if (url.startsWith("blob:") || url.startsWith("data:")) return false;
  if (!url.includes("777kze777/shreh") && !url.includes("Shrek2")) return false;
  return GAME_ASSET_PATTERN.test(url);
}
function parseEmbedFileUrl(html) {
  const match = html.match(FILE_URL_REGEX);
  return match?.[1] ?? null;
}
async function findEmbedFileUrl(page) {
  const candidates = [await page.content()];
  for (const frame of page.frames()) {
    try {
      candidates.push(await frame.content());
    } catch {
    }
  }
  for (const html of candidates) {
    const url = parseEmbedFileUrl(html);
    if (url) return url;
  }
  return null;
}
async function bootstrapGameLikeEmbed(page, gameHtml, networkAssetUrls) {
  page.on("response", (response) => {
    const url = response.url();
    if (isGameAssetUrl(url)) {
      networkAssetUrls.add(url);
    } else if (isDownloadableMediaUrl(url) && response.ok()) {
      networkAssetUrls.add(url);
    }
  });
  await page.goto("about:blank");
  await page.setContent(`
    <!DOCTYPE html>
    <html><head><title>Embed bootstrap</title></head>
    <body style="margin:0">
      <iframe id="fr" style="width:100vw;height:100vh;border:none"></iframe>
    </body></html>
  `);
  await page.evaluate((html) => {
    const iframe = document.getElementById("fr");
    iframe.contentDocument?.open();
    iframe.contentDocument?.write(html);
    iframe.contentDocument?.close();
  }, gameHtml);
  await page.waitForFunction(
    () => {
      const iframe = document.getElementById("fr");
      const doc = iframe?.contentDocument;
      const inner = doc?.documentElement?.innerHTML ?? "";
      return inner.includes("createUnityInstance") || inner.includes("DATA_PARTS");
    },
    { timeout: PAGE_TIMEOUT_MS }
  );
  await page.waitForTimeout(8e3);
}
async function discoverFromEmbeddedGame(browser, embedPageUrl) {
  const networkAssetUrls = /* @__PURE__ */ new Set();
  const embedContext = await browser.newContext();
  const embedPage = await embedContext.newPage();
  console.log(`[embed] Loading ${embedPageUrl}`);
  await embedPage.goto(embedPageUrl, {
    waitUntil: "domcontentloaded",
    timeout: PAGE_TIMEOUT_MS
  });
  await embedPage.waitForTimeout(3e3);
  const fileUrl = await findEmbedFileUrl(embedPage);
  await embedContext.close();
  if (!fileUrl) {
    throw new Error(
      "Could not find FILE_URL in Google Sites embed launcher. The page structure may have changed."
    );
  }
  console.log(`[embed] Found launcher FILE_URL: ${fileUrl}`);
  const fetchContext = await browser.newContext();
  const fetchPage = await fetchContext.newPage();
  const gameHtml = await fetchPage.evaluate(async (url) => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`FILE_URL fetch failed: HTTP ${response.status}`);
    }
    return response.text();
  }, fileUrl);
  await fetchContext.close();
  console.log(`[embed] Fetched game wrapper (${(gameHtml.length / 1024).toFixed(1)} KB)`);
  const { extractHtmlFromWrapper: extractHtmlFromWrapper2 } = await Promise.resolve().then(() => (init_extract(), extract_exports));
  const playableHtml = extractHtmlFromWrapper2(gameHtml);
  const bootContext = await browser.newContext();
  const bootPage = await bootContext.newPage();
  await bootstrapGameLikeEmbed(bootPage, playableHtml, networkAssetUrls);
  await bootContext.close();
  console.log(`[embed] Captured ${networkAssetUrls.size} asset URL(s) during game bootstrap`);
  return {
    embedPageUrl,
    fileUrl,
    gameHtml,
    networkAssetUrls: [...networkAssetUrls]
  };
}

// src/unity-embed/discover.ts
init_extract();
async function discoverGameInfo(gameId) {
  const meta = await readGameMetadata(gameId);
  const embedPageUrl = typeof meta?.embedPageUrl === "string" && meta.embedPageUrl.trim() || typeof meta?.embedDiscoveryUrl === "string" && meta.embedDiscoveryUrl.trim() || "";
  if (!embedPageUrl) {
    throw new Error(
      `Game "${gameId}" uses embed pull strategy but has no embedPageUrl in metadata. Add embedPageUrl to online/metadata.json or set pullStrategy to generic.`
    );
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const embed = await discoverFromEmbeddedGame(browser, embedPageUrl);
    const parsed = parseGameHtml(embed.gameHtml);
    const cdnBase = parsed.cdnBase || deriveCdnBase(embed.fileUrl);
    console.log(`[discover] Game: ${gameId}`);
    console.log(`[discover] Embed page: ${embed.embedPageUrl}`);
    console.log(`[discover] Embed FILE_URL: ${embed.fileUrl}`);
    console.log(`[discover] CDN base: ${cdnBase}`);
    console.log(`[discover] Data parts: ${parsed.dataParts}, WASM parts: ${parsed.wasmParts}`);
    console.log(`[discover] Network assets: ${embed.networkAssetUrls.length}`);
    return {
      ...parsed,
      cdnBase,
      embedPageUrl: embed.embedPageUrl,
      fileUrl: embed.fileUrl,
      networkAssetUrls: embed.networkAssetUrls,
      externalAssetUrls: [],
      gameHtml: embed.gameHtml
    };
  } finally {
    await browser.close();
  }
}
function deriveCdnBase(fileUrl) {
  try {
    return new URL(fileUrl).href.replace(/\/1\.xml$/, "");
  } catch {
    return DEFAULT_CDN_BASE;
  }
}

// src/unity-embed/download.ts
import { createHash } from "node:crypto";
import fs6 from "node:fs/promises";
import path8 from "node:path";
import { execFile as execFile2 } from "node:child_process";
import { promisify as promisify2 } from "node:util";
init_extract();
init_scan_assets();

// src/download/parallel-wget.ts
init_config();
import { existsSync as existsSync3 } from "node:fs";
import fs5 from "node:fs/promises";
import path7 from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
async function downloadOne(url, destPath) {
  if (existsSync3(destPath)) {
    try {
      const stat = await fs5.stat(destPath);
      if (stat.isFile() && stat.size > 0) {
        return { url, destPath, ok: true, skipped: true };
      }
    } catch {
    }
  }
  await fs5.mkdir(path7.dirname(destPath), { recursive: true });
  try {
    await execFileAsync("wget", [
      "-q",
      "--tries=2",
      "--timeout=90",
      ...wgetCommonArgs(),
      "-O",
      destPath,
      url
    ]);
    const stat = await fs5.stat(destPath);
    if (stat.size === 0) {
      await fs5.rm(destPath, { force: true });
      return { url, destPath, ok: false };
    }
    const head = (await fs5.readFile(destPath)).subarray(0, 32).toString("utf8");
    if (head.startsWith("<!DOCTYPE") || head.startsWith("<html")) {
      await fs5.rm(destPath, { force: true });
      return { url, destPath, ok: false };
    }
    return { url, destPath, ok: true };
  } catch {
    try {
      await fs5.rm(destPath, { force: true });
    } catch {
    }
    return { url, destPath, ok: false };
  }
}
async function downloadFilesParallel(tasks, options = {}) {
  const concurrency = Math.max(1, options.concurrency ?? DOWNLOAD_CONCURRENCY);
  const results = [];
  const queue = [...tasks];
  let done = 0;
  const total = tasks.length;
  async function worker() {
    while (queue.length > 0) {
      if (options.signal?.aborted) return;
      const task = queue.shift();
      if (!task) break;
      const result = await downloadOne(task.url, task.destPath);
      results.push(result);
      done++;
      options.onProgress?.(done, total, task);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length || 1) }, () => worker());
  await Promise.all(workers);
  if (options.signal?.aborted) {
    const { DownloadCancelledError: DownloadCancelledError2 } = await Promise.resolve().then(() => (init_cancel_registry(), cancel_registry_exports));
    throw new DownloadCancelledError2();
  }
  return results;
}
async function fetchTextForDiscovery(url) {
  try {
    const { stdout } = await execFileAsync("wget", [
      "-qO-",
      "--tries=2",
      "--timeout=45",
      ...wgetCommonArgs(),
      url
    ]);
    return stdout;
  } catch {
    return null;
  }
}
async function detectPartCountParallel(probe, baseUrl, hint, maxProbe = 32) {
  const limit = Math.max(hint + 2, maxProbe);
  const checks = Array.from({ length: limit }, (_, i) => `${baseUrl}.part${i}`);
  const results = await Promise.all(
    checks.map(async (url, i) => ({ i, ok: await probe(url) }))
  );
  let count = 0;
  for (const { i, ok } of results.sort((a, b) => a.i - b.i)) {
    if (!ok) break;
    count = i + 1;
  }
  return count || hint;
}

// src/unity-embed/download.ts
init_cancel_registry();

// src/unity/discover-assets.ts
var UNITY_ASSET_EXT = /(?:\.(?:unityweb|wasm|data|js|json|css|png|jpe?g|gif|webp|svg|ico|br|mp3|ogg|wav|woff2?|ttf|eot))(?:[?#]|$)/i;
var MANIFEST_KEYS = [
  "dataUrl",
  "wasmCodeUrl",
  "wasmFrameworkUrl",
  "codeUrl",
  "frameworkUrl",
  "symbolsUrl",
  "streamingAssetsUrl",
  "loaderUrl"
];
function collectGenericAssetRefs(text, baseUrl, queue, seen) {
  const patterns = [
    /(?:href|src)=["']([^"']+)["']/gi,
    /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi,
    /UnityLoader\.instantiate\s*\(\s*[^,]+,\s*["']([^"']+)["']/gi,
    /"(?:dataUrl|wasmCodeUrl|wasmFrameworkUrl|codeUrl|frameworkUrl|symbolsUrl|streamingAssetsUrl|loaderUrl)"\s*:\s*"([^"]+)"/gi,
    /['"]([^'"]+\.(?:unityweb|wasm|data|js|json|css|png|jpe?g|gif|webp|svg|ico|br|mp3|ogg|wav|woff2?|ttf|eot)(?:\?[^'"]*)?)['"]/gi
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      addResolvedUrl(m[1]?.trim(), baseUrl, queue, seen);
    }
  }
}
function addResolvedUrl(ref, baseUrl, queue, seen) {
  if (!ref || ref.startsWith("data:") || ref.startsWith("blob:") || ref.startsWith("#")) return;
  try {
    const abs = new URL(ref, baseUrl).href;
    if (!UNITY_ASSET_EXT.test(abs)) return;
    if (seen.has(abs)) return;
    queue.add(abs);
  } catch {
  }
}
function parseCreateUnityInstanceConfig(text) {
  const out = {};
  const blockMatch = text.match(/createUnityInstance\s*\(\s*[^,]+,\s*(\{[\s\S]*?\})\s*,/);
  if (!blockMatch?.[1]) return out;
  const block = blockMatch[1];
  for (const key of MANIFEST_KEYS) {
    const re = new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`, "i");
    const m = block.match(re);
    if (m?.[1]) out[key] = m[1];
  }
  return out;
}
function expandBuildManifest(manifest, manifestUrl) {
  const urls = [];
  for (const key of MANIFEST_KEYS) {
    const val = manifest[key];
    if (typeof val === "string" && val.trim()) {
      try {
        urls.push(new URL(val, manifestUrl).href);
      } catch {
      }
    }
  }
  return urls;
}
function findUnityLoaderBuildJson(text) {
  const match = text.match(/UnityLoader\.instantiate\s*\(\s*[^,]+,\s*["']([^"']+)["']/i);
  return match?.[1] ?? null;
}
function requiresLegacyUnityLoaderFile(text) {
  if (findUnityLoaderScriptRefs(text).length > 0) return true;
  if (/unityWebglLoaderUrl\s*[:=]\s*["'][^"']*UnityLoader[^"']*["']/i.test(text)) return true;
  const buildJson = findUnityLoaderBuildJson(text);
  return Boolean(buildJson && !buildJson.startsWith("blob:") && /\.json(?:[?#]|$)/i.test(buildJson));
}
function findUnityLoaderScriptRefs(text) {
  const refs = /* @__PURE__ */ new Set();
  const patterns = [
    /<script[^>]+src=["']([^"']*UnityLoader[^"']*\.js[^"']*)["']/gi,
    /unityWebglLoaderUrl\s*[:=]\s*["']([^"']*UnityLoader[^"']*\.js[^"']*)["']/gi,
    /["']((?:\.\/|\/)?(?:Build\/)?UnityLoader(?:\.[0-9.]+)?\.js)["']/gi
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const ref = m[1]?.trim();
      if (ref) refs.add(ref);
    }
  }
  return [...refs];
}
function unityLoaderCandidateUrls(text, baseUrl) {
  const urls = /* @__PURE__ */ new Set();
  for (const ref of findUnityLoaderScriptRefs(text)) {
    try {
      urls.add(new URL(ref, baseUrl).href);
    } catch {
    }
  }
  if (urls.size > 0) return [...urls];
  if (!requiresLegacyUnityLoaderFile(text)) return [];
  for (const rel of ["Build/UnityLoader.js", "UnityLoader.js"]) {
    try {
      urls.add(new URL(rel, baseUrl).href);
    } catch {
    }
  }
  return [...urls];
}
function scanUnityLoaderBundle(text, baseUrl) {
  const urls = /* @__PURE__ */ new Set();
  const patterns = [
    /Build\/[A-Za-z0-9_.-]+\.(?:loader|framework|data|wasm|symbols)\.(?:js|unityweb|br(?:\.part\d+)?)/gi,
    /[A-Za-z0-9_.-]+\.(?:data|wasm)\.br(?:\.part\d+)?/gi,
    /(?:dataUrl|frameworkUrl|codeUrl|loaderUrl|wasmCodeUrl|wasmFrameworkUrl)["']?\s*[:=]\s*["']([^"']+)["']/gi
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const ref = m[1] ?? m[0];
      addResolvedUrl(ref, baseUrl, urls, /* @__PURE__ */ new Set());
    }
  }
  return [...urls];
}
function discoverPokiRootAssets(text, iframeOrigin) {
  if (!/master-loader\.js|poki-sdk|unityWebglLoaderUrl/i.test(text)) {
    return [];
  }
  const root = `${iframeOrigin.replace(/\/$/, "")}/`;
  const candidates = [
    "master-loader.js",
    "poki-sdk.js",
    "unity.js",
    "unity-2020.js",
    "UnityLoader.js",
    "UnityLoader.2019.2.js",
    "UnityLoader.2020.3.js"
  ];
  return candidates.map((f) => root + f);
}
function isUnityShell(text) {
  return /UnityLoader|createUnityInstance|master-loader\.js|unityWebglLoaderUrl|Build\/.*\.json/i.test(
    text
  );
}
function buildSplitPartUrls(basePartUrl, partCount) {
  const urls = [];
  for (let i = 0; i < partCount; i++) {
    urls.push(`${basePartUrl}.part${i}`);
  }
  return urls;
}
function parseSplitPartCounts(text) {
  const dataMatch = text.match(/var\s+DATA_PARTS\s*=\s*(\d+)/);
  const wasmMatch = text.match(/var\s+WASM_PARTS\s*=\s*(\d+)/);
  return {
    dataParts: dataMatch ? Number.parseInt(dataMatch[1], 10) : 0,
    wasmParts: wasmMatch ? Number.parseInt(wasmMatch[1], 10) : 0
  };
}
function inferBuildProductName(text) {
  const m = text.match(/Build\/([A-Za-z0-9_.-]+)\.(?:loader|framework|data|wasm)/i);
  return m?.[1] ?? null;
}
function discoverUnityAssetRefs(text, baseUrl, queue, seen) {
  collectGenericAssetRefs(text, baseUrl, queue, seen);
  const inlineConfig = parseCreateUnityInstanceConfig(text);
  for (const val of Object.values(inlineConfig)) {
    addResolvedUrl(val, baseUrl, queue, seen);
  }
  for (const url of scanUnityLoaderBundle(text, baseUrl)) {
    addResolvedUrl(url, baseUrl, queue, seen);
  }
  const buildJson = findUnityLoaderBuildJson(text);
  if (buildJson) {
    addResolvedUrl(buildJson, baseUrl, queue, seen);
  }
  for (const url of unityLoaderCandidateUrls(text, baseUrl)) {
    addResolvedUrl(url, baseUrl, queue, seen);
  }
  try {
    const origin = new URL(baseUrl).origin;
    for (const url of discoverPokiRootAssets(text, origin)) {
      addResolvedUrl(url, baseUrl, queue, seen);
    }
  } catch {
  }
  const { dataParts, wasmParts } = parseSplitPartCounts(text);
  const product = inferBuildProductName(text);
  if (product && dataParts > 0) {
    const dataBase = new URL(`Build/${product}.data.br`, baseUrl).href;
    for (const u of buildSplitPartUrls(dataBase, dataParts)) {
      addResolvedUrl(u, baseUrl, queue, seen);
    }
  }
  if (product && wasmParts > 0) {
    const wasmBase = new URL(`Build/${product}.wasm.br`, baseUrl).href;
    for (const u of buildSplitPartUrls(wasmBase, wasmParts)) {
      addResolvedUrl(u, baseUrl, queue, seen);
    }
  }
}

// src/unity-embed/download.ts
var execFileAsync2 = promisify2(execFile2);
var PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
async function detectPartCount(request, baseUrl, hint) {
  return detectPartCountParallel(
    async (url) => {
      const response = await request.head(url);
      return response.ok();
    },
    baseUrl,
    hint
  );
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function isLikelyBinaryMedia(buffer, url) {
  if (buffer.length === 0) return false;
  const head = buffer.subarray(0, 16).toString("utf8");
  if (head.startsWith("<!DOCTYPE") || head.startsWith("<html") || head.startsWith("<HTML")) {
    return false;
  }
  if (/\.png/i.test(url)) return buffer[0] === 137 && buffer[1] === 80;
  if (/\.jpe?g/i.test(url)) return buffer[0] === 255 && buffer[1] === 216;
  if (/\.gif/i.test(url)) return buffer.subarray(0, 3).toString("ascii") === "GIF";
  if (/\.webp/i.test(url)) return buffer.subarray(0, 4).toString("ascii") === "RIFF";
  return buffer.length > 32;
}
async function downloadViaCurl(url, destPath) {
  await execFileAsync2("curl", [
    "-fsSLk",
    "--retry",
    "3",
    "-A",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "-o",
    destPath,
    url
  ]);
  return fs6.readFile(destPath);
}
async function downloadViaBrowser(page, url) {
  try {
    const response = await page.goto(url, { waitUntil: "commit", timeout: 2e4 });
    if (!response?.ok()) return null;
    const buffer = await response.body();
    return isLikelyBinaryMedia(buffer, url) ? buffer : null;
  } catch {
    return null;
  }
}
async function writePlaceholder(relativePath, destPath) {
  const ext = path8.extname(relativePath).toLowerCase();
  const buffer = ext === ".png" ? PLACEHOLDER_PNG : PLACEHOLDER_PNG;
  await fs6.mkdir(path8.dirname(destPath), { recursive: true });
  await fs6.writeFile(destPath, buffer);
  return buffer;
}
async function downloadFile(request, url, outDir, cdnBase, browserPage, allowPlaceholder = false) {
  const relativePath = urlToRelativePath(url, cdnBase);
  if (!relativePath) {
    throw new Error(`Could not resolve relative path for: ${url}`);
  }
  const destPath = path8.join(outDir, relativePath);
  await fs6.mkdir(path8.dirname(destPath), { recursive: true });
  let buffer = null;
  let placeholder = false;
  try {
    const response = await request.get(url);
    if (response.ok()) {
      buffer = Buffer.from(await response.body());
      if (!isLikelyBinaryMedia(buffer, url)) buffer = null;
    }
  } catch {
  }
  if (!buffer && isDownloadableMediaUrl(url)) {
    try {
      console.log(`  \u21BB curl fallback for ${relativePath}`);
      buffer = await downloadViaCurl(url, destPath);
      if (!isLikelyBinaryMedia(buffer, url)) buffer = null;
    } catch {
      buffer = null;
    }
  }
  if (!buffer && browserPage && isDownloadableMediaUrl(url)) {
    console.log(`  \u21BB browser fallback for ${relativePath}`);
    buffer = await downloadViaBrowser(browserPage, url);
  }
  if (!buffer && allowPlaceholder && isDownloadableMediaUrl(url)) {
    console.warn(`  \u26A0 placeholder for ${relativePath} (${url} blocked or unavailable)`);
    buffer = await writePlaceholder(relativePath, destPath);
    placeholder = true;
  }
  if (!buffer) {
    throw new Error(`Download failed ${url}: all methods exhausted`);
  }
  if (!placeholder) {
    await fs6.writeFile(destPath, buffer);
  }
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const tag = placeholder ? " (placeholder)" : "";
  console.log(`  \u2713 ${relativePath} (${formatBytes(buffer.length)})${tag}`);
  return { url, relativePath, size: buffer.length, sha256, placeholder: placeholder || void 0 };
}
async function downloadUrlList(request, urls, outDir, cdnBase, browserPage, signal) {
  console.log(`[download] Fetching ${urls.length} external file(s) in parallel\u2026`);
  const results = [];
  const queue = [...urls];
  async function worker() {
    while (queue.length > 0) {
      throwIfCancelled(signal);
      const url = queue.shift();
      if (!url) break;
      results.push(await downloadFile(request, url, outDir, cdnBase, browserPage, true));
    }
  }
  const workers = Array.from(
    { length: Math.min(DOWNLOAD_CONCURRENCY, urls.length || 1) },
    () => worker()
  );
  await Promise.all(workers);
  throwIfCancelled(signal);
  return results;
}
async function downloadAssets(request, info, outDir, signal) {
  const buildBase = `${info.cdnBase}/Build`;
  const product = inferBuildProductName(info.gameHtml) ?? inferBuildProductName(info.networkAssetUrls.join("\n")) ?? "Shrek2";
  throwIfCancelled(signal);
  info.dataParts = await detectPartCount(request, `${buildBase}/${product}.data.br`, info.dataParts);
  info.wasmParts = await detectPartCount(request, `${buildBase}/${product}.wasm.br`, info.wasmParts);
  const urls = buildAssetUrls(info, product);
  console.log(`[download] Fetching ${urls.length} files from embedded game source \u2026`);
  const results = [];
  const queue = [...urls];
  async function worker() {
    while (queue.length > 0) {
      throwIfCancelled(signal);
      const url = queue.shift();
      if (!url) break;
      results.push(await downloadFile(request, url, outDir, info.cdnBase));
    }
  }
  const workers = Array.from(
    { length: Math.min(DOWNLOAD_CONCURRENCY, urls.length) },
    () => worker()
  );
  await Promise.all(workers);
  if (signal?.aborted) throw new DownloadCancelledError();
  return results;
}

// src/unity-embed/host.ts
import { createHash as createHash2 } from "node:crypto";
import fs7 from "node:fs/promises";
import path9 from "node:path";

// src/unity-embed/adfree-host.ts
function buildAdFreeHostHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no"/>
  <title>Shrek Swamp Escape 2</title>
  <link rel="stylesheet" href="style.css"/>
  <style>
    canvas:focus { outline: none; }
    html, body {
      padding: 0; margin: 0; overflow: hidden; height: 100%;
      -webkit-touch-callout: none; user-select: none;
    }
    #play-cover {
      position: fixed;
      inset: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: center;
      background: url('background.jpg') center / cover no-repeat;
    }
    #play-cover::before {
      content: '';
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.35);
    }
    #play-button {
      position: relative;
      z-index: 1;
      font: 700 1.375rem/1 system-ui, -apple-system, 'Segoe UI', sans-serif;
      letter-spacing: 0.04em;
      padding: 1rem 3.5rem;
      border: 2px solid rgba(255, 255, 255, 0.85);
      border-radius: 999px;
      background: linear-gradient(180deg, #7ecf5a 0%, #4a9e32 100%);
      color: #fff;
      cursor: pointer;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
      transition: transform 0.15s ease, filter 0.15s ease;
    }
    #play-button:hover { filter: brightness(1.08); transform: scale(1.03); }
    #play-button:active { transform: scale(0.98); }
    #play-button:disabled { opacity: 0.65; cursor: wait; transform: none; }
  </style>
</head>
<body class="dark">
<div id="unity-container" class="unity-desktop">
  <canvas id="unity-canvas" tabindex="-1"></canvas>
</div>
<div id="play-cover">
  <button id="play-button" type="button">Play</button>
</div>
<script>
/* Globals + bridge functions Unity jslib calls (must be on window, not inside an IIFE) */
var cloudSaves = 'noData';
var paymentsData = 'none';
var environmentData = 'null';
var playerData = 'noData';
var leaderboard = null;
var ysdk = null;
var myGameInstance = null;
var initGame = false;
var pendingAdClose = false;
var launchStarted = false;
var player = null;

var SAVE_STORAGE_KEY = 'shrek_escape_cloud_saves';

function readSaveBlob(){
  try { return localStorage.getItem(SAVE_STORAGE_KEY); }
  catch (e) { return null; }
}

function writeSaveBlob(jsonData){
  try { localStorage.setItem(SAVE_STORAGE_KEY, jsonData); }
  catch (e) { console.error('Failed to persist save:', e); }
}

(function hydrateCloudSavesFromDisk(){
  var stored = readSaveBlob();
  if (stored) cloudSaves = JSON.stringify([stored]);
})();

function NotAuthorized(){
  return JSON.stringify({playerAuth:'rejected',playerName:'unauthorized',
    playerId:'unauthorized',playerPhoto:'unknown',payingStatus:'unknown'});
}

function InitGame(){
  initGame = true;
  if (pendingAdClose && myGameInstance) {
    myGameInstance.SendMessage('YandexGame', 'CloseFullAd', 'false');
    pendingAdClose = false;
  }
}

/** Instantly dismiss interstitial \u2014 never call OpenFullAd (avoids TimerBeforeAdsYG pause overlay). */
function FullAdShow(){
  if (initGame && myGameInstance) {
    myGameInstance.SendMessage('YandexGame', 'CloseFullAd', 'false');
  } else {
    pendingAdClose = true;
  }
  FocusGame();
}

/** Instantly grant reward \u2014 no video ad. */
function RewardedShow(id){
  if (myGameInstance) {
    myGameInstance.SendMessage('YandexGame', 'RewardVideo', id || '0');
    myGameInstance.SendMessage('YandexGame', 'CloseVideo');
    FocusGame();
  }
}

function StickyAdActivity(show){}
function StickyAdActivityInternal(show){}
function BuyPayments(id){}
function ConsumePurchases(id){}

function GetPayments(sendback){
  return Promise.resolve('none');
}

function LoadCloud(sendback){
  return new Promise(function(resolve){
    var stored = readSaveBlob();
    var r = stored ? JSON.stringify([stored]) : 'noData';
    cloudSaves = r;
    if (sendback && myGameInstance) {
      myGameInstance.SendMessage('YandexGame', 'SetLoadSaves', r);
    }
    resolve(r);
  });
}

function SaveCloud(jsonData, flush){
  writeSaveBlob(jsonData);
  if (player) {
    try { player.setData({ saves: [jsonData] }, flush); }
    catch (e) { console.error('SaveCloud error:', e); }
  }
}

function RequestingEnvironmentData(sendback){
  return Promise.resolve('null');
}

function InitPlayer(sendback){
  var r = NotAuthorized();
  if (sendback && myGameInstance) myGameInstance.SendMessage('YandexGame', 'SetInitializationSDK', r);
  return Promise.resolve(r);
}
</script>
<script>
/* Minimal offline SDK \u2014 no ads; player data persisted in localStorage */
function createOfflinePlayer(){
  return {
    isAuthorized: function(){ return false; },
    getMode: function(){ return 'lite'; },
    getName: function(){ return ''; },
    getUniqueID: function(){ return 'offline-local'; },
    getPhoto: function(){ return ''; },
    getPayingStatus: function(){ return 'unknown'; },
    setData: function(data, flush){
      if (data && data.saves && data.saves[0] !== undefined) {
        writeSaveBlob(data.saves[0]);
      }
      return Promise.resolve();
    },
    getData: function(keys){
      var result = {};
      if (!keys || keys.indexOf('saves') >= 0) {
        var stored = readSaveBlob();
        if (stored) result.saves = [stored];
      }
      return Promise.resolve(result);
    }
  };
}

window.YaGames = { init: function() {
  return Promise.resolve({
    environment: { app:{id:'0'}, i18n:{lang:'en',tld:'com'}, browser:{lang:'en'}, payload:null },
    deviceInfo: {
      type:'desktop',
      isMobile:  function(){ return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent); },
      isDesktop: function(){ return !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent); },
      isTablet:  function(){ return false; },
      isTV:      function(){ return false; }
    },
    screen: { fullscreen:{ status:'off', request:function(){ return Promise.resolve(); }, exit:function(){ return Promise.resolve(); } }},
    adv: {
      showFullscreenAdv: function(o){
        if (o && o.callbacks && o.callbacks.onClose) o.callbacks.onClose(false);
      },
      showRewardedVideo: function(o){
        if (o && o.callbacks) {
          o.callbacks.onRewarded && o.callbacks.onRewarded();
          o.callbacks.onClose && o.callbacks.onClose();
        }
      },
      showBannerAdv:function(){}, hideBannerAdv:function(){},
      getBannerAdvStatus:function(){ return Promise.resolve({stickyAdvIsShowing:false}); }
    },
    auth:{ openAuthDialog:function(){ return Promise.resolve(); } },
    feedback:{ canReview:function(){ return Promise.resolve({value:false,reason:''}); }, requestReview:function(){ return Promise.resolve({feedbackSent:false}); } },
    shortcut:{ canShowPrompt:function(){ return Promise.resolve({canShow:false}); }, showPrompt:function(){ return Promise.resolve({outcome:'rejected'}); } },
    getLeaderboards:function(){ return Promise.resolve({ setLeaderboardScore:function(){ return Promise.resolve(); }, getLeaderboardDescription:function(){ return Promise.reject('no lb'); }, getLeaderboardEntries:function(){ return Promise.reject('no lb'); } }); },
    getPayments:function(){ return Promise.resolve({ getCatalog:function(){ return Promise.resolve([]); }, getPurchases:function(){ return Promise.resolve([]); }, purchase:function(){ return Promise.reject('unavailable'); }, consumePurchase:function(){ return Promise.resolve(); } }); },
    getPlayer: function(){ return Promise.resolve(createOfflinePlayer()); },
    serverTime:function(){ return Date.now(); },
    on:function(){},
    features:{ LoadingAPI:{ready:function(){}}, GameplayAPI:{start:function(){},stop:function(){}} }
  });
}};
</script>
<script>
  var buildUrl = "Build";
  var config = {
    dataUrl:            buildUrl + "/Shrek2.data",
    frameworkUrl:       buildUrl + "/Shrek2.framework.js",
    codeUrl:            buildUrl + "/Shrek2.wasm",
    streamingAssetsUrl: "StreamingAssets",
    companyName:        "DefaultCompany",
    productName:        "DeliviryYandex",
    productVersion:     "0.1.0"
  };

  var canvas = document.querySelector("#unity-canvas");
  var playCover = document.querySelector("#play-cover");
  var playButton = document.querySelector("#play-button");

  function FocusGame(){ window.focus(); canvas.focus(); }
  window.addEventListener('pointerdown', FocusGame);
  window.addEventListener('touchstart', FocusGame);

  async function InitYSDK(){
    try {
      ysdk = await YaGames.init();
      player = await ysdk.getPlayer();
      cloudSaves = await LoadCloud();
      paymentsData = await GetPayments();
      environmentData = await RequestingEnvironmentData();
      playerData = await InitPlayer();
    } catch(e) {
      console.warn('SDK init skipped:', e);
      pendingAdClose = true;
    }
  }

  function signalReadyToUnity(){
    if (!myGameInstance) return;
    myGameInstance.SendMessage('YandexGame', 'SetInitializationSDK', NotAuthorized());
    if (ysdk && ysdk.features && ysdk.features.LoadingAPI) {
      ysdk.features.LoadingAPI.ready();
    }
  }

  async function detectPartCount(baseUrl){
    for (var i = 0; i < 32; i++) {
      var response = await fetch(baseUrl + '.part' + i, { method: 'HEAD' });
      if (!response.ok) return i;
    }
    return 32;
  }

  async function fetchParts(baseUrl, partCount){
    var parts = [];
    for (var i = 0; i < partCount; i++) {
      var response = await fetch(baseUrl + '.part' + i);
      if (!response.ok) throw new Error('part' + i + ': HTTP ' + response.status);
      parts.push(new Uint8Array(await response.arrayBuffer()));
    }
    var total = parts.reduce(function(sum, part){ return sum + part.length; }, 0);
    var merged = new Uint8Array(total);
    var offset = 0;
    for (var j = 0; j < parts.length; j++) {
      merged.set(parts[j], offset);
      offset += parts[j].length;
    }
    return merged;
  }

  function brotliBlobUrl(uint8, filename){
    var blob = new Blob([uint8], { type: 'application/octet-stream' });
    return URL.createObjectURL(blob) + '#' + encodeURIComponent(filename);
  }

  async function resolveUnityConfig(){
    var unityConfig = Object.assign({}, config);
    try {
      var dataPartCount = await detectPartCount(buildUrl + '/Shrek2.data.br');
      if (dataPartCount > 0) {
        var dataBytes = await fetchParts(buildUrl + '/Shrek2.data.br', dataPartCount);
        unityConfig.dataUrl = brotliBlobUrl(dataBytes, 'Shrek2.data.br');
      }
      var wasmPartCount = await detectPartCount(buildUrl + '/Shrek2.wasm.br');
      if (wasmPartCount > 0) {
        var wasmBytes = await fetchParts(buildUrl + '/Shrek2.wasm.br', wasmPartCount);
        unityConfig.codeUrl = brotliBlobUrl(wasmBytes, 'Shrek2.wasm.br');
      }
    } catch (error) {
      console.warn('Chunked asset load failed, using direct URLs:', error);
    }
    return unityConfig;
  }

  async function launchUnity(){
    if (!window.createUnityInstance) {
      console.error('Unity loader missing');
      playButton.disabled = false;
      playButton.textContent = 'Play';
      return;
    }

    var unityConfig = await resolveUnityConfig();
    createUnityInstance(canvas, unityConfig, function(){}).then(function(inst){
      myGameInstance = inst;
      playCover.style.display = 'none';
      InitGame();
      signalReadyToUnity();
      FocusGame();
    }).catch(function(msg){
      console.error(msg);
      launchStarted = false;
      playButton.disabled = false;
      playButton.textContent = 'Play';
      alert('Failed to start game: ' + msg);
    });
  }

  function loadUnityLoader(){
    return new Promise(function(resolve, reject){
      if (window.createUnityInstance) { resolve(); return; }
      var script = document.createElement('script');
      script.src = buildUrl + '/Shrek2.loader.js';
      script.onload = function(){ resolve(); };
      script.onerror = function(){ reject(new Error('Failed to load Unity loader')); };
      document.body.appendChild(script);
    });
  }

  async function onPlayClick(){
    if (launchStarted) return;
    launchStarted = true;
    playButton.disabled = true;
    playButton.textContent = 'Loading\u2026';

    try {
      await InitYSDK();
      await loadUnityLoader();
      await launchUnity();
    } catch (error) {
      console.error(error);
      launchStarted = false;
      playButton.disabled = false;
      playButton.textContent = 'Play';
      alert('Failed to load game assets.');
    }
  }

  playButton.addEventListener('click', onPlayClick);
</script>
</body>
</html>`;
}

// src/unity-embed/asset-redirect.ts
function buildAssetRedirectScript(routeMap) {
  const mapJson = JSON.stringify(routeMap);
  return `<script>
(function(){
  var ROUTE_MAP = ${mapJson};
  function route(url){
    if (!url || typeof url !== 'string') return url;
    return ROUTE_MAP[url] || url;
  }
  var origFetch = window.fetch;
  window.fetch = function(input, init){
    if (typeof input === 'string') return origFetch(route(input), init);
    if (input instanceof Request) {
      var mapped = route(input.url);
      if (mapped !== input.url) return origFetch(mapped, init);
    }
    return origFetch(input, init);
  };
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url){
    return origOpen.apply(this, [method, route(url), ...Array.prototype.slice.call(arguments, 2)]);
  };
})();
</script>`;
}

// src/embedded/assets.generated.ts
var UNITY_INJECT_SOURCE = `/**
 * Injected into Unity WebGL shells BEFORE the loader runs.
 * Removes splash banners, stubs Emscripten stdin, spoofs focus-loss,
 * and reduces ad SDK / portal noise.
 */
(function () {
	if (window.__ptUnityInjectInstalled) return;
	window.__ptUnityInjectInstalled = true;

	/* \u2014\u2014\u2014 Emscripten / Unity FS: avoid "invalid handle for stdin" aborts \u2014\u2014\u2014 */
	function ptNullStdin() {
		return null;
	}
	function ptNoopOut() {}

	function ensureUnityModuleHooks(mod) {
		mod = mod || {};
		if (typeof mod.stdin !== 'function') mod.stdin = ptNullStdin;
		if (typeof mod.stdout !== 'function') mod.stdout = ptNoopOut;
		if (typeof mod.stderr !== 'function') mod.stderr = ptNoopOut;
		if (!mod.ENVIRONMENT) mod.ENVIRONMENT = 'WEB';
		return mod;
	}

	try {
		window.Module = ensureUnityModuleHooks(window.Module || {});
	} catch (e) {
		/* ignore */
	}

	/* \u2014\u2014\u2014 Focus spoof: games stay "focused"; app pause still uses postMessage \u2014\u2014\u2014 */
	(function patchFocusSpoof() {
		if (window.__ptFocusSpoofInstalled) return;
		window.__ptFocusSpoofInstalled = true;

		/* Do NOT override Document.prototype.hasFocus \u2014 parent mute-on-focus uses it. */
		try {
			Object.defineProperty(Document.prototype, 'hidden', {
				configurable: true,
				get: function () {
					return false;
				}
			});
			Object.defineProperty(Document.prototype, 'visibilityState', {
				configurable: true,
				get: function () {
					return 'visible';
				}
			});
		} catch (e) {
			/* ignore */
		}

		function swallow(ev) {
			try {
				ev.stopImmediatePropagation();
				ev.stopPropagation();
				ev.preventDefault();
			} catch (e2) {
				/* ignore */
			}
		}

		/* Capture-phase: Unity never sees blur / visibilitychange (keeps in-game pause menus off). */
		['blur', 'focusout', 'visibilitychange'].forEach(function (type) {
			window.addEventListener(type, swallow, true);
			document.addEventListener(type, swallow, true);
		});
	})();

	/* \u2014\u2014\u2014 Reject HTML mistaken for JS/wasm (SPA fallback / missing Build files) \u2014\u2014\u2014 */
	(function patchAssetFetch() {
		if (window.__ptUnityFetchPatched || typeof window.fetch !== 'function') return;
		window.__ptUnityFetchPatched = true;
		var origFetch = window.fetch.bind(window);
		var assetRe = /\\.(js|mjs|wasm|unityweb|data|json)(\\?|#|$)/i;

		function looksLikeHtml(text) {
			var t = String(text || '')
				.trim()
				.slice(0, 64)
				.toLowerCase();
			return t.charAt(0) === '<' || t.indexOf('<!doctype') === 0 || t.indexOf('<html') === 0;
		}

		window.fetch = function (input, init) {
			var url = typeof input === 'string' ? input : input && input.url;
			var p = origFetch(input, init);
			if (!url || !assetRe.test(url)) return p;
			return p.then(function (res) {
				var ct = (res.headers && res.headers.get('content-type')) || '';
				if (/text\\/html/i.test(ct)) {
					return res.text().then(function () {
						throw new Error(
							'Unity asset returned HTML instead of binary/JS (missing file or SPA fallback): ' +
								url
						);
					});
				}
				/* Opaque / no content-type: sniff a clone for script-like URLs */
				if (!ct && /\\.js(\\?|#|$)/i.test(url)) {
					return res
						.clone()
						.text()
						.then(function (body) {
							if (looksLikeHtml(body)) {
								throw new Error(
									'Unity script URL returned HTML (missing Build asset?): ' + url
								);
							}
							return res;
						});
				}
				return res;
			});
		};
	})();

	/* Unity "Made with Unity" banner \u2014 no-op */
	window.unityShowBanner = function () {};

	/* Hide splash, progress bars, portal play gates, ad containers */
	var hideCss =
		'#unity-logo,#unity-footer,#unity-loading-bar,#unity-progress-bar-empty,#unity-progress-bar-full,' +
		'.webgl-content .logo,.webgl-content .progress,#splash,#splash-screen,#loading-cover,#play-cover,' +
		'.loading-cover,.poki-sdk-container,.y8-lifecycle-ad,.y8-preloader,.idnet-preloader,' +
		'[class*="splash"],[id*="splash"],[class*="loading-screen"],[id*="loading-screen"]' +
		'{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}';
	var style = document.createElement('style');
	style.id = 'pt-unity-inject-style';
	style.textContent = hideCss;
	(document.head || document.documentElement).appendChild(style);

	function hideLoadingDom() {
		var selectors = [
			'#unity-loading-bar',
			'#unity-logo',
			'#unity-footer',
			'#play-cover',
			'#loading-cover',
			'.loading-cover',
			'.poki-sdk-container'
		];
		for (var i = 0; i < selectors.length; i++) {
			var nodes = document.querySelectorAll(selectors[i]);
			for (var j = 0; j < nodes.length; j++) {
				nodes[j].style.display = 'none';
			}
		}
	}

	/* Wrap createUnityInstance once the loader defines it */
	var _cui = window.createUnityInstance;
	Object.defineProperty(window, 'createUnityInstance', {
		configurable: true,
		enumerable: true,
		get: function () {
			return _cui;
		},
		set: function (fn) {
			if (typeof fn !== 'function') {
				_cui = fn;
				return;
			}
			_cui = function (canvas, config, onProgress) {
				config = ensureUnityModuleHooks(config || {});
				if ('showBanner' in config) config.showBanner = false;
				hideLoadingDom();
				return fn(canvas, config, function (progress) {
					hideLoadingDom();
					if (typeof onProgress === 'function') onProgress(progress);
				}).then(function (instance) {
					hideLoadingDom();
					return instance;
				});
			};
		}
	});

	/* Legacy UnityLoader.instantiate \u2014 trap assignment so we wrap even if inject runs first */
	var _ul = window.UnityLoader;
	function patchUnityLoader(UL) {
		if (!UL || UL.__ptPatched) return UL;
		UL.__ptPatched = true;
		/* Skip mobile / browser warning popups (alert with "Press OK if you wish to continue"). */
		if (typeof UL.compatibilityCheck === 'function') {
			UL.compatibilityCheck = function (_gameInstance, onsuccess) {
				if (typeof onsuccess === 'function') onsuccess();
			};
		}
		if (typeof UL.instantiate === 'function') {
			var origInstantiate = UL.instantiate.bind(UL);
			UL.instantiate = function (container, url, opts) {
				hideLoadingDom();
				opts = opts || {};
				opts.Module = ensureUnityModuleHooks(opts.Module || {});
				if (opts.onProgress) {
					var origProgress = opts.onProgress;
					opts.onProgress = function (gameInstance, progress) {
						hideLoadingDom();
						return origProgress(gameInstance, progress);
					};
				}
				return origInstantiate(container, url, opts);
			};
		}
		return UL;
	}
	Object.defineProperty(window, 'UnityLoader', {
		configurable: true,
		enumerable: true,
		get: function () {
			return _ul;
		},
		set: function (UL) {
			_ul = patchUnityLoader(UL);
		}
	});
	if (_ul) _ul = patchUnityLoader(_ul);

	/* Track every AudioContext so focus-loss mute can suspend Unity Web Audio too. */
	var audioContexts = [];
	(function patchAudioContext() {
		if (window.__ptAudioContextPatched) return;
		var OrigAC = window.AudioContext || window.webkitAudioContext;
		if (!OrigAC) return;
		window.__ptAudioContextPatched = true;
		function PatchedAudioContext() {
			var args = arguments;
			var ctx;
			try {
				if (typeof Reflect !== 'undefined' && Reflect.construct) {
					ctx = Reflect.construct(OrigAC, args);
				} else {
					ctx = new OrigAC();
				}
			} catch (e) {
				ctx = new OrigAC();
			}
			audioContexts.push(ctx);
			window.__ptSharedAudioCtx = ctx;
			if (window.__ptAudioOutputMuted || window.__ptGamePaused) {
				try {
					ctx.suspend();
				} catch (e2) {}
			}
			return ctx;
		}
		PatchedAudioContext.prototype = OrigAC.prototype;
		try {
			Object.setPrototypeOf(PatchedAudioContext, OrigAC);
		} catch (e) {}
		window.AudioContext = PatchedAudioContext;
		if ('webkitAudioContext' in window) window.webkitAudioContext = PatchedAudioContext;
	})();

	function unlockAudio() {
		if (window.__ptAudioOutputMuted || window.__ptGamePaused) return;
		for (var i = 0; i < audioContexts.length; i++) {
			try {
				if (audioContexts[i].state === 'suspended') audioContexts[i].resume();
			} catch (e) {}
		}
	}

	function applyEffectiveAudioMute() {
		var effective = !!window.__ptAudioOutputMuted || !!window.__ptGamePaused;
		for (var i = 0; i < audioContexts.length; i++) {
			try {
				if (effective) {
					if (audioContexts[i].state === 'running') audioContexts[i].suspend();
				} else if (audioContexts[i].state === 'suspended') {
					audioContexts[i].resume();
				}
			} catch (e) {}
		}
	}

	function setAudioOutputMuted(muted) {
		window.__ptAudioOutputMuted = !!muted;
		applyEffectiveAudioMute();
	}

	function setGamePaused(paused) {
		window.__ptGamePaused = !!paused;
		applyEffectiveAudioMute();
		try {
			var media = document.querySelectorAll('audio, video');
			for (var i = 0; i < media.length; i++) {
				var el = media[i];
				if (paused) {
					if (!el.paused) el.setAttribute('data-pt-pause-was-playing', '1');
					try {
						el.pause();
					} catch (e) {}
				} else if (el.getAttribute('data-pt-pause-was-playing') === '1') {
					el.removeAttribute('data-pt-pause-was-playing');
					try {
						el.play();
					} catch (e) {}
				}
			}
		} catch (e) {}
	}

	/* \u2014\u2014\u2014 Touch console \u2192 synthetic keyboard (cross-origin parent uses postMessage) \u2014\u2014\u2014 */
	var PT_KEY_CODE_TO_KEY = {
		ArrowUp: 'ArrowUp',
		ArrowDown: 'ArrowDown',
		ArrowLeft: 'ArrowLeft',
		ArrowRight: 'ArrowRight',
		Space: ' ',
		Enter: 'Enter',
		Escape: 'Escape',
		ShiftLeft: 'Shift',
		ShiftRight: 'Shift',
		ControlLeft: 'Control',
		ControlRight: 'Control',
		AltLeft: 'Alt',
		AltRight: 'Alt',
		Tab: 'Tab',
		Backspace: 'Backspace'
	};
	var PT_KEY_CODE_TO_KEY_CODE = {
		ArrowLeft: 37,
		ArrowUp: 38,
		ArrowRight: 39,
		ArrowDown: 40,
		Space: 32,
		Enter: 13,
		Escape: 27,
		ShiftLeft: 16,
		ShiftRight: 16,
		ControlLeft: 17,
		ControlRight: 17,
		AltLeft: 18,
		AltRight: 18,
		Tab: 9,
		Backspace: 8
	};
	var ptTouchHeld = Object.create(null);

	function ptKeyFromCode(code) {
		if (PT_KEY_CODE_TO_KEY[code]) return PT_KEY_CODE_TO_KEY[code];
		if (code && code.indexOf('Key') === 0 && code.length === 4) return code.charAt(3).toLowerCase();
		if (code && code.indexOf('Digit') === 0 && code.length === 6) return code.charAt(5);
		return code || '';
	}

	function ptKeyCodeFromCode(code) {
		if (PT_KEY_CODE_TO_KEY_CODE[code] != null) return PT_KEY_CODE_TO_KEY_CODE[code];
		if (code && code.indexOf('Key') === 0 && code.length === 4) return code.charCodeAt(3);
		if (code && code.indexOf('Digit') === 0 && code.length === 6) return code.charCodeAt(5);
		return 0;
	}

	function ptTouchFocus() {
		try {
			var canvas =
				document.querySelector('canvas') ||
				document.querySelector('#unity-canvas, #gameContainer, #game, .game-canvas, [data-game-canvas]');
			if (canvas && canvas.focus) canvas.focus({ preventScroll: true });
		} catch (e) {}
		try {
			window.focus();
		} catch (e) {}
	}

	function ptDispatchKey(type, code) {
		if (!code) return;
		var key = ptKeyFromCode(code);
		var keyCode = ptKeyCodeFromCode(code);
		var init = {
			key: key,
			code: code,
			keyCode: keyCode,
			which: keyCode,
			bubbles: true,
			cancelable: true,
			composed: true,
			view: window
		};
		var event;
		try {
			event = new KeyboardEvent(type, init);
			try {
				Object.defineProperty(event, 'keyCode', { get: function () { return keyCode; } });
				Object.defineProperty(event, 'which', { get: function () { return keyCode; } });
				Object.defineProperty(event, 'charCode', { get: function () { return 0; } });
			} catch (e) {}
		} catch (e) {
			return;
		}
		ptTouchFocus();
		var canvas =
			document.querySelector('canvas') ||
			document.querySelector('#unity-canvas, #gameContainer, #game, .game-canvas, [data-game-canvas]');
		var targets = [];
		if (canvas) targets.push(canvas);
		if (document.body) targets.push(document.body);
		if (document.documentElement) targets.push(document.documentElement);
		targets.push(document, window);
		var seen = {};
		for (var i = 0; i < targets.length; i++) {
			var t = targets[i];
			if (!t || seen[t]) continue;
			seen[t] = true;
			try {
				t.dispatchEvent(event);
			} catch (e) {}
		}
	}

	function ptTouchInputDown(codes) {
		if (!codes || !codes.length) return;
		ptTouchFocus();
		for (var i = 0; i < codes.length; i++) {
			var code = codes[i];
			if (!code || ptTouchHeld[code]) continue;
			ptTouchHeld[code] = true;
			ptDispatchKey('keydown', code);
		}
	}

	function ptTouchInputUp(codes) {
		if (!codes || !codes.length) return;
		for (var i = 0; i < codes.length; i++) {
			var code = codes[i];
			if (!code || !ptTouchHeld[code]) continue;
			delete ptTouchHeld[code];
			ptDispatchKey('keyup', code);
		}
	}

	function ptTouchInputReleaseAll() {
		var codes = Object.keys(ptTouchHeld);
		ptTouchHeld = Object.create(null);
		for (var i = 0; i < codes.length; i++) ptDispatchKey('keyup', codes[i]);
	}

	function handleTouchInputMessage(data) {
		if (!data || data.type !== 'potato-tomato-touch-input') return;
		var action = data.action;
		var codes = Array.isArray(data.codes)
			? data.codes
			: data.code
				? [data.code]
				: [];
		if (action === 'down') ptTouchInputDown(codes);
		else if (action === 'up') ptTouchInputUp(codes);
		else if (action === 'releaseAll') ptTouchInputReleaseAll();
	}

	/* App-driven pause/mute/touch \u2014 must keep working despite focus spoof */
	window.addEventListener('message', function (ev) {
		var data = ev && ev.data;
		if (!data || typeof data !== 'object') return;
		if (data.type === 'potato-tomato-unlock-audio') unlockAudio();
		if (data.type === 'potato-tomato-audio-output') setAudioOutputMuted(!!data.muted);
		if (data.type === 'potato-tomato-game-pause') setGamePaused(!!data.paused);
		handleTouchInputMessage(data);
	});
	['pointerdown', 'touchstart', 'keydown'].forEach(function (type) {
		document.addEventListener(type, unlockAudio, true);
	});

	/* Stub portal SDKs so games do not pause on ads / login */
	window.PokiSDK =
		window.PokiSDK ||
		{
			init: function () {
				return Promise.resolve();
			},
			gameLoadingFinished: function () {},
			gameplayStart: function () {},
			commercialBreak: function () {
				return Promise.resolve();
			},
			rewardedBreak: function () {
				return Promise.resolve();
			}
		};

	window.y8 =
		window.y8 ||
		{
			ready: function (cb) {
				if (typeof cb === 'function') cb();
			},
			sdk: function () {
				return {
					init: function () {},
					showAd: function () {},
					showRewardAd: function () {}
				};
			},
			emitReadyEvent: function () {}
		};

	window.YaGames =
		window.YaGames ||
		{
			init: function () {
				return Promise.resolve({
					adv: {
						showFullscreenAdv: function (o) {
							if (o && o.callbacks && o.callbacks.onClose) o.callbacks.onClose(false);
						},
						showRewardedVideo: function (o) {
							if (o && o.callbacks) {
								if (o.callbacks.onRewarded) o.callbacks.onRewarded();
								if (o.callbacks.onClose) o.callbacks.onClose();
							}
						}
					},
					features: { LoadingAPI: { ready: function () {} } },
					getPlayer: function () {
						return Promise.resolve({
							setData: function () {
								return Promise.resolve();
							},
							getData: function () {
								return Promise.resolve({});
							}
						});
					}
				});
			}
		};

	document.addEventListener('DOMContentLoaded', hideLoadingDom);
	setInterval(hideLoadingDom, 500);
})();
`;
var GAME_STORAGE_BRIDGE_SOURCE = "/**\n * In-game iframe: sync full browser profile with Potato Tomato shell via postMessage.\n * Includes IndexedDB shim for Unity WebGL and other IDB-based saves.\n */\n(function () {\n	var TYPE = 'potato-tomato-game-storage';\n	var SCHEMA_VERSION = 1;\n	var gameId = '';\n	var origin = location.origin;\n	var idbProfile = [];\n	var idbShimInstalled = false;\n	var pushTimer = null;\n\n	/*\n	 * Focus spoof for ALL same-origin games (not just Unity inject.js):\n	 * stop blur/visibility from auto-pausing the game. App Pause still uses postMessage.\n	 * Do not override hasFocus \u2014 parent mute-on-focus-loss reads it.\n	 */\n	(function patchFocusSpoof() {\n		if (window.__ptFocusSpoofInstalled) return;\n		window.__ptFocusSpoofInstalled = true;\n		try {\n			Object.defineProperty(Document.prototype, 'hidden', {\n				configurable: true,\n				get: function () {\n					return false;\n				}\n			});\n			Object.defineProperty(Document.prototype, 'visibilityState', {\n				configurable: true,\n				get: function () {\n					return 'visible';\n				}\n			});\n		} catch (e) {\n			/* ignore */\n		}\n		function swallow(ev) {\n			try {\n				ev.stopImmediatePropagation();\n				ev.stopPropagation();\n				ev.preventDefault();\n			} catch (e2) {\n				/* ignore */\n			}\n		}\n		['blur', 'focusout', 'visibilitychange'].forEach(function (type) {\n			window.addEventListener(type, swallow, true);\n			document.addEventListener(type, swallow, true);\n		});\n	})();\n\n	/* Generic Emscripten/Unity stdin stubs (bridge may load when inject.js does not). */\n	(function patchUnityModuleStdio() {\n		if (window.__ptModuleStdioInstalled) return;\n		window.__ptModuleStdioInstalled = true;\n		function nullIn() {\n			return null;\n		}\n		function noopOut() {}\n		try {\n			var mod = window.Module || {};\n			if (typeof mod.stdin !== 'function') mod.stdin = nullIn;\n			if (typeof mod.stdout !== 'function') mod.stdout = noopOut;\n			if (typeof mod.stderr !== 'function') mod.stderr = noopOut;\n			if (!mod.ENVIRONMENT) mod.ENVIRONMENT = 'WEB';\n			window.Module = mod;\n		} catch (e) {\n			/* ignore */\n		}\n	})();\n\n	function detectGameId() {\n		var path = location.pathname;\n		var patterns = [\n			/\\/puller-games\\/([^/]+)\\//,\n			/\\/browser-offline\\/([^/]+)\\//,\n			/\\/games\\/([^/]+)\\/(?:offline|online)\\//\n		];\n		for (var i = 0; i < patterns.length; i++) {\n			var match = path.match(patterns[i]);\n			if (match) return decodeURIComponent(match[1]);\n		}\n		return '';\n	}\n\n	function emptyProfile() {\n		return {\n			schemaVersion: SCHEMA_VERSION,\n			updatedAt: 0,\n			profile: {\n				Default: {\n					localStorage: {},\n					sessionStorage: {},\n					cookies: [],\n					indexedDB: []\n				}\n			}\n		};\n	}\n\n	function snapLocalStorage() {\n		var data = {};\n		try {\n			for (var i = 0; i < localStorage.length; i++) {\n				var key = localStorage.key(i);\n				if (key) data[key] = localStorage.getItem(key);\n			}\n		} catch (e) {\n			/* ignore */\n		}\n		return data;\n	}\n\n	function snapSessionStorage() {\n		var data = {};\n		try {\n			for (var i = 0; i < sessionStorage.length; i++) {\n				var key = sessionStorage.key(i);\n				if (key) data[key] = sessionStorage.getItem(key);\n			}\n		} catch (e) {\n			/* ignore */\n		}\n		return data;\n	}\n\n	function snapCookies() {\n		var raw = document.cookie;\n		if (!raw) return [];\n		var cookies = [];\n		var parts = raw.split(';');\n		for (var i = 0; i < parts.length; i++) {\n			var trimmed = parts[i].trim();\n			if (!trimmed) continue;\n			var eq = trimmed.indexOf('=');\n			if (eq === -1) continue;\n			cookies.push({\n				name: trimmed.slice(0, eq).trim(),\n				value: trimmed.slice(eq + 1).trim(),\n				path: '/'\n			});\n		}\n		return cookies;\n	}\n\n	function serializeKey(key) {\n		try {\n			return JSON.stringify(key);\n		} catch (e) {\n			return String(key);\n		}\n	}\n\n	function serializeValue(val) {\n		if (val == null) return 'null';\n		if (typeof val === 'string') return val;\n		try {\n			if (val instanceof ArrayBuffer) {\n				var bytes = new Uint8Array(val);\n				var bin = '';\n				for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);\n				return '__ab__:' + btoa(bin);\n			}\n			return JSON.stringify(val);\n		} catch (e) {\n			return String(val);\n		}\n	}\n\n	function findDbProfile(name) {\n		for (var i = 0; i < idbProfile.length; i++) {\n			if (idbProfile[i].name === name) return idbProfile[i];\n		}\n		return null;\n	}\n\n	function upsertRecord(dbName, storeName, key, value) {\n		var db = findDbProfile(dbName);\n		if (!db) {\n			db = { name: dbName, version: 1, objectStores: [], records: [] };\n			idbProfile.push(db);\n		}\n		if (db.objectStores.indexOf(storeName) === -1) db.objectStores.push(storeName);\n		var keyStr = serializeKey(key);\n		var valStr = serializeValue(value);\n		for (var i = 0; i < db.records.length; i++) {\n			if (db.records[i].storeName === storeName && db.records[i].key === keyStr) {\n				db.records[i].value = valStr;\n				return;\n			}\n		}\n		db.records.push({ storeName: storeName, key: keyStr, value: valStr });\n	}\n\n	function removeRecord(dbName, storeName, key) {\n		var db = findDbProfile(dbName);\n		if (!db) return;\n		var keyStr = serializeKey(key);\n		db.records = db.records.filter(function (r) {\n			return r.storeName !== storeName || r.key !== keyStr;\n		});\n	}\n\n	function installIdbShim() {\n		if (idbShimInstalled || !window.indexedDB) return;\n		idbShimInstalled = true;\n		var realOpen = window.indexedDB.open.bind(window.indexedDB);\n\n		window.indexedDB.open = function (name, version) {\n			var req = realOpen(name, version || 1);\n			var dbName = String(name);\n			var dbVersion = version || 1;\n\n			req.addEventListener('upgradeneeded', function () {\n				var db = req.result;\n				var stores = [];\n				try {\n					for (var i = 0; i < db.objectStoreNames.length; i++) {\n						stores.push(db.objectStoreNames[i]);\n					}\n				} catch (e) {\n					/* ignore */\n				}\n				var existing = findDbProfile(dbName);\n				if (!existing) {\n					idbProfile.push({\n						name: dbName,\n						version: dbVersion,\n						objectStores: stores,\n						records: []\n					});\n				} else {\n					existing.version = dbVersion;\n					existing.objectStores = stores;\n				}\n			});\n\n			req.addEventListener('success', function () {\n				var db = req.result;\n				wrapDatabase(db, dbName);\n				hydrateIdbDatabase(db, dbName);\n			});\n\n			return req;\n		};\n	}\n\n	function wrapDatabase(db, dbName) {\n		var origTransaction = db.transaction.bind(db);\n		db.transaction = function (storeNames, mode) {\n			var tx = origTransaction(storeNames, mode);\n			wrapTransaction(tx, dbName, storeNames);\n			return tx;\n		};\n	}\n\n	function wrapTransaction(tx, dbName, storeNames) {\n		var names = Array.isArray(storeNames) ? storeNames : [storeNames];\n		tx.addEventListener('complete', function () {\n			schedulePush();\n		});\n\n		var origObjectStore = tx.objectStore.bind(tx);\n		tx.objectStore = function (name) {\n			var store = origObjectStore(name);\n			wrapObjectStore(store, dbName, name);\n			return store;\n		};\n	}\n\n	function wrapObjectStore(store, dbName, storeName) {\n		var origPut = store.put.bind(store);\n		var origAdd = store.add.bind(store);\n		var origDelete = store.delete.bind(store);\n\n		store.put = function (value, key) {\n			upsertRecord(dbName, storeName, key !== undefined ? key : value, value);\n			return origPut(value, key);\n		};\n		store.add = function (value, key) {\n			upsertRecord(dbName, storeName, key !== undefined ? key : value, value);\n			return origAdd(value, key);\n		};\n		store.delete = function (key) {\n			removeRecord(dbName, storeName, key);\n			return origDelete(key);\n		};\n	}\n\n	function parseStoredValue(valStr) {\n		if (valStr == null) return null;\n		if (valStr.indexOf('__ab__:') === 0) {\n			var bin = atob(valStr.slice(7));\n			var bytes = new Uint8Array(bin.length);\n			for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);\n			return bytes.buffer;\n		}\n		try {\n			return JSON.parse(valStr);\n		} catch (e) {\n			return valStr;\n		}\n	}\n\n	function parseStoredKey(keyStr) {\n		try {\n			return JSON.parse(keyStr);\n		} catch (e) {\n			return keyStr;\n		}\n	}\n\n	function hydrateIdbDatabase(db, dbName) {\n		var profile = findDbProfile(dbName);\n		if (!profile || !profile.records.length) return;\n\n		for (var i = 0; i < profile.records.length; i++) {\n			var rec = profile.records[i];\n			try {\n				if (!db.objectStoreNames.contains(rec.storeName)) continue;\n				var tx = db.transaction(rec.storeName, 'readwrite');\n				var store = tx.objectStore(rec.storeName);\n				var key = parseStoredKey(rec.key);\n				var value = parseStoredValue(rec.value);\n				store.put(value, key);\n			} catch (e) {\n				/* store may not exist yet */\n			}\n		}\n	}\n\n	function buildProfile() {\n		var p = emptyProfile();\n		p.updatedAt = Date.now();\n		p.profile.Default.localStorage[origin] = snapLocalStorage();\n		p.profile.Default.sessionStorage[origin] = snapSessionStorage();\n		p.profile.Default.cookies = snapCookies();\n		p.profile.Default.indexedDB = idbProfile.map(function (db) {\n			return {\n				name: db.name,\n				version: db.version,\n				objectStores: db.objectStores.slice(),\n				records: db.records.slice()\n			};\n		});\n		return p;\n	}\n\n	function applyProfile(profile) {\n		if (!profile || !profile.profile || !profile.profile.Default) return;\n		var def = profile.profile.Default;\n\n		var ls = def.localStorage && def.localStorage[origin];\n		if (ls) {\n			for (var key in ls) {\n				if (!Object.prototype.hasOwnProperty.call(ls, key)) continue;\n				try {\n					localStorage.setItem(key, ls[key]);\n				} catch (e) {\n					/* quota */\n				}\n			}\n		}\n\n		var ss = def.sessionStorage && def.sessionStorage[origin];\n		if (ss) {\n			for (var sk in ss) {\n				if (!Object.prototype.hasOwnProperty.call(ss, sk)) continue;\n				try {\n					sessionStorage.setItem(sk, ss[sk]);\n				} catch (e) {\n					/* ignore */\n				}\n			}\n		}\n\n		if (def.cookies && def.cookies.length) {\n			for (var ci = 0; ci < def.cookies.length; ci++) {\n				var c = def.cookies[ci];\n				if (c.httpOnly) continue;\n				var segment =\n					encodeURIComponent(c.name) + '=' + encodeURIComponent(c.value);\n				if (c.path) segment += '; path=' + c.path;\n				if (c.domain) segment += '; domain=' + c.domain;\n				if (c.secure) segment += '; secure';\n				if (c.sameSite) segment += '; samesite=' + c.sameSite;\n				try {\n					document.cookie = segment;\n				} catch (e) {\n					/* ignore */\n				}\n			}\n		}\n\n		if (def.indexedDB && def.indexedDB.length) {\n			idbProfile = def.indexedDB.map(function (db) {\n				return {\n					name: db.name,\n					version: db.version,\n					objectStores: (db.objectStores || []).slice(),\n					records: (db.records || []).slice()\n				};\n			});\n		}\n	}\n\n	function pushToParent() {\n		if (!gameId || window.parent === window) return;\n		window.parent.postMessage(\n			{\n				type: TYPE,\n				action: 'push',\n				gameId: gameId,\n				data: buildProfile()\n			},\n			'*'\n		);\n	}\n\n	function schedulePush() {\n		if (pushTimer) return;\n		pushTimer = setTimeout(function () {\n			pushTimer = null;\n			pushToParent();\n		}, 500);\n	}\n\n	gameId = detectGameId();\n	if (!gameId || window.parent === window) return;\n\n	installIdbShim();\n\n	function unlockAudio() {\n		if (window.__ptAudioOutputMuted || window.__ptGamePaused) return;\n		try {\n			var AC = window.AudioContext || window.webkitAudioContext;\n			if (!AC) return;\n			if (!window.__ptSharedAudioCtx) window.__ptSharedAudioCtx = new AC();\n			if (window.__ptSharedAudioCtx.state === 'suspended') {\n				window.__ptSharedAudioCtx.resume();\n			}\n		} catch (e) {\n			/* ignore */\n		}\n	}\n\n	function applyEffectiveAudioMute() {\n		try {\n			var ctx = window.__ptSharedAudioCtx;\n			if (!ctx) {\n				var AC = window.AudioContext || window.webkitAudioContext;\n				if (!AC) return;\n				ctx = new AC();\n				window.__ptSharedAudioCtx = ctx;\n			}\n			var effective = !!window.__ptAudioOutputMuted || !!window.__ptGamePaused;\n			if (effective) {\n				if (ctx.state === 'running') ctx.suspend();\n			} else if (ctx.state === 'suspended') {\n				ctx.resume();\n			}\n		} catch (e) {\n			/* ignore */\n		}\n	}\n\n	function setAudioOutputMuted(muted) {\n		window.__ptAudioOutputMuted = !!muted;\n		applyEffectiveAudioMute();\n	}\n\n	function setGamePaused(paused) {\n		window.__ptGamePaused = !!paused;\n		applyEffectiveAudioMute();\n		try {\n			var media = document.querySelectorAll('audio, video');\n			for (var i = 0; i < media.length; i++) {\n				var el = media[i];\n				if (paused) {\n					if (!el.paused) el.setAttribute('data-pt-pause-was-playing', '1');\n					try {\n						el.pause();\n					} catch (e2) {}\n				} else if (el.getAttribute('data-pt-pause-was-playing') === '1') {\n					el.removeAttribute('data-pt-pause-was-playing');\n					try {\n						el.play();\n					} catch (e2) {}\n				}\n			}\n		} catch (e) {\n			/* ignore */\n		}\n	}\n\n	var ptTouchHeld = Object.create(null);\n	function ptKeyFromCode(code) {\n		var map = {\n			ArrowUp: 'ArrowUp',\n			ArrowDown: 'ArrowDown',\n			ArrowLeft: 'ArrowLeft',\n			ArrowRight: 'ArrowRight',\n			Space: ' ',\n			Enter: 'Enter',\n			Escape: 'Escape',\n			ShiftLeft: 'Shift',\n			ShiftRight: 'Shift'\n		};\n		if (map[code]) return map[code];\n		if (code && code.indexOf('Key') === 0 && code.length === 4) return code.charAt(3).toLowerCase();\n		if (code && code.indexOf('Digit') === 0 && code.length === 6) return code.charAt(5);\n		return code || '';\n	}\n	function ptKeyCodeFromCode(code) {\n		var map = {\n			ArrowLeft: 37,\n			ArrowUp: 38,\n			ArrowRight: 39,\n			ArrowDown: 40,\n			Space: 32,\n			Enter: 13,\n			Escape: 27,\n			ShiftLeft: 16,\n			ShiftRight: 16\n		};\n		if (map[code] != null) return map[code];\n		if (code && code.indexOf('Key') === 0 && code.length === 4) return code.charCodeAt(3);\n		if (code && code.indexOf('Digit') === 0 && code.length === 6) return code.charCodeAt(5);\n		return 0;\n	}\n	function ptDispatchKey(type, code) {\n		if (!code) return;\n		var key = ptKeyFromCode(code);\n		var keyCode = ptKeyCodeFromCode(code);\n		var event;\n		try {\n			event = new KeyboardEvent(type, {\n				key: key,\n				code: code,\n				keyCode: keyCode,\n				which: keyCode,\n				bubbles: true,\n				cancelable: true,\n				composed: true,\n				view: window\n			});\n			try {\n				Object.defineProperty(event, 'keyCode', { get: function () { return keyCode; } });\n				Object.defineProperty(event, 'which', { get: function () { return keyCode; } });\n			} catch (e) {}\n		} catch (e) {\n			return;\n		}\n		try {\n			var canvas = document.querySelector('canvas');\n			if (canvas && canvas.focus) canvas.focus({ preventScroll: true });\n		} catch (e) {}\n		var targets = [];\n		var canvasEl = document.querySelector('canvas');\n		if (canvasEl) targets.push(canvasEl);\n		if (document.body) targets.push(document.body);\n		if (document.documentElement) targets.push(document.documentElement);\n		targets.push(document, window);\n		for (var i = 0; i < targets.length; i++) {\n			try {\n				targets[i].dispatchEvent(event);\n			} catch (e) {}\n		}\n	}\n	function handleTouchInputMessage(data) {\n		if (!data || data.type !== 'potato-tomato-touch-input') return;\n		var codes = Array.isArray(data.codes) ? data.codes : data.code ? [data.code] : [];\n		if (data.action === 'releaseAll') {\n			var held = Object.keys(ptTouchHeld);\n			ptTouchHeld = Object.create(null);\n			for (var r = 0; r < held.length; r++) ptDispatchKey('keyup', held[r]);\n			return;\n		}\n		if (data.action === 'down') {\n			for (var d = 0; d < codes.length; d++) {\n				if (!codes[d] || ptTouchHeld[codes[d]]) continue;\n				ptTouchHeld[codes[d]] = true;\n				ptDispatchKey('keydown', codes[d]);\n			}\n			return;\n		}\n		if (data.action === 'up') {\n			for (var u = 0; u < codes.length; u++) {\n				if (!codes[u] || !ptTouchHeld[codes[u]]) continue;\n				delete ptTouchHeld[codes[u]];\n				ptDispatchKey('keyup', codes[u]);\n			}\n		}\n	}\n\n	window.addEventListener('message', function (event) {\n		var data = event && event.data;\n		if (!data || typeof data !== 'object') return;\n		if (data.type === 'potato-tomato-unlock-audio') unlockAudio();\n		if (data.type === 'potato-tomato-audio-output') setAudioOutputMuted(!!data.muted);\n		if (data.type === 'potato-tomato-game-pause') setGamePaused(!!data.paused);\n		handleTouchInputMessage(data);\n	});\n	['pointerdown', 'touchstart', 'keydown'].forEach(function (type) {\n		document.addEventListener(type, unlockAudio, true);\n	});\n\n	window.addEventListener('message', function (event) {\n		var msg = event.data;\n		if (!msg || msg.type !== TYPE || msg.gameId !== gameId) return;\n		if (msg.action === 'hydrate' && msg.data) {\n			applyProfile(msg.data);\n		}\n	});\n\n	window.parent.postMessage({ type: TYPE, action: 'pull', gameId: gameId }, '*');\n	setInterval(pushToParent, 4000);\n	window.addEventListener('pagehide', pushToParent);\n})();\n";

// src/unity/inject-html.ts
var cachedInjectSource = null;
function loadUnityInjectSource() {
  if (cachedInjectSource) return cachedInjectSource;
  cachedInjectSource = UNITY_INJECT_SOURCE;
  return cachedInjectSource;
}
function buildUnityInjectScriptTag() {
  return `<script>${loadUnityInjectSource()}</script>`;
}
var BLOAT_SCRIPT = /(?:poki-sdk|master-loader|y8-afp|y8\.sdk|id\.net|idnet|gameapi|adsbygoogle|googlesyndication|cloak\.js|main\.min\.js|cdn-cgi|cloudflare)/i;
var BLOAT_LINK = /(?:poki|y8|id\.net|doubleclick|cloak)/i;
function stripUnityPortalBloat(html) {
  let out = html;
  out = out.replace(
    /<script\b[^>]*\bsrc=["'][^"']*["'][^>]*>\s*<\/script>/gi,
    (tag) => BLOAT_SCRIPT.test(tag) ? "" : tag
  );
  out = out.replace(/<script\b[^>]*>\s*[\s\S]*?<\/script>/gi, (tag) => {
    if (BLOAT_SCRIPT.test(tag) && !/createUnityInstance|UnityLoader/.test(tag)) return "";
    return tag;
  });
  out = out.replace(/<link\b[^>]*>/gi, (tag) => BLOAT_LINK.test(tag) ? "" : tag);
  out = out.replace(/<div\b[^>]*\bid=["']play-cover["'][^>]*>[\s\S]*?<\/div>/gi, "");
  out = out.replace(/<div\b[^>]*\bid=["']loading-cover["'][^>]*>[\s\S]*?<\/div>/gi, "");
  return out;
}
function injectUnityPatches(html, assetRoutes = {}) {
  let out = stripUnityPortalBloat(html);
  const inject = buildUnityInjectScriptTag();
  const redirect = Object.keys(assetRoutes).length > 0 ? buildAssetRedirectScript(assetRoutes) : "";
  const bundle = `${inject}
${redirect}`;
  if (out.includes("__ptUnityInjectInstalled")) return out;
  if (out.includes("<head")) {
    return out.replace(/<head([^>]*)>/i, `<head$1>${bundle}`);
  }
  if (out.includes("<body")) {
    return out.replace(/<body([^>]*)>/i, `<body$1>${bundle}`);
  }
  return bundle + out;
}
function isUnityGameHtml(html) {
  return /UnityLoader|createUnityInstance|master-loader\.js|unityWebglLoaderUrl|Build\/.*\.json/i.test(
    html
  );
}

// src/unity-embed/host.ts
function buildOfflineHtml(assetRoutes) {
  return injectUnityPatches(buildAdFreeHostHtml(), assetRoutes);
}
async function writeHostFiles(outDir, info, downloads, merges, assetRoutes) {
  const files = [];
  for (const dl of downloads) {
    if (dl.relativePath.includes(".part")) continue;
    files.push({ path: dl.relativePath, size: dl.size, sha256: dl.sha256 });
  }
  for (const merge of merges) {
    const mergedPath = path9.join(outDir, merge.relativePath);
    const buffer = await fs7.readFile(mergedPath);
    files.push({
      path: merge.relativePath,
      size: merge.size,
      sha256: createHash2("sha256").update(buffer).digest("hex")
    });
  }
  const placeholderAssets = downloads.filter((dl) => dl.placeholder).map((dl) => dl.url);
  const manifest = {
    productName: "Shrek Swamp Escape 2",
    productVersion: "0.1.0",
    pulledAt: (/* @__PURE__ */ new Date()).toISOString(),
    cdnBase: info.cdnBase,
    embedPageUrl: info.embedPageUrl,
    embedFileUrl: info.fileUrl,
    externalAssetUrls: info.externalAssetUrls,
    assetRoutes,
    ...placeholderAssets.length > 0 ? { placeholderAssets } : {},
    files
  };
  await fs7.writeFile(path9.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  await fs7.writeFile(path9.join(outDir, "asset-map.json"), JSON.stringify(assetRoutes, null, 2));
  await fs7.writeFile(path9.join(outDir, "index.html"), buildOfflineHtml(assetRoutes));
  console.log(`[host] Wrote manifest.json (${files.length} files)`);
  console.log(`[host] Wrote asset-map.json (${Object.keys(assetRoutes).length} routes)`);
  console.log("[host] Wrote index.html (standalone offline host)");
  return manifest;
}

// src/unity-embed/merge.ts
import fs8 from "node:fs/promises";
import path10 from "node:path";
function formatBytes2(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
var PART_CHUNK_BYTES = 8 * 1024 * 1024;
async function mergeParts(outDir, baseName) {
  const buildDir = path10.join(outDir, "Build");
  const entries = await fs8.readdir(buildDir);
  const partPattern = new RegExp(`^${baseName}\\.part(\\d+)$`);
  const parts = entries.map((name) => {
    const match = name.match(partPattern);
    return match ? { name, index: Number.parseInt(match[1], 10) } : null;
  }).filter((p) => p !== null).sort((a, b) => a.index - b.index);
  if (parts.length === 0) return null;
  const buffers = [];
  for (const part of parts) {
    buffers.push(await fs8.readFile(path10.join(buildDir, part.name)));
  }
  const merged = Buffer.concat(buffers);
  const mergedPath = path10.join(buildDir, baseName);
  await fs8.writeFile(mergedPath, merged);
  console.log(
    `[merge] ${baseName}: ${parts.length} parts -> ${formatBytes2(merged.length)} (parts kept for WebKit)`
  );
  return {
    relativePath: `Build/${baseName}`,
    size: merged.length,
    partCount: parts.length
  };
}
async function ensureServeParts(outDir) {
  for (const baseName of ["Shrek2.data.br", "Shrek2.wasm.br"]) {
    const buildDir = path10.join(outDir, "Build");
    const mergedPath = path10.join(buildDir, baseName);
    const partPattern = new RegExp(`^${baseName.replace(".", "\\.")}\\.part\\d+$`);
    try {
      await fs8.access(mergedPath);
    } catch {
      continue;
    }
    const entries = await fs8.readdir(buildDir);
    if (entries.some((name) => partPattern.test(name))) continue;
    const merged = await fs8.readFile(mergedPath);
    let partIndex = 0;
    for (let offset = 0; offset < merged.length; offset += PART_CHUNK_BYTES) {
      const chunk = merged.subarray(offset, offset + PART_CHUNK_BYTES);
      await fs8.writeFile(path10.join(buildDir, `${baseName}.part${partIndex}`), chunk);
      partIndex++;
    }
    console.log(`[merge] split ${baseName} -> ${partIndex} serve part(s)`);
  }
}
async function mergeSplitFiles(outDir) {
  const results = [];
  const dataResult = await mergeParts(outDir, "Shrek2.data.br");
  if (dataResult) {
    results.push(dataResult);
    const alias = await linkBrotliAlias(outDir, dataResult);
    if (alias) results.push(alias);
  }
  const wasmResult = await mergeParts(outDir, "Shrek2.wasm.br");
  if (wasmResult) {
    results.push(wasmResult);
    const alias = await linkBrotliAlias(outDir, wasmResult);
    if (alias) results.push(alias);
  }
  await ensureServeParts(outDir);
  return results;
}
async function linkBrotliAlias(outDir, merged) {
  if (!merged.relativePath.endsWith(".br")) return null;
  const brPath = path10.join(outDir, merged.relativePath);
  const aliasRelative = merged.relativePath.replace(/\.br$/, "");
  const aliasPath = path10.join(outDir, aliasRelative);
  await fs8.unlink(aliasPath).catch(() => {
  });
  try {
    await fs8.link(brPath, aliasPath);
  } catch {
    await fs8.copyFile(brPath, aliasPath);
  }
  console.log(`[merge] alias ${aliasRelative} -> ${merged.relativePath}`);
  return {
    relativePath: aliasRelative,
    size: merged.size,
    partCount: 0
  };
}

// src/strategies/embed.ts
init_scan_assets();
async function pullEmbedGame(gameId, onProgress, signal) {
  const outDir = outDirForGame(GAMES_DATA_DIR, gameId);
  await fs9.mkdir(outDir, { recursive: true });
  throwIfCancelled(signal);
  onProgress(5, "Discovering game source\u2026");
  const info = await discoverGameInfo(gameId);
  const browser = await chromium2.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const request = context.request;
  const browserPage = await context.newPage();
  try {
    throwIfCancelled(signal);
    onProgress(15, "Downloading core Unity assets\u2026");
    let downloads = await downloadAssets(request, info, outDir, signal);
    throwIfCancelled(signal);
    const merges = await mergeSplitFiles(outDir);
    onProgress(45, "Scanning for external media\u2026");
    info.externalAssetUrls = await scanGameDirectory(outDir, info.gameHtml);
    if (info.externalAssetUrls.length > 0) {
      onProgress(55, `Downloading ${info.externalAssetUrls.length} external asset(s)\u2026`);
      const externalDownloads = await downloadUrlList(
        request,
        info.externalAssetUrls,
        outDir,
        info.cdnBase,
        browserPage,
        signal
      );
      downloads = [...downloads, ...externalDownloads];
    }
    throwIfCancelled(signal);
    onProgress(85, "Writing offline host files\u2026");
    const assetRoutes = buildAssetRouteMap(info.externalAssetUrls);
    await writeHostFiles(outDir, info, downloads, merges, assetRoutes);
    onProgress(100, "Download complete");
  } finally {
    await context.close();
    await browser.close();
  }
}

// src/strategies/generic.ts
import fs17 from "node:fs/promises";
import { existsSync as existsSync7 } from "node:fs";
import path19 from "node:path";
import { spawn } from "node:child_process";
init_cancel_registry();
init_config();

// src/download/discover-all.ts
import { existsSync as existsSync4 } from "node:fs";
import fs10 from "node:fs/promises";
import path11 from "node:path";
var TEXT_EXT = /\.(html?|js|css|json|xml|txt)$/i;
async function readTextSource(url, outDir, baseUrl, localPathForUrl2) {
  const localPath = localPathForUrl2(baseUrl, url, outDir);
  if (existsSync4(localPath)) {
    try {
      const buf = await fs10.readFile(localPath);
      if (buf.length > 8 * 1024 * 1024) return null;
      return buf.toString("utf-8");
    } catch {
      return null;
    }
  }
  if (!TEXT_EXT.test(url)) return null;
  return fetchTextForDiscovery(url);
}
async function discoverAllAssetUrls(options, localPathForUrl2) {
  const { outDir, baseUrl, entryRel = "index.html", maxPasses = 32, unityOptimized = true } = options;
  const discovered = /* @__PURE__ */ new Set();
  const seen = /* @__PURE__ */ new Set();
  const scanQueue = /* @__PURE__ */ new Set();
  const entryPath = path11.join(outDir, entryRel);
  const entryHtml = await fs10.readFile(entryPath, "utf-8");
  const unityMode = unityOptimized && isUnityShell(entryHtml);
  const addRefs = (text, fileUrl) => {
    if (unityMode) {
      discoverUnityAssetRefs(text, fileUrl, scanQueue, seen);
    } else {
      collectGenericAssetRefs(text, fileUrl, scanQueue, seen);
    }
  };
  addRefs(entryHtml, baseUrl);
  for (let pass = 0; pass < maxPasses && scanQueue.size > 0; pass++) {
    const batch = [...scanQueue];
    scanQueue.clear();
    const DISCOVERY_CONCURRENCY = 16;
    for (let i = 0; i < batch.length; i += DISCOVERY_CONCURRENCY) {
      const chunk = batch.slice(i, i + DISCOVERY_CONCURRENCY);
      await Promise.all(
        chunk.map(async (url) => {
          if (seen.has(url)) return;
          seen.add(url);
          discovered.add(url);
          const text = await readTextSource(url, outDir, baseUrl, localPathForUrl2);
          if (!text) return;
          addRefs(text, url);
          if (unityMode && /\.json$/i.test(url)) {
            try {
              const manifest = JSON.parse(text);
              for (const assetUrl of expandBuildManifest(manifest, url)) {
                if (!seen.has(assetUrl)) scanQueue.add(assetUrl);
                discovered.add(assetUrl);
              }
            } catch {
            }
          }
          if (unityMode && /\.(loader|framework)\.js$/i.test(url)) {
            for (const assetUrl of scanUnityLoaderBundle(text, url)) {
              if (!seen.has(assetUrl)) scanQueue.add(assetUrl);
              discovered.add(assetUrl);
            }
            const inline = parseCreateUnityInstanceConfig(text);
            for (const val of Object.values(inline)) {
              try {
                const abs = new URL(val, url).href;
                if (!seen.has(abs)) scanQueue.add(abs);
                discovered.add(abs);
              } catch {
              }
            }
          }
        })
      );
    }
  }
  return discovered;
}

// src/generic/entry-html.ts
import fs11 from "node:fs/promises";
import { existsSync as existsSync5 } from "node:fs";
import path12 from "node:path";
var GAME_SHELL_MARKERS = /c2runtime|cr_createRuntime|lime\.embed|UnityLoader|createUnityInstance|openfl-content|Construct 2|openfl-content/i;
function mirroredIndexCandidates(out, iframeUrl) {
  const parsed = new URL(iframeUrl);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const hostDir = path12.join(out, parsed.hostname);
  const candidates = [path12.join(out, "index.html"), path12.join(hostDir, "index.html")];
  if (parts.length === 0) return candidates;
  const last = parts[parts.length - 1];
  candidates.push(path12.join(hostDir, ...parts, "index.html"));
  candidates.push(path12.join(hostDir, ...parts.slice(0, -1), `${last}.html`));
  candidates.push(path12.join(hostDir, ...parts, `${last}.html`));
  return candidates;
}
async function collectHtmlFiles(dir, acc = []) {
  const entries = await fs11.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path12.join(dir, e.name);
    if (e.isFile() && /\.html?$/i.test(e.name)) acc.push(full);
    else if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "_external") {
      await collectHtmlFiles(full, acc);
    }
  }
  return acc;
}
function scoreEntryHtml(filePath, content, iframeSrc) {
  let score = 0;
  const name = path12.basename(filePath).toLowerCase();
  const urlParts = new URL(iframeSrc).pathname.split("/").filter(Boolean);
  const last = urlParts[urlParts.length - 1]?.toLowerCase();
  if (name === "index.html") score += 100;
  else if (name === "index.htm") score += 90;
  if (last && name === `${last}.html`) score += 85;
  if (last && name.replace(/\.html?$/, "") === last) score += 70;
  if (GAME_SHELL_MARKERS.test(content)) score += 60;
  if (/<script\b/i.test(content)) score += 15;
  if (content.length >= 500) score += 10;
  if (content.length >= 2e3) score += 5;
  return score;
}
async function resolveMirroredEntryHtml(out, iframeSrc) {
  for (const candidate of mirroredIndexCandidates(out, iframeSrc)) {
    if (!existsSync5(candidate)) continue;
    try {
      const stat = await fs11.stat(candidate);
      if (stat.isFile() && stat.size >= 64) return candidate;
    } catch {
    }
  }
  const htmlFiles = await collectHtmlFiles(out);
  if (htmlFiles.length === 0) {
    throw new Error("Mirror completed but no playable HTML entry point found");
  }
  let best = htmlFiles[0];
  let bestScore = -1;
  for (const filePath of htmlFiles) {
    try {
      const stat = await fs11.stat(filePath);
      if (!stat.isFile() || stat.size < 64) continue;
      const content = await fs11.readFile(filePath, "utf-8");
      const score = scoreEntryHtml(filePath, content, iframeSrc);
      if (score > bestScore) {
        bestScore = score;
        best = filePath;
      }
    } catch {
    }
  }
  if (bestScore < 0) {
    throw new Error("Mirror completed but no playable HTML entry point found");
  }
  return best;
}

// src/generic/post-process-offline.ts
import fs13 from "node:fs/promises";
import path14 from "node:path";

// src/ads/apply.ts
import fs12 from "node:fs/promises";
import path13 from "node:path";

// src/ads/stubs.ts
function buildPokiOfflineStubScript() {
  return `(function(){
  var resolved = function(v){ return Promise.resolve(v); };
  var noop = function(){};
  window.PokiSDK = {
    init: function(){ return resolved(); },
    gameLoadingStart: noop,
    gameLoadingProgress: noop,
    gameLoadingFinished: noop,
    gameplayStart: noop,
    gameplayStop: noop,
    happyTime: noop,
    commercialBreak: function(){ return resolved(); },
    rewardedBreak: function(){ return resolved(false); },
    isAdBlocked: function(){ return false; }
  };
})();`;
}
function buildYandexOfflineStubScript() {
  return `(function(){
  function createOfflinePlayer(){
    return {
      isAuthorized: function(){ return false; },
      getMode: function(){ return 'lite'; },
      getName: function(){ return ''; },
      getUniqueID: function(){ return 'offline-local'; },
      getPhoto: function(){ return ''; },
      getPayingStatus: function(){ return 'unknown'; },
      setData: function(){ return Promise.resolve(); },
      getData: function(){ return Promise.resolve({}); }
    };
  }
  window.YaGames = { init: function() {
    return Promise.resolve({
      environment: { app:{id:'0'}, i18n:{lang:'en',tld:'com'}, browser:{lang:'en'}, payload:null },
      deviceInfo: {
        type:'desktop',
        isMobile: function(){ return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent); },
        isDesktop: function(){ return !/iPhone|iPad|iPod|Android/i.test(navigator.userAgent); },
        isTablet: function(){ return false; },
        isTV: function(){ return false; }
      },
      screen: { fullscreen:{ status:'off', request:function(){ return Promise.resolve(); }, exit:function(){ return Promise.resolve(); } }},
      adv: {
        showFullscreenAdv: function(o){
          if (o && o.callbacks && o.callbacks.onClose) o.callbacks.onClose(false);
        },
        showRewardedVideo: function(o){
          if (o && o.callbacks) {
            o.callbacks.onRewarded && o.callbacks.onRewarded();
            o.callbacks.onClose && o.callbacks.onClose();
          }
        },
        showBannerAdv:function(){}, hideBannerAdv:function(){},
        getBannerAdvStatus:function(){ return Promise.resolve({stickyAdvIsShowing:false}); }
      },
      auth:{ openAuthDialog:function(){ return Promise.resolve(); } },
      feedback:{ canReview:function(){ return Promise.resolve({value:false,reason:''}); }, requestReview:function(){ return Promise.resolve({feedbackSent:false}); } },
      shortcut:{ canShowPrompt:function(){ return Promise.resolve({canShow:false}); }, showPrompt:function(){ return Promise.resolve({outcome:'rejected'}); } },
      getLeaderboards:function(){ return Promise.resolve({ setLeaderboardScore:function(){ return Promise.resolve(); }, getLeaderboardDescription:function(){ return Promise.reject('no lb'); }, getLeaderboardEntries:function(){ return Promise.reject('no lb'); } }); },
      getPayments:function(){ return Promise.resolve({ getCatalog:function(){ return Promise.resolve([]); }, getPurchases:function(){ return Promise.resolve([]); }, purchase:function(){ return Promise.reject('unavailable'); }, consumePurchase:function(){ return Promise.resolve(); } }); },
      getPlayer: function(){ return Promise.resolve(createOfflinePlayer()); },
      serverTime:function(){ return Date.now(); },
      on:function(){},
      features:{ LoadingAPI:{ready:function(){}}, GameplayAPI:{start:function(){},stop:function(){}} }
    });
  }};
  window.FullAdShow = function(){};
  window.RewardedShow = function(id){
    if (window.myGameInstance) {
      window.myGameInstance.SendMessage('YandexGame', 'RewardVideo', id || '0');
      window.myGameInstance.SendMessage('YandexGame', 'CloseVideo');
    }
  };
  window.StickyAdActivity = function(){};
})();`;
}
function buildGenericAdStubScript() {
  return `(function(){
  var resolved = function(v){ return Promise.resolve(v); };
  var noop = function(){};
  window.__ptAdFree = true;
  if (!window.PokiSDK) {
    window.PokiSDK = {
      init: function(){ return resolved(); },
      commercialBreak: function(){ return resolved(); },
      rewardedBreak: function(){ return resolved(false); },
      gameLoadingStart: noop, gameLoadingFinished: noop,
      gameplayStart: noop, gameplayStop: noop, happyTime: noop
    };
  }
})();`;
}

// src/ads/apply.ts
var AD_IFRAME_HOST = /(?:doubleclick\.net|googlesyndication\.com|googleadservices\.com|adnxs\.com|adservice\.google|facebook\.com\/tr|amazon-adsystem\.com|scorecardresearch\.com)/i;
var SITE_ROOT_SCRIPT = /\bsrc=["'](?:\.\.\/)+([^"']+)["']/gi;
function indexHtmlReferencesPokiSdk(html) {
  return /poki-sdk|PokiSDK/i.test(html);
}
function indexHtmlReferencesYandexSdk(html) {
  return /YaGames|yandex\.ru\/games|yandex-sdk|ysdk/i.test(html);
}
function patchPokiSdkScriptTags(html) {
  return html.replace(
    /<script\b[^>]*\bsrc=["'][^"']*poki-sdk[^"']*["'][^>]*>\s*<\/script>/gi,
    '<script src="poki-sdk.js"></script>'
  );
}
function patchYandexSdkScriptTags(html) {
  return html.replace(
    /<script\b[^>]*\bsrc=["'][^"']*(?:yandex|ysdk)[^"']*["'][^>]*>\s*<\/script>/gi,
    '<script src="yandex-sdk-offline.js"></script>'
  );
}
function stripAdIframes(html) {
  return html.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, (tag) => {
    if (AD_IFRAME_HOST.test(tag)) return "<!-- ad iframe removed for offline -->";
    return tag;
  });
}
function injectHeadScript(html, src) {
  const tag = `<script src="${src}"></script>`;
  if (html.includes(src)) return html;
  if (html.includes("</head>")) return html.replace("</head>", `${tag}
</head>`);
  return `${tag}
${html}`;
}
async function patchSiteRootScriptTags(outDir, html) {
  const needed = /* @__PURE__ */ new Set();
  let out = html;
  out = out.replace(SITE_ROOT_SCRIPT, (tag, fileName) => {
    if (typeof fileName !== "string" || !fileName.trim()) return tag;
    needed.add(fileName);
    return tag.replace(/(?:\.\.\/)+[^"']+/, fileName);
  });
  for (const fileName of needed) {
    const dest = path13.join(outDir, fileName);
    if (fileName === "poki-sdk.js" || fileName === "yandex-sdk-offline.js") continue;
    try {
      const stat = await fs12.stat(dest);
      if (stat.isFile() && stat.size > 0) continue;
    } catch {
    }
    await fs12.writeFile(dest, "// offline noop\n", "utf-8");
  }
  return out;
}
async function applyOfflineAdStripping(options) {
  const entryRel = options.entryRel ?? "index.html";
  const entryPath = path13.join(options.outDir, entryRel);
  let html = await fs12.readFile(entryPath, "utf-8");
  html = stripAdIframes(html);
  html = await patchSiteRootScriptTags(options.outDir, html);
  if (indexHtmlReferencesPokiSdk(html)) {
    await fs12.writeFile(
      path13.join(options.outDir, "poki-sdk.js"),
      buildPokiOfflineStubScript(),
      "utf-8"
    );
    html = patchPokiSdkScriptTags(html);
    html = injectHeadScript(html, "poki-sdk.js");
  }
  if (indexHtmlReferencesYandexSdk(html)) {
    await fs12.writeFile(
      path13.join(options.outDir, "yandex-sdk-offline.js"),
      buildYandexOfflineStubScript(),
      "utf-8"
    );
    html = patchYandexSdkScriptTags(html);
    html = injectHeadScript(html, "yandex-sdk-offline.js");
  }
  await fs12.writeFile(
    path13.join(options.outDir, "pt-adfree.js"),
    buildGenericAdStubScript(),
    "utf-8"
  );
  html = injectHeadScript(html, "pt-adfree.js");
  await fs12.writeFile(entryPath, html, "utf-8");
}

// src/generic/post-process-offline.ts
async function postProcessGenericOfflineMirror(outDir, entryRel = "index.html") {
  await applyOfflineAdStripping({ outDir, entryRel });
  const entryPath = path14.join(outDir, entryRel);
  await fs13.access(entryPath);
}

// src/capture/session.ts
init_cancel_registry();
import fs15 from "node:fs/promises";
import path17 from "node:path";
import { chromium as chromium3 } from "playwright";

// src/capture/frames.ts
var FILE_URL_REGEX2 = /const\s+FILE_URL\s*=\s*['"]([^'"]+)['"]/;
function parseEmbedFileUrl2(html) {
  const match = html.match(FILE_URL_REGEX2);
  return match?.[1] ?? null;
}
function extractIframeSrc(html) {
  const patterns = [/<iframe[^>]+src=["']([^"']+)["']/i, /<iframe[^>]+src=([^\s>]+)/i];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const src = m[1].replace(/&amp;/g, "&").trim();
      if (src.startsWith("http")) return src;
    }
  }
  return null;
}
async function collectFrameHtml(page) {
  const candidates = [];
  try {
    candidates.push(await page.content());
  } catch {
  }
  for (const frame of page.frames()) {
    try {
      candidates.push(await frame.content());
    } catch {
    }
  }
  return candidates;
}
async function findEmbedFileUrl2(page) {
  for (const html of await collectFrameHtml(page)) {
    const url = parseEmbedFileUrl2(html);
    if (url) return url;
  }
  return null;
}
async function listNestedIframeSrcs(page) {
  const found = /* @__PURE__ */ new Set();
  for (const html of await collectFrameHtml(page)) {
    const src = extractIframeSrc(html);
    if (src) found.add(src);
  }
  for (const frame of page.frames()) {
    try {
      const srcs = await frame.$$eval(
        "iframe[src]",
        (nodes) => nodes.map((n) => n.src).filter((s) => typeof s === "string" && s.startsWith("http"))
      );
      for (const s of srcs) found.add(s);
    } catch {
    }
  }
  return [...found];
}
function frameLooksLikeGame(html) {
  return /createUnityInstance|UnityLoader|DATA_PARTS|WASM_PARTS|c2runtime|lime\.embed|PokiSDK|YaGames/i.test(
    html
  ) || html.length > 2e3;
}
async function waitForGameShell(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      try {
        const html = await frame.content();
        if (frameLooksLikeGame(html)) return true;
      } catch {
      }
    }
    await page.waitForTimeout(400);
  }
  return false;
}

// src/capture/network-vault.ts
import fs14 from "node:fs/promises";
import path16 from "node:path";

// src/capture/rewrite.ts
import path15 from "node:path";
function localPathForUrl(baseUrl, assetUrl, outDir) {
  const base = new URL(baseUrl);
  const abs = new URL(assetUrl, base);
  const absPathParts = abs.pathname.split("/").filter(Boolean);
  if (abs.origin !== base.origin) {
    return path15.join(outDir, "_external", abs.hostname, ...absPathParts);
  }
  const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  if (!abs.pathname.startsWith(basePath)) {
    return path15.join(outDir, ...absPathParts);
  }
  const baseParts = base.pathname.split("/").filter(Boolean);
  const relParts = absPathParts.slice(baseParts.length);
  if (relParts.length === 0) return path15.join(outDir, "index.html");
  return path15.join(outDir, ...relParts);
}
function relativePathForUrl(baseUrl, assetUrl, outDir) {
  const full = localPathForUrl(baseUrl, assetUrl, outDir);
  return path15.relative(outDir, full).split(path15.sep).join("/");
}
function isCapturableUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// src/capture/network-vault.ts
var SKIP_CONTENT_TYPES = /(?:text\/event-stream|application\/octet-stream;\s*charset=binary)/i;
function shouldSkipUrl(url) {
  if (!isCapturableUrl(url)) return true;
  try {
    const u = new URL(url);
    if (/\b(doubleclick|googlesyndication|google-analytics|googletagmanager|facebook\.com\/tr)\b/i.test(
      u.hostname
    )) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}
function createNetworkVault() {
  const entries = /* @__PURE__ */ new Map();
  const handlers = /* @__PURE__ */ new WeakMap();
  async function ingest(response) {
    const url = response.url();
    if (shouldSkipUrl(url)) return;
    if (!isCapturableUrl(url)) return;
    if (entries.has(url)) return;
    const status = response.status();
    if (status < 200 || status >= 400) return;
    const contentType = response.headers()["content-type"] ?? "";
    if (SKIP_CONTENT_TYPES.test(contentType) && contentType.includes("event-stream")) return;
    try {
      const body = Buffer.from(await response.body());
      if (body.length === 0) return;
      entries.set(url, { url, status, contentType, body });
    } catch {
    }
  }
  return {
    entries,
    attach(page) {
      const handler = (response) => {
        void ingest(response);
      };
      handlers.set(page, handler);
      page.on("response", handler);
    },
    detach(page) {
      const handler = handlers.get(page);
      if (handler) {
        page.off("response", handler);
        handlers.delete(page);
      }
    },
    async flush(outDir, baseUrl) {
      const written = [];
      for (const entry of entries.values()) {
        const dest = localPathForUrl(baseUrl, entry.url, outDir);
        await fs14.mkdir(path16.dirname(dest), { recursive: true });
        await fs14.writeFile(dest, entry.body);
        written.push(dest);
      }
      return written;
    }
  };
}

// src/capture/session.ts
var CAPTURE_PAGE_TIMEOUT_MS = 6e4;
var CAPTURE_BOOT_WAIT_MS = 12e3;
function normalizeGameBaseUrl(iframeSrc) {
  const parsed = new URL(iframeSrc);
  if (!parsed.pathname.endsWith("/") && !/\.[a-z0-9]+$/i.test(parsed.pathname)) {
    parsed.pathname = `${parsed.pathname}/`;
  }
  return parsed.href;
}
async function ensureEntryHtml(outDir, baseUrl, vault, page) {
  const entryDest = localPathForUrl(baseUrl, new URL("index.html", baseUrl).href, outDir);
  const indexCandidate = path17.join(outDir, "index.html");
  let html = "";
  try {
    html = await page.content();
  } catch {
    html = "";
  }
  if (!html || html.length < 64) {
    const fromVault = vault.entries.get(baseUrl) ?? vault.entries.get(baseUrl.replace(/\/$/, ""));
    if (fromVault) {
      html = fromVault.body.toString("utf-8");
    }
  }
  if (!html || html.length < 64) {
    for (const entry of vault.entries.values()) {
      try {
        if (new URL(entry.url).origin !== new URL(baseUrl).origin) continue;
      } catch {
        continue;
      }
      const ct = entry.contentType.toLowerCase();
      const looksHtml = ct.includes("text/html") || /\.html?$/i.test(entry.url) || entry.body.subarray(0, 32).toString("utf8").includes("<");
      if (looksHtml && entry.body.length >= 64) {
        html = entry.body.toString("utf-8");
        break;
      }
    }
  }
  if (!html || html.length < 64) {
    throw new Error("Playwright capture finished but no HTML entry was captured");
  }
  await fs15.mkdir(path17.dirname(entryDest), { recursive: true });
  await fs15.writeFile(entryDest, html, "utf-8");
  if (path17.resolve(entryDest) !== path17.resolve(indexCandidate)) {
    await fs15.mkdir(outDir, { recursive: true });
    await fs15.writeFile(indexCandidate, html, "utf-8");
    return "index.html";
  }
  return relativePathForUrl(baseUrl, new URL("index.html", baseUrl).href, outDir) || "index.html";
}
async function captureGameWithPlaywright(options) {
  const {
    outDir,
    gameUrl,
    signal,
    onProgress,
    bootWaitMs = CAPTURE_BOOT_WAIT_MS,
    pageTimeoutMs = CAPTURE_PAGE_TIMEOUT_MS
  } = options;
  const notes = [];
  const baseUrl = normalizeGameBaseUrl(gameUrl);
  throwIfCancelled(signal);
  onProgress?.(20, `Launching browser for ${baseUrl}\u2026`);
  let browser = null;
  const vault = createNetworkVault();
  try {
    browser = await chromium3.launch({ headless: true });
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });
    const page = await context.newPage();
    vault.attach(page);
    const onAbort = () => {
      void context.close().catch(() => {
      });
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    throwIfCancelled(signal);
    onProgress?.(28, "Loading game host\u2026");
    await page.goto(baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: pageTimeoutMs
    });
    const fileUrl = await findEmbedFileUrl2(page);
    if (fileUrl) {
      notes.push(`embed FILE_URL=${fileUrl}`);
      onProgress?.(32, "Fetching embed FILE_URL wrapper\u2026");
      const wrapperHtml = await page.evaluate(async (url) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`FILE_URL fetch failed: HTTP ${res.status}`);
        return res.text();
      }, fileUrl);
      await page.goto("about:blank");
      await page.setContent(
        `<!DOCTYPE html><html><body style="margin:0"><iframe id="fr" style="width:100vw;height:100vh;border:none"></iframe></body></html>`
      );
      await page.evaluate((html) => {
        const iframe = document.getElementById("fr");
        iframe.contentDocument?.open();
        iframe.contentDocument?.write(html);
        iframe.contentDocument?.close();
      }, wrapperHtml);
    }
    onProgress?.(40, "Waiting for game shell / network\u2026");
    await waitForGameShell(page, Math.min(bootWaitMs, pageTimeoutMs));
    await page.waitForTimeout(Math.min(bootWaitMs, 8e3));
    const nested = await listNestedIframeSrcs(page);
    for (const src of nested) {
      if (src === baseUrl || src.startsWith(baseUrl)) continue;
      notes.push(`nested iframe ${src}`);
      try {
        throwIfCancelled(signal);
        onProgress?.(45, `Following nested iframe\u2026`);
        const nestedPage = await context.newPage();
        vault.attach(nestedPage);
        await nestedPage.goto(src, {
          waitUntil: "domcontentloaded",
          timeout: pageTimeoutMs
        });
        await waitForGameShell(nestedPage, Math.min(bootWaitMs, 1e4));
        await nestedPage.waitForTimeout(3e3);
        vault.detach(nestedPage);
        await nestedPage.close();
      } catch (err) {
        if (err instanceof DownloadCancelledError) throw err;
        notes.push(`nested iframe failed: ${src}`);
      }
    }
    throwIfCancelled(signal);
    onProgress?.(50, `Saving ${vault.entries.size} captured response(s)\u2026`);
    await fs15.mkdir(outDir, { recursive: true });
    await vault.flush(outDir, baseUrl);
    const entryRel = await ensureEntryHtml(outDir, baseUrl, vault, page);
    vault.detach(page);
    signal?.removeEventListener("abort", onAbort);
    await context.close();
    return {
      baseUrl,
      entryRel,
      capturedUrls: [...vault.entries.keys()],
      ok: true,
      notes
    };
  } finally {
    await browser?.close().catch(() => {
    });
  }
}

// src/unity/post-process-offline.ts
init_scan_assets();
import fs16 from "node:fs/promises";
import { existsSync as existsSync6 } from "node:fs";
import path18 from "node:path";
async function listBuildFiles(outDir) {
  const buildDir = path18.join(outDir, "Build");
  if (!existsSync6(buildDir)) return [];
  const entries = await fs16.readdir(buildDir);
  return entries.map((f) => path18.posix.join("Build", f));
}
async function discoverExternalUnityAssets(outDir, indexHtml) {
  const urls = new Set(scanContentForMediaUrls(indexHtml));
  const product = inferBuildProductName(indexHtml);
  const toScan = await listBuildFiles(outDir);
  if (product) {
    for (const suffix of [".framework.js", ".loader.js", ".data", ".wasm", ".data.br", ".wasm.br"]) {
      toScan.push(path18.posix.join("Build", `${product}${suffix}`));
    }
  }
  for (const rel of toScan) {
    const filePath = path18.join(outDir, rel);
    if (!existsSync6(filePath)) continue;
    try {
      const buf = await fs16.readFile(filePath);
      if (buf.length > 16 * 1024 * 1024) continue;
      for (const url of scanContentForMediaUrls(buf.toString("latin1"))) {
        urls.add(url);
      }
    } catch {
    }
  }
  return [...urls].sort();
}
async function postProcessUnityOfflineMirror(outDir, baseUrl, entryRel = "index.html") {
  const entryPath = path18.join(outDir, entryRel);
  const entryHtml = await fs16.readFile(entryPath, "utf-8");
  if (!isUnityGameHtml(entryHtml)) {
    return { assetRoutes: {}, externalCount: 0 };
  }
  const externalUrls = await discoverExternalUnityAssets(outDir, entryHtml);
  const assetRoutes = buildAssetRouteMap(externalUrls);
  if (externalUrls.length > 0) {
    await fs16.writeFile(
      path18.join(outDir, "asset-map.json"),
      JSON.stringify(assetRoutes, null, 2)
    );
  }
  const patched = injectUnityPatches(entryHtml, assetRoutes);
  await fs16.writeFile(entryPath, patched);
  console.log(
    `[unity] Post-processed ${path18.basename(outDir)} \u2014 ${externalUrls.length} external route(s), product=${inferBuildProductName(entryHtml) ?? "unknown"}`
  );
  return { assetRoutes, externalCount: externalUrls.length };
}

// src/strategies/generic.ts
function normalizeGameBaseUrl2(iframeSrc) {
  const parsed = new URL(iframeSrc);
  if (!parsed.pathname.endsWith("/") && !/\.[a-z0-9]+$/i.test(parsed.pathname)) {
    parsed.pathname = `${parsed.pathname}/`;
  }
  return parsed.href;
}
async function findGameContentRoot(mirrorDir) {
  async function walk(dir) {
    if (existsSync7(path19.join(dir, "Build")) || existsSync7(path19.join(dir, "TemplateData"))) {
      return dir;
    }
    const entries = await fs17.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const found = await walk(path19.join(dir, e.name));
      if (found) return found;
    }
    return null;
  }
  return walk(mirrorDir);
}
async function promoteGameRootToOfflineDir(mirrorDir, iframeSrc) {
  const entryPath = await resolveMirroredEntryHtml(mirrorDir, iframeSrc);
  const contentRoot = await findGameContentRoot(mirrorDir) ?? path19.dirname(entryPath);
  const staging = path19.join(path19.dirname(mirrorDir), `${path19.basename(mirrorDir)}.__staging__`);
  await fs17.rm(staging, { recursive: true, force: true });
  await fs17.mkdir(staging, { recursive: true });
  await fs17.cp(contentRoot, staging, { recursive: true });
  const entryName = path19.basename(entryPath);
  const stagedEntry = path19.join(staging, entryName);
  if (!existsSync7(stagedEntry)) {
    await fs17.rm(staging, { recursive: true, force: true });
    throw new Error(`Could not prepare offline entry (${entryName})`);
  }
  const entryRel = path19.relative(staging, stagedEntry).split(path19.sep).join("/");
  await fs17.rm(mirrorDir, { recursive: true, force: true });
  await fs17.rename(staging, mirrorDir);
  const baseUrl = normalizeGameBaseUrl2(iframeSrc);
  await writeOfflineManifest(mirrorDir, { entry: entryRel, mirroredFrom: iframeSrc });
  return { baseUrl, entryRel };
}
function wgetExitMessage(code) {
  if (code === 5) {
    return "wget mirror failed: SSL certificate could not be verified (exit 5). The game host uses an invalid or expired certificate.";
  }
  if (code === 4) {
    return "wget mirror failed: network failure (exit 4). Check your connection and try again.";
  }
  return `wget mirror failed with exit code ${code}`;
}
function isWgetFailure(code) {
  return code !== 0 && code !== 8;
}
async function runWget(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("wget", args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}
async function hasUnityLoaderOnDisk(outDir) {
  const roots = [outDir, path19.join(outDir, "Build")];
  for (const root of roots) {
    if (!existsSync7(root)) continue;
    try {
      const entries = await fs17.readdir(root);
      if (entries.some((name) => /^UnityLoader(?:\.[0-9.]+)?\.js$/i.test(name))) {
        return true;
      }
    } catch {
    }
  }
  return false;
}
async function ensureLegacyUnityLoader(outDir, baseUrl, indexHtml, signal) {
  if (!requiresLegacyUnityLoaderFile(indexHtml)) return;
  if (await hasUnityLoaderOnDisk(outDir)) return;
  const candidates = unityLoaderCandidateUrls(indexHtml, baseUrl);
  if (candidates.length === 0) return;
  const tasks = candidates.map((url) => ({
    url,
    destPath: localPathForUrl(baseUrl, url, outDir)
  }));
  await downloadFilesParallel(tasks, { signal });
}
async function validateRequiredAssets(outDir, baseUrl, indexHtml) {
  const missing = [];
  if (isUnityShell(indexHtml)) {
    const buildJsonRel = findUnityLoaderBuildJson(indexHtml);
    if (buildJsonRel && !buildJsonRel.startsWith("blob:")) {
      const buildJsonUrl = new URL(buildJsonRel, baseUrl).href;
      const buildJsonPath = localPathForUrl(baseUrl, buildJsonUrl, outDir);
      if (!existsSync7(buildJsonPath)) {
        missing.push(buildJsonPath);
      } else {
        try {
          const buildMeta = JSON.parse(await fs17.readFile(buildJsonPath, "utf-8"));
          for (const assetUrl of expandBuildManifest(buildMeta, buildJsonUrl)) {
            const assetPath = localPathForUrl(baseUrl, assetUrl, outDir);
            if (!existsSync7(assetPath)) missing.push(assetPath);
          }
        } catch {
          missing.push(buildJsonPath);
        }
      }
    }
    if (requiresLegacyUnityLoaderFile(indexHtml) && !await hasUnityLoaderOnDisk(outDir)) {
      missing.push(path19.join(outDir, "Build/UnityLoader.js"));
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing required offline assets: ${missing.slice(0, 5).join(", ")}`);
  }
}
async function discoverAndDownloadAssets(outDir, baseUrl, entryRel, onProgress, signal) {
  throwIfCancelled(signal);
  onProgress(55, "Discovering all asset URLs\u2026");
  const urls = await discoverAllAssetUrls(
    { outDir, baseUrl, entryRel, unityOptimized: true },
    localPathForUrl
  );
  throwIfCancelled(signal);
  const tasks = [...urls].map((url) => ({
    url,
    destPath: localPathForUrl(baseUrl, url, outDir)
  }));
  onProgress(65, `Downloading ${tasks.length} asset(s) in parallel\u2026`);
  let lastPct = 65;
  await downloadFilesParallel(tasks, {
    signal,
    onProgress: (done, total) => {
      const pct = 65 + Math.min(25, Math.floor(done / Math.max(total, 1) * 25));
      if (pct > lastPct) {
        lastPct = pct;
        onProgress(pct, `Downloaded ${done}/${total} asset(s)\u2026`);
      }
    }
  });
  throwIfCancelled(signal);
  onProgress(90, "Ensuring Unity loader assets\u2026");
  const entryHtml = await fs17.readFile(path19.join(outDir, entryRel), "utf-8");
  await ensureLegacyUnityLoader(outDir, baseUrl, entryHtml, signal);
  throwIfCancelled(signal);
  onProgress(92, "Verifying Unity / required assets\u2026");
  await validateRequiredAssets(outDir, baseUrl, entryHtml);
}
async function mirrorWithWget(out, mirrorUrl, iframeSrc, onProgress, signal) {
  onProgress(15, `wget fallback: mirroring ${mirrorUrl}\u2026`);
  const wgetArgs = [
    "--mirror",
    "--convert-links",
    "--adjust-extension",
    "--no-parent",
    "--page-requisites",
    "--directory-prefix",
    out,
    "-e",
    "robots=off",
    ...wgetCommonArgs(),
    "--tries=3",
    "--timeout=120",
    mirrorUrl
  ];
  const code = await runWget(wgetArgs);
  throwIfCancelled(signal);
  onProgress(50, "Preparing offline layout\u2026");
  let baseUrl;
  let entryRel;
  try {
    ({ baseUrl, entryRel } = await promoteGameRootToOfflineDir(out, iframeSrc));
  } catch (error) {
    if (isWgetFailure(code)) {
      throw new Error(wgetExitMessage(code));
    }
    throw error;
  }
  if (isWgetFailure(code)) {
    throw new Error(wgetExitMessage(code));
  }
  const entryPath = path19.join(out, entryRel);
  if (!existsSync7(entryPath)) {
    throw new Error(`Mirror completed but entry HTML missing: ${entryRel}`);
  }
  return { baseUrl, entryRel };
}
async function pullGenericGame(gameId, onProgress, signal) {
  const onlineIndex = path19.join(catalogOnlineDir(gameId), "index.html");
  const out = offlineDir(gameId);
  throwIfCancelled(signal);
  onProgress(5, "Reading online shell\u2026");
  const html = await fs17.readFile(onlineIndex, "utf-8");
  const iframeSrc = extractIframeSrc(html);
  if (!iframeSrc) {
    onProgress(20, "No iframe \u2014 copying online shell to offline\u2026");
    await fs17.rm(out, { recursive: true, force: true });
    await fs17.cp(catalogOnlineDir(gameId), out, { recursive: true });
    await writeOfflineManifest(out, { entry: "index.html" });
    await postProcessGenericOfflineMirror(out, "index.html");
    onProgress(100, "Copied online shell");
    return;
  }
  const mirrorUrl = normalizeGameBaseUrl2(iframeSrc);
  const existingCache = await readDownloadCache(gameId);
  if (!existingCache) {
    await fs17.rm(out, { recursive: true, force: true });
  }
  await fs17.mkdir(out, { recursive: true });
  let baseUrl;
  let entryRel;
  let usedPlaywright = false;
  try {
    onProgress(12, "Full scrape via Playwright\u2026");
    const capture = await captureGameWithPlaywright({
      outDir: out,
      gameUrl: iframeSrc,
      signal,
      onProgress
    });
    usedPlaywright = capture.ok;
    baseUrl = capture.baseUrl;
    entryRel = capture.entryRel;
    try {
      const promoted = await promoteGameRootToOfflineDir(out, iframeSrc);
      baseUrl = promoted.baseUrl;
      entryRel = promoted.entryRel;
    } catch {
      await writeOfflineManifest(out, {
        entry: entryRel,
        mirroredFrom: iframeSrc
      });
    }
    if (capture.notes.length > 0) {
      console.log(`[generic] capture notes: ${capture.notes.join("; ")}`);
    }
  } catch (error) {
    if (error instanceof DownloadCancelledError) throw error;
    console.warn(
      `[generic] Playwright capture failed, falling back to wget:`,
      error instanceof Error ? error.message : error
    );
    onProgress(14, "Playwright unavailable \u2014 using wget\u2026");
    await fs17.rm(out, { recursive: true, force: true });
    await fs17.mkdir(out, { recursive: true });
    ({ baseUrl, entryRel } = await mirrorWithWget(out, mirrorUrl, iframeSrc, onProgress, signal));
  }
  await discoverAndDownloadAssets(out, baseUrl, entryRel, onProgress, signal);
  const entryHtml = await fs17.readFile(path19.join(out, entryRel), "utf-8");
  if (isUnityShell(entryHtml)) {
    throwIfCancelled(signal);
    onProgress(95, "Injecting Unity patches & asset routes\u2026");
    await postProcessUnityOfflineMirror(out, baseUrl, entryRel);
    await postProcessGenericOfflineMirror(out, entryRel);
  } else {
    throwIfCancelled(signal);
    onProgress(95, "Patching offline SDK & stripping ads\u2026");
    await postProcessGenericOfflineMirror(out, entryRel);
  }
  onProgress(
    100,
    usedPlaywright ? "Download complete (Playwright full scrape)" : "Download complete (wget fallback)"
  );
}

// src/offline-thumbnail.ts
init_config();
import fs18 from "node:fs/promises";
import { createWriteStream, existsSync as existsSync8 } from "node:fs";
import path20 from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
function extensionFromUrlOrType(url, contentType) {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "image/jpeg" || type === "image/jpg") return ".jpg";
  if (type === "image/png") return ".png";
  if (type === "image/webp") return ".webp";
  if (type === "image/gif") return ".gif";
  if (type === "image/svg+xml") return ".svg";
  try {
    const pathname = new URL(url).pathname;
    const m = pathname.match(/\.(jpe?g|png|webp|gif|svg)$/i);
    if (m) return `.${m[1].toLowerCase().replace("jpeg", "jpg")}`;
  } catch {
  }
  return ".jpg";
}
async function patchManifestThumbnail(offlineRoot, thumbnailRel, entry) {
  const prev = await readOfflineManifestFromDir(offlineRoot);
  await writeOfflineManifest(offlineRoot, {
    entry: prev?.entry ?? entry,
    mirroredFrom: prev?.mirroredFrom,
    thumbnail: thumbnailRel
  });
}
async function ensureOfflineThumbnail(gameId) {
  const meta = await readGameMetadata(gameId);
  const thumb = typeof meta?.thumbnail === "string" ? meta.thumbnail.trim() : "";
  if (!thumb) return null;
  const outRoot = offlineDir(gameId);
  await fs18.mkdir(outRoot, { recursive: true });
  const existing = await readOfflineManifestFromDir(outRoot);
  if (existing?.thumbnail) {
    const abs = path20.join(outRoot, existing.thumbnail);
    if (existsSync8(abs)) return existing.thumbnail;
  }
  if (thumb.startsWith("/")) {
    const relFromGames = thumb.replace(/^\/games\//, "");
    const candidates = [
      path20.join(CATALOG_DIR, relFromGames),
      path20.join(outRoot, "..", "online", "assets", path20.basename(thumb))
    ];
    for (const src of candidates) {
      try {
        const st = await fs18.stat(src);
        if (!st.isFile() || st.size < 32) continue;
        const ext = path20.extname(src) || ".png";
        const rel = `assets/thumbnail${ext}`;
        const dest = path20.join(outRoot, rel);
        await fs18.mkdir(path20.dirname(dest), { recursive: true });
        await fs18.copyFile(src, dest);
        await patchManifestThumbnail(outRoot, rel, existing?.entry ?? "index.html");
        return rel;
      } catch {
      }
    }
    return null;
  }
  if (!/^https?:\/\//i.test(thumb)) return null;
  try {
    const res = await fetch(thumb, {
      headers: { "User-Agent": UA, Accept: "image/*,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(6e4)
    });
    if (!res.ok || !res.body) return null;
    const ext = extensionFromUrlOrType(thumb, res.headers.get("content-type"));
    const rel = `assets/thumbnail${ext}`;
    const dest = path20.join(outRoot, rel);
    await fs18.mkdir(path20.dirname(dest), { recursive: true });
    await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
    await patchManifestThumbnail(outRoot, rel, existing?.entry ?? "index.html");
    return rel;
  } catch {
    return null;
  }
}
async function readOfflineThumbnailRel(gameId) {
  const outRoot = offlineDir(gameId);
  const manifest = await readOfflineManifestFromDir(outRoot);
  if (manifest?.thumbnail) {
    const abs = path20.join(outRoot, manifest.thumbnail);
    if (existsSync8(abs)) return manifest.thumbnail;
  }
  for (const name of [
    "assets/thumbnail.jpg",
    "assets/thumbnail.jpeg",
    "assets/thumbnail.png",
    "assets/thumbnail.webp",
    "assets/thumbnail.gif"
  ]) {
    if (existsSync8(path20.join(outRoot, name))) return name;
  }
  return null;
}

// src/download-manager.ts
var cancelDiscardCache = /* @__PURE__ */ new Map();
async function getGameStatus(gameId) {
  const partialCache = await hasPartialDownloadCache(gameId);
  const cache = partialCache ? await countOfflineFiles(gameId) : 0;
  const offline = await hasOfflineMirror(gameId);
  const offlineThumbnail = offline ? await readOfflineThumbnailRel(gameId) ?? void 0 : void 0;
  return {
    online: await hasOnlineShell(gameId),
    offline,
    downloading: isGameDownloading(gameId),
    partialCache: partialCache && !offline,
    cacheFileCount: cache > 0 ? cache : void 0,
    offlineThumbnail
  };
}
async function listOfflineActivityIds() {
  const ids = new Set(listDownloadingGameIds());
  const roots = /* @__PURE__ */ new Set([GAMES_DATA_DIR, CATALOG_DIR]);
  for (const root of roots) {
    try {
      const entries = await fs19.readdir(root, { withFileTypes: true });
      await Promise.all(
        entries.map(async (entry) => {
          if (!entry.isDirectory() || entry.name.startsWith("_") || !isValidGameId(entry.name)) {
            return;
          }
          try {
            const st = await fs19.stat(path21.join(root, entry.name, "offline"));
            if (st.isDirectory()) ids.add(entry.name);
          } catch {
          }
        })
      );
    } catch {
    }
  }
  return [...ids];
}
async function getDownloadedGameStatuses() {
  const ids = await listOfflineActivityIds();
  const result = {};
  await Promise.all(
    ids.map(async (id) => {
      result[id] = await getGameStatus(id);
    })
  );
  return result;
}
async function getGameStatusesForIds(gameIds) {
  const result = {};
  const unique = [...new Set(gameIds.filter((id) => isValidGameId(id)))];
  await Promise.all(
    unique.map(async (id) => {
      result[id] = await getGameStatus(id);
    })
  );
  return result;
}
async function deleteOfflineGame(gameId) {
  if (!isValidGameId(gameId)) throw new Error("Invalid game id");
  if (!await isGameInCatalog(gameId)) throw new Error("Game not in catalog");
  if (isGameDownloading(gameId)) {
    throw new Error("Cannot delete while download is in progress");
  }
  await fs19.rm(offlineDir(gameId), { recursive: true, force: true });
  invalidateCatalogCache();
}
async function startDownload(gameId) {
  if (!isValidGameId(gameId)) throw new Error("Invalid game id");
  if (!await isGameInCatalog(gameId)) throw new Error("Game not in catalog");
  if (!await hasOnlineShell(gameId)) {
    throw new Error("Game has no online shell to pull from");
  }
  const existing = getActiveJobForGame(gameId);
  if (existing && (existing.state === "pending" || existing.state === "running")) {
    return { started: false, message: "Download already in progress" };
  }
  cancelDiscardCache.delete(gameId);
  const job = createJob(gameId);
  const signal = beginDownloadAbort(gameId);
  void runDownloadJob(gameId, job, signal);
  return { started: true, message: "Download started" };
}
async function cancelDownload(gameId, discardCache) {
  if (!isValidGameId(gameId)) throw new Error("Invalid game id");
  const job = getActiveJobForGame(gameId);
  if (!job || job.state !== "pending" && job.state !== "running") {
    return { cancelled: false, message: "No active download" };
  }
  cancelDiscardCache.set(gameId, discardCache);
  cancelDownloadAbort(gameId);
  return { cancelled: true, message: discardCache ? "Cancelling and discarding\u2026" : "Cancelling\u2026" };
}
async function runDownloadJob(gameId, job, signal) {
  const reporter = (progress, message) => {
    if (signal.aborted) return;
    updateJob(gameId, { state: "running", progress, message });
  };
  updateJob(gameId, { state: "running", progress: 0, message: "Starting\u2026" });
  try {
    const strategy = await getPullStrategy(gameId);
    if (strategy === "embed") {
      await pullEmbedGame(gameId, reporter, signal);
    } else {
      await pullGenericGame(gameId, reporter, signal);
    }
    if (signal.aborted) throw new DownloadCancelledError();
    reporter(96, "Caching cover thumbnail\u2026");
    await ensureOfflineThumbnail(gameId);
    await clearDownloadCache(gameId);
    updateJob(gameId, {
      state: "done",
      progress: 100,
      message: "Complete",
      finishedAt: Date.now()
    });
    invalidateCatalogCache();
  } catch (error) {
    const discardCache = cancelDiscardCache.get(gameId) ?? true;
    cancelDiscardCache.delete(gameId);
    if (error instanceof DownloadCancelledError || signal.aborted) {
      const fileCount = await countOfflineFiles(gameId);
      if (discardCache) {
        try {
          await fs19.rm(offlineDir(gameId), { recursive: true, force: true });
        } catch {
        }
      } else if (fileCount > 0) {
        await writeDownloadCache(gameId, {
          cachedAt: Date.now(),
          fileCount,
          message: "Partial download saved for resume"
        });
      }
      updateJob(gameId, {
        state: "cancelled",
        progress: 0,
        message: discardCache ? "Cancelled \u2014 cache discarded" : "Cancelled \u2014 partial cache kept",
        finishedAt: Date.now()
      });
      invalidateCatalogCache();
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    updateJob(gameId, {
      state: "error",
      progress: 0,
      message: "Failed",
      error: message,
      finishedAt: Date.now()
    });
    try {
      await fs19.rm(offlineDir(gameId), { recursive: true, force: true });
    } catch {
    }
  } finally {
    clearDownloadAbort(gameId);
  }
}

// src/game-storage-bridge-script.ts
var cachedBridge = null;
function loadBridgeSource() {
  if (cachedBridge) return cachedBridge;
  cachedBridge = GAME_STORAGE_BRIDGE_SOURCE;
  return cachedBridge;
}
function buildInlineGameStorageBridgeScript() {
  const source = loadBridgeSource();
  return `<script>${source}</script>`;
}
function injectGameStorageBridge(html, _gameId, childScriptSrc) {
  const tag = childScriptSrc ? `<script src="${childScriptSrc}"></script>` : buildInlineGameStorageBridgeScript();
  if (html.includes("</head>")) {
    return html.replace("</head>", tag + "</head>");
  }
  if (html.includes("<body")) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${tag}`);
  }
  return tag + html;
}

// src/unity/proxy-play.ts
import fs20 from "node:fs/promises";
import { existsSync as existsSync9 } from "node:fs";
import path22 from "node:path";
init_config();
function extractIframeSrc2(html) {
  const patterns = [/<iframe[^>]+src=["']([^"']+)["']/i];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const src = m[1].replace(/&amp;/g, "&").trim();
      if (src.startsWith("http")) return src;
    }
  }
  return null;
}
async function resolveUnityPlayUrl(gameId) {
  const meta = await readGameMetadata(gameId);
  const embed = typeof meta?.onlineEmbedUrl === "string" ? meta.onlineEmbedUrl.trim() : "";
  if (embed) return embed;
  const indexPath = path22.join(catalogOnlineDir(gameId), "index.html");
  if (!existsSync9(indexPath)) return null;
  const html = await fs20.readFile(indexPath, "utf-8");
  return extractIframeSrc2(html);
}
async function fetchProxiedUnityHtml(gameId) {
  const targetUrl = await resolveUnityPlayUrl(gameId);
  if (!targetUrl) return null;
  const res = await fetch(targetUrl, {
    headers: {
      "User-Agent": WGET_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,*/*"
    },
    signal: AbortSignal.timeout(6e4)
  });
  if (!res.ok) return null;
  let html = await res.text();
  html = injectUnityPatches(html);
  const base = new URL(targetUrl);
  html = html.replace(
    /(src|href)=["'](?!https?:|\/\/|data:|blob:|#)([^"']+)["']/gi,
    (_m, attr, rel) => `${attr}="${new URL(rel, base).href}"`
  );
  return html;
}

// src/browser-data.ts
import fs21 from "node:fs/promises";
import path23 from "node:path";
import { existsSync as existsSync10 } from "node:fs";

// src/browser-data-profile.ts
var BROWSER_PROFILE_SCHEMA_VERSION = 1;
function emptyGameBrowserProfile() {
  return {
    schemaVersion: BROWSER_PROFILE_SCHEMA_VERSION,
    updatedAt: 0,
    profile: {
      Default: {
        localStorage: {},
        sessionStorage: {},
        cookies: [],
        indexedDB: []
      }
    }
  };
}
function isGameBrowserProfile(value) {
  if (!value || typeof value !== "object") return false;
  const v = value;
  return typeof v.schemaVersion === "number" && typeof v.updatedAt === "number" && v.profile?.Default != null && typeof v.profile.Default.localStorage === "object" && typeof v.profile.Default.sessionStorage === "object" && Array.isArray(v.profile.Default.cookies) && Array.isArray(v.profile.Default.indexedDB);
}
var PROFILE_DISK_PATHS = {
  meta: "meta.json",
  localStorage: "profile/Default/localStorage.json",
  sessionStorage: "profile/Default/sessionStorage.json",
  cookies: "profile/Default/cookies.json",
  indexedDbDir: "profile/Default/indexeddb"
};

// src/browser-data.ts
function browserDataDir(gameId) {
  return path23.join(gameDataRoot(gameId), "data");
}
function dataFilePath(gameId, rel) {
  return path23.join(browserDataDir(gameId), rel);
}
function assertDataPath(gameId, absPath) {
  const root = path23.resolve(browserDataDir(gameId));
  const resolved = path23.resolve(absPath);
  if (!resolved.startsWith(root + path23.sep) && resolved !== root) {
    throw new Error("Path traversal rejected");
  }
}
async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs21.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
async function writeJsonAtomic(filePath, data) {
  const dir = path23.dirname(filePath);
  await fs21.mkdir(dir, { recursive: true });
  const tmp = filePath + ".tmp";
  await fs21.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs21.rename(tmp, filePath);
}
async function loadIndexedDbProfiles(gameId) {
  const idbRoot = dataFilePath(gameId, PROFILE_DISK_PATHS.indexedDbDir);
  if (!existsSync10(idbRoot)) return [];
  const entries = await fs21.readdir(idbRoot, { withFileTypes: true });
  const profiles = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dbDir = path23.join(idbRoot, entry.name);
    const metaPath = path23.join(dbDir, "meta.json");
    const recordsPath = path23.join(dbDir, "records.json");
    try {
      const meta = await readJsonFile(
        metaPath,
        { name: entry.name, version: 1, objectStores: [] }
      );
      const records = await readJsonFile(recordsPath, []);
      profiles.push({
        name: meta.name ?? entry.name,
        version: meta.version ?? 1,
        objectStores: meta.objectStores ?? [],
        records: Array.isArray(records) ? records : []
      });
    } catch {
    }
  }
  return profiles;
}
async function saveIndexedDbProfiles(gameId, databases) {
  const idbRoot = dataFilePath(gameId, PROFILE_DISK_PATHS.indexedDbDir);
  await fs21.mkdir(idbRoot, { recursive: true });
  const existing = existsSync10(idbRoot) ? await fs21.readdir(idbRoot, { withFileTypes: true }) : [];
  for (const entry of existing) {
    if (entry.isDirectory()) {
      await fs21.rm(path23.join(idbRoot, entry.name), { recursive: true, force: true });
    }
  }
  for (const db of databases) {
    const safeName = db.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const dbDir = path23.join(idbRoot, safeName);
    assertDataPath(gameId, dbDir);
    await fs21.mkdir(dbDir, { recursive: true });
    await writeJsonAtomic(path23.join(dbDir, "meta.json"), {
      name: db.name,
      version: db.version,
      objectStores: db.objectStores
    });
    await writeJsonAtomic(path23.join(dbDir, "records.json"), db.records);
  }
}
async function readGameBrowserProfile(gameId) {
  const root = browserDataDir(gameId);
  const metaPath = dataFilePath(gameId, PROFILE_DISK_PATHS.meta);
  if (!existsSync10(root) && !existsSync10(metaPath)) {
    return null;
  }
  const profile = emptyGameBrowserProfile();
  const meta = await readJsonFile(
    metaPath,
    null
  );
  if (meta) {
    profile.schemaVersion = meta.schemaVersion ?? BROWSER_PROFILE_SCHEMA_VERSION;
    profile.updatedAt = meta.updatedAt ?? 0;
  }
  profile.profile.Default.localStorage = await readJsonFile(
    dataFilePath(gameId, PROFILE_DISK_PATHS.localStorage),
    {}
  );
  profile.profile.Default.sessionStorage = await readJsonFile(
    dataFilePath(gameId, PROFILE_DISK_PATHS.sessionStorage),
    {}
  );
  profile.profile.Default.cookies = await readJsonFile(
    dataFilePath(gameId, PROFILE_DISK_PATHS.cookies),
    []
  );
  profile.profile.Default.indexedDB = await loadIndexedDbProfiles(gameId);
  const hasData = profile.updatedAt > 0 || Object.keys(profile.profile.Default.localStorage).length > 0 || Object.keys(profile.profile.Default.sessionStorage).length > 0 || profile.profile.Default.cookies.length > 0 || profile.profile.Default.indexedDB.length > 0;
  return hasData ? profile : null;
}
async function writeGameBrowserProfile(gameId, input) {
  if (!isGameBrowserProfile(input)) {
    throw new Error("Invalid browser profile payload");
  }
  const root = browserDataDir(gameId);
  assertDataPath(gameId, root);
  await fs21.mkdir(root, { recursive: true });
  const updatedAt = Date.now();
  const profile = {
    ...input,
    schemaVersion: BROWSER_PROFILE_SCHEMA_VERSION,
    updatedAt
  };
  await writeJsonAtomic(dataFilePath(gameId, PROFILE_DISK_PATHS.meta), {
    schemaVersion: profile.schemaVersion,
    updatedAt: profile.updatedAt
  });
  await writeJsonAtomic(
    dataFilePath(gameId, PROFILE_DISK_PATHS.localStorage),
    profile.profile.Default.localStorage
  );
  await writeJsonAtomic(
    dataFilePath(gameId, PROFILE_DISK_PATHS.sessionStorage),
    profile.profile.Default.sessionStorage
  );
  await writeJsonAtomic(dataFilePath(gameId, PROFILE_DISK_PATHS.cookies), profile.profile.Default.cookies);
  await saveIndexedDbProfiles(gameId, profile.profile.Default.indexedDB);
}
async function deleteGameBrowserProfile(gameId) {
  const root = browserDataDir(gameId);
  if (!existsSync10(root)) return;
  assertDataPath(gameId, root);
  await fs21.rm(root, { recursive: true, force: true });
}

// src/server.ts
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Access-Control-Request-Private-Network",
    "Access-Control-Allow-Private-Network": "true"
  });
  res.end(payload);
}
function mimeFor(filePath) {
  const ext = path24.extname(filePath).toLowerCase();
  const map = {
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".wasm": "application/wasm",
    ".unityweb": "application/octet-stream",
    ".data": "application/octet-stream",
    ".br": "application/octet-stream",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
  };
  return map[ext] ?? "application/octet-stream";
}
async function serveStaticGames(req, res, urlPath) {
  const prefix = "/games/";
  if (!urlPath.startsWith(prefix)) return false;
  const rel = decodeURIComponent(urlPath.slice(prefix.length));
  const parts = rel.split("/").filter(Boolean);
  if (parts.length === 0) {
    sendJson(res, 404, { error: "Not found" });
    return true;
  }
  const gameId = parts[0];
  if (!isValidGameId(gameId)) {
    sendJson(res, 400, { error: "Invalid game id" });
    return true;
  }
  if (!await isGameInCatalog(gameId)) {
    sendJson(res, 404, { error: "Game not in catalog" });
    return true;
  }
  const fileRel = parts.slice(1).join("/");
  if (!fileRel.startsWith("offline/")) {
    sendJson(res, 403, { error: "Only offline files are served" });
    return true;
  }
  const offlineRel = fileRel.slice("offline/".length);
  const absPath = resolveOfflineFilePath(gameId, offlineRel);
  if (!absPath) {
    sendJson(res, 403, { error: "Forbidden" });
    return true;
  }
  if (!existsSync11(absPath)) {
    sendJson(res, 404, { error: "Not found" });
    return true;
  }
  let st;
  try {
    st = await fs22.stat(absPath);
  } catch {
    sendJson(res, 404, { error: "Not found" });
    return true;
  }
  if (!st.isFile()) {
    sendJson(res, 404, { error: "Not found" });
    return true;
  }
  const isHtml = /\.html?$/i.test(absPath);
  res.writeHead(200, {
    "Content-Type": mimeFor(absPath),
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Private-Network": "true",
    "Cache-Control": "public, max-age=3600"
  });
  if (isHtml) {
    let raw = await fs22.readFile(absPath, "utf-8");
    if (isUnityGameHtml(raw)) {
      raw = injectUnityPatches(raw);
    }
    res.end(injectGameStorageBridge(raw, gameId));
    return true;
  }
  const stream = createReadStream(absPath);
  stream.on("error", (err) => {
    console.error("[puller] read error", absPath, err.message);
    if (!res.headersSent) {
      sendJson(res, 500, { error: "Read failed" });
    } else {
      res.destroy(err);
    }
  });
  stream.pipe(res);
  return true;
}
function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    const pathname = url.pathname;
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": CORS_ORIGIN,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Access-Control-Request-Private-Network",
        "Access-Control-Allow-Private-Network": "true"
      });
      res.end();
      return;
    }
    try {
      if (pathname === "/api/offline/health" && req.method === "GET") {
        const catalogIds = await loadGameIds();
        sendJson(res, 200, {
          ok: true,
          dataDir: GAMES_DATA_DIR,
          catalogDir: CATALOG_DIR,
          catalogGameCount: catalogIds.length
        });
        return;
      }
      if (pathname === "/api/offline/status" && req.method === "GET") {
        const idsParam = url.searchParams.get("ids");
        if (idsParam?.trim()) {
          const ids = idsParam.split(",").map((id) => id.trim()).filter(Boolean);
          const statuses2 = await getGameStatusesForIds(ids);
          sendJson(res, 200, { games: statuses2 });
          return;
        }
        const statuses = await getDownloadedGameStatuses();
        sendJson(res, 200, { games: statuses });
        return;
      }
      const statusMatch = pathname.match(/^\/api\/offline\/status\/([^/]+)$/);
      if (statusMatch && req.method === "GET") {
        const gameId = decodeURIComponent(statusMatch[1]);
        if (!isValidGameId(gameId)) {
          sendJson(res, 400, { error: "Invalid game id" });
          return;
        }
        sendJson(res, 200, await getGameStatus(gameId));
        return;
      }
      const downloadMatch = pathname.match(/^\/api\/offline\/([^/]+)\/download$/);
      if (downloadMatch && req.method === "POST") {
        const gameId = decodeURIComponent(downloadMatch[1]);
        const result = await startDownload(gameId);
        sendJson(res, 202, result);
        return;
      }
      const cancelMatch = pathname.match(/^\/api\/offline\/([^/]+)\/cancel$/);
      if (cancelMatch && req.method === "POST") {
        const gameId = decodeURIComponent(cancelMatch[1]);
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        let discardCache = true;
        if (chunks.length > 0) {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
            discardCache = body.discardCache !== false;
          } catch {
          }
        }
        const result = await cancelDownload(gameId, discardCache);
        sendJson(res, 200, result);
        return;
      }
      const progressMatch = pathname.match(/^\/api\/offline\/([^/]+)\/progress$/);
      if (progressMatch && req.method === "GET") {
        const gameId = decodeURIComponent(progressMatch[1]);
        const job = getProgressJobForGame(gameId);
        if (!job) {
          sendJson(res, 200, { state: "idle", progress: 0, message: "No active job" });
          return;
        }
        sendJson(res, 200, job);
        return;
      }
      const unityPlayMatch = pathname.match(/^\/api\/unity-play\/([^/]+)$/);
      if (unityPlayMatch && req.method === "GET") {
        const gameId = decodeURIComponent(unityPlayMatch[1]);
        if (!isValidGameId(gameId)) {
          sendJson(res, 400, { error: "Invalid game id" });
          return;
        }
        if (!await isGameInCatalog(gameId)) {
          sendJson(res, 404, { error: "Game not in catalog" });
          return;
        }
        const html = await fetchProxiedUnityHtml(gameId);
        if (!html) {
          sendJson(res, 502, { error: "Could not fetch Unity build" });
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Access-Control-Allow-Origin": CORS_ORIGIN,
          "Access-Control-Allow-Private-Network": "true",
          "Cache-Control": "public, max-age=300"
        });
        res.end(injectGameStorageBridge(html, gameId));
        return;
      }
      const deleteMatch = pathname.match(/^\/api\/offline\/([^/]+)$/);
      if (deleteMatch && req.method === "DELETE") {
        const gameId = decodeURIComponent(deleteMatch[1]);
        await deleteOfflineGame(gameId);
        sendJson(res, 200, { deleted: true });
        return;
      }
      const browserDataGetMatch = pathname.match(/^\/api\/browser-data\/([^/]+)$/);
      if (browserDataGetMatch && req.method === "GET") {
        const gameId = decodeURIComponent(browserDataGetMatch[1]);
        if (!isValidGameId(gameId)) {
          sendJson(res, 400, { error: "Invalid game id" });
          return;
        }
        if (!await isGameInCatalog(gameId)) {
          sendJson(res, 404, { error: "Game not in catalog" });
          return;
        }
        const profile = await readGameBrowserProfile(gameId);
        if (!profile) {
          sendJson(res, 404, { error: "No browser data" });
          return;
        }
        sendJson(res, 200, profile);
        return;
      }
      const browserDataPutMatch = pathname.match(/^\/api\/browser-data\/([^/]+)$/);
      if (browserDataPutMatch && req.method === "PUT") {
        const gameId = decodeURIComponent(browserDataPutMatch[1]);
        if (!isValidGameId(gameId)) {
          sendJson(res, 400, { error: "Invalid game id" });
          return;
        }
        if (!await isGameInCatalog(gameId)) {
          sendJson(res, 404, { error: "Game not in catalog" });
          return;
        }
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks).toString("utf-8");
        const parsed = JSON.parse(raw);
        await writeGameBrowserProfile(gameId, parsed);
        sendJson(res, 200, { saved: true });
        return;
      }
      const browserDataDeleteMatch = pathname.match(/^\/api\/browser-data\/([^/]+)$/);
      if (browserDataDeleteMatch && req.method === "DELETE") {
        const gameId = decodeURIComponent(browserDataDeleteMatch[1]);
        if (!isValidGameId(gameId)) {
          sendJson(res, 400, { error: "Invalid game id" });
          return;
        }
        if (!await isGameInCatalog(gameId)) {
          sendJson(res, 404, { error: "Game not in catalog" });
          return;
        }
        await deleteGameBrowserProfile(gameId);
        sendJson(res, 200, { deleted: true });
        return;
      }
      if (await serveStaticGames(req, res, pathname)) {
        return;
      }
      sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { error: message });
    }
  });
}
function startServer() {
  const server = createServer();
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[puller] listening on http://127.0.0.1:${PORT}`);
    console.log(`[puller] games data: ${GAMES_DATA_DIR}`);
  });
  return server;
}

// src/index.ts
await seedBundledOfflineFromCatalog();
startServer();
