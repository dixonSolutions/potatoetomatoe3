# Per-game browser storage

Games persist saves in browser storage (`localStorage`, `sessionStorage`, cookies, IndexedDB). This app emulates that storage per catalog game so **online and offline play share the same profile**, with persistence that matches the offline-download backend split.

See also: [offline-downloader.md](./offline-downloader.md) for game file mirrors.

## Backend selection

| Deployment                     | Backend            | Where profiles live                                                |
| ------------------------------ | ------------------ | ------------------------------------------------------------------ |
| **Public site** (GitHub Pages) | `browser`          | IndexedDB `potatotomato-browser-data-v1` → store `browserProfiles` |
| **Local app** + puller         | `puller`           | `{GAMES_DATA_DIR}/{gameId}/data/` on disk                          |
| **Local app**, puller down     | `browser` fallback | Same IndexedDB store                                               |

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

| Route                               | Action              |
| ----------------------------------- | ------------------- |
| `GET /api/browser-data/{gameId}`    | Read profile        |
| `PUT /api/browser-data/{gameId}`    | Write profile       |
| `DELETE /api/browser-data/{gameId}` | Remove `data/` tree |

Deleting an **offline** game copy does **not** delete `data/` saves.

## Virtual storage (the in-frame bridge)

`static/game-storage-bridge.child.js` is injected as the **first thing in `<head>`** of
every game document it can reach, so it runs before any game script.

It gives each game its own **virtual** `localStorage`, `sessionStorage` and cookie jar,
keyed by catalog id:

- Same-origin games no longer share one bucket with each other and with the app — a
  game's `localStorage.clear()` cannot wipe the app's settings or another game's saves.
- The stores are ready **synchronously** at boot, from the first of:
  1. the profile the app preloaded on `top.__ptGameProfiles` (same-origin frames — the
     game page reads it while the Play poster is up);
  2. this origin's own cached copy (`__pt_vs:{gameId}:*` keys in real storage);
  3. a `pull` over postMessage (cross-origin frames, e.g. the puller on loopback). If that
     late profile brings saves the game booted without, the frame reloads once, carrying
     the profile across the reload so it wins over anything written in between. The
     answer is accepted only from the app window (`top`), and only the first one counts.
     A slow answer is not "no saves": the pull is repeated with backoff (4 s … 64 s) and
     pushes stay held until an answer arrives.
- Changes are pushed back (debounced, and on pause / `pagehide`) only once the saved
  profile is known, so an empty boot can never overwrite real saves. The origin's cache
  copy is written at most once a second (and at once on pause, `pagehide`, teardown and
  the late-profile reload): each write rewrites the whole store.
- Each localStorage bucket carries a `__pt_ts` stamp, so when online play and the
  offline mirror (different origins) both have a copy, the newest one wins.
- **One set of stores per game per origin.** Portal shells, relayed pages and offline
  mirrors nest the real game in a same-origin frame, and every such document gets the
  bridge with the same game id. The outermost bridge of the game on an origin owns the
  stores and the sync with the app; nested bridges borrow its localStorage,
  sessionStorage and cookie jar and hand it the database connections they open. (Each
  frame used to keep its own copy, and whichever pushed last rolled the other's saves
  back.)

**IndexedDB** stays real — it is already per origin and per database name. The bridge
mirrors it into the profile after each write transaction (coalesced) with a typed
encoding (`__pt2:` prefix), so `Uint8Array`, `ArrayBuffer`, `Date`, `Map`/`Set` —
Unity IDBFS stores `{ timestamp: Date, contents: Uint8Array }` — survive the round trip.
Restores are add-if-absent, so a stale profile never overwrites newer real data; the one
exception is the reload-onto-late-profile case above. A push carries only the databases
the frame has read back from the real database, never the saved copy of one it did not
open. `UnityCache` (a rebuildable asset cache) is not mirrored.

If a browser refuses to let `window.localStorage` be redefined, the bridge falls back to
hydrating and sampling the real store.

The app side (`src/lib/utils/game-storage-bridge.ts`) answers `pull` / `push` only for
frames nested in the page, merges pushes per origin bucket and per database
(`mergeGameBrowserProfiles`) instead of replacing the whole profile, and serialises
writes per game. Pushes that arrive while a write is running are folded into one next
write, so a slow store cannot queue a profile copy per push.

Injection:

| Play path                                                | Mechanism                                                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `/browser-offline/{id}/…` and `blob:` offline shells     | `offline-sw.js` / `browser-offline-download.ts` inject the bridge script (blob shells carry `data-pt-game`)                                   |
| `/games/{id}/online/…`, `/games/{id}/offline/…` (public) | Service worker intercepts HTML                                                                                                                |
| `/games/…` (local dev)                                   | Vite `games-html-bridge-inject` middleware (only `/games/**` — must not 404 Vite `/@fs` or `/node_modules` modules or the app never hydrates) |
| Puller HTML (offline, live relay, Unity proxy)           | Inlined by `injectGameStorageBridge` with `window.__ptGameId`                                                                                 |

Parent handler: `attachGameStorageBridge()` in `+layout.svelte`; preload:
`preloadGameBrowserProfile()` on the game page.

End-to-end check: `pnpm bridge-test` (see [dev-test-harnesses.md](./dev-test-harnesses.md)).

## Limitations

- **Third-party embeds** (Poki iframe, external CDN shells): saves stay on the embed origin; not mirrored.
- **httpOnly cookies** cannot be restored from JS.
- **A failed profile read looks like "no saves".** `loadGameBrowserProfile` returns `null`
  both when a game has no profile and when the read fails (puller error, IndexedDB
  error). The app then answers the pull with `null`, and if the following write succeeds
  it stores only what that session wrote. Telling the two apart needs the loaders to
  report failures.
- Profiles are **per browser / per machine** (like offline downloads), not synced to GitHub.

## Legacy migration

Old shell snapshots under `potato-tomato-game-browser-data-{gameId}` in app `localStorage` are imported once into the new profile (localStorage for the play origin) when no profile exists yet.

Profiles written before virtual storage snapshotted the app origin's _entire_
localStorage. On first boot the bridge seeds the game's virtual store from that bucket,
skipping the app's own keys (`potato-tomato-*`, `pt-*`, `scn-*`, `mode-watcher*`).
