# Offline downloader service

The app picks an offline backend automatically from where it is running:

| Deployment | Detection | Download storage | Play path |
|------------|-----------|------------------|-----------|
| **Public site** (GitHub Pages) | Production host, not localhost/Tauri | Browser **IndexedDB** + service worker | `/browser-offline/{id}/…` |
| **Local app** (`pnpm dev`, Tauri) | `import.meta.env.DEV`, Tauri, or localhost | **Puller** writes files to disk | `/puller-games/{id}/offline/…` (dev proxy) |

Override with `PUBLIC_OFFLINE_DEPLOYMENT=public-site` or `local-app` in `.env` if needed.

The puller is a standalone Node.js backend at `puller/` that mirrors games into `static/games/<id>/offline/` and serves them over HTTP.

## Running

```bash
pnpm puller:start          # production
pnpm puller:dev            # watch mode
```

Environment variables:

| Variable               | Default               | Description                             |
| ---------------------- | --------------------- | --------------------------------------- |
| `PULLER_PORT`          | `18787`               | HTTP listen port (8787 used by Cursor Voice) |
| `GAMES_DATA_DIR`       | `<repo>/static/games` | Writable games root                     |
| `PULLER_CORS_ORIGIN`   | `*`                   | CORS header                             |
| `EMBED_STRATEGY_GAMES` | `shrek-escape`        | Comma-separated embed-strategy game IDs |

## Security

- Game IDs are validated against `games-list.json` (allowlist)
- Path traversal is rejected on static file serving
- Writes are restricted to `<dataDir>/<gameId>/offline/`

## Strategies

### `embed`

Used for Unity WebGL games embedded via Google Sites (Shrek). Carried over from ShrekEscape2 `pull/`:

1. Discover game via Playwright (FILE_URL from embed page)
2. Download split Brotli Unity assets
3. Merge parts, scan external media, write ad-free host HTML

Set `pullStrategy: "embed"` in `online/metadata.json` or add the game ID to `EMBED_STRATEGY_GAMES`.

### `generic`

Default for catalog games:

1. Read `online/index.html` iframe URL
2. Mirror with `wget --mirror`
3. Deep-fetch referenced assets

## Tauri integration

In debug builds, Tauri spawns `pnpm exec tsx puller/src/index.ts` on startup.

In release builds, the puller is bundled as a sidecar binary (`src-tauri/binaries/puller-sidecar`) built via `pnpm puller:bundle:linux`.

The desktop app sets `GAMES_DATA_DIR` to the app data directory so downloads persist outside the read-only bundle.

| Variable | Dev | Packaged app |
|----------|-----|--------------|
| `GAMES_DATA_DIR` | `static/games/` | `~/.local/share/com.potatotomato.games/games/` |
| `CATALOG_DIR` | same as data dir | bundled `catalog/games/` resource (read-only online shells) |

Downloaded `offline/` folders are **gitignored** under `static/games/` during development.

## Frontend client

The SvelteKit app uses `src/lib/utils/offline-downloader.ts` as a unified API. Detection lives in `src/lib/utils/offline-deployment.ts`; routing in `offline-runtime.ts`:

| Environment | Backend | Storage |
|-------------|---------|---------|
| Public site (GitHub Pages) | Browser only | IndexedDB + `offline-sw.js` |
| Local app + puller running | Puller | Files on disk (`GAMES_DATA_DIR`) |
| Local app, puller stopped | Browser fallback | IndexedDB (limited mirrors) |
| Tauri desktop | Puller sidecar | App data directory |

Configure the puller URL with `PUBLIC_DOWNLOADER_URL` (default `http://127.0.0.1:18787`).

### Game save data (localStorage)

Offline play reuses in-game browser storage where possible:

| Play path | Storage behaviour |
|-----------|-------------------|
| `/games/{id}/online/` or `/offline/` | Same origin — shared `localStorage` |
| `/puller-games/{id}/offline/` (dev proxy) | Same origin as the app — shared with static paths |
| `/browser-offline/{id}/…` | Same origin; service worker injects `game-storage-bridge.child.js` |
| Direct puller URL (`127.0.0.1:18787`) | Cross-origin; puller injects a bridge script and the shell syncs saves via `postMessage` |

Snapshots are stored in the app shell under `potato-tomato-game-browser-data-{gameId}`. Games embedded in third-party iframes (Poki, etc.) keep saves on the embed origin and cannot be mirrored automatically.

### Browser offline (GitHub Pages)

When the puller is unavailable but IndexedDB and service workers are supported:

1. **Download** crawls same-origin files under `/games/<id>/online/` and stores them in IndexedDB.
2. **Play** uses `/browser-offline/<id>/online/index.html`, served by `static/offline-sw.js`.
3. Games that load entirely from external iframes may still need network access after download.

Per-game online/offline preference is stored in localStorage via `src/lib/utils/game-play-mode.ts`.

## GitHub Pages

Production builds use base path `/potatoetomatoe3` (override with `PUBLIC_PAGES_BASE` in CI).

Deploy workflow: `.github/workflows/pages.yml` (runs on push to `main`).

Enable Pages in the repo: **Settings → Pages → Build and deployment → GitHub Actions**.

Note: private repos require a GitHub plan that includes Pages for private repositories.
