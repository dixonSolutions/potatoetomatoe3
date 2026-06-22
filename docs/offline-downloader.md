# Offline downloader service

The puller is a standalone Node.js backend at `puller/` that mirrors games into `static/games/<id>/offline/` and serves them over HTTP.

## Running

```bash
pnpm puller:start          # production
pnpm puller:dev            # watch mode
```

Environment variables:

| Variable               | Default               | Description                             |
| ---------------------- | --------------------- | --------------------------------------- |
| `PULLER_PORT`          | `8787`                | HTTP listen port                        |
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

The SvelteKit app uses `src/lib/utils/offline-downloader.ts` as a unified API. It picks a backend automatically:

| Environment | Backend | Storage |
|-------------|---------|---------|
| Tauri desktop / `pnpm dev` | Puller HTTP service | Files on disk (`GAMES_DATA_DIR`) |
| GitHub Pages / static web | Browser (IndexedDB + service worker) | Per-browser persistent storage |

Configure the puller URL with `PUBLIC_DOWNLOADER_URL` (default `http://127.0.0.1:8787`).

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
