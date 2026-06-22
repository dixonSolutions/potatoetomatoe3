# Potato Tomato 3

Browse and play unblocked HTML5 games in the browser or as a **Tauri 2** desktop app. Download individual games for offline play via the separate **puller** backend service.

## Features

- Game catalog with search, categories, favourites, and recommendations
- **Per-game offline download** — download, delete, and switch between online/offline versions on each game page
- **Downloaded only** filter on the games browse page
- **Shrek: Escape from the Swamp** bundled with a pre-built offline copy
- Tauri desktop shell + Flatpak packaging with public OSTree remote on GitHub Pages

## Quick start (web)

```bash
pnpm install
pnpm dev          # web dev + offline downloader (opens browser)
pnpm app          # Tauri desktop + offline downloader
```

Offline download runs in a bundled **puller** backend that starts automatically with `pnpm app` (Tauri) and packaged Flatpak/AppImage builds. Downloaded games are stored in app data (`~/.local/share/com.potatotomato.games/games/`), not in the git repo.

For web dev only, `pnpm dev` also starts the puller. User-downloaded `offline/` folders under `static/games/` are gitignored.

If game thumbnails or online shells are missing after a fresh clone, restore from the last build:

```bash
pnpm games:restore-from-build   # copies online/ + metadata from build/games/
```

## Desktop (Tauri)

```bash
pnpm install
pnpm tauri:dev    # starts Vite + Tauri; puller auto-spawns in debug builds
pnpm tauri:build  # production binary in src-tauri/target/release/
```

**Linux deps:** `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf`

## Flatpak

### Build locally

```bash
pnpm flatpak:build
pnpm flatpak:run
```

### Install from public remote (after CI release)

```bash
flatpak remote-add --if-not-exists potatotomato \
  https://dixonsolutions.github.io/potatoetomatoe3/potatotomato.flatpakrepo
flatpak install potatotomato com.potatotomato.games
flatpak run com.potatotomato.games
```

## Puller service

The puller runs as a **separate Node package** at [`puller/`](puller/). It exposes:

| Endpoint                        | Method | Description                      |
| ------------------------------- | ------ | -------------------------------- |
| `/api/offline/health`           | GET    | Service health                   |
| `/api/offline/status`           | GET    | All games' online/offline status |
| `/api/offline/status/:gameId`   | GET    | Single game status               |
| `/api/offline/:gameId/download` | POST   | Start offline download           |
| `/api/offline/:gameId/progress` | GET    | Download progress                |
| `/api/offline/:gameId`          | DELETE | Remove offline copy              |
| `/games/:gameId/...`            | GET    | Serve offline game files         |

**Strategies:** `embed` (Unity/Google Sites — Shrek) and `generic` (iframe wget mirror).

See [docs/offline-downloader.md](docs/offline-downloader.md) for details.

## Project structure

```
PotatoeTomatoe3/
├── puller/              # Offline download backend (Playwright + HTTP API)
├── src/                 # SvelteKit frontend
├── src-tauri/           # Tauri Rust shell (+ puller sidecar)
├── static/games/        # Game catalog (gitignored except shrek-escape)
├── flatpak/             # Flatpak manifest
├── scripts/             # Catalog generators, port importers
└── docs/                # Architecture & release docs
```

## CI / releases

Every push to `main` runs [`.github/workflows/release.yml`](.github/workflows/release.yml):

1. Builds Flatpak + puller sidecar
2. Publishes GitHub Release with `.flatpak` bundle
3. Deploys web build + OSTree Flatpak repo to GitHub Pages

## Scripts

| Script                          | Description                              |
| ------------------------------- | ---------------------------------------- |
| `pnpm dev`                      | Web dev server (opens browser)           |
| `pnpm app`                      | Tauri desktop app                        |
| `pnpm puller:start`             | Start puller backend                     |
| `pnpm games:restore-from-build` | Restore online shells from `build/games` |
| `pnpm tauri:dev`                | Alias for `pnpm app`                     |
| `pnpm flatpak:build`            | Local Flatpak build                      |
| `pnpm port-game`                | Import a game from tag2game              |

## License

MIT — game assets are third-party content where applicable.
