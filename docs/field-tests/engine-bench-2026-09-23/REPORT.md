# Engine bench — WebKitGTK (Tauri) vs Chromium for games on Linux — 2026-09-23

The question: is WebKitGTK, the engine the Linux desktop app plays games in, slow enough
that games should move to a Chromium-family engine on Linux? Android (Android System
WebView) and Windows (WebView2) already run Chromium, so this is only about Linux.

A first attempt the same day gave WebKitGTK 30 fps on everything and Chromium numbers that
were worthless (occluded window, rAF throttled to ~0). This report replaces it. Times are
local (UTC+10); the runs span 18:00–00:00 on 2026-09-23.

## Answer first

- **Most of the "WebKitGTK is at 30 fps" was two throttles, not engine speed.** Neither
  exists in Chromium.
  1. **Power saver halves the frame rate.** WebKitGTK 2.52 asks GLib's power-profile
     monitor, in the web process, whether the system is in `power-saver`, and if so halves
     rendering updates (WebCore's low-power mode): `requestAnimationFrame` runs at 30 fps.
     This laptop was in `power-saver` for every run (on battery, later charging).
     The shipped Tauri app ran every workload at ≤31 fps; the same binary with only that
     one answer changed ran Shrek, the light WebGL scene and 20 000 batched WebGL sprites
     at 60 fps, like Chromium.
  2. **Cross-origin game frames run at 30 fps until the player clicks inside them.** An
     iframe from another origin — another port on the same host is enough — gets
     `requestAnimationFrame` at 29 fps next to a 59 fps parent, and 59 fps after one real
     click inside it. Every game the shipped app plays is cross-origin to the app page
     (puller on `127.0.0.1:18787`, portal embeds). Touch-console presses are synthetic
     events and do not count. Chromium runs the same iframe at 59.5 fps from the start.
- **Without the throttles the engines are close at DPR 1.** Unity (Shrek), a light WebGL
  scene and 20 000 batched WebGL sprites hold 60 fps in both. What remains:
  - **Canvas 2D** (3000 rotated, alpha-blended `drawImage` sprites): WebKitGTK ~29–34 fps against Chromium's ~33–35 (medians of the two matrices; Chromium's range reaches 44 when the machine is quiet, because its canvas cost sits on the page's main thread and suffers most from load). **With `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1` WebKitGTK does 45–46 fps, ahead of Chromium**, and 15.4–15.6 against 11.2–11.6 at 10 000 sprites.
  - **GPU-bound WebGL**: WebKitGTK 22–24 fps against Chromium's 27 (−15–20 %). WebKit runs WebGL calls synchronously on the page's thread (7 ms of script per frame for 4000 draws, against 1 ms in Chromium).
  - **Load**: Unity cold start 3.8 s (shipped app; 3.4–6.9 s over all WebKitGTK runs, plus one 15.9 s outlier at load average 24) against 2.8 s (2.4–3.4 s); fetching the 32 MB wasm over loopback ~400 ms against ~200 ms, and `WebAssembly.compile` of it ~300–380 ms against ~110–140 ms.
- **Fractional scaling costs WebKitGTK a lot.** At 125 % (the user's desktop) GTK3 makes WebKitGTK render at DPR 2 — 2.56× the pixels Chromium renders at DPR 1.25. GPU-bound WebGL: **8 fps against Chromium's 20** (this reproduces the 8.6 fps of the first desktop run), 20 000 WebGL sprites 31 against 60. Capping the game frames' `devicePixelRatio` at 1.25 takes WebKitGTK to 19 and 60 — Chromium's numbers — without touching the app's own UI.
- **Recommendation: (b) keep WebKitGTK and tune it**: ignore the power-saver profile while
  games render (a 17 kB GIO module, measured in the real Tauri binary), let the first click
  reach the game frame, and render game frames at the monitor's real scale on
  fractional-scaled desktops. Each has an automatic fallback. **With the first and third
  in place, WebKitGTK on the user's 125 % desktop is within 2 fps of Chromium on every
  workload** (WebKitGTK / Chromium: Unity 59 / 60, Canvas 2D 42 / 43 and 12 / 14 at 10 000
  sprites, WebGL sprites 60 / 60, GL heavy 19 / 21, GL light 60 / 60). Skia CPU painting wins
  Canvas 2D outright but costs WebGL-heavy pages, so it is an opt-in at most. (c), a
  Chromium app window, would buy ~2 fps on GPU-bound WebGL and ~1 s off a Unity cold start (after (b)) for weeks of work, a sandbox hole in the
  Flatpak and a second UI surface. Details in [Decision](#decision).

## Method

### Harness

Everything ran in a **private headless GNOME Shell 50.1** (`--headless --wayland
--virtual-monitor`), on the machine's real GPU (Intel Meteor Lake, Mesa 26.0.8), with its
own session bus and settings, so no other window could cover or throttle the one under
test. Other agents were building and testing on the same machine, so:

- configurations were **interleaved** (A, B, C, A, B, C …), each repeated at least 3 times;
- every report carries the **load average** and **power state** at its start and after each
  workload (the collector adds them), and the harness records the compositor's shield
  state before and after each run;
- tables show the **median** and the (min–max) range over runs.

The engines:

| name in tables | what it is                                                                                                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tauri-*`      | the app's own debug binary (`src-tauri`, Tauri 2.11.5, wry 0.55.1, WebKitGTK 2.52.6 / webkit2gtk-4.1 on GTK 3.24.52), built with `tauri.perf-bench.conf.json`: dev URL = the bench page, its own identifier so its WebKit data dir can be wiped before every run (cold start). Tray off.                                        |
| `wk-*`         | a bare WebKitGTK window (`harness/wk.py`, `/usr/bin/python3` + WebKit2 4.1) with the settings wry applies (WebGL, WebAudio, page cache, developer extras) and an ephemeral data manager. Used for the variants that need a WebKit setting rather than an env var. `v-wk-default` vs `v-tauri-shipped` shows it matches the app. |
| `chromium`     | Chrome for Testing 149.0.7827.55 (Playwright's `chromium-1228`) launched directly — not through Playwright, so none of its automation flags — as `--app=<bench URL>` with `--ozone-platform=wayland`, a fresh `--user-data-dir` per run, 1440×900. That is option (c) as a user would get it.                                   |

Vite (`:5180`) served the same bench page, games and scenes to all of them.

### Workloads

The bench page is `/dev/perf-bench` (dev builds only). It loads each workload in an iframe
inside a fixed 1280×720 CSS px box with the real `TouchConsole` over it, and measures from
inside the page, so it runs unchanged in every engine.

| id                     | what                                                                                                                    | why                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `shrek-unity`          | Shrek Swamp Escape 2, Unity WebGL 2 build (32 MB wasm, 64 MB data), menu scene                                          | the 29 % of the catalog tagged Unity, and the load-time case                           |
| `sprites-canvas`       | Canvas 2D: tiled scrolling background, 3000 rotated/scaled/alpha `drawImage` sprites from one PNG atlas, a line of text | the classic 2D canvas game (Construct 2 canvas, Phaser CANVAS, CreateJS, hand-written) |
| `sprites-canvas-heavy` | same, 10 000 sprites                                                                                                    | canvas throughput                                                                      |
| `sprites-webgl`        | same scene as one batched WebGL 1 draw per frame, 20 000 sprites                                                        | modern 2D engines (Pixi, Phaser 3, Construct 3, Cocos)                                 |
| `gl-heavy`             | WebGL 2: full-screen fragment loop (2500 iterations) + 4000 small draws                                                 | GPU-bound 3D                                                                           |
| `gl-light`             | same, 12 iterations + 150 draws                                                                                         | should hold vsync anywhere                                                             |

Catalog mix, from the index shards: 3983 of 13 645 games (29 %) are tagged Unity, 636
HTML5; the rest are untagged portal embeds (CrazyGames 4215, Addicting Games 1175, FNF 635,
Drive U 7 546, Coolmath 405 …) whose engine cannot be read offline — a 600-game sample of
local HTML found Ruffle (Flash) in 5.5 %. Every sprite and GL scene draws from a seeded
PRNG, so all engines draw the same frames.

### Measures

- **page rAF**: the bench page's own `requestAnimationFrame` rate for 3 s before any game
  loads — the display pace as the engine sees it. A run below the refresh rate there is
  throttled, not slow.
- **fps / frame time**: the game document's rAF intervals over 10 s (main matrix) or 8 s
  (variants), console hidden and shown. A loop that stops is counted against the wall
  clock and flagged `stalled`.
- **script ms**: the scene's own per-frame JS time (update + issuing draws). WebKit rounds
  `performance.now()` to 1 ms, so its values are means of quantised samples.
- **latency**: synthetic press on the real console button / joystick / postMessage bridge
  → `keydown` in the game document → the game's next animation frame (40 presses per
  series).
- **load**: Unity cold "ready" (Play click → `createUnityInstance` resolved; covers fetch of
  96 MB over loopback, wasm compile and first scene), the same again warm in the same
  session, and a cold fetch + `WebAssembly.compile` of the 32 MB module on its own. Both
  engines compile wasm lazily (V8 Liftoff, JSC's in-place interpreter), so the compile
  number is mostly parse + validate; Unity ready is the end-to-end one.
- **engine CPU s**: user+system CPU of the engine's whole process group over one run (UI,
  web, network, GPU processes / browser, renderer, GPU processes). Coarse, but other agents'
  load does not enter it.

### Things that went wrong on the way, and what the bench now does about them

- **A shielded compositor sends no frame callbacks.** The first private shell shared the
  user's settings; it put up its screen shield when the real desktop went idle (18:07),
  and Chromium's rAF went to 0. With its own settings it still shielded when the real
  desktop locked (20:04): without `XDG_SESSION_ID` gnome-shell asks logind for the user's
  display session and follows its lock. `harness/compositor.sh` now uses its own
  `XDG_CONFIG_HOME` and a session id logind does not know. WebKitGTK paces rAF on its own
  timer here (`VBlank type: Timer` in `webkit://gpu`) and kept running under the shield,
  which is why only Chromium showed it. **The shared `ptbench-0` compositor other agents
  use was shielded at 20:10**; frame-rate measurements taken there after the desktop went
  idle are throttled.
- **One Chromium run reported "60 fps" for a window that was not being presented**: one
  16.6 ms interval, then nothing. Stalled phases are now counted against the wall clock.
  Three runs taken while the shield was (or may have been) up are excluded and kept in
  `raw/excluded/`.
- **Load.** Other agents' builds pushed the 1-minute load average from 2 to 28 during the
  day. Interleaving puts it on every configuration alike; ranges in the tables show where
  it mattered (mostly Canvas 2D and GL heavy).

## Environment

|                                    |                                                                                                                                                                                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine                            | Intel Core Ultra 7 155U (12 cores / 14 threads, 15 W), Intel Graphics (Meteor Lake), 62 GB                                                                                                                                                                      |
| OS                                 | Ubuntu 26.04, kernel 7.0.0-31, Mesa 26.0.8, GNOME Shell 50.1 (Wayland)                                                                                                                                                                                          |
| Power                              | profile `power-saver` for every run; on battery until ~19:40, then charging (per-run state in each JSON's `host.power`)                                                                                                                                         |
| Compositor                         | private headless GNOME Shell, virtual monitor 1920×1080@60 scale 1 (and 1920×1200@60 at 1.25 for the scaling runs)                                                                                                                                              |
| WebKitGTK                          | 2.52.6 (webkit2gtk-4.1), `webkit://gpu`: hardware acceleration policy `always`, DMA-BUF renderer, 2D canvas accelerated, Skia GPU painting on 2 threads, GL_RENDERER Mesa Intel Graphics (MTL), VBlank Timer 60 Hz ([gpu-webkitgtk.txt](raw/gpu-webkitgtk.txt)) |
| Chromium                           | Chrome for Testing 149.0.7827.55, Wayland ozone, ANGLE on OpenGL ES (Mesa), GPU rasterization, canvas, WebGL hardware accelerated ([gpu-chromium.txt](raw/gpu-chromium.txt))                                                                                    |
| User's real desktop                | 1920×1200 panel at 125 % with `scale-monitor-framebuffer`: Chromium gets DPR 1.25, GTK3/WebKitGTK gets DPR 2 and the compositor scales it down                                                                                                                  |
| Chromium-family browsers installed | only `org.chromium.Chromium` (Flatpak, 152)                                                                                                                                                                                                                     |

## Results

### 1. Shipped app vs Chromium, and the power-saver throttle (scale 1, DPR 1)

Game-frame fps with the console hidden, median (min–max) over runs.
`tauri-nolowpower` is the shipped binary with GIO's power-saver answer forced to "off"
(an `LD_PRELOAD` shim, bench only); `tauri-tuned` is the shipped binary with the
shippable form of that (a GIO module, see [Decision](#decision)) plus
`WEBKIT_SKIA_ENABLE_CPU_RENDERING=1`.

| configuration    | n   | DPR | load avg | page rAF | Shrek (Unity)    | Canvas 2D 3k     | Canvas 2D 10k    | WebGL sprites 20k | GL heavy         | GL light         |
| ---------------- | --- | --- | -------- | -------- | ---------------- | ---------------- | ---------------- | ----------------- | ---------------- | ---------------- |
| tauri-shipped    | 5   | 1   | 5.0      | 31.0     | 31.0 (23.3–31.0) | 30.9 (24.6–31.0) | 10.5 (8.4–13.9)  | 31.0 (30.8–31.0)  | 22.9 (21.9–26.9) | 30.9 (30.9–31.0) |
| tauri-nolowpower | 5   | 1   | 11.2     | 61.8     | 60.0 (59.6–60.0) | 28.9 (25.8–32.9) | 10.6 (9.7–11.6)  | 59.8 (57.8–60.0)  | 21.8 (19.9–26.0) | 60.0 (59.8–60.0) |
| tauri-tuned      | 3   | 1   | 11.7     | 61.6     | 55.2 (24.2–57.3) | 44.9 (43.9–48.6) | 15.4 (12.6–18.1) | 59.8 (49.6–59.9)  | 24.0 (20.3–26.3) | 59.9 (59.9–60.0) |
| chromium         | 5   | 1   | 7.1      | 60.0     | 59.9 (57.7–60.0) | 33.2 (30.0–44.0) | 11.2 (9.6–12.2)  | 60.0 (55.1–60.0)  | 26.8 (22.5–34.3) | 59.9 (59.3–60.0) |

Frame time p95 (ms):

| configuration    | Shrek (Unity) | Canvas 2D 3k | Canvas 2D 10k | WebGL sprites 20k | GL heavy | GL light |
| ---------------- | ------------- | ------------ | ------------- | ----------------- | -------- | -------- |
| tauri-shipped    | 33            | 39           | 135           | 33                | 74       | 33       |
| tauri-nolowpower | 19            | 48           | 123           | 20                | 78       | 19       |
| tauri-tuned      | 30            | 28           | 83            | 19                | 66       | 18       |
| chromium         | 17            | 42           | 111           | 17                | 52       | 17       |

With the console shown (fps). Showing it costs little in either engine: nothing on Unity
and the light scene, a few fps on the heavier scenes (GL heavy 26.8 → 23.5 in Chromium,
WebGL sprites 59.8 → 56.6 in WebKitGTK). The one outlier, `tauri-tuned` Shrek at 45, is a
run under load average 22 (see Skia CPU painting in the decision).

| configuration    | Shrek (Unity) | Canvas 2D 3k | Canvas 2D 10k | WebGL sprites 20k | GL heavy | GL light |
| ---------------- | ------------- | ------------ | ------------- | ----------------- | -------- | -------- |
| tauri-shipped    | 31.0          | 27.6         | 10.3          | 31.0              | 22.1     | 31.0     |
| tauri-nolowpower | 60.0          | 27.2         | 10.1          | 56.6              | 19.8     | 59.5     |
| tauri-tuned      | 45.0          | 39.9         | 15.3          | 57.2              | 22.2     | 60.0     |
| chromium         | 59.8          | 36.2         | 11.1          | 59.8              | 23.5     | 60.0     |

Per-frame script time (ms) — the scene's own JS work, which shows headroom even when a
frame rate is capped:

| configuration    | Canvas 2D 3k     | Canvas 2D 10k    | WebGL sprites 20k | GL heavy       | GL light      |
| ---------------- | ---------------- | ---------------- | ----------------- | -------------- | ------------- |
| tauri-shipped    | 10.1 (9.5–13.3)  | 32.2 (24.2–39.1) | 4.2 (4.1–4.3)     | 7.1 (7.1–12.6) | 0.6 (0.6–0.6) |
| tauri-nolowpower | 11.0 (9.6–12.2)  | 30.7 (29.0–35.1) | 4.1 (3.8–4.3)     | 7.1 (6.8–14.6) | 0.6 (0.6–0.7) |
| tauri-tuned      | 11.9 (10.8–12.1) | 35.4 (29.9–42.9) | 4.2 (4.1–6.7)     | 7.2 (7.2–7.4)  | 0.6 (0.5–0.6) |
| chromium         | 28.2 (21.2–31.1) | 80.8 (74.3–94.5) | 4.3 (4.0–5.1)     | 1.1 (1.0–1.5)  | 0.2 (0.2–0.2) |

### 2. The cross-origin throttle

`static/dev-bench/raf-probe.html` measures its own rAF rate and can embed a copy of
itself from another origin. Power-saver masked in WebKitGTK so only this throttle shows:

| engine                                                     | parent (127.0.0.1:5180) | child iframe           | child origin                                                        |
| ---------------------------------------------------------- | ----------------------- | ---------------------- | ------------------------------------------------------------------- |
| WebKitGTK                                                  | 59.3                    | **28.8**               | `http://localhost:5180` (cross-site)                                |
| WebKitGTK                                                  | 59.3                    | **28.8**               | `http://127.0.0.1:5190` (same host, other port — the puller's case) |
| WebKitGTK                                                  | 59.2                    | 59.4                   | same origin                                                         |
| WebKitGTK, one real (GDK) click inside the child after 6 s | 59.4                    | 28.8 → 56.4 → **59.3** | cross-site, 3 s windows                                             |
| Chromium                                                   | 59.7                    | 59.5                   | cross-site                                                          |

In the app every game document is cross-origin to the page that embeds it, so every game
starts at 30 fps in WebKitGTK and stays there until the player clicks inside it. With
power-saver on as well, both reasons give 30, not 15.

### 3. WebKitGTK variants (scale 1)

Everything reachable without changing WebKit: env vars, WebKit settings and feature flags
in `wk.py`, and the app binary under env vars. All `wk-nolowpower-*` rows have the
power-saver answer masked, so they compare against `v-wk-nolowpower`. These ran with a
shorter bench (8 s samples, no latency or console phase), all interleaved.

| configuration                   | n   | DPR | load avg | page rAF | Shrek (Unity)    | Canvas 2D 3k     | Canvas 2D 10k    | WebGL sprites 20k | GL heavy         | GL light         |
| ------------------------------- | --- | --- | -------- | -------- | ---------------- | ---------------- | ---------------- | ----------------- | ---------------- | ---------------- |
| v-tauri-shipped                 | 3   | 1   | 9.1      | 30.9     | 30.8 (29.8–31.0) | 24.4 (24.1–28.5) | 9.1 (8.5–9.2)    | 30.9 (28.8–31.0)  | 23.6 (20.5–25.6) | 30.9 (30.9–30.9) |
| v-wk-default                    | 3   | 1   | 16.3     | 30.9     | 30.7 (30.6–31.0) | 27.8 (27.5–28.5) | 9.7 (8.5–9.9)    | 30.7 (29.5–31.0)  | 23.7 (16.2–24.0) | 30.9 (30.7–31.0) |
| v-wk-nolowpower                 | 3   | 1   | 14.3     | 61.6     | 58.7 (56.7–59.9) | 33.8 (32.8–36.6) | 9.8 (9.8–11.0)   | 58.6 (45.0–59.8)  | 23.6 (23.2–24.2) | 60.0 (60.0–60.0) |
| v-tauri-giomodule               | 3   | 1   | 8.0      | 61.9     | 59.9 (59.9–60.0) | 30.7 (30.3–31.5) | 10.7 (9.5–11.1)  | 59.6 (57.7–59.9)  | 24.4 (23.7–24.7) | 59.9 (59.7–60.0) |
| v-wk-nolowpower-skiacpu         | 3   | 1   | 10.9     | 61.9     | 59.7 (40.4–59.9) | 46.1 (23.0–48.6) | 15.6 (14.4–16.6) | 57.6 (55.4–59.6)  | 22.8 (22.1–23.8) | 60.0 (59.8–60.0) |
| v-wk-nolowpower-webglgpuprocess | 3   | 1   | 14.4     | 61.8     | 59.8 (58.7–59.9) | 33.6 (30.7–38.1) | 9.9 (9.4–11.1)   | 58.6 (53.8–60.0)  | 24.7 (24.2–25.0) | 60.0 (60.0–60.0) |
| v-wk-nolowpower-shm             | 3   | 1   | 11.1     | 61.7     | 59.1 (51.7–59.6) | 27.1 (9.4–27.7)  | 9.9 (9.3–10.4)   | 54.4 (52.6–56.2)  | 20.5 (19.7–20.6) | 59.8 (59.7–59.8) |
| v-wk-nolowpower-gputhreads0     | 3   | 1   | 10.8     | 61.7     | 47.9 (26.7–60.0) | 26.0 (24.1–33.4) | 9.6 (2.6–10.5)   | 52.4 (52.0–56.2)  | 24.7 (22.1–25.0) | 59.9 (58.0–60.0) |
| v-wk-nolowpower-nodmabuf        | 3   | 1   | 11.2     | 61.9     | 27.9 (26.9–28.8) | 2.3 (2.0–2.7)    | 0.6 (0.3–61.7)   | 30.4 (29.6–31.2)  | 14.5 (13.7–14.7) | 35.5 (33.0–36.3) |
| v-wk-nolowpower-nocompositing   | 3   | 1   | 9.8      | 61.7     | 28.4 (27.5–29.2) | 2.6 (2.6–2.8)    | 0.8 (0.7–61.9)   | 30.5 (26.6–30.8)  | 14.4 (14.3–14.8) | 37.6 (35.9–60.7) |
| v-wk-nolowpower-canvascpu       | 3   | 1   | 14.5     | 61.7     | 58.0 (52.0–59.7) | 2.2 (2.2–2.5)    | 0.8 (0.7–0.8)    | 59.5 (59.3–59.8)  | 24.4 (24.1–25.8) | 59.9 (59.8–60.0) |
| v-chromium                      | 3   | 1   | 15.0     | 60.0     | 60.0 (58.0–60.0) | 34.6 (32.8–37.0) | 11.6 (11.4–12.1) | 59.6 (44.9–59.6)  | 27.3 (22.4–27.7) | 60.0 (59.7–60.0) |

Script time (ms/frame):

| configuration                   | Canvas 2D 3k        | Canvas 2D 10k          | WebGL sprites 20k | GL heavy         | GL light      |
| ------------------------------- | ------------------- | ---------------------- | ----------------- | ---------------- | ------------- |
| v-tauri-shipped                 | 13.1 (11.6–13.2)    | 36.4 (35.5–37.5)       | 3.9 (3.9–4.6)     | 7.3 (7.2–17.6)   | 0.6 (0.5–0.6) |
| v-wk-default                    | 11.7 (11.4–11.8)    | 33.1 (32.9–38.4)       | 4.3 (3.9–8.6)     | 10.1 (7.0–22.1)  | 0.6 (0.6–0.7) |
| v-wk-nolowpower                 | 9.8 (9.2–10.1)      | 34.9 (30.6–34.9)       | 4.1 (3.8–10.5)    | 7.3 (7.0–10.0)   | 0.5 (0.5–0.6) |
| v-tauri-giomodule               | 10.5 (10.4–10.6)    | 31.4 (30.3–36.1)       | 3.9 (3.9–4.1)     | 7.0 (6.8–7.4)    | 0.6 (0.6–0.6) |
| v-wk-nolowpower-skiacpu         | 11.5 (10.6–21.9)    | 34.9 (32.1–36.7)       | 4.0 (3.9–4.1)     | 7.3 (7.1–12.4)   | 0.5 (0.5–0.5) |
| v-wk-nolowpower-webglgpuprocess | 10.3 (9.1–10.8)     | 33.2 (29.7–35.8)       | 3.9 (3.6–3.9)     | 5.8 (5.7–6.2)    | 0.6 (0.4–0.6) |
| v-wk-nolowpower-shm             | 12.0 (11.7–36.5)    | 35.1 (32.6–36.7)       | 4.4 (4.4–4.6)     | 9.0 (8.6–9.2)    | 0.6 (0.5–0.6) |
| v-wk-nolowpower-gputhreads0     | 11.8 (9.9–13.2)     | 35.5 (32.3–134.8)      | 4.0 (3.9–4.0)     | 8.2 (7.3–12.9)   | 0.6 (0.5–0.8) |
| v-wk-nolowpower-nodmabuf        | 410.6 (363.8–489.4) | 2179.5 (1555.5–2803.5) | 4.1 (4.0–4.2)     | 20.7 (19.1–21.0) | 1.1 (1.1–1.2) |
| v-wk-nolowpower-nocompositing   | 362.5 (342.1–369.6) | 1297.9 (1194.9–1401.0) | 4.1 (4.1–5.2)     | 20.0 (19.2–24.3) | 1.1 (1.1–1.2) |
| v-wk-nolowpower-canvascpu       | 440.3 (388.0–442.2) | 1251.4 (1201.0–1417.3) | 4.1 (3.7–4.2)     | 7.3 (7.2–8.7)    | 0.6 (0.5–0.6) |
| v-chromium                      | 26.5 (24.7–28.0)    | 77.5 (74.6–80.1)       | 5.4 (5.3–15.7)    | 1.1 (1.1–2.9)    | 0.2 (0.2–0.3) |

- `hardware-acceleration-policy ALWAYS` is already the default in 2.52 (`webkit://gpu`
  says `always`), so it was not a variant.
- **`WEBKIT_SKIA_ENABLE_CPU_RENDERING=1` is the one setting that helps**: Canvas 2D goes
  from ~34 to ~46 fps (3000 sprites) and ~10 to ~15.6 fps (10 000), past Chromium, with
  WebGL unchanged. On this 12-core CPU, Skia's CPU rasteriser on worker threads beats its
  GL backend for thousands of small textured draws.
- Turning 2D canvas acceleration off (`enable-2d-canvas-acceleration=false`),
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` or `WEBKIT_DISABLE_COMPOSITING_MODE=1` wreck Canvas 2D
  (2 fps) and cut WebGL to ~28–30 fps: not candidates, including as a "safe mode".
- The 61.7 / 61.9 maxima in the 10k column of the DMA-BUF-off and compositing-off rows are
  stalled phases read by the old accounting (one interval; fixed afterwards, see Method);
  the medians stand.
- `WEBKIT_DMABUF_RENDERER_FORCE_SHM=1`, `WEBKIT_SKIA_GPU_PAINTING_THREADS=0` and the
  experimental `UseGPUProcessForWebGL` are equal or worse. The GPU-process WebGL flag moves
  some GL cost off the page's thread (GL heavy script 7.3 → 5.9 ms) but not the frame rate.

### 4. Fractional scaling (the user's desktop: 1920×1200 at 125 %)

The private shell got a 1920×1200 virtual monitor (the user's panel) set to scale 1.25
with `gdctl`, with the same `scale-monitor-framebuffer` mode as the real desktop. As on the
real desktop, WebKitGTK sees DPR 2 (viewport 1536×881) and Chromium DPR 1.25.
`GDK_SCALE=1` does not change WebKitGTK's DPR under Wayland (probe: still 2), so it is not
a lever. `dprcap125` is `wk.py` injecting a document-start script into sub-frames only
(not the bench page) that caps `devicePixelRatio` at 1.25 — what the in-frame bridge would
do in the app. Shorter bench (8 s samples, no latency or console phase), interleaved.

| configuration                | n   | DPR  | load avg | page rAF | Shrek (Unity)    | Canvas 2D 3k     | Canvas 2D 10k    | WebGL sprites 20k | GL heavy         | GL light         |
| ---------------------------- | --- | ---- | -------- | -------- | ---------------- | ---------------- | ---------------- | ----------------- | ---------------- | ---------------- |
| s125-tauri-shipped           | 3   | 2    | 3.0      | 31.0     | 31.1 (31.0–31.1) | 31.0 (30.2–31.1) | 12.7 (11.1–13.2) | 30.3 (30.3–30.7)  | 8.2 (7.9–8.3)    | 31.0 (31.0–31.0) |
| s125-tauri-nolowpower        | 3   | 2    | 5.0      | 62.0     | 59.9 (59.9–60.0) | 38.1 (34.1–40.1) | 11.1 (10.7–13.1) | 30.7 (30.0–30.8)  | 8.0 (7.9–8.3)    | 59.1 (59.0–60.0) |
| s125-tauri-tuned             | 2   | 2    | 4.0      | 61.5     | 57.3 (57.3–57.3) | 46.0 (43.6–48.3) | 17.5 (14.2–20.8) | 31.4 (26.1–36.7)  | 7.8 (7.8–7.9)    | 55.1 (54.9–55.4) |
| s125-wk-nolowpower-skiacpu   | 3   | 2    | 5.3      | 62.0     | 58.5 (53.7–59.3) | 44.3 (36.2–46.2) | 17.8 (16.0–20.5) | 30.3 (26.4–33.6)  | 7.8 (7.7–7.9)    | 53.5 (51.5–55.8) |
| s125-wk-nolowpower-dprcap125 | 3   | 2    | 4.3      | 61.7     | 59.3 (58.8–59.7) | 41.7 (28.6–41.9) | 12.0 (10.6–12.1) | 60.0 (59.9–60.0)  | 19.2 (18.8–19.2) | 59.9 (58.3–60.0) |
| s125-wk-tuned-dprcap         | 3   | 2    | 3.0      | 62.0     | 59.1 (59.0–59.4) | 50.9 (50.3–51.0) | 19.9 (19.8–20.5) | 49.5 (49.5–49.8)  | 16.3 (16.2–17.2) | 57.5 (57.0–57.6) |
| s125-chromium                | 6   | 1.25 | 2.9      | 60.0     | 60.0 (60.0–60.1) | 42.8 (32.2–44.5) | 14.1 (11.5–14.8) | 59.9 (59.8–60.0)  | 20.9 (19.4–22.1) | 60.0 (59.9–60.0) |

Game canvas backing store per configuration:

- s125-tauri-shipped: gl-heavy 2556x1436, gl-light 2556x1436, shrek-unity 2556x1436, sprites-canvas 2556x1436, sprites-canvas-heavy 2556x1436, sprites-webgl 2556x1436
- s125-tauri-nolowpower: gl-heavy 2556x1436, gl-light 2556x1436, shrek-unity 2556x1436, sprites-canvas 2556x1436, sprites-canvas-heavy 2556x1436, sprites-webgl 2556x1436
- s125-tauri-tuned: gl-heavy 2556x1436, gl-light 2556x1436, shrek-unity 2556x1436, sprites-canvas 2556x1436, sprites-canvas-heavy 2556x1436, sprites-webgl 2556x1436
- s125-wk-nolowpower-skiacpu: gl-heavy 2556x1436, gl-light 2556x1436, shrek-unity 2556x1436, sprites-canvas 2556x1436, sprites-canvas-heavy 2556x1436, sprites-webgl 2556x1436
- s125-wk-nolowpower-dprcap125: gl-heavy 1598x898, gl-light 1598x898, shrek-unity 1598x898, sprites-canvas 1598x898, sprites-canvas-heavy 1598x898, sprites-webgl 1598x898
- s125-wk-tuned-dprcap: gl-heavy 1598x898, gl-light 1598x898, shrek-unity 1598x898, sprites-canvas 1598x898, sprites-canvas-heavy 1598x898, sprites-webgl 1598x898
- s125-chromium: gl-heavy 1598x898, gl-light 1598x898, shrek-unity 1598x898, sprites-canvas 1598x898, sprites-canvas-heavy 1598x898, sprites-webgl 1598x898

- DPR 2 costs WebKitGTK nothing on the Unity menu scene, light GL or Canvas 2D (those are
  bound by draw calls and frame pacing, not pixels), but GPU-bound work loses 60 %: GL
  heavy 22–24 → 8 fps, WebGL sprites 60 → 31.
- The DPR cap brings both back to Chromium's level (19 / 60 against 20 / 60), because the
  game then renders the same 1598×898 backing store Chromium does.
- Skia CPU painting keeps its Canvas 2D lead at DPR 2 (44–48 fps against Chromium's 44;
  18 against 14.5 at 10 000 sprites) but costs light GL a few frames (59 → 53–55): it now
  paints 2.56× the pixels on the CPU.
- All three together (power saver masked, DPR cap, Skia CPU painting:
  `s125-wk-tuned-dprcap`) win Canvas 2D outright (51 / 20 fps against Chromium's 43 / 14)
  but give up WebGL: sprites 50 instead of 60, GL heavy 16 instead of 19. Power saver
  masked + DPR cap alone (`s125-wk-nolowpower-dprcap125`) is the configuration that
  matches Chromium across the board.

### 5. Load time

| configuration           | Unity cold ready (ms) | Unity warm ready (ms) | fetch 32 MB wasm (ms) | WebAssembly.compile (ms) |
| ----------------------- | --------------------- | --------------------- | --------------------- | ------------------------ |
| tauri-shipped           | 3805 (3441–3909)      | 3425 (3230–5887)      | 406 (357–456)         | 298 (227–460)            |
| tauri-nolowpower        | 5063 (3412–6916)      | 3933 (3347–4159)      | 508 (370–531)         | 363 (251–861)            |
| tauri-tuned             | 5125 (5004–15861)     | 4520 (4007–4692)      | 383 (381–434)         | 316 (260–352)            |
| chromium                | 2775 (2414–2900)      | 2322 (2129–2766)      | 200 (169–365)         | 108 (95–201)             |
| v-tauri-shipped         | 4397 (3602–6844)      | –                     | 395 (378–401)         | 378 (294–465)            |
| v-wk-nolowpower-skiacpu | 3755 (3630–3894)      | –                     | 385 (379–396)         | 374 (272–402)            |
| v-chromium              | 2794 (2621–3445)      | –                     | 224 (175–282)         | 138 (122–153)            |

- Chromium starts Unity about 1 s sooner, cold or warm. The warm start (same session,
  HTTP cache hot) is not faster in WebKitGTK: its cost is compile and Unity's own boot, not
  the network.
- WebKitGTK's cold-start range is wide (3.4–6.9 s; one 15.9 s outlier with the load average
  at 24) because Unity's boot is CPU-bound and other agents' builds came and went; the
  medians of the interleaved runs are the comparable numbers.
- The 32 MB fetch goes through WebKit's network process (~400 ms, 80 MB/s over loopback)
  against Chromium's ~200 ms.

### 6. Console latency

Median over runs of each run's p50, ms. "press → keydown" is the console's own dispatch;
"→ next frame" is dominated by where in the frame interval the press lands, so it tracks
frame rate.

| configuration    | press → keydown | press → next frame: Shrek | Canvas 3k | Canvas 10k | WebGL 20k | GL heavy | GL light | bridge → next frame (Shrek) |
| ---------------- | --------------- | ------------------------- | --------- | ---------- | --------- | -------- | -------- | --------------------------- |
| tauri-shipped    | 1.0             | 25.0                      | 16.0      | 41.0       | 23.0      | 34.0     | 18.0     | 23.0                        |
| tauri-nolowpower | 0.0             | 15.0                      | 16.0      | 45.0       | 14.0      | 35.0     | 9.0      | 13.0                        |
| tauri-tuned      | 1.0             | 21.0                      | 17.0      | 41.0       | 16.0      | 28.0     | 12.0     | 16.0                        |
| chromium         | 0.6             | 14.3                      | 30.8      | 83.8       | 13.3      | 23.5     | 10.3     | 12.9                        |

Dispatch is under a millisecond in both engines (WebKit reports whole milliseconds). At
equal frame rates the press-to-frame latency is equal; the shipped app's extra ~10 ms is
the power-saver halving. The bridge (postMessage path the app uses for cross-origin
frames) adds nothing measurable over direct dispatch.

### 7. CPU cost

| configuration                | runs with CPU data | engine CPU seconds per run | run wall seconds |
| ---------------------------- | ------------------ | -------------------------- | ---------------- |
| tauri-shipped                | 3                  | 329 (318–335)              | 389 (378–402)    |
| tauri-nolowpower             | 3                  | 386 (360–390)              | 371 (360–384)    |
| tauri-tuned                  | 3                  | 357 (354–365)              | 345 (341–360)    |
| chromium                     | 3                  | 459 (446–473)              | 363 (362–364)    |
| s125-tauri-shipped           | 3                  | 75 (74–75)                 | 85 (85–85)       |
| s125-tauri-nolowpower        | 3                  | 85 (85–86)                 | 84 (84–85)       |
| s125-tauri-tuned             | 2                  | 90 (88–92)                 | 85 (85–85)       |
| s125-wk-nolowpower-skiacpu   | 3                  | 82 (82–85)                 | 85 (85–85)       |
| s125-wk-nolowpower-dprcap125 | 3                  | 89 (88–90)                 | 85 (85–86)       |
| s125-wk-tuned-dprcap         | 3                  | 92 (92–93)                 | 85 (85–85)       |
| s125-chromium                | 6                  | 83 (82–83)                 | 83 (83–83)       |

User + system CPU of the engine's whole process group over one run, for the runs recorded
after the harness learned to count it. At scale 1 the runs take about the same wall time:
the shipped app used 0.85 cores on average (it renders half the frames), WebKitGTK at full
frame rate 1.03–1.04 cores, Chromium 1.26 — ~20 % more than WebKitGTK for the same
workload list (its Canvas 2D costs 2–3× the main-thread time, and its GPU process adds).
The Tauri numbers include the dev puller (Node) the app starts at launch. At 125 % the
shorter runs are within 10 % of each other.

## What explains each difference

| difference                                               | cause                                                                                                                                                                                                                                                                                          | evidence                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shipped app at ≤31 fps on everything, Chromium at 60     | WebKitGTK low-power mode: GLib's power-profile monitor says `power-saver`, WebCore halves rendering updates                                                                                                                                                                                    | page rAF 31 → 62 fps with only that answer changed (`LD_PRELOAD` shim or GIO module, in the Tauri binary and in bare WebKitGTK); a shim that answers "off" only in the process named `WebKitWebProcess` is enough, so the web process decides; the UI process never asks |
| Games at 30 fps until clicked, even without power saver  | WebKit throttles rAF in cross-origin frames the user has not interacted with                                                                                                                                                                                                                   | probe: child 28.8 fps beside a 59 fps parent, 59.3 after one real click inside it; same-origin child 59.4; Chromium 59.5                                                                                                                                                 |
| Canvas 2D slower in WebKitGTK (~29–34 vs ~33–44 fps)     | not script: WebKit spends 9–12 ms of JS per frame against Chromium's 21–27 ms; the time goes into Skia's GL backend replaying thousands of small textured draws on 2 painting threads                                                                                                          | `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1` (Skia's CPU rasteriser on worker threads) lifts the same scene to ~46 fps and 10 000 sprites from ~10 to ~15.6, past Chromium, with the same script time                                                                            |
| GPU-bound WebGL ~15–25 % slower in WebKitGTK             | WebKit executes WebGL calls synchronously on the page's thread through ANGLE (7 ms of script per frame for 4000 draws vs 1 ms in Chromium, which only queues them to its GPU process), so CPU submit and GPU work do not overlap; its frames are also paced by a timer rather than vblank here | GL heavy script 7.1–7.3 ms vs 1.0 ms; the `UseGPUProcessForWebGL` flag takes it to 5.9 ms but not the frame rate                                                                                                                                                         |
| Unity starts ~1 s slower, wasm fetch/compile 2–3× slower | loopback fetch goes through WebKit's network process (32 MB: ~400 vs ~200 ms); JSC's wasm validation/first tier is slower than V8's Liftoff (~300–400 vs ~100–130 ms for 32 MB); Unity's own boot (data unpack, first scene) accounts for the rest                                             | Unity cold ready 3.4–4.4 s vs 2.4–2.8 s; the warm second start is no faster in WebKitGTK (HTTP cache does not help much; the cost is compile + boot)                                                                                                                     |
| Press → next frame ~10 ms longer in the shipped app      | frame interval: 33 ms at 30 fps vs 16.7 ms                                                                                                                                                                                                                                                     | equal (within a few ms) when both run at 60; dispatch itself is < 1 ms in both                                                                                                                                                                                           |
| Fractional scaling                                       | GTK3 has no fractional scale, so WebKitGTK renders at the next integer (DPR 2) and the compositor scales down; Chromium renders at 1.25                                                                                                                                                        | GL heavy 8 fps at DPR 2 (backing store 2556×1436), 19 with the game frame capped at 1.25 (1598×898); Chromium at DPR 1.25: 20                                                                                                                                            |

## Decision

The question is Linux only. Android (System WebView) and Windows (WebView2) already play
in Chromium.

### (a) Keep WebKitGTK as it is

- Cost: none. Risk: none.
- What users keep getting: **30 fps whenever the laptop is in power saver** (GNOME can
  switch to it automatically on low battery), **30 fps in every game until the first click
  inside it**, Canvas 2D ~20 % behind Chromium, GPU-bound WebGL ~15–25 % behind, Unity
  starts ~1 s slower, and on a fractional-scaled desktop every game pays for DPR 2.
- Not acceptable given what (b) costs.

### (b) Keep WebKitGTK and tune it (recommended)

In order of value per effort. Each can ship on its own; each falls back by itself.

1. **Ignore power saver while games render.** A GIO module (`harness/shim/
full-speed-power-monitor.c`, 50 lines of C against GLib, 17 kB built) registers a
   `GPowerProfileMonitor` named `full-speed` that always says "not in power saver". The
   app sets `GIO_EXTRA_MODULES=<dir with the module>` and
   `GIO_USE_POWER_PROFILE_MONITOR=full-speed` in its own environment at startup, before
   the first webview; WebKit's web process inherits them. Measured in the real Tauri
   binary: page rAF 31 → 62, Shrek / WebGL sprites / GL light 31 → 60 fps
   (`v-tauri-giomodule`, `tauri-tuned`).
   - Cost: ~1 day. Build the module in CI (a `cc` build step or a Makefile, x86_64 and
     aarch64), ship it next to the binary (deb/AppImage) and under `/app/lib` in the
     Flatpak, set the two variables in `main.rs` behind a setting.
   - Risk: it overrides the user's power-saver choice for the whole app (the catalog UI
     too), so it costs battery; WebKit also uses low-power mode to defer speculative loads
     and media work. Make it a setting ("Full frame rate in power saver", on by default
     while a game is open — the module can watch a flag file the app flips when a game
     starts and stops, and emit `notify::power-saver-enabled`).
   - Fallback: if the module is missing, fails to load or the name is unknown, GIO warns
     and uses its normal D-Bus/portal monitor: back to 30 fps, nothing else changes.
   - **One open risk:** one launch with the module crashed the web process during Unity's
     load with `GLib-ERROR: getauxval () failed: Interrupted system call`. That message is
     GLib's set-uid check (`g_check_setuid`), which GLib runs before it honours environment
     variables such as `GIO_EXTRA_MODULES` or a bus address; it aborts when it finds
     `errno` set, here to `EINTR` — most likely a signal landing on that thread
     (JavaScriptCore suspends threads with signals for GC). A soak run afterwards (15
     launches with the module interleaved with 15 with the `LD_PRELOAD` form, two Unity
     starts each) did not reproduce it. Tally: 1 crash in 24 launches (42 Unity starts)
     with the module, 0 in 70 WebKitGTK launches without it. Rare, cause not proven, not
     ruled out: ship it behind the setting, log `web-process-terminated`, and if it
     recurs, register the monitor without `GIO_EXTRA_MODULES` (e.g. from a WebKit
     web-process extension — untested).
   - No code-free alternative exists: WebKitGTK 2.52 has no setting, feature flag or API
     for it (checked the WebKit2 4.1 GIR and all 486 `WebKitFeature`s).
2. **Let the first click land in the game frame.** The cross-origin throttle lifts on a
   real click inside the frame. The in-frame bridge (`game-storage-bridge.child.js`)
   already runs first in every relayed and offline game document; on WebKitGTK it can
   show a one-tap "Click to play" cover inside the game until the document has seen a
   trusted `pointerdown`. Games embedded straight from a portal (no bridge) mostly start
   with a click inside the frame anyway.
   - Cost: ~half a day. Risk: one extra click for keyboard-only games. Fallback: without
     the cover the game runs at 30 fps until clicked, as today.
   - Not recommended instead: serving games same-origin with the app page. It removes the
     throttle but hands game code the app's storage and IPC.
3. **Render game frames at the monitor's real scale on fractional-scaled desktops.**
   The in-frame bridge (the first script in relayed and offline game documents) overrides
   `devicePixelRatio` in the game document with the desktop's real scale whenever
   WebKitGTK reports an integer DPR above it. Measured with the same override injected by
   `wk.py`: at 125 %, GL heavy 8 → 19 fps and WebGL sprites 31 → 60, equal to Chromium;
   Unity and Canvas 2D unchanged.
   - Cost: ~1 day. GTK3 only reports 2, so the app has to learn the real scale — Mutter's
     `org.gnome.Mutter.DisplayConfig.GetCurrentState` gives it on GNOME; a setting
     ("game resolution: sharp / fast") covers other desktops.
   - Risk: games that size their canvas from `devicePixelRatio` once at boot keep what
     they read (the override must be in place before the game's first script, which the
     bridge is); the picture is scaled 1.25 → 2 by WebKit and back to 1.25 by the
     compositor, slightly softer than native. Portal embeds without the bridge are not
     covered. Fallback: a per-game off switch.
4. **Skia CPU painting for Canvas 2D — opt-in only** (`WEBKIT_SKIA_ENABLE_CPU_RENDERING=1`,
   set at startup like 1.). At scale 1 it takes Canvas 2D from ~29–34 to ~45–46 fps (3000
   sprites) and ~10 to ~15.5 (10 000), past Chromium, and leaves WebGL about where it was.
   At 125 % it costs WebGL, though: with the DPR cap, WebGL sprites 60 → 50 and GL heavy 19 → 16; light GL 59 → 53–55 at DPR 2; and in the two runs where other agents pushed the load average to 14–24, Unity fell to 24–40 fps with it and never without it — CPU painting competes with everything else for the CPU.
   - It is a whole-process switch (the catalog UI paints on the CPU too) and it trades GPU
     work for CPU work. Worth offering as a per-user "smoother 2D games" toggle; not a
     default until it has been measured on a 2–4-core laptop and a discrete-GPU desktop.
     Fallback: the variable off.
5. Leave alone: DMA-BUF off, compositing off, SHM buffers, 0 GPU painting threads,
   unaccelerated canvas, GPU-process WebGL — all equal or much worse (2 fps Canvas 2D for
   the first three). `hardware-acceleration-policy` is already `always` in 2.52.

With 1 and 3 in place, WebKitGTK on the user's 125 % desktop (`s125-wk-nolowpower-dprcap125`)
is within 2 fps of Chromium everywhere: Unity 59 / 60, Canvas 2D 3k
42 / 43, 10k 12 / 14, WebGL sprites 60 / 60, GL heavy 19 / 21, GL light 60 / 60. 2 removes
the remaining 30 fps start. What stays behind is load time (~1 s on a Unity cold start)
and GPU-bound WebGL at scale 1 (24 against 27 fps).

Also worth filing upstream (no lead time we control): a WebKitGTK setting for embedders to
opt out of low-power throttling and of the cross-origin-frame throttle — both are
Safari-oriented policies that a game launcher does not want. The long-term fix for DPR 2
is GTK4 (fractional scales since GTK 4.14, so webkitgtk-6.0 can render at 1.25); that path
only opens when wry moves to GTK4, and it was not measured here.

### (c) Play games in a Chromium-family browser the user already has

What it would buy over (b): GPU-bound WebGL ~10–20 % (21 against 19 fps at 125 % with (b)
applied; 27 against 22–24 at scale 1), Unity ~1 s sooner to start, heavy Canvas 2D 14
against 12 fps. Everything else measured here is already equal after (b). On this machine
the only Chromium-family browser is the Flatpak `org.chromium.Chromium`, so (c) here means
the app launching another Flatpak. What it costs:

- **Serve the player over loopback.** The game page and everything on it — in-game menu,
  touch console, Controls menu, offline controls, disguise, saves — are SvelteKit routes
  served from Tauri's `tauri://` protocol and talk to Rust over IPC (`invoke`: puller URL,
  window focus, disguise, colour scheme, tray). A browser cannot load `tauri://`, so the
  puller (or a new localhost server in Tauri) has to serve the built frontend, and every
  IPC call on the game route needs an HTTP equivalent. The frontend's existing web mode
  (`public-site`) turns off exactly the local-app features that matter (puller relay,
  puller-backed saves), so this is a third deployment mode.
- **Secure that server.** Anything that can reach it can start downloads, write saves and
  drive the puller's Playwright capture. Loopback is reachable by every local process and,
  via DNS rebinding or CSRF, by any site open in the user's browser: per-launch random
  token in the URL, `Host`/`Origin` checks, 127.0.0.1 only.
- **Find and launch a browser.** Native `google-chrome(-stable)`, `chromium(-browser)`,
  `brave-browser`, `microsoft-edge(-stable)`, `vivaldi`; Flatpak `com.google.Chrome`,
  `org.chromium.Chromium`, `com.brave.Browser`, `com.microsoft.Edge`,
  `io.github.ungoogled_software.ungoogled_chromium`; Snap `chromium` (Ubuntu's
  `chromium-browser` is a Snap shim). Launch with `--app=<url>`, an app-owned
  `--user-data-dir` (otherwise the browser's single-instance logic hands the URL to the
  user's running session as a tab — `flatpak run org.chromium.Chromium` does that on this
  machine while the user's Chromium is open), `--no-first-run`, a class/app-id. Flatpak and
  Snap browsers only accept a profile inside their own sandbox (`~/.var/app/<id>/…`,
  `~/snap/chromium/…`).
- **The app's own Flatpak** cannot exec host binaries. `flatpak-spawn --host` needs
  `--talk-name=org.freedesktop.Flatpak`, which lets the app run anything on the host —
  a sandbox escape Flathub review pushes back on. The alternative, the OpenURI portal,
  opens the user's default browser (possibly Firefox) in an ordinary tab: no app window,
  no own profile, no way to know when the game closes. On the main Linux channel (c)
  either needs the escape or degrades to "open in your browser".
- **State.** Game saves live in the puller (`GAMES_DATA_DIR/<id>/data`, through the
  bridge), so they follow the game between surfaces if the external page uses the puller
  backend. Settings kept in the app webview's `localStorage` (console layout, preferences)
  and the browser's own caches do not; they would have to move to the puller.
- **Product.** The game becomes a separate OS window with the browser's identity: the
  privacy disguise (title/icon) does not reach it, close-to-tray and "back to catalog"
  need a second implementation, and GPU blocklists and versions vary with whatever browser
  the user has (this bench cannot promise the user's Chrome behaves like Chrome for
  Testing 149).
- **Fallback.** In-app WebKitGTK when no browser is found, the process exits early, the
  page never checks in, or WebGL reports a software renderer (SwiftShader / llvmpipe).
- **Estimate:** 2–4 weeks, plus two player surfaces to maintain on Linux, for a gain that
  (b) mostly delivers.

### Other options considered

- **Bundle a Chromium** (CEF through an experimental Tauri runtime, or Electron): +150–250
  MB per install and Chromium security updates become the app's job. Not justified by the
  measured gap.
- **Use the Chromium the puller already downloads for capture** (Playwright's): a known
  version, no dependence on the user's browser, runs inside the app's Flatpak — but it
  still needs everything in (c) except discovery, and inside Flatpak Chromium's own
  sandbox needs zypak or `--no-sandbox`, which is not acceptable for third-party game code.

### Recommendation

**(b), items 1–3.** Ship 1 (power saver) and 2 (first click) first: together they remove
the 30 fps cap the user saw, for about a day and a half, with automatic fallbacks — after a
soak test of 1 (see its open risk). Then 3, fractional scale (about a day; the biggest single win on the user's actual 125 % desktop). Offer 4 (Skia
CPU painting) as an opt-in at most, after one more bench run on a low-core and a
discrete-GPU machine. Do not build (c) now: after (b) it buys ~2 fps on GPU-bound WebGL and
~1 s of Unity start for weeks of work and a Flatpak sandbox escape. Revisit only if
GPU-heavy WebGL games are still reported slow on Linux after (b) — and then as an opt-in
"open in Chrome" for native (non-Flatpak) installs, not as the default surface.

## Reproduce

Everything is in `harness/`; paths default to `$XDG_RUNTIME_DIR/pt-engine-bench`
(`BENCH_DIR`).

```sh
# 1. private compositor (1920×1200 for the scaling runs); gdctl below needs the
#    system Python with GObject bindings (/usr/bin/python3 /usr/bin/gdctl on this machine)
PTBENCH_MONITOR=1920x1080@60 docs/field-tests/engine-bench-2026-09-23/harness/compositor.sh &
# 2. dev server and collector
PUBLIC_OFFLINE_DEPLOYMENT=local-app npx vite dev --port 5180 --host 127.0.0.1 &
PERF_BENCH_PORT=18800 node scripts/perf-bench-collector.mjs "$BENCH_DIR/results" &
# 3. shims + the Tauri binary with the bench dev URL
PKG_CONFIG_PATH=/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/share/pkgconfig \
  docs/field-tests/engine-bench-2026-09-23/harness/setup.sh
# 4. matrices (interleaved; reps; common bench query)
H=docs/field-tests/engine-bench-2026-09-23/harness
$H/matrix.sh $H/matrices/main.txt 3 "delay=8000&sample=10000&settle=4000&taps=40"
$H/matrix.sh $H/matrices/variants.txt 3 "delay=3000&sample=8000&settle=3000&latency=0&console=0&warm=0"
# scaling: restart the compositor with PTBENCH_MONITOR=1920x1200@60, then
DBUS_SESSION_BUS_ADDRESS=$(cat $BENCH_DIR/compositor.bus) gdctl set --logical-monitor --primary --scale 1.25 --monitor Meta-0
$H/matrix.sh $H/matrices/scale125.txt 3 "delay=3000&sample=8000&settle=3000&latency=0&console=0&warm=0"
# 5. tables
python3 $H/aggregate.py "$BENCH_DIR"/results/*.json
```

A single run by hand: open `http://127.0.0.1:5180/dev/perf-bench?engine=<name>&auto=1` in
any engine with the collector running; `?quick=1` for a 3-minute smoke run. The cross-origin
probe: `/dev-bench/raf-probe.html?embed=<same page on another origin>&windows=3`.

## Files

- `raw/*.json` — every valid run, one file per run (`<engine>-<variant>-<ms>.json`): options,
  environment, per-workload frames, script time, latency, load, surfaces, and the
  collector's host snapshots (load average, power state) at the start, per workload and
  at the end.
- `raw/excluded/` — three runs taken while the compositor was (or may have been)
  shielded (not in any table), and the tail of the one crashed launch's log.
- `raw/*soak-*.json` — the GIO-module soak (Unity only, two starts per launch).
- `raw/progress.log` — every status line from every run, including the cross-origin probe
  lines (`raf-probe …`).
- `raw/matrix-*.log` — harness logs: start/end time, load average, shield state, engine CPU
  seconds per run.
- `raw/gpu-webkitgtk.txt`, `raw/gpu-chromium.txt` — `webkit://gpu` and `chrome://gpu`.
- `raw/implemented/` — the runs behind [Implemented](#implemented-2026-09-24): reports,
  matrix logs, the probe lines, and `soak-summary.txt`.
- `harness/` — compositor, setup, run and matrix scripts, the bare WebKitGTK window
  (`wk.py`), the power-saver shim and GIO module sources, matrix definitions,
  `aggregate.py` (all metrics per configuration) and `report-tables.py` (the tables in
  this report: `report-tables.py raw raw/cpu.log`).
- The bench itself: `src/routes/dev/perf-bench/+page.svelte`, `static/dev-bench/`
  (`sprites.html`, `gl-scene.html`, `raf-probe.html`), `scripts/perf-bench-collector.mjs`,
  `src-tauri/tauri.perf-bench.conf.json`.

## Implemented (2026-09-24)

Decision (b) items 1–3 are in the app; item 4 (Skia CPU painting) is not shipped and is
mentioned in [`docs/native-first.md`](../../native-first.md) as a possible opt-in. How
each part works, its fallbacks and its settings are in that document ("WebKitGTK tuning
for games"). Two things changed from the plan above:

- **The power-saver module wraps GLib's own monitor instead of replacing it.** It creates
  the D-Bus monitor (the portal one in a Flatpak) through the same extension point,
  forwards its answer and change signal, and reports "not in power saver" only while a
  flag file exists, which the app creates when a game frame starts and removes when the
  game page is left. Outside games WebKit still saves power. `build.rs` builds it (the
  `cc` crate, against gio-2.0), the binary embeds it and writes it to the cache directory
  at startup, so no package format ships a second file.
- **No "click to play" cover.** Measured below: a key press inside the focused game frame
  lifts the cross-origin throttle as a click does, and so does a key event the app sends
  to the `WebKitWebView` itself. The app sends one F24 press once the game frame has
  focus, and swallows it in the frame before any game listener.

### Method

The app's own debug binary (the bench's Tauri config with identifier
`com.potatotomato.games.tuningbench`, wiped before every run) in a private headless GNOME
Shell (`harness/compositor.sh`, with its own display name through `PTBENCH_DISPLAY`),
power profile `power-saver` on AC for every run, load average 2–5. Configurations differ
only in an environment variable that turns one part off for that run
(`POTATO_TOMATO_FULL_SPEED=0`, `POTATO_TOMATO_FIRST_INPUT=0`, `POTATO_TOMATO_DPR_CAP=0`);
"all off" is the app as it shipped before. Interleaved, 3 runs each, median (min–max).
The bench page ran with `gameOpen=1`: it samples its own rAF first, with no game open,
then sets the native game-frame context as the game page does and loads the workloads
(`harness/matrices/tuning-*.txt`). Raw reports and logs are in `raw/implemented/`.

### 1. Full frame rate in power saver (scale 1)

| configuration                  | page rAF, no game | Shrek (Unity)    | Canvas 2D 3k     | WebGL sprites 20k | GL heavy         | GL light |
| ------------------------------ | ----------------- | ---------------- | ---------------- | ----------------- | ---------------- | -------- |
| module off (as shipped before) | 31.0              | 31.0             | 31.0             | 31.0 (31.0–31.1)  | 27.4 (27.4–27.5) | 31.0     |
| module on (default)            | 31.0              | 60.0 (59.9–60.0) | 39.6 (39.5–40.4) | 60.0 (59.9–60.0)  | 27.5 (27.4–27.5) | 60.0     |

Frame time p95 33 → 18 ms on Shrek, WebGL sprites and GL light. The page's own rAF stays
at 31 with the module on: with no game open, WebKit follows power saver as before. GL heavy
is GPU-bound below 30 fps either way. In a bare WebKitGTK view the web process follows the
flag within a frame or two: 31 fps; flag created → 58.3 in the 3 s window it landed in,
then 60; flag removed → 42.9, then 31.

### 2. The cross-origin throttle and the first key press

Which input lifts it: bare WebKitGTK (`wk.py --key`), `raf-probe.html` from another
origin in a frame the parent focuses on load (`?focus=1`), power saver masked, input at
6 s, 3 s windows:

| input at 6 s                                                             | child before | child after                          |
| ------------------------------------------------------------------------ | ------------ | ------------------------------------ |
| none                                                                     | 30.2         | 30.0, 29.8                           |
| GDK F24 press + release sent to the `WebKitWebView` (`gtk_widget_event`) | 30.1         | 56.7 (the window it landed in), 60.0 |
| the same through `gtk_main_do_event` (the window's event path)           | 30.0         | 56.7, 60.0                           |
| GDK F24 while the frame does **not** have focus                          | 30.1         | 30.0 (the parent document got it)    |
| GDK `Shift_L` (a bare modifier)                                          | 29.9         | 56.7, 60.0                           |
| a real key (`x`) through the compositor (Mutter RemoteDesktop)           | 29.9         | 50.3, 60.0                           |
| a real F24 through the compositor                                        | 29.5         | 29.1 (no F24 on its keymap)          |

So (a) a key the player presses while the game frame has focus lifts the throttle, and
(b) a GDK key event the app sends lifts it too; neither does without frame focus. WebKit
reports the synthetic F24 as `key: "Unidentified"`, `code: "Unidentified"`,
`keyCode: 135` (the virtual keyboard's keymap has no F24 keycode). A bare modifier works
as well but means something in many games; F24 is on no normal keyboard and no game binds
it.

In the app (`throttle=1`: the same probe from the other loopback name as a native game
frame, focused on load as the player does):

| configuration             | 1.5–4.5 s after load | 4.5–7.5 s        | 7.5–10.5 s       | 10.5–13.5 s      |
| ------------------------- | -------------------- | ---------------- | ---------------- | ---------------- |
| first key off (as before) | 30.3 (30.2–30.3)     | 30.9 (30.8–30.9) | 31.0 (28.8–31.0) | 31.0 (28.6–31.0) |
| first key on (default)    | 60.1 (60.0–60.2)     | 60.0             | 60.0             | 60.0             |

One F24 per run in the log, and the probe's own capture-phase key listeners never saw it:
the app's in-frame script stopped it first.

### 3. Fractional scaling (125 %, 1920×1200 virtual monitor)

| configuration                  | game DPR, backing | Shrek (Unity) | Canvas 2D 3k     | WebGL sprites 20k | GL heavy         | GL light |
| ------------------------------ | ----------------- | ------------- | ---------------- | ----------------- | ---------------- | -------- |
| all off (as shipped before)    | 2, 2556×1436      | 31.0          | 31.0 (30.9–31.1) | 31.0 (30.5–31.0)  | 8.3 (7.9–8.4)    | 31.0     |
| power saver fixed, no cap      | 2, 2556×1436      | 60.0          | 41.8 (38.9–43.4) | 46.6 (45.6–52.8)  | 8.4 (8.1–8.4)    | 60.0     |
| all on (default)               | 1.25, 1598×898    | 60.0          | 42.1 (41.3–42.3) | 60.0              | 19.4 (17.7–19.5) | 60.0     |
| Chromium (§4, `s125-chromium`) | 1.25, 1598×898    | 60.0          | 42.8             | 59.9              | 20.9             | 60.0     |

GL heavy frame time p95 219 → 87 ms. The bench page itself stays at DPR 2 (the app's UI is
not capped); the app logs `devicePixelRatio capped at 1.25 (display at 1.25, WebKit at 2)`.
With all three parts on, the app is within 1.5 fps of Chromium on every workload here.

### Flatpak

The same debug binary, run inside the installed app's Flatpak sandbox
(`flatpak run --command=<binary> com.potatotomato.games`: the app's finish-args, the GNOME
50 runtime with GLib 2.88.3 and its own WebKitGTK 4.1) against the private compositor.
The module compiled on the host loaded in the sandbox's web process and wrapped GLib's
**portal** monitor: page rAF 31 with no game, GL light and WebGL sprites 60 with a game
open. The cache directory (`~/.var/app/com.potatotomato.games/cache/…`) and the flag's
runtime directory needed nothing from the manifest. Mutter's `DisplayConfig` is not
reachable from the sandbox without `--talk-name=org.gnome.Mutter.DisplayConfig`
(ServiceUnknown, so no cap: the fallback); with it, now in the manifest, the game frames
got 1.25 and a 1598×898 backing store at 125 %, as on the host.

### Crash guard and soak

- The guard, end to end: `SIGABRT` to the web process 8 s after start. The app logged
  "turned off after the game engine crashed 8 s after the app started; off from the next
  launch" and wrote `disabled-after-crash.json`; the next launch logged "not in use";
  `POTATO_TOMATO_FULL_SPEED=1` loaded the module anyway.
- Soak (`harness/matrices/tuning-soak.txt`, summarised by `harness/soak-summary.py`): 32
  launches of the app with the module, each loading Shrek cold and then warm (64 Unity
  starts) with a game open and power saver on: **0 web-process crashes**. The module ran
  in every launch's web process (wrapping the D-Bus monitor); Shrek ran at 59.5 fps
  (53–59.9), Unity cold start 3.5 s (3.3–8.2 s). The other ~25 launches with the module in
  this session (the tables above, smoke and Flatpak runs) did not crash either, apart from
  the deliberate `SIGABRT`. Against the first version's 1 in 24 this does not prove the
  abort gone, but it did not recur.
- About the one abort the first version of the module saw ("GLib-ERROR: getauxval ()
  failed: Interrupted system call"), a hypothesis, not verified: GLib's `g_check_setuid()`
  reads `errno` after `getauxval()`, and JavaScriptCore suspends threads for GC with a
  signal whose handler can leave `errno` set, so the check fails when a suspension lands
  in between. GLib runs that check when a process first resolves a D-Bus address. The
  replacing module answered without D-Bus, so the web process made its first bus
  connection later, possibly in the middle of Unity's load; the wrapping module creates
  GLib's D-Bus or portal monitor when the web process starts, as WebKit does without the
  module.

### What is left

- The cap needs GNOME (Mutter's `DisplayConfig`). On KDE, wlroots desktops and X11, games
  keep DPR 2 at fractional scales; a reader for another compositor's scale would cover
  them.
- The first key lands in whatever frame has focus. A portal that loads its game in a
  nested frame and focuses it gets a second press when that frame announces itself (up to
  four per launch), but a nested frame that never gets focus stays throttled until the
  player's first input.
- Like a real key press, the F24 gives the game document transient user activation: for
  WebKit's activation window it could start audio, go fullscreen or lock the pointer by
  itself. `window.open` does nothing in the app.
- Untouched by this: Unity's cold start (§5, ~1 s behind Chromium) and WebKit's
  synchronous WebGL submission (§1: GL heavy script 7 ms per frame against Chromium's 1).
  Chromium was not re-run for this section.
