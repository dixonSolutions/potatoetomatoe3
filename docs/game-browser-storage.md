# Per-game browser storage

Games persist saves in browser storage (`localStorage`, `sessionStorage`, cookies, IndexedDB). This app emulates that storage per catalog game so **online and offline play share the same profile**, with persistence that matches the offline-download backend split.

See also: [offline-downloader.md](./offline-downloader.md) for game file mirrors.

## Backend selection

| Deployment                        | Backend            | Where profiles live                                                   |
| --------------------------------- | ------------------ | --------------------------------------------------------------------- |
| **Public site** (GitHub Pages)    | `browser`          | IndexedDB `potatotomato-browser-data-v1` → store `browserProfiles`    |
| **Desktop app**                   | `native`           | `{games data dir}/{gameId}/data/`, read and written by the app itself |
| **`pnpm dev`** in a browser       | `puller`           | `{GAMES_DATA_DIR}/{gameId}/data/` on disk, through the dev puller     |
| **`pnpm dev`**, no puller running | `browser` fallback | Same IndexedDB store                                                  |

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
     A slow answer is not "no saves": the pull is repeated with backoff (4 s … 64 s, then
     every 64 s for as long as the game runs) and pushes stay held until an answer
     arrives. No answer at all is also what the app gives when it could not read the
     saves (see [Failed reads](#failed-reads)).
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

The app side (`src/lib/utils/game-storage-bridge.ts`) merges pushes per origin bucket and
per database (`mergeGameBrowserProfiles`) instead of replacing the whole profile, and
serialises writes per game. Pushes that arrive while a write is running are folded into
one next write, so a slow store cannot queue a profile copy per push.

**A game's saves belong to the frame hosting it.** `LazyGameFrame` registers its iframe
with the game's id (`registerGameFrameHost`), and a `pull` or `push` for game X is acted on
only when it comes from that iframe's window or a window nested under it. The check walks
`source.parent` up to the hosting iframe's `contentWindow` — `parent` is readable across
origins, so native-injected game frames on their own host and nested portal frames pass,
while a frame in the app page outside the game, or a frame inside game X naming game Y,
does not. (Any frame nested in the page used to be able to read or write any game's saves
by naming it.) A frame being torn down flushes from `pagehide`, when it is no longer in
the frame tree and has no parent to walk: its push counts only if that window was seen
inside the frame hosting that game — noted at registration, on the frame's `load`, and on
every message it sent while attached.

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

## Failed reads

A failed read is not "no saves". `loadGameBrowserProfile` resolves to the profile, to `null`
when the game has none, and throws `GameProfileReadError` when the store could not say:

| Backend   | "No saves"                            | A failed read (throws)                                                                   |
| --------- | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `native`  | no `data/` dir, or nothing in it      | `game_profile_read` fails: a file that cannot be read or does not parse (logged by Rust) |
| `puller`  | `GET /api/browser-data/{id}` is a 404 | the puller is gone, answers another error (a file it cannot parse is now a 500), or junk |
| `browser` | no record in `browserProfiles`        | IndexedDB cannot be opened or read, or holds a record that is not a profile              |

Before this, every one of those failures came back as `null`. The bridge's rule — never
push before the saved profile is known — relies on that answer, so a transient failure let
the next write replace the real saves with what one session wrote. Now:

- The preload leaves `__ptGameProfiles[id]` unset, so a same-origin frame pulls instead of
  booting from "no saves".
- A `pull` is not answered unless the read succeeds (or this page already knows the saves
  from an earlier read and the pushes since). The frame keeps its pushes held and asks
  again with backoff.
- A `push` that needs the stored profile to merge into, when it cannot be read, is held in
  memory under anything pushed later and retried (2 s, doubling to 60 s). Nothing is
  written until a read succeeds.

The native write still falls back to IndexedDB when the disk write fails. That is a write
failure, outside this rule; the IndexedDB copy is read back only while nothing is on disk.

## Limitations

- **Third-party embeds** (Poki iframe, external CDN shells): saves stay on the embed origin; not mirrored.
- **httpOnly cookies** cannot be restored from JS.
- **A profile file that stays unreadable blocks syncing that game.** Its frames keep their
  own per-origin cache (`__pt_vs:*`), so progress on that origin survives, but nothing is
  written to the profile until the file is fixed or removed.
- Profiles are **per browser / per machine** (like offline downloads), not synced to GitHub.

## Legacy migration

Old shell snapshots under `potato-tomato-game-browser-data-{gameId}` in app `localStorage` are imported once into the new profile (localStorage for the play origin) when no profile exists yet.

Profiles written before virtual storage snapshotted the app origin's _entire_
localStorage. On first boot the bridge seeds the game's virtual store from that bucket,
skipping the app's own keys (`potato-tomato-*`, `pt-*`, `scn-*`, `mode-watcher*`).
