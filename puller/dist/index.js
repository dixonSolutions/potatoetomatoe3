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
  EMBED_STRATEGY_GAME_IDS: () => EMBED_STRATEGY_GAME_IDS,
  GAMES_DATA_DIR: () => GAMES_DATA_DIR,
  MIN_OFFLINE_INDEX_BYTES: () => MIN_OFFLINE_INDEX_BYTES,
  PORT: () => PORT,
  REPO_ROOT: () => REPO_ROOT
});
import path from "node:path";
import { fileURLToPath } from "node:url";
var __dirname, REPO_ROOT, GAMES_DATA_DIR, CATALOG_DIR, PORT, CORS_ORIGIN, MIN_OFFLINE_INDEX_BYTES, EMBED_STRATEGY_GAME_IDS;
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
    EMBED_STRATEGY_GAME_IDS = new Set(
      (process.env.EMBED_STRATEGY_GAMES ?? "shrek-escape").split(",").filter(Boolean)
    );
  }
});

// src/shrek/scan-assets.ts
import fs2 from "node:fs/promises";
import path4 from "node:path";
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
  return path4.posix.join("assets", parsed.hostname, cleanPath);
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
    const filePath = path4.join(outDir, rel);
    try {
      const buf = await fs2.readFile(filePath);
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
  "src/shrek/scan-assets.ts"() {
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

// src/shrek/extract.ts
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
function buildAssetUrls(info) {
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
  urls.add(`${buildBase}/Shrek2.framework.js`);
  urls.add(`${buildBase}/Shrek2.loader.js`);
  for (let i = 0; i < info.dataParts; i++) {
    urls.add(`${buildBase}/Shrek2.data.br.part${i}`);
  }
  for (let i = 0; i < info.wasmParts; i++) {
    urls.add(`${buildBase}/Shrek2.wasm.br.part${i}`);
  }
  for (const media of info.mediaUrls) {
    urls.add(media);
  }
  return [...urls].filter((u) => !u.endsWith("/Build"));
}
var CDN_REGEX, DATA_PARTS_REGEX, WASM_PARTS_REGEX, ABSOLUTE_URL_REGEX, ASSET_FILENAME, parseGameXml;
var init_extract = __esm({
  "src/shrek/extract.ts"() {
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
import fs9 from "node:fs/promises";
import { createReadStream, existsSync as existsSync2 } from "node:fs";
import path9 from "node:path";

// src/download-manager.ts
import fs8 from "node:fs/promises";

// src/catalog.ts
init_config();
import fs from "node:fs/promises";
import path2 from "node:path";
var GAME_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/i;
var cachedGameIds = null;
function isValidGameId(gameId) {
  if (!GAME_ID_PATTERN.test(gameId)) return false;
  if (gameId.startsWith("_")) return false;
  return !gameId.includes("..") && !gameId.includes("/");
}
async function loadGameIds() {
  if (cachedGameIds) return cachedGameIds;
  const listPath = path2.join(CATALOG_DIR, "games-list.json");
  try {
    const raw = await fs.readFile(listPath, "utf-8");
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
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith("_") && isValidGameId(e.name)).map((e) => e.name);
  } catch {
    return [];
  }
}
function gameDataRoot(gameId) {
  return path2.join(GAMES_DATA_DIR, gameId);
}
function catalogGameRoot(gameId) {
  return path2.join(CATALOG_DIR, gameId);
}
function catalogOnlineDir(gameId) {
  return path2.join(catalogGameRoot(gameId), "online");
}
function offlineDir(gameId) {
  return path2.join(gameDataRoot(gameId), "offline");
}
function offlineIndexPath(gameId) {
  return path2.join(offlineDir(gameId), "index.html");
}
function catalogOfflineIndexPath(gameId) {
  return path2.join(catalogGameRoot(gameId), "offline", "index.html");
}
async function hasOnlineShell(gameId) {
  for (const indexPath of [
    path2.join(catalogOnlineDir(gameId), "index.html"),
    path2.join(gameDataRoot(gameId), "online", "index.html")
  ]) {
    try {
      const stat = await fs.stat(indexPath);
      if (stat.size >= MIN_OFFLINE_INDEX_BYTES) return true;
    } catch {
    }
  }
  return false;
}
async function hasOfflineMirror(gameId) {
  for (const indexPath of [offlineIndexPath(gameId), catalogOfflineIndexPath(gameId)]) {
    try {
      const stat = await fs.stat(indexPath);
      if (stat.size >= MIN_OFFLINE_INDEX_BYTES) return true;
    } catch {
    }
  }
  return false;
}
function resolveOfflineFilePath(gameId, fileRel) {
  const normalized = path2.normalize(fileRel).replace(/^(\.\.(\/|\\|$))+/, "");
  const candidates = [
    path2.join(offlineDir(gameId), normalized),
    path2.join(catalogGameRoot(gameId), "offline", normalized)
  ];
  for (const candidate of candidates) {
    const dataRoot = path2.resolve(path2.dirname(candidate));
    const allowedRoots = [
      path2.resolve(GAMES_DATA_DIR),
      path2.resolve(CATALOG_DIR)
    ];
    const ok = allowedRoots.some(
      (root) => dataRoot.startsWith(root + path2.sep) || dataRoot === root
    );
    if (ok) return candidate;
  }
  return null;
}
async function readGameMetadata(gameId) {
  const candidates = [
    path2.join(catalogOnlineDir(gameId), "metadata.json"),
    path2.join(catalogGameRoot(gameId), "shared", "metadata.json"),
    path2.join(catalogGameRoot(gameId), "metadata.json"),
    path2.join(gameDataRoot(gameId), "online", "metadata.json")
  ];
  for (const p of candidates) {
    try {
      return JSON.parse(await fs.readFile(p, "utf-8"));
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
  if (path2.resolve(CATALOG_DIR) === path2.resolve(GAMES_DATA_DIR)) return;
  const ids = await loadGameIds();
  for (const gameId of ids) {
    try {
      await fs.access(catalogOfflineIndexPath(gameId));
    } catch {
      continue;
    }
    try {
      await fs.access(offlineIndexPath(gameId));
      continue;
    } catch {
      await fs.mkdir(offlineDir(gameId), { recursive: true });
      await fs.cp(path2.join(catalogGameRoot(gameId), "offline"), offlineDir(gameId), {
        recursive: true
      });
      console.log(`[puller] Seeded bundled offline copy: ${gameId}`);
    }
  }
}

// src/jobs.ts
var jobs = /* @__PURE__ */ new Map();
var activeByGame = /* @__PURE__ */ new Map();
function getActiveJobForGame(gameId) {
  const jobId = activeByGame.get(gameId);
  return jobId ? jobs.get(jobId) : void 0;
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
init_config();
import fs6 from "node:fs/promises";
import { chromium as chromium2 } from "playwright";

// src/shrek/config.ts
import path3 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var __dirname2 = path3.dirname(fileURLToPath2(import.meta.url));
var GAME_PAGE_URL = "https://sites.google.com/classroom.center/view-1/shrek-escape-from-the-swamp";
var CDN_BASE = "https://cdn.jsdelivr.net/gh/777kze777/shreh@main";
var PAGE_TIMEOUT_MS = 6e4;
var DOWNLOAD_CONCURRENCY = 4;
function outDirForGame(gamesDataDir, gameId) {
  return path3.join(gamesDataDir, gameId, "offline");
}

// src/shrek/discover.ts
import { chromium } from "playwright";

// src/shrek/embed.ts
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
async function discoverFromEmbeddedGame(browser) {
  const networkAssetUrls = /* @__PURE__ */ new Set();
  const embedContext = await browser.newContext();
  const embedPage = await embedContext.newPage();
  console.log(`[embed] Loading ${GAME_PAGE_URL}`);
  await embedPage.goto(GAME_PAGE_URL, {
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
    embedPageUrl: GAME_PAGE_URL,
    fileUrl,
    gameHtml,
    networkAssetUrls: [...networkAssetUrls]
  };
}

// src/shrek/discover.ts
init_extract();
async function discoverGameInfo() {
  const browser = await chromium.launch({ headless: true });
  try {
    const embed = await discoverFromEmbeddedGame(browser);
    const parsed = parseGameHtml(embed.gameHtml);
    const cdnBase = parsed.cdnBase || deriveCdnBase(embed.fileUrl);
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
    return CDN_BASE;
  }
}

// src/shrek/download.ts
import { createHash } from "node:crypto";
import fs3 from "node:fs/promises";
import path5 from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
init_extract();
init_scan_assets();
var execFileAsync = promisify(execFile);
var PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
async function detectPartCount(request, baseUrl, hint) {
  let count = 0;
  const maxProbe = Math.max(hint + 2, 16);
  for (let i = 0; i < maxProbe; i++) {
    const url = `${baseUrl}.part${i}`;
    const response = await request.head(url);
    if (!response.ok()) break;
    count = i + 1;
  }
  return count || hint;
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
  await execFileAsync("curl", [
    "-fsSLk",
    "--retry",
    "3",
    "-A",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "-o",
    destPath,
    url
  ]);
  return fs3.readFile(destPath);
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
  const ext = path5.extname(relativePath).toLowerCase();
  const buffer = ext === ".png" ? PLACEHOLDER_PNG : PLACEHOLDER_PNG;
  await fs3.mkdir(path5.dirname(destPath), { recursive: true });
  await fs3.writeFile(destPath, buffer);
  return buffer;
}
async function downloadFile(request, url, outDir, cdnBase, browserPage, allowPlaceholder = false) {
  const relativePath = urlToRelativePath(url, cdnBase);
  if (!relativePath) {
    throw new Error(`Could not resolve relative path for: ${url}`);
  }
  const destPath = path5.join(outDir, relativePath);
  await fs3.mkdir(path5.dirname(destPath), { recursive: true });
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
    await fs3.writeFile(destPath, buffer);
  }
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const tag = placeholder ? " (placeholder)" : "";
  console.log(`  \u2713 ${relativePath} (${formatBytes(buffer.length)})${tag}`);
  return { url, relativePath, size: buffer.length, sha256, placeholder: placeholder || void 0 };
}
async function downloadUrlList(request, urls, outDir, cdnBase, browserPage) {
  console.log(`[download] Fetching ${urls.length} external file(s)...`);
  const results = [];
  for (const url of urls) {
    results.push(await downloadFile(request, url, outDir, cdnBase, browserPage, true));
  }
  return results;
}
async function downloadAssets(request, info, outDir) {
  const buildBase = `${info.cdnBase}/Build`;
  info.dataParts = await detectPartCount(request, `${buildBase}/Shrek2.data.br`, info.dataParts);
  info.wasmParts = await detectPartCount(request, `${buildBase}/Shrek2.wasm.br`, info.wasmParts);
  const urls = buildAssetUrls(info);
  console.log(`[download] Fetching ${urls.length} files from embedded game source \u2026`);
  const results = [];
  const queue = [...urls];
  async function worker() {
    while (queue.length > 0) {
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
  return results;
}

// src/shrek/host.ts
import { createHash as createHash2 } from "node:crypto";
import fs4 from "node:fs/promises";
import path6 from "node:path";

// src/shrek/adfree-host.ts
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

// src/shrek/asset-redirect.ts
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

// src/shrek/host.ts
function buildOfflineHtml(assetRoutes) {
  const redirect = Object.keys(assetRoutes).length > 0 ? buildAssetRedirectScript(assetRoutes) : "";
  return buildAdFreeHostHtml().replace("</head>", `${redirect}
</head>`);
}
async function writeHostFiles(outDir, info, downloads, merges, assetRoutes) {
  const files = [];
  for (const dl of downloads) {
    if (dl.relativePath.includes(".part")) continue;
    files.push({ path: dl.relativePath, size: dl.size, sha256: dl.sha256 });
  }
  for (const merge of merges) {
    const mergedPath = path6.join(outDir, merge.relativePath);
    const buffer = await fs4.readFile(mergedPath);
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
  await fs4.writeFile(path6.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  await fs4.writeFile(path6.join(outDir, "asset-map.json"), JSON.stringify(assetRoutes, null, 2));
  await fs4.writeFile(path6.join(outDir, "index.html"), buildOfflineHtml(assetRoutes));
  console.log(`[host] Wrote manifest.json (${files.length} files)`);
  console.log(`[host] Wrote asset-map.json (${Object.keys(assetRoutes).length} routes)`);
  console.log("[host] Wrote index.html (standalone offline host)");
  return manifest;
}

// src/shrek/merge.ts
import fs5 from "node:fs/promises";
import path7 from "node:path";
function formatBytes2(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
var PART_CHUNK_BYTES = 8 * 1024 * 1024;
async function mergeParts(outDir, baseName) {
  const buildDir = path7.join(outDir, "Build");
  const entries = await fs5.readdir(buildDir);
  const partPattern = new RegExp(`^${baseName}\\.part(\\d+)$`);
  const parts = entries.map((name) => {
    const match = name.match(partPattern);
    return match ? { name, index: Number.parseInt(match[1], 10) } : null;
  }).filter((p) => p !== null).sort((a, b) => a.index - b.index);
  if (parts.length === 0) return null;
  const buffers = [];
  for (const part of parts) {
    buffers.push(await fs5.readFile(path7.join(buildDir, part.name)));
  }
  const merged = Buffer.concat(buffers);
  const mergedPath = path7.join(buildDir, baseName);
  await fs5.writeFile(mergedPath, merged);
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
    const buildDir = path7.join(outDir, "Build");
    const mergedPath = path7.join(buildDir, baseName);
    const partPattern = new RegExp(`^${baseName.replace(".", "\\.")}\\.part\\d+$`);
    try {
      await fs5.access(mergedPath);
    } catch {
      continue;
    }
    const entries = await fs5.readdir(buildDir);
    if (entries.some((name) => partPattern.test(name))) continue;
    const merged = await fs5.readFile(mergedPath);
    let partIndex = 0;
    for (let offset = 0; offset < merged.length; offset += PART_CHUNK_BYTES) {
      const chunk = merged.subarray(offset, offset + PART_CHUNK_BYTES);
      await fs5.writeFile(path7.join(buildDir, `${baseName}.part${partIndex}`), chunk);
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
  const brPath = path7.join(outDir, merged.relativePath);
  const aliasRelative = merged.relativePath.replace(/\.br$/, "");
  const aliasPath = path7.join(outDir, aliasRelative);
  await fs5.unlink(aliasPath).catch(() => {
  });
  try {
    await fs5.link(brPath, aliasPath);
  } catch {
    await fs5.copyFile(brPath, aliasPath);
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
async function pullEmbedGame(gameId, onProgress) {
  const outDir = outDirForGame(GAMES_DATA_DIR, gameId);
  await fs6.mkdir(outDir, { recursive: true });
  onProgress(5, "Discovering game source\u2026");
  const info = await discoverGameInfo();
  const browser = await chromium2.launch({ headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const request = context.request;
  const browserPage = await context.newPage();
  try {
    onProgress(15, "Downloading core Unity assets\u2026");
    let downloads = await downloadAssets(request, info, outDir);
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
        browserPage
      );
      downloads = [...downloads, ...externalDownloads];
    }
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
import fs7 from "node:fs/promises";
import { existsSync } from "node:fs";
import path8 from "node:path";
import { execFile as execFile2, spawn } from "node:child_process";
import { promisify as promisify2 } from "node:util";
var execFileAsync2 = promisify2(execFile2);
var WGET_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
var ASSET_EXT = /(?:\.(?:unityweb|wasm|data|js|json|css|png|jpe?g|gif|webp|svg|ico|br|mp3|ogg|wav|woff2?|ttf|eot))(?:[?#]|$)/i;
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
function mirroredIndexCandidates(out, iframeUrl) {
  const parsed = new URL(iframeUrl);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const hostDir = path8.join(out, parsed.hostname);
  const candidates = [path8.join(out, "index.html"), path8.join(hostDir, "index.html")];
  if (parts.length === 0) return candidates;
  const last = parts[parts.length - 1];
  candidates.push(path8.join(hostDir, ...parts, "index.html"));
  candidates.push(path8.join(hostDir, ...parts.slice(0, -1), `${last}.html`));
  candidates.push(path8.join(hostDir, ...parts, `${last}.html`));
  return candidates;
}
async function findIndexHtml(dir) {
  const entries = await fs7.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path8.join(dir, e.name);
    if (e.isFile() && /^index\.html?$/i.test(e.name)) return full;
    if (e.isDirectory()) {
      const found = await findIndexHtml(full);
      if (found) return found;
    }
  }
  return null;
}
async function resolveMirroredIndex(out, iframeSrc) {
  for (const candidate of mirroredIndexCandidates(out, iframeSrc)) {
    if (!existsSync(candidate)) continue;
    try {
      const stat = await fs7.stat(candidate);
      if (stat.isFile() && stat.size >= 64) return candidate;
    } catch {
    }
  }
  const hostDir = path8.join(out, new URL(iframeSrc).hostname);
  if (existsSync(hostDir)) {
    const found = await findIndexHtml(hostDir);
    if (found) return found;
  }
  const fallback = await findIndexHtml(out);
  if (fallback) return fallback;
  throw new Error("Mirror completed but no playable HTML entry point found");
}
async function findGameContentRoot(mirrorDir) {
  async function walk(dir) {
    if (existsSync(path8.join(dir, "Build")) || existsSync(path8.join(dir, "TemplateData"))) {
      return dir;
    }
    const entries = await fs7.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const found = await walk(path8.join(dir, e.name));
      if (found) return found;
    }
    return null;
  }
  return walk(mirrorDir);
}
async function promoteGameRootToOfflineDir(mirrorDir, iframeSrc) {
  const indexPath = await resolveMirroredIndex(mirrorDir, iframeSrc);
  const contentRoot = await findGameContentRoot(mirrorDir) ?? path8.dirname(indexPath);
  const staging = path8.join(path8.dirname(mirrorDir), `${path8.basename(mirrorDir)}.__staging__`);
  await fs7.rm(staging, { recursive: true, force: true });
  await fs7.mkdir(staging, { recursive: true });
  await fs7.cp(contentRoot, staging, { recursive: true });
  const entryName = path8.basename(indexPath);
  const stagedEntry = path8.join(staging, entryName);
  const stagedIndex = path8.join(staging, "index.html");
  if (entryName !== "index.html" && existsSync(stagedEntry)) {
    await fs7.copyFile(stagedEntry, stagedIndex);
  } else if (!existsSync(stagedIndex) && existsSync(path8.join(contentRoot, "index.html"))) {
    await fs7.copyFile(path8.join(contentRoot, "index.html"), stagedIndex);
  }
  if (!existsSync(stagedIndex)) {
    await fs7.rm(staging, { recursive: true, force: true });
    throw new Error("Could not prepare offline index.html");
  }
  await fs7.rm(mirrorDir, { recursive: true, force: true });
  await fs7.rename(staging, mirrorDir);
  return normalizeGameBaseUrl(iframeSrc);
}
async function runWget(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("wget", args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}
async function downloadFile2(url, destPath) {
  if (existsSync(destPath)) {
    try {
      const stat = await fs7.stat(destPath);
      if (stat.isFile() && stat.size > 0) return true;
    } catch {
    }
  }
  await fs7.mkdir(path8.dirname(destPath), { recursive: true });
  try {
    await execFileAsync2("wget", [
      "-q",
      "--tries=3",
      "--timeout=120",
      "-U",
      WGET_UA,
      "-O",
      destPath,
      url
    ]);
    const stat = await fs7.stat(destPath);
    if (stat.size === 0) {
      await fs7.rm(destPath, { force: true });
      return false;
    }
    const head = (await fs7.readFile(destPath)).subarray(0, 32).toString("utf8");
    if (head.startsWith("<!DOCTYPE") || head.startsWith("<html")) {
      await fs7.rm(destPath, { force: true });
      return false;
    }
    return true;
  } catch {
    try {
      await fs7.rm(destPath, { force: true });
    } catch {
    }
    return false;
  }
}
function localPathForUrl(baseUrl, assetUrl, outDir) {
  const base = new URL(baseUrl);
  const abs = new URL(assetUrl, base);
  if (abs.origin !== base.origin) {
    return path8.join(
      outDir,
      "_external",
      abs.hostname,
      ...abs.pathname.split("/").filter(Boolean)
    );
  }
  const baseParts = base.pathname.split("/").filter(Boolean);
  const absParts = abs.pathname.split("/").filter(Boolean);
  const relParts = absParts.slice(baseParts.length);
  if (relParts.length === 0) return path8.join(outDir, "index.html");
  return path8.join(outDir, ...relParts);
}
function collectAssetRefs(text, fileUrl, queue, seen) {
  const patterns = [
    /(?:href|src)=["']([^"']+)["']/gi,
    /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi,
    /UnityLoader\.instantiate\s*\(\s*[^,]+,\s*["']([^"']+)["']/gi,
    /"(?:dataUrl|wasmCodeUrl|wasmFrameworkUrl|codeUrl|frameworkUrl|symbolsUrl|streamingAssetsUrl)"\s*:\s*"([^"]+)"/gi,
    /["']([^"']+\.(?:unityweb|wasm|data|js|json|css|png|jpe?g|gif|webp|svg|ico|br|mp3|ogg|wav|woff2?|ttf|eot)(?:\?[^"']*)?)["']/gi
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const ref = m[1]?.trim();
      if (!ref || ref.startsWith("data:") || ref.startsWith("blob:") || ref.startsWith("#")) continue;
      try {
        const abs = new URL(ref, fileUrl).href;
        if (!ASSET_EXT.test(abs)) continue;
        if (seen.has(abs)) continue;
        queue.add(abs);
      } catch {
      }
    }
  }
}
async function validateRequiredAssets(outDir, baseUrl, indexHtml) {
  const missing = [];
  if (/UnityLoader/i.test(indexHtml)) {
    const match = indexHtml.match(/UnityLoader\.instantiate\s*\(\s*[^,]+,\s*["']([^"']+)["']/i);
    if (match?.[1]) {
      const buildJsonUrl = new URL(match[1], baseUrl).href;
      const buildJsonPath = localPathForUrl(baseUrl, buildJsonUrl, outDir);
      if (!existsSync(buildJsonPath)) {
        missing.push(buildJsonPath);
      } else {
        try {
          const buildMeta = JSON.parse(await fs7.readFile(buildJsonPath, "utf-8"));
          for (const key of [
            "dataUrl",
            "wasmCodeUrl",
            "wasmFrameworkUrl",
            "codeUrl",
            "frameworkUrl"
          ]) {
            const rel = buildMeta[key];
            if (!rel) continue;
            const assetPath = localPathForUrl(buildJsonUrl, rel, outDir);
            if (!existsSync(assetPath)) missing.push(assetPath);
          }
        } catch {
          missing.push(buildJsonPath);
        }
      }
    }
    if (!existsSync(path8.join(outDir, "Build", "UnityLoader.js"))) {
      missing.push(path8.join(outDir, "Build", "UnityLoader.js"));
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing required offline assets: ${missing.slice(0, 5).join(", ")}`);
  }
}
async function fetchAllReferencedAssets(outDir, baseUrl, onProgress) {
  onProgress(65, "Fetching all referenced assets\u2026");
  const indexPath = path8.join(outDir, "index.html");
  const indexHtml = await fs7.readFile(indexPath, "utf-8");
  const queue = /* @__PURE__ */ new Set();
  const seen = /* @__PURE__ */ new Set();
  collectAssetRefs(indexHtml, baseUrl, queue, seen);
  let fetched = 0;
  for (let pass = 0; pass < 24 && queue.size > 0; pass++) {
    const batch = [...queue];
    queue.clear();
    for (const url of batch) {
      if (seen.has(url)) continue;
      seen.add(url);
      const dest = localPathForUrl(baseUrl, url, outDir);
      const ok = await downloadFile2(url, dest);
      if (!ok) continue;
      fetched++;
      if (fetched % 5 === 0) {
        onProgress(70 + Math.min(20, Math.floor(fetched / 3)), `Downloaded ${fetched} asset(s)\u2026`);
      }
      if (/\.(html?|js|css|json)$/i.test(dest)) {
        try {
          const text = await fs7.readFile(dest, "utf-8");
          collectAssetRefs(text, url, queue, seen);
        } catch {
        }
      }
    }
  }
  onProgress(92, `Verifying required assets (${fetched} downloaded)\u2026`);
  await validateRequiredAssets(outDir, baseUrl, indexHtml);
}
async function pullGenericGame(gameId, onProgress) {
  const onlineIndex = path8.join(catalogOnlineDir(gameId), "index.html");
  const out = offlineDir(gameId);
  onProgress(5, "Reading online shell\u2026");
  const html = await fs7.readFile(onlineIndex, "utf-8");
  const iframeSrc = extractIframeSrc(html);
  if (!iframeSrc) {
    onProgress(20, "No iframe \u2014 copying online shell to offline\u2026");
    await fs7.rm(out, { recursive: true, force: true });
    await fs7.cp(catalogOnlineDir(gameId), out, { recursive: true });
    onProgress(100, "Copied online shell");
    return;
  }
  const mirrorUrl = normalizeGameBaseUrl(iframeSrc);
  onProgress(15, `Mirroring ${mirrorUrl}\u2026`);
  await fs7.rm(out, { recursive: true, force: true });
  await fs7.mkdir(out, { recursive: true });
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
    "-U",
    WGET_UA,
    "--tries=3",
    "--timeout=120",
    mirrorUrl
  ];
  const code = await runWget(wgetArgs);
  onProgress(50, "Preparing offline layout\u2026");
  let baseUrl;
  try {
    baseUrl = await promoteGameRootToOfflineDir(out, iframeSrc);
  } catch (error) {
    if (code !== 0 && code !== 8) {
      throw new Error(`wget mirror failed with exit code ${code}`);
    }
    throw error;
  }
  if (code !== 0 && code !== 8) {
    throw new Error(`wget mirror failed with exit code ${code}`);
  }
  if (!existsSync(path8.join(out, "index.html"))) {
    throw new Error("Mirror completed but no index.html found");
  }
  await fetchAllReferencedAssets(out, baseUrl, onProgress);
  onProgress(100, "Download complete");
}

// src/download-manager.ts
async function getGameStatus(gameId) {
  return {
    online: await hasOnlineShell(gameId),
    offline: await hasOfflineMirror(gameId),
    downloading: isGameDownloading(gameId)
  };
}
async function getAllGameStatuses() {
  const ids = await loadGameIds();
  const downloading = listDownloadingGameIds();
  const result = {};
  await Promise.all(
    ids.map(async (id) => {
      result[id] = {
        online: await hasOnlineShell(id),
        offline: await hasOfflineMirror(id),
        downloading: downloading.has(id)
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
  await fs8.rm(offlineDir(gameId), { recursive: true, force: true });
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
  const job = createJob(gameId);
  void runDownloadJob(gameId, job);
  return { started: true, message: "Download started" };
}
async function runDownloadJob(gameId, job) {
  const reporter = (progress, message) => {
    updateJob(gameId, { state: "running", progress, message });
  };
  updateJob(gameId, { state: "running", progress: 0, message: "Starting\u2026" });
  try {
    const strategy = await getPullStrategy(gameId);
    if (strategy === "embed") {
      await pullEmbedGame(gameId, reporter);
    } else {
      await pullGenericGame(gameId, reporter);
    }
    updateJob(gameId, {
      state: "done",
      progress: 100,
      message: "Complete",
      finishedAt: Date.now()
    });
    invalidateCatalogCache();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateJob(gameId, {
      state: "error",
      progress: 0,
      message: "Failed",
      error: message,
      finishedAt: Date.now()
    });
    try {
      await fs8.rm(offlineDir(gameId), { recursive: true, force: true });
    } catch {
    }
  }
}

// src/game-storage-bridge-script.ts
function buildInlineGameStorageBridgeScript(gameId) {
  const safeId = JSON.stringify(gameId);
  return `<script>(function(){var GAME_ID=${safeId};var TYPE='potato-tomato-game-storage';function snap(){var d={},i,k;try{for(i=0;i<localStorage.length;i++){k=localStorage.key(i);if(k)d[k]=localStorage.getItem(k);}}catch(e){}return d;}function push(){if(window.parent===window)return;window.parent.postMessage({type:TYPE,action:'push',gameId:GAME_ID,data:{localStorage:snap()}},'*');}window.addEventListener('message',function(e){var m=e.data;if(!m||m.type!==TYPE||m.gameId!==GAME_ID||m.action!=='hydrate'||!m.data||!m.data.localStorage)return;var ls=m.data.localStorage,k;for(k in ls){if(Object.prototype.hasOwnProperty.call(ls,k)){try{localStorage.setItem(k,ls[k]);}catch(err){}}}});if(window.parent!==window){window.parent.postMessage({type:TYPE,action:'pull',gameId:GAME_ID},'*');setInterval(push,4000);window.addEventListener('pagehide',push);}})();</script>`;
}
function injectGameStorageBridge(html, gameId, childScriptSrc) {
  const tag = childScriptSrc ? `<script src="${childScriptSrc}" defer></script>` : buildInlineGameStorageBridgeScript(gameId);
  if (html.includes("</head>")) {
    return html.replace("</head>", `${tag}</head>`);
  }
  if (html.includes("<body")) {
    return html.replace(/<body([^>]*)>/i, `<body$1>${tag}`);
  }
  return tag + html;
}

// src/server.ts
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(payload);
}
function mimeFor(filePath) {
  const ext = path9.extname(filePath).toLowerCase();
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
  if (!existsSync2(absPath)) {
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
    const raw = await fs9.readFile(absPath, "utf-8");
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
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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
      const progressMatch = pathname.match(/^\/api\/offline\/([^/]+)\/progress$/);
      if (progressMatch && req.method === "GET") {
        const gameId = decodeURIComponent(progressMatch[1]);
        const job = getActiveJobForGame(gameId);
        if (!job) {
          sendJson(res, 200, { state: "idle", progress: 0, message: "No active job" });
          return;
        }
        sendJson(res, 200, job);
        return;
      }
      const deleteMatch = pathname.match(/^\/api\/offline\/([^/]+)$/);
      if (deleteMatch && req.method === "DELETE") {
        const gameId = decodeURIComponent(deleteMatch[1]);
        await deleteOfflineGame(gameId);
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
