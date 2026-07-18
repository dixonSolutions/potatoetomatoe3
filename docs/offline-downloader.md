# Offline downloader service

The app picks an offline backend automatically from where it is running:

| Deployment                        | Detection                                                                           | Download storage                | Play path                                              |
| --------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------ |
| **Public site** (GitHub Pages)    | `PUBLIC_OFFLINE_DEPLOYMENT=public-site`, or non-local host without Tauri            | None; preview only              | Raw online game embed                                  |
| **Local app** (`pnpm dev`, Tauri) | `local-app` stamp, `globalThis.isTauri`, `tauri.localhost`, or `TAURI_ENV_PLATFORM` | **Puller** writes files to disk | `/puller-games/{id}/offline/…` or loopback puller URLs |

Release preparation stamps native artifacts with `PUBLIC_OFFLINE_DEPLOYMENT=local-app`.
Pages CI keeps `public-site`. Override with `PUBLIC_OFFLINE_DEPLOYMENT=public-site` or
`local-app` in `.env` only when debugging.

The puller is the native desktop Node.js backend:

1. **Primary:** mirrors games into `static/games/<id>/offline/` for true offline play (`/api/offline`)
2. **Also:** live-relays external online embeds through `/api/game-live` (and Unity via `/api/unity-play`) for native online play

The execution and storage adapters differ by host, but scrape/capture/ads logic is not duplicated:

- Tauri/Flatpak runs the puller sidecar and keeps mirrors on disk.
- The public web app does not capture, download, relay, register a service worker, or inject touch controls. It is an online preview and native-app download site.
- Linux/Flatpak is the mirror-creating platform. Android plays bundled/imported verified mirrors and cannot run the Node/Playwright capture sidecar.

## Running

```bash
pnpm puller:start          # production
pnpm puller:dev            # watch mode
```

Environment variables:

| Variable               | Default               | Description                                  |
| ---------------------- | --------------------- | -------------------------------------------- |
| `PULLER_PORT`          | `18787`               | HTTP listen port (8787 used by Cursor Voice) |
| `GAMES_DATA_DIR`       | `<repo>/static/games` | Writable games root                          |
| `PULLER_CORS_ORIGIN`   | `*`                   | CORS header                                  |
| `EMBED_STRATEGY_GAMES` | `shrek-escape`        | Comma-separated embed-strategy game IDs      |

## Security

- Game IDs are validated against `games-list.json` (allowlist)
- The allowlist reloads when `games-list.json` mtime changes (and once on a miss), so catalog imports do not require a puller restart for new IDs
- Path traversal is rejected on static file serving
- Writes are restricted to `<dataDir>/<gameId>/offline/` and `<dataDir>/<gameId>/data/` (browser profiles)

## Offline status API (scoped)

At 10k+ catalog size, the SPA never asks the puller for every game’s status.

