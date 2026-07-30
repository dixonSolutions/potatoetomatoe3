# Field test — Ultramarine Surface (`marinesurface`) — 2026-07-30

Remote exercise of the **published Flatpak** `com.potatotomato.games` on a Surface tablet
running Ultramarine Linux 44 (GNOME Surface Edition), using GDR (`@gdr -dev=marinesurface`)
plus SSH (`borysthebear@100.125.7.103`). Tests used the **app UI**, not the dev harnesses.

Evidence screenshots live beside this report (`00-` … `05-*.png`).

## Device

| Item | Value |
|------|-------|
| Host alias | `marinesurface` / `surface` / `ultramarine` |
| OS | Ultramarine Linux 44 (GNOME Edition), kernel `6.18.8-1.surface.fc43.x86_64` |
| Panel | `eDP-1` **2880×1920 @ 120 Hz**, scale **2.0** (logical 1440×960) |
| Session | Wayland GNOME; AppIndicator extension **installed** (`appindicatorsupport@rgcjonas.gmail.com`) |
| Battery during test | ~74% → ~69% |
| GDR | `gdrd` on `:7337`, cert pin matches local `~/.config/gdr/config.json` |
| SSH | password auth (`1122`); Tailscale `100.125.7.103` |

## Flatpak under test (= latest published)

| Item | Value |
|------|-------|
| App ID | `com.potatotomato.games` |
| Remote | `potatotomato` (user) → Pages OSTree |
| Installed commit | `e8a30434fea3a6a464e9a22bf94b94c35d64ae1e910957e98c43250bc96a6aaf` |
| Commit date | **2026-07-18 01:26:04 UTC** |
| Pages `/flatpak/summary` Last-Modified | **2026-07-18 01:36:00 GMT** |
| GitHub latest | **Release 0.0.68** (`release-68`, published 2026-07-18T01:32:16Z) |
| Update available? | No — remote commit equals installed commit |
| Runtime | `org.gnome.Platform//50` |
| Sidecars | `/app/bin/potato-tomato`, `/app/bin/puller-sidecar` |

**Verdict:** tablet is on the **latest published Flatpak (0.0.68)**.

Note: the binary still embeds Tauri `version` string `0.0.1` (from `tauri.conf.json`); release identity is carried by Flatpak/OSTree + GitHub asset name, not that string.

## Puller health

Probed while the app owned the sidecar (`GET http://127.0.0.1:18787/api/offline/health`):

```json
{
  "ok": true,
  "dataDir": "/home/borysthebear/.var/app/com.potatotomato.games/data/com.potatotomato.games/games",
  "catalogDir": "/app/lib/Potato Tomato/catalog/games",
  "catalogGameCount": 13012,
  "port": 18787,
  "activeDownloads": 0,
  "liveSessions": 0
}
```

| Check | Result |
|-------|--------|
| Health HTTP | **200 / ok:true** within ~2s of cold launch |
| Catalog | **13012** games under `/app/lib/Potato Tomato/catalog/games` |
| Port | Default **18787** (no collision) |
| `GET /api/unity-play/slope` | **200**, inject present (`__ptUnityInject`, `potato-tomato-touch-input`) |
| `GET /api/game-live/flappy-bird` | **200**, touch bridge strings present |
| Slope offline status | `online:true`, `offline:true`, `Downloaded` in UI, 17 cache files |
| Offline mirror inject | `slope/offline/index.html` contains `potato-tomato-touch-input` / `__pt*` |

**Verdict:** puller sidecar is healthy on the published Flatpak; catalog path matches the known Flatpak layout fix (`Potato Tomato` product name).

## Game launch (Slope via app UI)

1. Opened home → double-activated **Slope** tile (Continue row).
2. Game page showed **Play from Online**, offline badge **Downloaded**, Delete offline copy.
3. Enabled **Console · ON** (emerald button + toast).
4. **Relaunch** → Unity shell loaded Slope menu (green dotted UI).
5. Entered play → 3D track rendered; later **Again** / in-run HUD (`steer with arrows, a/d or q/d`).

WebKitWebProcess peaked ~25% CPU / ~900 MB RSS while the game was up — expected for Unity WebGL in WebKitGTK.

**Verdict:** in-app game launch works for Slope with the published puller + offline mirror.

