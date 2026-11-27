# Offline downloads

Two backends, picked by `getOfflineBackend()` in `src/lib/utils/offline-runtime.ts`.
The legacy Node puller (Playwright capture + HTTP API) was removed in M3; nothing starts a
separate process any more.

## Desktop app (`native`)

`src-tauri/src/offline_download.rs` downloads a game over HTTP, in the app process:

1. **Start document:** catalog `online/metadata.json` `onlineEmbedUrl` / `remotePlayUrl`;
   Drive U 7 games use the catalog's `online/embed.html` against `embedBaseUrl`; games whose
   files ship in the catalog are copied from `online/`.
2. **Discovery:** tag `src`/`href` (scripts, images, media, `<link>`, frames), CSS
   `url()`/`@import`, quoted paths with an asset extension in scripts and JSON. `<a href>`
   is never followed. Ad and analytics hosts are skipped.
3. **Layout:** `<data>/<id>/offline.part/_external/<host>/<path>`, swapped in as
   `offline/` with `offline-manifest.json` (`entry`, `title`, `description`, `author`,
   `thumbnail`, `files`, `bytes`) only when complete. A cancelled download keeps
   `offline.part/` and resumes from it.
4. **Limits:** public addresses only (same resolver and redirect rules as `relay.rs`),
   6 parallel fetches, 6000 files, 2 GB per game, 768 MB per file.

Commands: `offline_download_start`, `offline_download_progress`, `offline_download_cancel`
(`discard` drops the partial files), plus `offline_statuses`, `offline_entry`,
`offline_delete` in `offline_games.rs`.

Serving (`offline_games.rs`, `ptoffline://localhost/<id>/<path>`): absolute URLs whose file
is in the copy are rewritten to `/<id>/_external/<host>/…` in HTML, CSS, JS and JSON;
site-root paths (`/js/a.js`) in a vaulted document map into that document's host folder;
run-time site-root requests are mapped back through the `Referer`. The storage bridge is
inlined first in every HTML document.

Copies written by the old puller use the same layout and still play.

## Web and Android (`browser`)

`src/lib/utils/browser-offline-download.ts` crawls the same-origin online shell
(`/games/<id>/online/`) into IndexedDB; the service worker serves it offline. Games whose
shell frames a third-party host cannot be saved from a browser and say so.

## Saves

Per-game saves live in `<data>/<id>/profile/…` on desktop (`game_profile_*` commands) and in
IndexedDB elsewhere (`game-browser-storage.ts`).
