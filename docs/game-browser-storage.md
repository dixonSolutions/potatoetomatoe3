# Per-game browser storage

Games persist saves in browser storage (`localStorage`, `sessionStorage`, cookies, IndexedDB). This app emulates that storage per catalog game so **online and offline play share the same profile**, with persistence that matches the offline-download backend split.

See also: [offline-downloader.md](./offline-downloader.md) for game file mirrors.

## Backend selection

| Deployment | Backend | Where profiles live |
|------------|---------|---------------------|
| **Public site** (GitHub Pages) | `browser` | IndexedDB `potatotomato-browser-data-v1` → store `browserProfiles` |
| **Local app** + puller | `puller` | `{GAMES_DATA_DIR}/{gameId}/data/` on disk |
| **Local app**, puller down | `browser` fallback | Same IndexedDB store |

Detection reuses `offline-deployment.ts` (`PUBLIC_OFFLINE_DEPLOYMENT`, Tauri, localhost, etc.).

API: `src/lib/utils/game-browser-storage.ts` (`loadGameBrowserProfile`, `saveGameBrowserProfile`, `getBrowserDataBackend`).

## On-disk layout (Chromium-inspired)

Per game, under `static/games/{gameId}/data/` (gitignored):

```
data/
  meta.json
  profile/Default/
    localStorage.json      # { "https://origin": { key: value } }
    sessionStorage.json
    cookies.json
    indexeddb/
      {dbName}/
        meta.json
        records.json
```

JSON replaces Chromium LevelDB for inspectability and simple Node I/O. Folder names mirror profile domains (`Default`, `Local Storage` conceptually).

Puller API:

| Route | Action |
|-------|--------|
| `GET /api/browser-data/{gameId}` | Read profile |
| `PUT /api/browser-data/{gameId}` | Write profile |
| `DELETE /api/browser-data/{gameId}` | Remove `data/` tree |

Deleting an **offline** game copy does **not** delete `data/` saves.

## Bridge and IndexedDB shim

`static/game-storage-bridge.child.js` runs inside the game iframe:

1. **pull** → parent loads profile → **hydrate** into the iframe
2. **push** (interval + `pagehide`) → parent saves profile

Captures:

- `localStorage` / `sessionStorage` (per `location.origin`)
- `document.cookie` (non-`httpOnly` only on hydrate)
- **IndexedDB** via a shim on `indexedDB.open` that mirrors puts/deletes into the profile

Injection:

| Play path | Mechanism |
|-----------|-----------|
| `/browser-offline/{id}/…` | `offline-sw.js` injects bridge script |
| `/games/{id}/online|offline/…` (public site) | Service worker intercepts HTML |
| `/games/…` (local dev) | Vite `games-html-bridge-inject` middleware |
| Puller offline HTML | Inline or script injection in puller |

Parent handler: `attachGameStorageBridge()` in `+layout.svelte`.

Same-origin teardown backup: `captureGameStorageFromIframe` in `LazyGameFrame.svelte`.

## Limitations

- **Third-party embeds** (Poki iframe, external CDN shells): saves stay on the embed origin; not mirrored.
- **httpOnly cookies** cannot be restored from JS.
- Profiles are **per browser / per machine** (like offline downloads), not synced to GitHub.

## Legacy migration

Old shell snapshots under `potato-tomato-game-browser-data-{gameId}` in app `localStorage` are imported once into the new profile (localStorage for the play origin) when no profile exists yet.
