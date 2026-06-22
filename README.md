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

## Flatpak (Linux desktop)

App ID: `com.potatotomato.games`

### Install from the public remote (recommended)

Requires [Flatpak](https://flatpak.org/setup/) and the Flathub remote:

```bash
# One-time setup
flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak remote-add --user --if-not-exists potatotomato \
  https://dixonsolutions.github.io/potatoetomatoe3/potatotomato.flatpakrepo

# Install and run
flatpak install --user potatotomato com.potatotomato.games
flatpak run com.potatotomato.games
```

Updates:

```bash
flatpak update --user com.potatotomato.games
```

### Install from a GitHub Release bundle

If the remote is unavailable, download `com.potatotomato.games-*.flatpak` from
[GitHub Releases](https://github.com/dixonSolutions/potatoetomatoe3/releases) and install:

```bash
flatpak install --user ~/Downloads/com.potatotomato.games-*.flatpak
flatpak run com.potatotomato.games
```

### Build locally

Build the Tauri app and puller sidecar on the host first, then package with Flatpak:

```bash
git clone https://github.com/dixonSolutions/potatoetomatoe3.git
cd potatoetomatoe3

flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak install -y flathub org.gnome.Platform//50 org.gnome.Sdk//50

# Tauri build deps (Debian/Ubuntu)
sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf

pnpm install --frozen-lockfile
pnpm puller:bundle:linux
pnpm tauri:build
pnpm flatpak:install   # build + install to ~/.local/share/flatpak
pnpm flatpak:run
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
2. Publishes a [GitHub Release](https://github.com/dixonSolutions/potatoetomatoe3/releases) with a `.flatpak` bundle
3. Deploys the web app plus OSTree Flatpak repo to GitHub Pages (`/flatpak/` + `potatotomato.flatpakrepo`)

See [docs/release.md](docs/release.md) for CI details and troubleshooting.

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