## Touch console / injection

| Step | Result |
|------|--------|
| Console toggle in game chrome | Works — `Console · Off` → green **`Console · ON`** |
| Overlay chrome | Glass **joystick** (left) + **A/B/X/Y** (right) + drag handle visible over menu and gameplay |
| Injection path availability | Online unity-play HTML and offline mirror both include touch bridge / inject markers |
| Overlay during gameplay | Remained composited over the 3D view with Console still ON |
| Pointer → overlay widgets | Clicks on A / stick region accepted by the overlay (no parent chrome steal once away from Quit) |

Slope’s own HUD text (`steer with arrows, a/d or q/d`) matches the default touch→keyboard mapping target.

**Verdict:** touch console enables and renders on the published app; inject assets are present on both live proxy and offline paths. Full analog “hold/drag” validation is limited by GDR’s click-centric remote pointer (no durable touch-down stream), but overlay presence + inject wiring are confirmed in-product.

## Other bugs / observations uncovered

### P1 — Home Continue grid missing many thumbnails

On cold start, a large share of Continue tiles rendered as **blank gray/white** (artwork missing) while titles still showed. Puller health was already OK (`catalogGameCount:13012`). Likely WebKit/image decode or CDN thumb fetch race — not a puller-down failure. See `00-home-missing-thumbs.png`.

### P2 — Quit sits in the same top band as Settings; easy to fat-finger remotely

GNOME **Quit** in the app top bar is near the right cluster. Early automation clicks around `y≈400` repeatedly **exited or hid** the app. Game chrome (**Console / Relaunch**) is safer around **`y≈600–680`** at 2880×1920.

### P3 — Close-to-tray can strand the window on this GNOME

`appindicatorsupport@rgcjonas.gmail.com` is enabled, so tray/close-to-tray behavior can apply (unlike stock GNOME without the extension). Closing the window can leave `potato-tomato` + puller running with **no visible window**. Recovery: tray Show, `gio launch …desktop`, or `flatpak kill com.potatotomato.games` then relaunch. Aligns with `docs/desktop-tray.md`, but Ultramarine Surface is a “GNOME **with** AppIndicator” skew.

### P4 — Dual Flatpak scopes on a single launch

`flatpak ps` often showed **two** `com.potatotomato.games` scopes for one user launch (bwrap parent + child). Worth confirming this is expected Tauri/WebKit sandboxing and not a double-exec.

### P5 — Packaged binary version string still `0.0.1`

Release/OSTree identity is correct (0.0.68), but `strings` on `potato-tomato` only finds `0.0.1`. About/Settings UX that reads Tauri version will under-report. Prefer stamping `0.0.<n>` into `tauri.conf.json` during release prep (already implied by release docs).

### P6 — GDR RemoteDesktop stress under Unity

While Slope/WebKit was heavy, MCP `gdr_screenshot` / input calls **timed out**; `gdrd` needed `systemctl --user restart gdr.service`. CLI `gdr --host marinesurface screenshot` still worked afterward at full 2880×1920 (~5 MB PNG). Prefer CLI for this panel resolution; consider GDR downscale for MCP.

### P7 — Accidental Dislike during Offline toggle miss

A mis-click on the Slope page hit **Disliked** (red) while aiming for Offline. Not an app bug; notes Favorited/Disliked hit targets sit next to Play-from controls.

## Patches / follow-ups (recommended)

1. **Stamp release version into Tauri** during `Release preparation` so About/Flatpak metadata and binary agree with `0.0.<n>`.
2. **Thumbnail hydration:** skeleton → retry failed thumb URLs; avoid persistent blank tiles when catalog is healthy.
3. **Touch / tablet chrome:** keep Console toggle far from Quit; consider larger hit targets on Surface.
4. **Tray defaults on Ultramarine:** detect AppIndicator-present GNOME and surface an explicit first-run note (“close hides to tray”) or keep quit-on-close unless the setting is enabled.
5. **GDR MCP:** optional max screenshot dimension for 2× Surface panels to avoid Cursor MCP timeouts.
6. Optional: in-app **puller health chip** on Settings/Home (API already healthy) so field testers need not curl.

## Method notes

