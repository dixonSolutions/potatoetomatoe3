# Native-first architecture

Potato Tomato has two deliberate product surfaces:

- The GitHub Pages site is a fast catalog and player. It cannot capture a
  third-party game host — a browser page has no way to scrape a cross-origin
  origin — so it does not create mirrors of catalog titles that embed one, and it
  does not relay arbitrary sites. It does register the offline service worker,
  download same-origin games into IndexedDB, keep its own shell cached so those
  games survive losing the network, and offer touch controls wherever the game
  document is same-origin. It is stamped with
  `PUBLIC_OFFLINE_DEPLOYMENT=public-site`.
- The native app is the full player. Linux/Flatpak plays every game from its own
  host with the in-game bridge put into the game's frames by the webview itself,
  reads offline copies and saves from disk, and starts the Node puller only to
  capture a download (Playwright). Android plays bundled or imported mirrors and
  does not package Node.js or Playwright. Native frontend builds are stamped with
  `PUBLIC_OFFLINE_DEPLOYMENT=local-app` and also accept runtime Tauri signals
  (`globalThis.isTauri`, `tauri.localhost`, `TAURI_ENV_PLATFORM`).

## Play path: no puller

The desktop app used to route online games through the puller's Node relay
(`/api/game-live/:id`, `/api/unity-play/:id`), which re-fetched and rewrote every
asset of the game, and it started that process with the app. Both are gone. A launch
resolves to a chain of routes (`planOnlineRoutes` in
[`online-play-routing.ts`](../src/lib/utils/online-play-routing.ts)), best first:

| Route    | What the frame loads                                                          | Platforms            |
| -------- | ----------------------------------------------------------------------------- | -------------------- |
| `direct` | The game's own URL, as the public site does                                   | all                  |
| `local`  | The catalog's `online/embed.html` (Drive U 7) from a blob, bridge first       | all                  |
| `shell`  | HTML a host labels `text/plain` (jsDelivr), fetched into a blob with `<base>` | all                  |
| `relay`  | `ptrelay://localhost/game/<id>`: the in-process relay (`relay.rs`)            | desktop              |
| `puller` | The legacy Node relay — only if a puller already answers; never started       | desktop / `pnpm dev` |

What each class of game gets first:

| Games                                  | Why a plain frame fails                       | First route |
| -------------------------------------- | --------------------------------------------- | ----------- |
| Most of the catalog                    | it does not                                   | `direct`    |
| Drive U 7 on Google Sites (331)        | `X-Frame-Options: DENY`                       | `local`     |
| Drive U 7 on jsDelivr (215)            | HTML served as `text/plain`                   | `local`     |
| AddictingGames Flash `.swf` (341)      | `X-Frame-Options: SAMEORIGIN`, no CORS, Flash | `relay`     |
| Catalog shells that frame another host | (the wrapper hides the game from the console) | `direct`    |

On desktop, catalog shells that only frame a third-party page are unwrapped to that
page, and Unity embeds skip `/unity/player.html`: the bridge is injected into the game
frame itself, and a wrapper would stand between the console and the game.

### The bridge in cross-origin game frames

A game on its own host is a cross-origin document; page JavaScript cannot put anything
in it. The Linux webview can: `set_game_frame_context` (`src-tauri/src/game_frames.rs`)
installs `static/game-storage-bridge.child.js`, embedded at build time, as a WebKitGTK
user script that runs at document start in every frame, before the page's own script.
It is swapped per launch and carries the game's id; a page with no game has no bridge.
The preamble (`game_frames.js`) decides where it runs:

- never the top document, and only frames whose `location.ancestorOrigins` end at the
  app's origin;
- not the app's own same-origin documents, `blob:`/`about:` documents or a puller page:
  those carry the bridge in their HTML;
- **one frame per game owns the saved profile** — the outermost frame the app did not
  serve itself. The bridge restores the freshest per-origin storage bucket, so a portal
  shell and the game frame inside it would otherwise trade each other's saves. Frames
  inside it get the bridge without a game id (focus/pause) plus console input relayed
  down from the game frame; known ad hosts get nothing;
- a global guard, since `document.open()` re-runs user scripts on the same global;
- the first time a game runs with the bridge on an origin, its virtual store is seeded
  from what the game saved there before, so direct-play progress is kept.

Android keeps its own `native_touch_bridge.js` (`MainActivity`); nothing here runs there.

### Launch watchdog

`handleFrameLoadState` on the game page walks the chain without asking. A frame that
never fires `load` within 25 s and whose document never ran moves on to the next route;
so does, on desktop, a frame that loads but never runs a script — a host refusing to be
framed, an error page and a Flash file all still fire `load`, but only a real document
says hello from the preamble or the relay page. A frame that did say hello is left alone
however late its `load` is: one slow ad request holds `load` back while the game already
plays. Failed routes are remembered per game for the session (**Relaunch** clears them).
The user sees a toast only when every route failed, with **Open in browser** offered.

