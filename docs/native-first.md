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

### When a game crashes the web process

WebKitGTK runs cross-origin frames in the page's own web process, so a game that crashes
it takes the whole app page down: the window goes blank. The AddictingGames HTML5 titles
above do exactly that. On Linux the app watches the webview's `web-process-terminated`
signal ([`webview_crash.rs`](../src-tauri/src/webview_crash.rs)) and reloads the page the
user was on, logging the reason and the URL.

A game page is not simply reloaded into the same game, which would crash again and reload
again. The crash is kept on the native side; the reloaded game page takes it once
(`take_webview_crash`, [`webview-crash.ts`](../src/lib/utils/webview-crash.ts)) and, when it
was this game, holds the frame back behind "This game crashed the player" with **Open in
browser** and **Play here anyway**. Coming back to the game later starts it as usual.
Automatic reloads are capped at three a minute; the fourth crash in a minute gets a static
page with a link back to the games instead.

Debug builds can crash the web process on purpose: the `debug_crash_webview` command, or
`POTATO_TOMATO_DEBUG_CRASH_ON_GAME=<ms>` (once a game page has been open that long; every
time with `POTATO_TOMATO_DEBUG_CRASH_REPEAT=1`). Verified in the Tauri app under the
headless compositor: `addicting-flower-shop-2` crashed WebKit by itself, the page came
back on its game page showing the notice with no game frame, and nothing crashed again;
the debug trigger on `crazygames-foot-chinko` did the same, and with repeats the fourth
crash in a minute got the static page and no reload.

### Offline copies and saves without Node

`ptoffline://localhost/<id>/<path>` (`src-tauri/src/offline_games.rs`) serves a mirror
from the app data games dir, falling back to the bundled catalog, with the HTML fixes the
puller applied (vaulted `_external/` URLs, the Unity patches, the bridge first). Offline
status, delete and per-game saves are Tauri commands that read and write the puller's
on-disk layout, so existing mirrors and saves are where they were. The frontend's
`native` offline backend uses them; **Download for offline** starts the puller on
demand (`ensure_puller`) for the capture and polls it. Health probes never start it.

## WebKitGTK tuning for games (Linux)

The engine bench ([report](field-tests/engine-bench-2026-09-23/REPORT.md)) found that
most of what made games slower in the Linux app than in Chromium was not engine speed but
three WebKitGTK behaviours meant for documents. The app keeps WebKitGTK and switches each
off while a game is on screen. Everything starts with `set_game_frame_context` and ends
when the game page is left ([`game_frame_tuning.rs`](../src-tauri/src/game_frame_tuning.rs));
each part falls back to the old behaviour on its own, and none of it exists on Android
(Chromium WebView) or on the public site. Measured in the app's own binary (the report's
[Implemented](field-tests/engine-bench-2026-09-23/REPORT.md#implemented-2026-09-24)
section): in power saver, Unity and WebGL sprites 31 → 60 fps with a game open; a
cross-origin probe frame 30 → 60 fps from its first second; at 125 %, GPU-bound WebGL
8 → 19 fps and WebGL sprites 31 → 60 (Chromium: 21 and 60).

