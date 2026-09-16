# Field test — Linux desktop theme, launch and resize — 2026-09-16

Local GNOME 50 / Wayland session (Debian, BenQ 1920×1080 at scale 1.0, and the same
monitor temporarily at scale 2.0), driven by `pnpm desktop-theme-test`
(`scripts/verify-desktop-theme.mjs`). The app under test is a debug build of
`src-tauri` made in a Debian container; `dev-cold/` loads the page from a freshly
started Vite (what `pnpm app` looks like on a cold start), `embedded/` is the
`tauri build`-style binary with the frontend embedded (what the Flatpak ships).

Each run directory has a `REPORT.md` (pass/fail table, per-frame launch timeline, page
probes, app log excerpts), a `report.json`, and `frames/` cropped to the app window.

## What was reported

- "Ghost window" / white theming on WebView launch under a dark desktop.
- The desktop light/dark switch not followed while the app runs (a GNOME accent-colour
  change did show).
- After a resize, the previous frame staying visible in the other scheme.
- Scaling: the app not opening at its full size on a HiDPI screen.

## What the instruments showed before the fix

`before-dark-desktop-white-sheet-during-load.png` is the app 0.8 s after launch on a
dark desktop with a cold Vite: a white sheet under a dark header bar. The page probe
during those frames says `url: about:blank`, `prefers-color-scheme: dark` — the
document had not arrived yet, and WebKit was painting the _webview base colour_, which
the app had set to the theme's dark `rgb(53,53,53)` and WebKit had received as
**white**. Measured over a cold launch: **127 white frames over 21.0 s**, then the page
painted dark.

Three separate causes, each confirmed by the logs the app now writes:

1. **wry 0.53.5 handed WebKitGTK the colour bytes unscaled.** `GdkRGBA` takes 0.0–1.0
   floats; wry passed `53.0`, which clamps to `1.0` — every channel became white. Any
   non-black base colour was white. This is what "white theming on WebView launch" was:
   the colour was being set correctly on the app side and lost one crate down. Fixed
   upstream in wry 0.55 (#1692, "normalize background color values to 0.0–1.0"), which
   arrives with Tauri 2.11.5 — so the app now tracks Tauri 2.11 / tauri-runtime-wry
   2.11 / wry 0.55 / tao 0.35.
2. **The puller spawn ran inside Tauri `setup`, before GTK pumped a single event.** It
   waits up to ten seconds per candidate for the puller to answer. On this machine the
   window did not appear for **11.2 s** (`ft-run1`: first frame at +11498 ms). Every
   second of that was a second with no window at all, and on the user's machine a
   second of the white sheet. The spawn now runs on its own thread.
3. **`ensure_puller` was a synchronous command**, so Tauri ran it on the GTK main
   thread; it waits up to twelve seconds for the puller. The frontend calls it at
   startup when the puller is not healthy, which froze the whole window: no repaint,
   no input, and no `SettingChanged` delivered from the portal — so a desktop
   light/dark switch during that window was simply lost, and the page never followed.
   It is now `async` and runs on the worker pool.

And one that made the resize ghost worse: the window/webview base colour was read once
at launch. After a live light→dark switch the strip a resize exposes before WebKit
repaints was painted in the _launch_ scheme. It is now re-read from the GTK theme on
every portal `SettingChanged` and re-applied to window and webview.

## What the instruments show after the fix

See `dev-cold/REPORT.md`, `embedded/REPORT.md`, `scale-2/REPORT.md` for the full
tables. Headlines (all measured, not inferred):

- Cold `pnpm app`-style launch on a dark desktop: **0 wrong-scheme frames** across the
  whole ~22 s Vite cold start; the window is the theme's dark base colour from its
  first frame. Same for light.
- Embedded build: window at +0.6 s, page loaded at +0.9 s, colour correct from the
  first frame, both schemes.
- Live switch while running: the media query flips ~80–110 ms after `gsettings`; the
  `.dark` class and the painted page follow at ~200 ms in the embedded build. In the
  Vite dev build only, the _first_ switch after launch takes ~2.2 s before the class
  flips (the media event itself is on time); later switches are ~200 ms. Not present in
  the shipped build; left as is.
- Maximize / restore / keyboard resize, in each scheme and after a live switch: **0%**
  of the page painted in the other scheme beyond the settled page's own light
  thumbnails. GNOME's own size-change animation shows the previous frame stretched for
  one capture (~180 ms), then the page. Thumbnail grids re-flow for up to ~1 s
  afterwards — content settling, in the current scheme.
- No second toplevel at any point (`gtk_state` logs list exactly one `Toplevel` plus the
  tray menu's unmapped `Popup`), and nothing left on screen after close. Note the
  after-close check diffs against the pre-launch desktop, so another window repainting
  underneath (a chat client) registers as "differing" — inspect the frame when it fires.
- Scale 2.0 (960×540 logical): the page reports `devicePixelRatio: 2`, the window is
  clamped to the screen (960×461 CSS px, as it must be — 1280×720 does not fit), colours
  correct. Residual: the very first captured frame at 2× is black under the (correct)
  header bar for ≤1 capture (~180 ms) before WebKit's first paint — WebKit's initial
  buffer, below anything the app sets. At scale 1.0 the first frame is already the base
  colour. On a 1440×960-logical screen such as the Surface at 2×, 1280×720 fits, so the
  window opens at its configured size; GNOME only auto-maximizes windows that cover
  ≥80 % of the screen, and this one covers 67 %.

## Running it again

```bash
pkill -x puller-sidecar                       # a leftover puller changes launch timing
pnpm desktop-theme-test -- --binary src-tauri/target/debug/potato-tomato --dev-server --cold
pnpm desktop-theme-test -- --binary src-tauri/target/debug/potato-tomato               # embedded build
pnpm desktop-theme-test -- --binary ... --scale 2 --skip-switch --skip-resize
```

Do not run anything that opens windows (the Vitest browser tests, for one) while it
runs: every window on the desktop is in the capture.