### Measured (2026-09-23)

`scripts/play-path-bench.mjs` launches a stable two-per-class sample through the real
`getGamePlayerUrl` in the Tauri webview (WebKitGTK 2.52, headless compositor) and in
Chromium, and reports from inside the frames (see the script's header). "Before" is the
puller relay as it shipped, with a puller running; "after" is this path with **no puller
at all**. The machine was shared with other benchmarks (load average 12–16 on 14 cores),
so single timings are noisy; the counts and the per-class routes are the result.

| Run                                      | Loaded | First canvas | Median resolve |
| ---------------------------------------- | -----: | -----------: | -------------: |
| Tauri before (puller relay)              |  16/20 |        10/20 |          69 ms |
| Tauri after (no puller)                  |  18/20 |        12/20 |          39 ms |
| Chromium before (puller relay)           |  17/20 |         9/20 |          67 ms |
| Chromium after (no puller, web behavior) |  14/20 |        12/20 |          61 ms |

Per class, in Tauri: Unity Play direct 0.9–2.0 s to canvas (1.2–2.0 s on the relay);
Coolmath direct 0.3 s where the relay took 9.9 s; both AddictingGames Flash titles now
play in Ruffle through the in-process relay (1.8 s; the Node relay never loaded them);
the jsDelivr and Sites Drive U 7 games play from `embed.html` (0.3–1.9 s) where two of
four were dead frames. Both AddictingGames HTML5 titles crash the WebKitGTK web process
before and after — a WebGL crash that reproduces in a bare WebKitGTK view and goes away
with WebGL disabled, so it is the engine in this environment, not the routing.

Resolution (the wait before the frame starts) is 13–73 ms for direct, relay and
`embed.html` routes, 139–189 ms for the Sites games (the `embed.html` fetch). The two
relays head to head on six games (`--force relay|puller`): median frame load 2.1 s for
the in-process relay against 6.2 s for the Node one.

### Offline copies and saves without Node

`ptoffline://localhost/<id>/<path>` (`src-tauri/src/offline_games.rs`) serves a mirror
from the app data games dir, falling back to the bundled catalog, with the HTML fixes the
puller applied (vaulted `_external/` URLs, the Unity patches, the bridge first). Offline
status, delete and per-game saves are Tauri commands that read and write the puller's
on-disk layout, so existing mirrors and saves are where they were. The frontend's
`native` offline backend uses them; **Download for offline** starts the puller on
demand (`ensure_puller`) for the capture and polls it. Health probes never start it.

## Native runtime diagnostics

In the packaged webview DevTools:

```js
({
	hostname: location.hostname,
	isTauri: globalThis.isTauri,
	PUBLIC_OFFLINE_DEPLOYMENT: import.meta.env.PUBLIC_OFFLINE_DEPLOYMENT,
	TAURI_ENV_PLATFORM: import.meta.env.TAURI_ENV_PLATFORM
});
```

Healthy Flatpak expectations:

- deployment resolves to `local-app`
- `PUBLIC_OFFLINE_DEPLOYMENT` is `local-app` (never `public-site`)
- `Download app` nav / browser-preview banner are hidden
- Offline download controls report `Game files on disk` (not `Browser storage`); no
  puller process runs until a download starts (`ps` shows no `puller-sidecar`)

Android Settings → App downloads the latest `.apk` asset from this repository’s
GitHub Releases. Flatpak updates remain system-managed (`flatpak update`).

Android APK packaging must stay under the ZIP32 **65535 entry** limit. The Android
Tauri config skips GitHub Pages per-game SPA fallbacks, drops `.gitkeep` / non-bundled
`offline/` trees via `scripts/slim-android-assets.mjs`, and does not re-bundle the
catalog as a separate `resources` tree (the WebView already serves the built games; the desktop resource catalog is sourced from `static/games`).

## Capture contract

The puller captures interactive pages with Playwright, observes successful
responses, discovers nested frames, rewrites assets to local paths, and writes
`mirror-manifest.json` beside the offline entry document. Each manifest records
the game ID, entry path, capture method, source URL, file sizes, SHA-256 hashes,
capture time, and diagnostics. `capture-manifest.json` retains response-level
metadata for debugging and future import tooling.

Playwright is a capture and clean-context verification tool, not a renderer.
Mirrors always play in the platform WebView. The existing wget path remains a
bounded fallback and is marked as such in the manifest.

## Platform distribution

The central release workflow calculates the next `0.0.<number>` version and creates
an immutable `release-<number>` tag at the merged commit. Linux/Flatpak and Android
jobs use that same tag and commit SHA but publish independently. The download site
links to the matching GitHub Release and presents Linux/Flatpak first.
Android is a manually updated APK; there is no F-Droid repository or app
update remote.

Windows, macOS, and iOS remain future targets until each has a tested capture,
packaging, signing, and update strategy.