| Request                             | Response                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /api/offline/status`           | Only **downloaded / in-progress / partial** games (dirs with `offline/`, plus active downloads) |
| `GET /api/offline/status?ids=a,b,c` | Statuses for the listed ids (visible cards)                                                     |
| `GET /api/offline/status/:id`       | Single game (unchanged)                                                                         |

Client helpers: `fetchDownloadedStatuses()` and `fetchOfflineStatusesForIds(ids)`.

## Offline covers

After a successful offline download, the puller also caches the catalog `thumbnail` (remote Unity CDN or local asset) as `offline/assets/thumbnail.*` and records it in `offline-manifest.json`. The UI prefers that local cover when the device is offline or the game is marked downloaded, so cards do not depend on the network for covers.

For browser/PWA downloads delegated to the puller, the export API includes the cached thumbnail.
The browser storage adapter stores that file in IndexedDB and records its path in the browser game
metadata, so dashboard cards use a blob URL from IndexedDB instead of the catalog/network reference.
Existing puller mirrors are repaired lazily when status is requested if their thumbnail is missing.

## Strategies

### `embed`

Used for Unity WebGL games embedded via Google Sites (Shrek). Carried over from [ShrekEscape2 `pull/`](https://github.com/dixonSolutions/ShrekEscape2) (design reference, not a runtime dependency):

1. Discover game via Playwright (FILE_URL from embed page)
2. Download split Brotli Unity assets
3. Merge parts, scan external media, write ad-free host HTML

Set `pullStrategy: "embed"` in `online/metadata.json` or add the game ID to `EMBED_STRATEGY_GAMES`.

### `generic` (full scrape)

Default for catalog games. **Does not stop at the online shell** — mirrors the iframe game host and all reachable assets:

1. Read `online/index.html` iframe URL
2. **Primary:** Playwright opens the iframe URL, walks nested frames, and vaults every successful network response (HTML/JS/CSS/WASM/data/media/JSON) during boot (`puller/src/capture/`)
3. Persist vault under `offline/` (`_external/<host>/…` for cross-origin assets)
4. **Fill-in:** BFS discovery (`discover-all.ts`) + parallel wget for refs never requested during boot
5. **Ads:** strip known ad iframes; inject offline Poki / Yandex / generic stubs (`puller/src/ads/`)
6. Unity WebGL: `postProcessUnityOfflineMirror` (inject.js, asset-map) then ad strip

**Fallback:** if Playwright cannot start, use `wget --mirror` + the same fill-in / ad / Unity post-process path (never a silent shell-only copy).

### Browser IndexedDB vs puller

| Backend                        | What gets saved                         | Cross-origin iframe                                                                                                                       |
| ------------------------------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Puller** (local app / Tauri) | Full iframe host + assets + ad stubs    | Supported (this is the full-scrape path)                                                                                                  |
| **Browser** (GitHub Pages)     | Same-origin `/games/{id}/online/*` only | **Refused** — download fails with CTA unless a local puller is reachable (`pnpm puller:start`), then the download is routed to the puller |

Shell-only “offline” copies that still load a live third-party iframe are no longer treated as successful downloads.

### Y8 catalog import

```bash
pnpm run games:import-y8
pnpm run games:import-y8 -- --limit 50 --skip-existing
node scripts/generate-games-list.js
```

Unity titles get `engine: "unity"` and `onlineEmbedUrl` pointing at the raw `storage-direct.y8.com` build. When the local puller is running (Tauri / `pnpm dev`), online Unity play prefers `/api/unity-play/:id` so `inject.js` runs **inside** the game document (splash stripped + Web Audio unlock + touch postMessage bridge). Catalog shells that only wrap a Unity iframe (e.g. `abinbins.github.io`) are detected at play time and also routed to `/api/unity-play/:id` even without `engine: "unity"` metadata — CDN assets stay remote while inject still runs in-document. Non-Unity external embeds use `/api/game-live/:id` (live relay — not an offline download).

**All Games catalog:** shards are A–Z; the browse page paints after shard-000 and loads more as you scroll (`loadMoreCatalogShards`). Searching or non-name sorts pull the rest of the index in the background.

**Unity inject hardening** ([`static/unity/inject.js`](../static/unity/inject.js)):

- Patches both `assert(0===stdin.fd,…)` and `assert(stdin.fd===0,…)` so WebKitGTK does not abort at `createStandardStreams` (“invalid handle for stdin”).
- Wraps `unityDecompressReleaseFile` so legacy UnityLoader only gunzips real gzip payloads (plain UnityFS / already-decoded bodies pass through) — avoids zlib “incorrect header check” when the `*.gz` fallback would inflate HTML or uncompressed data.
- Forces `UnityLoader.CompressionState` to Supported when possible so flaky first XHRs do not kick that broken `.gz` path.

**GitHub Pages:** Unity online uses same-origin `{base}/api/unity-play/:id`; other external online embeds use `{base}/api/game-live/:id`. [`offline-sw.js`](../static/offline-sw.js) relays to `http://127.0.0.1:18787` when you run `pnpm puller:start` locally (no hosted proxy required; avoids mixed-content). Optionally set `PUBLIC_PLAY_PROXY_URL` (Cloudflare Worker) for Unity visitors without a local puller — see [`workers/unity-play-proxy/`](../workers/unity-play-proxy/). Without puller or that env var, the SW iframe shows an error page (touch unavailable).

### Live online relay (additional capability)

When the puller is running, catalog games with an external `onlineEmbedUrl` can play through same-origin `/api/game-live/:id`. That path:

- Fetches the remote entry HTML and rewrites assets through a short-lived in-memory session
- Injects the touch / storage bridge (and Unity patches when the HTML looks like Unity)
- Does **not** write an offline mirror — use **Download for offline** / `/api/offline` for that

Offline play loads the local offline entry **directly** (blob, `/browser-offline/`, `/puller-games/`, or `/games/…/offline/`) — those hosts are already post-processed and must not be wrapped in `player.html` (which rejects `blob:` and caused “Missing or invalid ?src=” for browser-storage offline).

### Unity Play catalog import

Primary source for new Unity WebGL catalog entries (Poki import is deprecated; purge with `pnpm games:purge-poki`):

```bash
pnpm run games:import-unity-play -- --discover-only
pnpm run games:import-unity-play -- --limit 20 --skip-existing
pnpm run games:import-unity-play -- --skip-existing
node scripts/generate-games-list.js
```

Each game gets `sourcePortal: "unity-play"`, `engine: "unity"`, and `onlineEmbedUrl` set to the Unity Play build frame (`https://play.unity.com/api/v1/games/game/<uuid>/build/latest/frame`). That frame loads `createUnityInstance` against `cdn.play.unity.com` assets and does **not** send `frame-ancestors` / `X-Frame-Options`, so `/unity/player.html?src=…` works. In **Vite dev**, online play prefers `/api/unity-play/:id` (same-origin inject proxy via Vite). Packaged Tauri uses the local puller URL when available (touch via postMessage bridge). **GitHub Pages** uses same-origin `/api/unity-play/:id` via the offline service worker → local puller when `pnpm puller:start` is running; optional `PUBLIC_PLAY_PROXY_URL` for a hosted Worker.

## Tauri integration

In debug builds (`pnpm app` / `tauri dev`), Tauri starts the puller with `pnpm exec tsx puller/src/index.ts` and waits for `/api/offline/health` before treating it as up. The `src-tauri/binaries/puller-sidecar-*` file is only a **placeholder shell script** until `pnpm puller:bundle:linux` runs — spawning that stub used to “succeed” and skip the tsx fallback, which left the UI on “puller unavailable”.

In release builds, the puller is bundled as a real sidecar binary (`src-tauri/binaries/puller-sidecar`) built via `pnpm puller:bundle:linux`. The bundle uses CommonJS before packaging because the pkg runtime can lose imported ESM bindings such as `isValidGameId` and `loadGameIds`. It targets the prebuilt Node 22 runtime and runs a health and proxy-route smoke test before succeeding; CI caches the pkg runtime so it does not compile Node from source. Unity inject + game-storage bridge scripts are **inlined at build time** (`puller/scripts/embed-assets.mjs`) so the pkg sidecar does not need to read `static/` from disk (required for Flatpak).

Flatpak must preserve the sidecar byte-for-byte. `pkg` appends its JavaScript snapshot to the Node ELF, so Flatpak debug-info extraction or stripping corrupts the snapshot even when the pre-Flatpak smoke test passes. The manifest disables both transformations, and CI compares the installed sidecar with its source and reruns the health/proxy smoke test after Flatpak assembly.

The desktop app sets `GAMES_DATA_DIR` to the app data directory so downloads persist outside the read-only bundle. Tauri reserves a free loopback port (default `18787`, next free if busy — e.g. when Flatpak already owns 18787) and exposes it to the UI via `get_puller_base_url` so the webview talks to **this** app’s puller, not another instance.

| Variable         | Dev              | Packaged app                                                                                                                                                                                                                                                                                    |
| ---------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GAMES_DATA_DIR` | `static/games/`  | `~/.local/share/com.potatotomato.games/games/`                                                                                                                                                                                                                                                  |
| `CATALOG_DIR`    | same as data dir | bundled `catalog/games/` resource (read-only online shells). Flatpak must install under `/app/lib/Potato Tomato/catalog/games/` because Tauri resolves Linux resources with `productName` (`Potato Tomato`), not the Cargo crate name. A `potato-tomato` symlink is also created for debugging. |

Downloaded `offline/` folders are **gitignored** under `static/games/` during development.

## Frontend client

The SvelteKit app uses `src/lib/utils/offline-downloader.ts` as a unified API. Detection lives in `src/lib/utils/offline-deployment.ts`; routing in `offline-runtime.ts`:

| Environment                | Backend          | Storage                          |
| -------------------------- | ---------------- | -------------------------------- |
| Public site (GitHub Pages) | Browser only     | IndexedDB + `offline-sw.js`      |
| Local app + puller running | Puller           | Files on disk (`GAMES_DATA_DIR`) |
| Local app, puller stopped  | Browser fallback | IndexedDB (limited mirrors)      |
| Tauri desktop              | Puller sidecar   | App data directory               |

Configure the puller URL with `PUBLIC_DOWNLOADER_URL` (default `http://127.0.0.1:18787`).
In Vite / `pnpm app`, offline APIs use same-origin `/api/offline/*` (proxied to the puller) so
WebKit/Tauri does not depend on cross-origin fetches to `:18787`. Packaged Flatpak/Tauri still
loads play iframes from `http://127.0.0.1:<port>/api/unity-play|game-live/…`, but **health and
respawn** go through Tauri `ensure_puller` / `get_puller_base_url` first — WebKit fetch to
loopback from `tauri://` is flaky and used to leave Unity shells on nested catalog HTML
(`Script error`) even when the sidecar was fine. `PUBLIC_OFFLINE_DEPLOYMENT=local-app`
is set by `pnpm app` and the Tauri beforeDevCommand.

### Game save data (browser profiles)

Per-game saves (`localStorage`, `sessionStorage`, cookies, IndexedDB) are emulated and persisted so online and offline play share one profile. Full documentation: [game-browser-storage.md](./game-browser-storage.md).

| Play path                             | Bridge injection                                      |
| ------------------------------------- | ----------------------------------------------------- |
| `/games/{id}/online/` or `/offline/`  | Vite middleware (dev) or service worker (public site) |
| `/puller-games/{id}/offline/`         | Same as app origin + puller HTML injection            |
| `/browser-offline/{id}/…`             | Service worker injects `game-storage-bridge.child.js` |
| Direct puller URL (`127.0.0.1:18787`) | Inline bridge; shell syncs via `postMessage`          |

| Deployment     | Profile storage                          |
| -------------- | ---------------------------------------- |
| Local + puller | `static/games/{id}/data/` (gitignored)   |
| GitHub Pages   | IndexedDB `potatotomato-browser-data-v1` |

Games embedded in third-party iframes (Poki, etc.) keep saves on the embed origin and cannot be mirrored automatically.

### Browser offline (GitHub Pages)

When the puller is unavailable but IndexedDB and service workers are supported:

1. **Download** crawls same-origin files under `/games/<id>/online/` and stores them in IndexedDB.
2. **Play** uses `/browser-offline/<id>/online/index.html`, served by `static/offline-sw.js`.
3. Games that load entirely from external iframes may still need network access after download.

Per-game online/offline preference is stored in localStorage via `src/lib/utils/game-play-mode.ts`.

When the puller drops mid-session, the UI falls back to browser storage but still probes
same-origin `/games/{id}/offline/` mirrors so previously downloaded offline copies remain
playable. Use **Retry puller** (or wait ~12s for auto-recovery) to reconnect without reloading;
Console / pause inject need the puller proxy for online Unity (otherwise the page shows
**Unity · CDN** and touch controls cannot inject).

On the game page, **View logs** opens diagnostics scoped to the current game only (play URL
resolution, download events, and relaunch events). **Relaunch** resets the player surface and
remounts the iframe so you can start fresh after a bad offline load. The in-memory ring buffer
may contain events from multiple games during an SPA session, but the game dialog filters and
clears only its own entries.

## GitHub Pages

Production builds use base path `/potatoetomatoe3` (override with `PUBLIC_PAGES_BASE` in CI).

**Public URL:** `https://dixonsolutions.github.io/potatoetomatoe3/` — game pages are `…/potatoetomatoe3/games/{id}` (not `…/games/{id}` at the domain root). The build copies SPA shells into each `games/{id}/` folder so GitHub Pages deep links work beside static game assets.

Deploy workflows: `.github/workflows/pages.yml` handles the fast web build on every `main` push, preserves `/flatpak/` from the latest successful Release artifact, and runs again after a successful Release to attach that exact new OSTree. `.github/workflows/release.yml` publishes the Flatpak and GitHub Release only. Manual web hotfixes: `pages.yml` or `deploy.yml` via **workflow_dispatch**.

Enable Pages in the repo: **Settings → Pages → Build and deployment → GitHub Actions**.

Note: private repos require a GitHub plan that includes Pages for private repositories.

## Touch console

Mirrored / offline play paths are what make the [universal touch console](./touch-console.md) able to inject keyboard events into the game document. With the local puller running, live relay (`/api/game-live`) and Unity play (`/api/unity-play`) also enable touch for external online embeds without a permanent download.
