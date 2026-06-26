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
import fs18 from "node:fs/promises";
import { createReadStream, existsSync as existsSync10 } from "node:fs";
import path20 from "node:path";

// src/download-manager.ts
import fs15 from "node:fs/promises";

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
function isValidGameId(gameId) {
  if (!GAME_ID_PATTERN.test(gameId)) return false;
  if (gameId.startsWith("_")) return false;
  return !gameId.includes("..") && !gameId.includes("/");
}
async function loadGameIds() {
  if (cachedGameIds) return cachedGameIds;
  const listPath = path3.join(CATALOG_DIR, "games-list.json");
  try {
    const raw = await fs2.readFile(listPath, "utf-8");
    const parsed = JSON.parse(raw);
    cachedGameIds = Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string" && isValidGameId(id)) : [];
  } catch {
    cachedGameIds = await listGameIdsFromDisk(CATALOG_DIR);
  }
  return cachedGameIds;
}
function invalidateCatalogCache() {
  cachedGameIds = null;
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
  if (!/master-loader\.js|poki-sdk|unityWebglLoaderUrl|UnityLoader/i.test(text)) {
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
import path10 from "node:path";

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

// src/unity/inject-html.ts
import { readFileSync } from "node:fs";
import path9 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

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

// src/unity/inject-html.ts
var INJECT_PATH = path9.resolve(
  path9.dirname(fileURLToPath2(import.meta.url)),
  "../../../static/unity/inject.js"
);
var cachedInjectSource = null;
function loadUnityInjectSource() {
  if (cachedInjectSource) return cachedInjectSource;
  cachedInjectSource = readFileSync(INJECT_PATH, "utf-8");
  return cachedInjectSource;
}
function buildUnityInjectScriptTag() {
  return `<script>${loadUnityInjectSource()}</script>`;
}
var BLOAT_SCRIPT = /(?:poki-sdk|master-loader|y8-afp|y8\.sdk|id\.net|idnet|gameapi|adsbygoogle|googlesyndication)/i;
var BLOAT_LINK = /(?:poki|y8|id\.net|doubleclick)/i;
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
  if (out.includes("</head>")) {
    return out.replace("</head>", `${bundle}
</head>`);
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
    const mergedPath = path10.join(outDir, merge.relativePath);
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
  await fs7.writeFile(path10.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  await fs7.writeFile(path10.join(outDir, "asset-map.json"), JSON.stringify(assetRoutes, null, 2));
  await fs7.writeFile(path10.join(outDir, "index.html"), buildOfflineHtml(assetRoutes));
  console.log(`[host] Wrote manifest.json (${files.length} files)`);
  console.log(`[host] Wrote asset-map.json (${Object.keys(assetRoutes).length} routes)`);
  console.log("[host] Wrote index.html (standalone offline host)");
  return manifest;
}

// src/unity-embed/merge.ts
import fs8 from "node:fs/promises";
import path11 from "node:path";
function formatBytes2(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
var PART_CHUNK_BYTES = 8 * 1024 * 1024;
async function mergeParts(outDir, baseName) {
  const buildDir = path11.join(outDir, "Build");
  const entries = await fs8.readdir(buildDir);
  const partPattern = new RegExp(`^${baseName}\\.part(\\d+)$`);
  const parts = entries.map((name) => {
    const match = name.match(partPattern);
    return match ? { name, index: Number.parseInt(match[1], 10) } : null;
  }).filter((p) => p !== null).sort((a, b) => a.index - b.index);
  if (parts.length === 0) return null;
  const buffers = [];
  for (const part of parts) {
    buffers.push(await fs8.readFile(path11.join(buildDir, part.name)));
  }
  const merged = Buffer.concat(buffers);
  const mergedPath = path11.join(buildDir, baseName);
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
    const buildDir = path11.join(outDir, "Build");
    const mergedPath = path11.join(buildDir, baseName);
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
      await fs8.writeFile(path11.join(buildDir, `${baseName}.part${partIndex}`), chunk);
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
  const brPath = path11.join(outDir, merged.relativePath);
  const aliasRelative = merged.relativePath.replace(/\.br$/, "");
  const aliasPath = path11.join(outDir, aliasRelative);
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
import fs14 from "node:fs/promises";
import { existsSync as existsSync7 } from "node:fs";
import path16 from "node:path";
import { spawn } from "node:child_process";
init_cancel_registry();
init_config();

// src/download/discover-all.ts
import { existsSync as existsSync4 } from "node:fs";
import fs10 from "node:fs/promises";
import path12 from "node:path";
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
  const entryPath = path12.join(outDir, entryRel);
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
import path13 from "node:path";
var GAME_SHELL_MARKERS = /c2runtime|cr_createRuntime|lime\.embed|UnityLoader|createUnityInstance|openfl-content|Construct 2|openfl-content/i;
function mirroredIndexCandidates(out, iframeUrl) {
  const parsed = new URL(iframeUrl);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const hostDir = path13.join(out, parsed.hostname);
  const candidates = [path13.join(out, "index.html"), path13.join(hostDir, "index.html")];
  if (parts.length === 0) return candidates;
  const last = parts[parts.length - 1];
  candidates.push(path13.join(hostDir, ...parts, "index.html"));
  candidates.push(path13.join(hostDir, ...parts.slice(0, -1), `${last}.html`));
  candidates.push(path13.join(hostDir, ...parts, `${last}.html`));
  return candidates;
}
async function collectHtmlFiles(dir, acc = []) {
  const entries = await fs11.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path13.join(dir, e.name);
    if (e.isFile() && /\.html?$/i.test(e.name)) acc.push(full);
    else if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "_external") {
      await collectHtmlFiles(full, acc);
    }
  }
  return acc;
}
function scoreEntryHtml(filePath, content, iframeSrc) {
  let score = 0;
  const name = path13.basename(filePath).toLowerCase();
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
import fs12 from "node:fs/promises";
import path14 from "node:path";

// src/generic/poki-offline-stub.ts
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
function indexHtmlReferencesPokiSdk(html) {
  return /poki-sdk/i.test(html);
}
function patchPokiSdkScriptTags(html) {
  return html.replace(
    /<script\b[^>]*\bsrc=["'][^"']*poki-sdk[^"']*["'][^>]*>\s*<\/script>/gi,
    '<script src="poki-sdk.js"></script>'
  );
}

// src/generic/post-process-offline.ts
var SITE_ROOT_SCRIPT = /\bsrc=["'](?:\.\.\/)+([^"']+)["']/gi;
var PORTAL_SCRIPT_STUBS = {
  "cloak.js": "// offline noop\n",
  "poki-sdk.js": ""
  // filled via buildPokiOfflineStubScript when referenced
};
async function patchSiteRootScriptTags(outDir, html) {
  const needed = /* @__PURE__ */ new Set();
  let out = html;
  out = out.replace(SITE_ROOT_SCRIPT, (tag, fileName) => {
    if (typeof fileName !== "string" || !fileName.trim()) return tag;
    needed.add(fileName);
    return tag.replace(/(?:\.\.\/)+[^"']+/, fileName);
  });
  for (const fileName of needed) {
    const dest = path14.join(outDir, fileName);
    if (fileName === "poki-sdk.js") continue;
    try {
      const stat = await fs12.stat(dest);
      if (stat.isFile() && stat.size > 0) continue;
    } catch {
    }
    const stub = PORTAL_SCRIPT_STUBS[fileName] ?? "// offline noop\n";
    await fs12.writeFile(dest, stub, "utf-8");
  }
  return out;
}
async function postProcessGenericOfflineMirror(outDir, entryRel = "index.html") {
  const entryPath = path14.join(outDir, entryRel);
  let html = await fs12.readFile(entryPath, "utf-8");
  html = await patchSiteRootScriptTags(outDir, html);
  if (indexHtmlReferencesPokiSdk(html)) {
    await fs12.writeFile(path14.join(outDir, "poki-sdk.js"), buildPokiOfflineStubScript(), "utf-8");
    html = patchPokiSdkScriptTags(html);
  }
  await fs12.writeFile(entryPath, html, "utf-8");
}

// src/unity/post-process-offline.ts
init_scan_assets();
import fs13 from "node:fs/promises";
import { existsSync as existsSync6 } from "node:fs";
import path15 from "node:path";
async function listBuildFiles(outDir) {
  const buildDir = path15.join(outDir, "Build");
  if (!existsSync6(buildDir)) return [];
  const entries = await fs13.readdir(buildDir);
  return entries.map((f) => path15.posix.join("Build", f));
}
async function discoverExternalUnityAssets(outDir, indexHtml) {
  const urls = new Set(scanContentForMediaUrls(indexHtml));
  const product = inferBuildProductName(indexHtml);
  const toScan = await listBuildFiles(outDir);
  if (product) {
    for (const suffix of [".framework.js", ".loader.js", ".data", ".wasm", ".data.br", ".wasm.br"]) {
      toScan.push(path15.posix.join("Build", `${product}${suffix}`));
    }
  }
  for (const rel of toScan) {
    const filePath = path15.join(outDir, rel);
    if (!existsSync6(filePath)) continue;
    try {
      const buf = await fs13.readFile(filePath);
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
  const entryPath = path15.join(outDir, entryRel);
  const entryHtml = await fs13.readFile(entryPath, "utf-8");
  if (!isUnityGameHtml(entryHtml)) {
    return { assetRoutes: {}, externalCount: 0 };
  }
  const externalUrls = await discoverExternalUnityAssets(outDir, entryHtml);
  const assetRoutes = buildAssetRouteMap(externalUrls);
  if (externalUrls.length > 0) {
    await fs13.writeFile(
      path15.join(outDir, "asset-map.json"),
      JSON.stringify(assetRoutes, null, 2)
    );
  }
  const patched = injectUnityPatches(entryHtml, assetRoutes);
  await fs13.writeFile(entryPath, patched);
  console.log(
    `[unity] Post-processed ${path15.basename(outDir)} \u2014 ${externalUrls.length} external route(s), product=${inferBuildProductName(entryHtml) ?? "unknown"}`
  );
  return { assetRoutes, externalCount: externalUrls.length };
}

// src/strategies/generic.ts
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
function normalizeGameBaseUrl(iframeSrc) {
  const parsed = new URL(iframeSrc);
  if (!parsed.pathname.endsWith("/")) {
    parsed.pathname = `${parsed.pathname}/`;
  }
  return parsed.href;
}
async function findGameContentRoot(mirrorDir) {
  async function walk(dir) {
    if (existsSync7(path16.join(dir, "Build")) || existsSync7(path16.join(dir, "TemplateData"))) {
      return dir;
    }
    const entries = await fs14.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const found = await walk(path16.join(dir, e.name));
      if (found) return found;
    }
    return null;
  }
  return walk(mirrorDir);
}
async function promoteGameRootToOfflineDir(mirrorDir, iframeSrc) {
  const entryPath = await resolveMirroredEntryHtml(mirrorDir, iframeSrc);
  const contentRoot = await findGameContentRoot(mirrorDir) ?? path16.dirname(entryPath);
  const staging = path16.join(path16.dirname(mirrorDir), `${path16.basename(mirrorDir)}.__staging__`);
  await fs14.rm(staging, { recursive: true, force: true });
  await fs14.mkdir(staging, { recursive: true });
  await fs14.cp(contentRoot, staging, { recursive: true });
  const entryName = path16.basename(entryPath);
  const stagedEntry = path16.join(staging, entryName);
  if (!existsSync7(stagedEntry)) {
    await fs14.rm(staging, { recursive: true, force: true });
    throw new Error(`Could not prepare offline entry (${entryName})`);
  }
  const entryRel = path16.relative(staging, stagedEntry).split(path16.sep).join("/");
  await fs14.rm(mirrorDir, { recursive: true, force: true });
  await fs14.rename(staging, mirrorDir);
  const baseUrl = normalizeGameBaseUrl(iframeSrc);
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
function localPathForUrl(baseUrl, assetUrl, outDir) {
  const base = new URL(baseUrl);
  const abs = new URL(assetUrl, base);
  const absPathParts = abs.pathname.split("/").filter(Boolean);
  if (abs.origin !== base.origin) {
    return path16.join(outDir, "_external", abs.hostname, ...absPathParts);
  }
  const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  if (!abs.pathname.startsWith(basePath)) {
    return path16.join(outDir, ...absPathParts);
  }
  const baseParts = base.pathname.split("/").filter(Boolean);
  const relParts = absPathParts.slice(baseParts.length);
  if (relParts.length === 0) return path16.join(outDir, "index.html");
  return path16.join(outDir, ...relParts);
}
async function validateRequiredAssets(outDir, baseUrl, indexHtml) {
  const missing = [];
  if (isUnityShell(indexHtml)) {
    const buildJsonRel = findUnityLoaderBuildJson(indexHtml);
    if (buildJsonRel) {
      const buildJsonUrl = new URL(buildJsonRel, baseUrl).href;
      const buildJsonPath = localPathForUrl(baseUrl, buildJsonUrl, outDir);
      if (!existsSync7(buildJsonPath)) {
        missing.push(buildJsonPath);
      } else {
        try {
          const buildMeta = JSON.parse(await fs14.readFile(buildJsonPath, "utf-8"));
          for (const assetUrl of expandBuildManifest(buildMeta, buildJsonUrl)) {
            const assetPath = localPathForUrl(baseUrl, assetUrl, outDir);
            if (!existsSync7(assetPath)) missing.push(assetPath);
          }
        } catch {
          missing.push(buildJsonPath);
        }
      }
    }
    if (/UnityLoader/i.test(indexHtml) && !existsSync7(path16.join(outDir, "Build", "UnityLoader.js")) && !existsSync7(path16.join(outDir, "UnityLoader.js"))) {
      missing.push(path16.join(outDir, "Build/UnityLoader.js"));
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
  onProgress(92, "Verifying Unity / required assets\u2026");
  const entryHtml = await fs14.readFile(path16.join(outDir, entryRel), "utf-8");
  await validateRequiredAssets(outDir, baseUrl, entryHtml);
}
async function pullGenericGame(gameId, onProgress, signal) {
  const onlineIndex = path16.join(catalogOnlineDir(gameId), "index.html");
  const out = offlineDir(gameId);
  throwIfCancelled(signal);
  onProgress(5, "Reading online shell\u2026");
  const html = await fs14.readFile(onlineIndex, "utf-8");
  const iframeSrc = extractIframeSrc(html);
  if (!iframeSrc) {
    onProgress(20, "No iframe \u2014 copying online shell to offline\u2026");
    await fs14.rm(out, { recursive: true, force: true });
    await fs14.cp(catalogOnlineDir(gameId), out, { recursive: true });
    await writeOfflineManifest(out, { entry: "index.html" });
    onProgress(100, "Copied online shell");
    return;
  }
  const mirrorUrl = normalizeGameBaseUrl(iframeSrc);
  onProgress(15, `Mirroring ${mirrorUrl}\u2026`);
  const existingCache = await readDownloadCache(gameId);
  if (!existingCache) {
    await fs14.rm(out, { recursive: true, force: true });
  }
  await fs14.mkdir(out, { recursive: true });
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
  const entryPath = path16.join(out, entryRel);
  if (!existsSync7(entryPath)) {
    throw new Error(`Mirror completed but entry HTML missing: ${entryRel}`);
  }
  await discoverAndDownloadAssets(out, baseUrl, entryRel, onProgress, signal);
  const entryHtml = await fs14.readFile(entryPath, "utf-8");
  if (isUnityShell(entryHtml)) {
    throwIfCancelled(signal);
    onProgress(95, "Injecting Unity patches & asset routes\u2026");
    await postProcessUnityOfflineMirror(out, baseUrl, entryRel);
  } else {
    throwIfCancelled(signal);
    onProgress(95, "Patching offline SDK & links\u2026");
    await postProcessGenericOfflineMirror(out, entryRel);
  }
  onProgress(100, "Download complete");
}

// src/download-manager.ts
var cancelDiscardCache = /* @__PURE__ */ new Map();
async function getGameStatus(gameId) {
  const partialCache = await hasPartialDownloadCache(gameId);
  const cache = partialCache ? await countOfflineFiles(gameId) : 0;
  return {
    online: await hasOnlineShell(gameId),
    offline: await hasOfflineMirror(gameId),
    downloading: isGameDownloading(gameId),
    partialCache: partialCache && !await hasOfflineMirror(gameId),
    cacheFileCount: cache > 0 ? cache : void 0
  };
}
async function getAllGameStatuses() {
  const ids = await loadGameIds();
  const downloading = listDownloadingGameIds();
  const result = {};
  await Promise.all(
    ids.map(async (id) => {
      const partialCache = await hasPartialDownloadCache(id);
      const offline = await hasOfflineMirror(id);
      const cacheFileCount = partialCache ? await countOfflineFiles(id) : 0;
      result[id] = {
        online: await hasOnlineShell(id),
        offline,
        downloading: downloading.has(id),
        partialCache: partialCache && !offline,
        cacheFileCount: cacheFileCount > 0 ? cacheFileCount : void 0
      };
    })
  );
  return result;
}
async function deleteOfflineGame(gameId) {
  if (!isValidGameId(gameId)) throw new Error("Invalid game id");
  const ids = await loadGameIds();
  if (!ids.includes(gameId)) throw new Error("Game not in catalog");
  if (isGameDownloading(gameId)) {
    throw new Error("Cannot delete while download is in progress");
  }
  await fs15.rm(offlineDir(gameId), { recursive: true, force: true });
  invalidateCatalogCache();
}
async function startDownload(gameId) {
  if (!isValidGameId(gameId)) throw new Error("Invalid game id");
  const ids = await loadGameIds();
  if (!ids.includes(gameId)) throw new Error("Game not in catalog");
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
          await fs15.rm(offlineDir(gameId), { recursive: true, force: true });
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
      await fs15.rm(offlineDir(gameId), { recursive: true, force: true });
    } catch {
    }
  } finally {
    clearDownloadAbort(gameId);
  }
}

// src/game-storage-bridge-script.ts
import { readFileSync as readFileSync2 } from "node:fs";
import path17 from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
var BRIDGE_PATH = path17.resolve(
  path17.dirname(fileURLToPath3(import.meta.url)),
  "../../static/game-storage-bridge.child.js"
);
var cachedBridge = null;
function loadBridgeSource() {
  if (cachedBridge) return cachedBridge;
  cachedBridge = readFileSync2(BRIDGE_PATH, "utf-8");
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
import fs16 from "node:fs/promises";
import { existsSync as existsSync8 } from "node:fs";
import path18 from "node:path";
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
  const indexPath = path18.join(catalogOnlineDir(gameId), "index.html");
  if (!existsSync8(indexPath)) return null;
  const html = await fs16.readFile(indexPath, "utf-8");
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
import fs17 from "node:fs/promises";
import path19 from "node:path";
import { existsSync as existsSync9 } from "node:fs";

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
  return path19.join(gameDataRoot(gameId), "data");
}
function dataFilePath(gameId, rel) {
  return path19.join(browserDataDir(gameId), rel);
}
function assertDataPath(gameId, absPath) {
  const root = path19.resolve(browserDataDir(gameId));
  const resolved = path19.resolve(absPath);
  if (!resolved.startsWith(root + path19.sep) && resolved !== root) {
    throw new Error("Path traversal rejected");
  }
}
async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs17.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
async function writeJsonAtomic(filePath, data) {
  const dir = path19.dirname(filePath);
  await fs17.mkdir(dir, { recursive: true });
  const tmp = filePath + ".tmp";
  await fs17.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs17.rename(tmp, filePath);
}
async function loadIndexedDbProfiles(gameId) {
  const idbRoot = dataFilePath(gameId, PROFILE_DISK_PATHS.indexedDbDir);
  if (!existsSync9(idbRoot)) return [];
  const entries = await fs17.readdir(idbRoot, { withFileTypes: true });
  const profiles = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dbDir = path19.join(idbRoot, entry.name);
    const metaPath = path19.join(dbDir, "meta.json");
    const recordsPath = path19.join(dbDir, "records.json");
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
  await fs17.mkdir(idbRoot, { recursive: true });
  const existing = existsSync9(idbRoot) ? await fs17.readdir(idbRoot, { withFileTypes: true }) : [];
  for (const entry of existing) {
    if (entry.isDirectory()) {
      await fs17.rm(path19.join(idbRoot, entry.name), { recursive: true, force: true });
    }
  }
  for (const db of databases) {
    const safeName = db.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const dbDir = path19.join(idbRoot, safeName);
    assertDataPath(gameId, dbDir);
    await fs17.mkdir(dbDir, { recursive: true });
    await writeJsonAtomic(path19.join(dbDir, "meta.json"), {
      name: db.name,
      version: db.version,
      objectStores: db.objectStores
    });
    await writeJsonAtomic(path19.join(dbDir, "records.json"), db.records);
  }
}
async function readGameBrowserProfile(gameId) {
  const root = browserDataDir(gameId);
  const metaPath = dataFilePath(gameId, PROFILE_DISK_PATHS.meta);
  if (!existsSync9(root) && !existsSync9(metaPath)) {
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
  await fs17.mkdir(root, { recursive: true });
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
  if (!existsSync9(root)) return;
  assertDataPath(gameId, root);
  await fs17.rm(root, { recursive: true, force: true });
}

// src/server.ts
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(payload);
}
function mimeFor(filePath) {
  const ext = path20.extname(filePath).toLowerCase();
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
  const ids = await loadGameIds();
  if (!ids.includes(gameId)) {
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
  if (!existsSync10(absPath)) {
    sendJson(res, 404, { error: "Not found" });
    return true;
  }
  const isHtml = /\.html?$/i.test(absPath);
  res.writeHead(200, {
    "Content-Type": mimeFor(absPath),
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Cache-Control": "public, max-age=3600"
  });
  if (isHtml) {
    let raw = await fs18.readFile(absPath, "utf-8");
    if (isUnityGameHtml(raw)) {
      raw = injectUnityPatches(raw);
    }
    res.end(injectGameStorageBridge(raw, gameId));
    return true;
  }
  createReadStream(absPath).pipe(res);
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
        "Access-Control-Allow-Headers": "Content-Type"
      });
      res.end();
      return;
    }
    try {
      if (pathname === "/api/offline/health" && req.method === "GET") {
        sendJson(res, 200, {
          ok: true,
          dataDir: GAMES_DATA_DIR,
          catalogDir: CATALOG_DIR
        });
        return;
      }
      if (pathname === "/api/offline/status" && req.method === "GET") {
        const statuses = await getAllGameStatuses();
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
        const ids = await loadGameIds();
        if (!ids.includes(gameId)) {
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
        const ids = await loadGameIds();
        if (!ids.includes(gameId)) {
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
        const ids = await loadGameIds();
        if (!ids.includes(gameId)) {
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
        const ids = await loadGameIds();
        if (!ids.includes(gameId)) {
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