- **Power saver** ([`power_profile.rs`](../src-tauri/src/power_profile.rs),
  [`gio/full-speed-power-monitor.c`](../src-tauri/gio/full-speed-power-monitor.c)).
  WebKitGTK halves `requestAnimationFrame` to 30 fps whenever GLib's power-profile monitor,
  asked in the web process, says power-saver, and GNOME turns that on by itself on low
  battery. `build.rs` compiles a 23 kB GIO module against gio-2.0 (with the `cc` crate) and
  the binary embeds it; at startup, before any thread or webview exists, the app writes it
  to `<cache>/<identifier>/webkit-tuning/gio/<hash>/` and prepends that directory to
  `GIO_EXTRA_MODULES`, with `GIO_USE_POWER_PROFILE_MONITOR=potato-full-speed`. WebKit's web
  processes inherit both. The module wraps GLib's own monitor (D-Bus, or the portal in a
  Flatpak), forwards its answer and its change signal, and reports "not in power saver"
  only while a flag file exists — the app creates it when a game frame starts and removes
  it when the game page is left, and the module follows it through a `GFileMonitor`. It
  takes over only in a `WebKitWebProcess` started by the app; anywhere else (a browser
  opened from the app inherits the environment) GIO uses its normal monitor. Nothing is
  bundled or installed, so the Flatpak manifest needs nothing for it: the cache directory
  and the flag's runtime directory are the same inside the sandbox for the web processes.
  Setting: **Full frame rate in power saver** (Playing, on by default, read at startup).
  - Fallback: no module in the binary (no C compiler or gio-2.0 headers at build time: a
    cargo warning), the setting off, a failed write, a module GIO cannot load, or
    `GIO_USE_POWER_PROFILE_MONITOR` already set by the user — WebKit's normal behaviour,
    and one log line saying why.
  - Crash guard: the bench saw one unexplained web-process abort (a GLib `getauxval`
    error) in 24 launches with the first, unconditional version of the module. The app's
    `web-process-terminated` handler reports crashes here; two in a session with the
    module active, or one within 30 s of startup, turn it off for the following launches
    of that module build (`disabled-after-crash.json`, logged). Switching the setting off
    and on again retries. The soak test of this version is in the report.
- **The cross-origin frame throttle**
  ([`frame_first_input.rs`](../src-tauri/src/frame_first_input.rs)). WebKit runs a
  cross-origin frame the user has not interacted with at 30 fps, and every game is
  cross-origin to the app page. The throttle lifts on the first click, or on the first key
  press while the frame has focus; measured, a real key press and a GDK key event sent to
  the `WebKitWebView` both lift it (30 → 60 fps), and neither does without frame focus.
  So there is no "click to play" cover: once a game document has announced itself (the
  native preamble, or the bridge asking for its saves) and its frame holds focus,
  [`native-game-frames.ts`](../src/lib/utils/native-game-frames.ts) asks for one F24 press,
  sent natively as a GDK event. F24 is on no normal keyboard and no game binds it (WebKit
  reports `key: "Unidentified"`, `keyCode: 135`); the app's in-frame script swallows it in
  capture phase before any game listener. Nested frames a portal loads inside the game
  announce themselves too and get their own press. If the press never happens, the
  player's first input lifts the throttle, as before. Like a real key press, it counts as
  a user gesture for that document: for WebKit's activation window a game could start
  audio, go fullscreen or lock the pointer by itself (`window.open` does nothing in the
  app, which has no new-window handler). `POTATO_TOMATO_FIRST_INPUT=0` turns it off for a
  run.
- **Fractional scaling** ([`display_scale.rs`](../src-tauri/src/display_scale.rs),
  [`game_frame_tuning.js`](../src-tauri/src/game_frame_tuning.js)). GTK3 has no fractional
  scaling, so at 125 % WebKitGTK renders at scale 2 (`devicePixelRatio` 2) and the
  compositor scales down: 2.56 times the pixels, and GPU-bound games lose more than half
  their frame rate. At each game start the app reads the real scale of the window's
  monitor from `org.gnome.Mutter.DisplayConfig.GetCurrentState` and a document-start
  script caps `devicePixelRatio` in game frames at it, only when WebKit's is higher. The
  app's own UI keeps its scale. Wayland, a logical monitor layout and a matched monitor
  are required; anything else (another desktop, X11, no access to the bus name) means no
  cap. The Flatpak gets `--talk-name=org.gnome.Mutter.DisplayConfig` for it. Setting:
  **Render games at your display's scale (faster)** (Playing → Game resolution, on by
  default, from the next game). The picture is slightly softer: WebKit scales the canvas
  up to 2 and the compositor back down to 1.25. A game that reads `devicePixelRatio` from
  CSS media queries rather than the property still sees 2.

Not shipped: Skia CPU painting (`WEBKIT_SKIA_ENABLE_CPU_RENDERING=1`) wins Canvas 2D by
~35 % on this 12-core machine but costs WebGL at 125 % and competes with everything else
for the CPU. It is a whole-process switch set at startup like the GIO module, so it could
become an opt-in ("smoother 2D games") once measured on a 2–4-core laptop and a
discrete-GPU desktop.

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