- Prefer `gdr --host marinesurface …` CLI for screenshots on this device; MCP image payload often exceeds tool timeouts.
- Coordinate space is **physical 2880×1920** (not logical 1440×960).
- Do **not** click near `y < 400` on the right when the app is focused — Quit / window chrome live there.
- Kill stranded apps with `flatpak kill com.potatotomato.games`.

## Summary scorecard

| Area | Status |
|------|--------|
| Latest Flatpak (0.0.68) installed | Pass |
| Puller health + catalog | Pass |
| unity-play / game-live inject assets | Pass |
| Slope launch in app | Pass |
| Console toggle + overlay | Pass |
| Offline mirror present for Slope | Pass |
| Home thumbnails completeness | Fail (blank tiles) |
| Version string in binary | Fail (`0.0.1`) |
| Tray/close UX on this GNOME | Risk (extension present) |

## Follow-up: “many games do not launch” (Flatpak, not local clone)

Clarification: all of this testing was against the **installed Flatpak** on `marinesurface`
(`flatpak run com.potatotomato.games`), not a git checkout / `pnpm app` build.

Puller HTTP often returns **200** even when the game still fails in WebKit. Real failure
classes found from **your analytics + offline dirs + proxied HTML** on this device:

### 1) CrazyGames proxy HTML still points at `localhost:3002`

Example: `crazygames-neon-rider-vwz` (opened once, **0 play ms**).

- Shell iframe: `https://games.crazygames.com/en_US/neon-rider-vwz/index.html`
- Puller `unity-play` / `game-live` HTML still contains:
  `gameframeJs = 'http://localhost:3002/bundle.js'`
- That URL cannot work inside Flatpak → blank / instant fail.

Same `localhost:3002` residue appears in other CrazyGames unity-play bodies
(e.g. `crazygames-10-minutes-till-dawn`).

### 2) Offline mode stuck on incomplete mirrors

Your prefs force **Offline** for several Continue titles (`snow-rider-3d`,
`color-tunnel-2`, `g-switch-3`, `ape-sling`, `06marblerace2`).

- `ape-sling` offline tree has `box2d.wasm.js` but **no `box2d.wasm`** → offline
  Construct/asm launch dies immediately.
- Unity offline mirrors that use `.unityweb` can work, but any incomplete capture
  with Offline selected looks like “does not launch at all.”

### 3) Zero-play analytics = open without a successful session

From `potato-tomato-play-analytics` on the tablet:

| gameId | sessions | totalPlayMs |
|--------|----------|-------------|
| `crazygames-10-minutes-till-dawn` | 2 | 0 |
| `toelooping` | 2 | 0 |
| `crazygames-neon-rider-vwz` | 1 | 0 |

These are the strongest “opened page, never actually played” signals.

### 4) Catalog metadata lacks `engine`

Per-game `online/metadata.json` in the Flatpak catalog has **no `engine` field**
(even for Slope). Launch routing depends on iframe probing + puller. If probe/proxy
misclassifies (CrazyGames especially), the WebView loads a broken shell.

### Recommended patches

1. **Strip / rewrite `localhost:*` in puller unity-play & game-live responses**; fail the
   session with a visible error instead of serving dead CRA URLs.
2. **Offline readiness gate:** do not keep Play-from=Offline (or auto-fallback to Online)
   when required binaries (`*.wasm`, Unity `.unityweb` code) are missing.
3. **Mark CrazyGames live hosts** that need a fuller rewrite; add a play-log error when
   proxied HTML still references localhost.
4. **Continue feed:** show a clear “won’t run” badge when last session playMs=0 after N opens.

## Follow-up: Pause + Console ON → black / never starts

**Symptom (0.0.69 Flatpak):** With Console ON, Pause then Resume left Unity titles
(e.g. Slope 2 Multiplayer) on a black viewport; chrome peeked at the bottom.

**Root cause:** `inject.js` / storage bridge treated app Pause like mute and called
`AudioContext.suspend()`. On WebKitGTK, `resume()` often never completes without an
iframe gesture → Unity WebGL stays frozen. Restoring Console also forced
`gameSurfaceStarted` before Play, skipping the user-gesture path.

**Fix (local, needs next Flatpak):** Mute-only AC suspend; unlock on resume; Console
pref restore no longer auto-starts the frame; longer bridge load probes. Embedded
into puller via `pnpm embed-assets`.
