# Universal Touch Console

Glassmorphic on-screen gamepad for mobile (and optional desktop) play. Turns joystick / button touches into synthetic `KeyboardEvent`s dispatched **only into the game iframe document** — never the parent app window.

## Why this exists

Most of the 7000+ catalog games are desktop HTML5 / Unity builds that listen for keyboard (and sometimes mouse), not touch. Rather than patching every game, Potato Tomato overlays one translator that maps touch → the keys each game already understands.

## Architecture

```mermaid
flowchart TD
    subgraph page [Game page - inside gameSurfaceEl so it survives fullscreen]
        iframe[Game iframe] --- overlay[TouchConsole overlay]
    end

    overlay --> cap{Injectable?}
    cap -->|deepestSameOriginDoc finds canvas doc| dispatch[touch-input-dispatch]
    cap -->|nested cross-origin / external / tauri puller| unavailable[Show controls-unavailable note]

    subgraph controls [Glass controls - pointer-events auto]
        joy[TouchJoystick vector] --> translate[Map vector to held direction keys]
        btns[TouchButton A/B/X/Y] --> translate
    end
    translate --> dispatch
    dispatch -->|keydown/keyup with code+keyCode+bubbles+composed, canvas focused| gamedoc[Game document]

    The in-game **Console** control lives in the page toolbar (with Pause / Fullscreen) and in the fullscreen chrome — not as a floating switch over the game. Turning it on shows the glass joystick / buttons overlay.

    settings[Settings - Touch Controls] --> draft[(unsaved settings draft)]
    draft --> saveSplit[shared settings Save / Discard]
    saveSplit --> store[(touch-console store: global + per-game)]
    editmode[In-game hold-2s edit mode] --> store
    store --> overlay
```

### Isolation guarantees

1. **Overlay → page:** the overlay root is `pointer-events: none`; only widgets (joystick, buttons, toggle, drag handle) are `pointer-events: auto`. Touches that miss a widget pass through to the game.
2. **Overlay → game only:** `KeyDispatcher` targets `iframe.contentDocument` / nested same-origin docs. It never calls `window.dispatchEvent` on the parent.
3. **Focus → pause:** the injected child bridge blocks game blur, focus-out, and visibility-loss listeners before game code registers them. Using the touch console therefore cannot pause a game; only the app's explicit Pause control sends a pause command.

### Same-origin matrix (injectability)

| Play URL pattern                                                                    | Top iframe vs app   | Game document injectable?                                                                                                                                          |
| ----------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/games/{id}/offline/…`                                                             | Same-origin         | **Yes** (DOM or postMessage bridge)                                                                                                                                |
| `/puller-games/{id}/offline/…` (dev proxy)                                          | Same-origin         | **Yes**                                                                                                                                                            |
| `/browser-offline/{id}/…`                                                           | Same-origin         | **Yes** if canvas in top doc; **No** if the online shell only wraps a cross-origin iframe (browser IndexedDB refuses shell-only “offline”; use puller full scrape) |
| `/api/unity-play/{id}` (Vite / Pages SW relay)                                      | Same-origin         | **Yes** — inject.js in game doc                                                                                                                                    |
| `/api/game-live/{id}` (relay: Vite proxy, Tauri, or `offline-sw.js` → local puller) | Same-origin         | **Yes** — the relay answers on this origin, so the game document is injectable on every deployment, the public site included                                       |
| `PUBLIC_PLAY_PROXY_URL/api/unity-play/{id}`                                         | Cross-origin Worker | **Yes** via postMessage bridge                                                                                                                                     |
| `blob:…`                                                                            | Same-origin         | Same as browser-offline                                                                                                                                            |
| `/unity/player.html?src=…`                                                          | Same-origin shell   | **No** — nested cross-origin `#game`                                                                                                                               |
| `/games/{id}/online/index.html`                                                     | Same-origin shell   | **No** — nested external embed                                                                                                                                     |
| Direct `https://…` embed                                                            | Cross-origin        | **No** without local puller live relay                                                                                                                             |
| `http://127.0.0.1:<port>/api/unity-play/…` (Tauri/Flatpak puller)                   | Cross-origin        | **Yes** via postMessage bridge — prefer this for Unity iframe shells (abinbins)                                                                                    |
| `http://127.0.0.1:<port>/api/game-live/…` (Tauri/Flatpak puller)                    | Cross-origin        | **Yes** via postMessage bridge for non-Unity external embeds (not for nested Unity shells)                                                                         |

The puller’s **main job** is offline download (`/api/offline`). Live relay (`/api/game-live`) is an extra capability of a running puller, wherever it runs: on the public site `offline-sw.js` forwards the same-origin relay paths to a puller on the visitor's own machine, so the console works there too when one is up.

Without a relay, touch on the public web app needs the game document to be same-origin already — a browser download saved under `/browser-offline/`, a bundled mirror, or a self-hosted game. That is the case worth optimising for: **Download for offline** on the web makes the console work for that title as a side effect, because the mirror is then served from this origin.

Expanding puller mirroring ([offline-downloader.md](./offline-downloader.md)) unlocks permanent offline play. Live relay covers the “play online with touch now” case without a download.

**Rule of thumb:** take the cheapest path that works, in this order.

1. **Direct DOM dispatch.** If `resolveInjectable(iframe)` finds a canvas in a same-origin
   document, the console already has a target. No proxy, no reload, no added latency.
2. **An inject/bridge URL already loaded** — an offline mirror, or a relay URL the game is
   on anyway (`canUseTouchBridge`).
3. **The puller relay**, only for a genuinely cross-origin game. This reloads the game
   through Node, so it is the last resort rather than the default.

Offline + console → **inject** into the mirrored HTML. Never inject into a same-origin
shell that only wraps a cross-origin Unity iframe — that causes Unity “Script error” when
the console steals focus.

`ensureTouchCapablePlayUrl` in [`+page.svelte`](../src/routes/games/[gameId]/+page.svelte)
implements exactly this order. It used to start at step 3 for every online game, which
reloaded games that were already injectable and put the relay's latency on the critical
path for launches that never needed it.

### Native injection removes the need for a proxy (Android)

The console's core constraint has always been that page JavaScript cannot script a
cross-origin game document. That is Blink's same-origin policy — identical in Chrome,
Safari, and any embedded Chromium — so no amount of WebView configuration changes it from
_inside_ the page. It is why online + console meant "puller relay".

A native embedder sits outside that sandbox.
[`WebViewCompat.addDocumentStartJavaScript`](https://developer.android.com/reference/androidx/webkit/WebViewCompat)
runs a script at document start in **every frame whose origin matches the allowed rules**,
cross-origin subframes included, before any of the page's own script.
`MainActivity.onWebViewCreate` installs
[`native_touch_bridge.js`](../src-tauri/gen/android/app/src/main/res/raw/native_touch_bridge.js)
with `setOf("*")`, so on Android the bridge is already inside the game — no relay, no
sidecar, no proxy hop, and no extra WebView.

Note it is the _same_ iframe and the same renderer, so there is no latency cost. Hosting
each game in a second native WebView would add compositing work and break the page layout
without granting anything this does not already provide.

Verified on a Galaxy Tab Active3 against the release APK:

```
frame                                                          cross-origin?  bridge?
http://tauri.localhost/games/crazygames-home-pin-2-fpx              false      true
https://games.crazygames.com/en_US/home-pin-2-fpx/index.html        true       true
https://cm.g.doubleclick.net/partnerpixels?url=...                  true       true
about:blank                                                         true       false
```

and end to end, posting the real protocol from the parent produced genuine events inside
the CrazyGames document, with the legacy numeric fields old engines read:

```
keydown:ArrowRight:39  keyup:ArrowRight:39  keydown:Space:32
```

`about:blank` has no origin to match and is skipped; it is a placeholder, not the game.

Requirements: WebView 89+ for `DOCUMENT_START_SCRIPT` (`WebViewFeature.isFeatureSupported`
is checked), and `androidx.webkit`, already a dependency. Older WebViews fall back to the
same-origin-only behaviour described below.

`canUseTouchBridge` returns true whenever `hasNativeFrameBridge()` sees the marker the
injected script sets, so the play URL stops deciding console availability on Android.

**Dispatch once, on `document.body`.** Two constraints pull against each other and body is
the only target meeting both.

- Dispatching at several targets (canvas, body, documentElement, document, window — what
  `game-storage-bridge.child.js` still does) delivers one press as four `keydown`s to
  anything listening on window. One Space tap became four jumps.
- Dispatching at the canvas is silently ignored by Scratch, which is what most of the
  `abinbins`-hosted catalog is — Geometry Dash included. Its handler drops key events whose
  `target` is neither `document` nor `document.body`, so typing into its answer box does not
  drive the game.

Measured against a live VM on device:

```
dispatch on canvas -> vm.runtime.ioDevices.keyboard._keysPressed === []
dispatch on body   -> vm.runtime.ioDevices.keyboard._keysPressed === ["space"]
```

The event bubbles and is composed, so window-, document- and body-level listeners each see
it exactly once. Only a listener bound directly to the canvas misses it, which is rare: a
canvas needs tabindex and focus to receive key events naturally, so engines bind to
document or window instead.

**Do not `preventDefault()` on form controls.** The overlay root runs `keepGameFocused` as
a capture-phase `pointerdown` handler to stop presses stealing focus from the game. It saw
every press inside the console, including the joystick scheme `<select>`; preventing the
default activation stops Android WebView opening the native picker, so the Arrows/WASD
dropdown appeared dead. `isInteractiveControl` exempts `select`, `input`, `textarea` and
anything marked `data-console-control`.

### Platforms with no sidecar (Tauri mobile)

`shouldProbePullerBackend()` is false on Android and iOS: those builds ship no puller, so
steps 2 and 3 above do not exist for a cross-origin game. The console is available for
same-origin catalog shells and downloaded mirrors, and unavailable for third-party embeds
— on a touch device the game still takes real touches directly.

Anything that names the puller must be gated on `shouldProbePullerBackend()`, not on
`isLocalAppDeployment()`. Both are true in the desktop app, but only the former is false
on mobile — gating on deployment is why the Android build showed “Starting puller”, a
Retry puller button, a 12-second wait for a sidecar that cannot start, and advice to run
`pnpm puller:start` on a tablet.

**Unity iframe shells (abinbins / similar):** when the puller is up, play resolves to `/api/unity-play/:id` (unwrap remote HTML, inject, absolutize CDN asset URLs). When the puller is down, the desktop UI shows a Retry-puller warning — launching the nested shell alone usually fails with a masked Unity `Script error`.

**OpenFL / Lime (G-Switch 3):** abinbins hosts these next to Unity builds. The app must **not** treat every abinbins URL as Unity — OpenFL goes through `/api/game-live/:id` with a `<base href>` that includes the live session prefix so runtime `assets/…` loads succeed.

**CrazyGames (Color Tunnel):** treat as a **portal shell**, not a Unity document. Online play uses **game-live** to proxy the real CrazyGames HTML (gameframe + CrazySDK stay intact). Do **not** unwrap into a synthetic UnityLoader page — that caused `CrazySDK` / `isModularized` crashes. Touch may not reach the nested cross-origin gameframe; playability comes first. Blank `engine` → game-live is correct.

### Touch postMessage bridge

When the parent cannot read `iframe.contentDocument` (cross-origin), [`KeyDispatcher`](../src/lib/utils/touch-input-dispatch.ts) sends:

```js
{ type: 'potato-tomato-touch-input', action: 'down'|'up'|'releaseAll', codes?: string[] }
```

Handlers live in [`static/unity/inject.js`](../static/unity/inject.js) and [`static/game-storage-bridge.child.js`](../static/game-storage-bridge.child.js). They synthesize the same rich `KeyboardEvent`s as the DOM path.

Live probe: `resolveInjectable(iframe)` for same-origin; `canUseTouchBridge(playerUrl)` enables the bridge path when inject is known to be present.

### Unity / live embeds on GitHub Pages (local puller + Service Worker)

HTTPS Pages must not iframe `http://127.0.0.1` (mixed content). Instead:

1. On your machine: `pnpm puller:start` (listens on `127.0.0.1:18787`).
2. Open the Pages site; the app registers [`offline-sw.js`](../static/offline-sw.js).
3. Unity online play uses same-origin `{base}/api/unity-play/{id}`; other external online embeds use `{base}/api/game-live/{id}`.
4. The service worker relays that request to the local puller and returns HTML with the touch bridge — touch works.

If the puller is not running, the iframe shows an error page telling you to start it.

**Optional (Unity only, no local puller):** deploy [`workers/unity-play-proxy/`](../workers/unity-play-proxy/), set Actions variable `PUBLIC_PLAY_PROXY_URL`, and Pages prefers that hosted proxy for Unity. Live HTML5 relay always needs the local puller. Random visitors without puller or `PUBLIC_PLAY_PROXY_URL` cannot use touch on online Unity CDN shells.

## Gestures and UX

| Action               | Behavior                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gamepad switch       | Blue on/off switch for the console (when enabled / availability allows).                                                                                                                                      |
| Joystick             | Analog stick → 8-way keys. Scheme select: **Arrows** (default) or **WASD** — stored in touch settings.                                                                                                        |
| Space                | Glass pill button → `Space` (same overlay as A/B/X/Y).                                                                                                                                                        |
| A / B / X / Esc      | Hold = keydown, release = keyup (Z / Enter / Shift / Escape by default; remappable). The fourth face button is labelled by what it sends, because Escape is the one whose job is not guessable from a letter. |
| Hold on a control    | After 650 ms, enter drag mode (dashed highlight), move, release commits to store.                                                                                                                             |
| Hold on panel grip   | After 650 ms, drag the whole compact console rectangle. Pointer capture keeps the drag active after the finger leaves the grip.                                                                               |
| Pause / privacy lock | Overlay hides and all keys are released.                                                                                                                                                                      |

### The game's own menu

Escape is how almost every game opens its own pause / options menu, and a touch
device has no keyboard to press it with. It is reachable two ways, and the
important one is not the console:

- **Game menu** in the player toolbar, beside Pause / Relaunch / Fullscreen.
  Available whenever the game frame can receive keys, whether or not the console
  is enabled or switched on. This is the answer to "how do I open the game's
  menu" — the console is a control pad, and needing to find it, enable it and
  switch it ON before a game's menu is reachable at all was the wrong shape.
- **Esc** on the console overlay, for players who already have the pad up.

Both go through the same dispatch path as every other console key
([`game-key-tap.ts`](../src/lib/utils/game-key-tap.ts) →
`KeyDispatcher.tap`), so a game that cannot receive console input cannot receive
this either — and the toolbar button says so rather than doing nothing quietly.

This is the game's Escape, not the app's: it does not exit the game, leave
fullscreen, or close the page.

Five-finger toggle was removed: iOS/iPadOS reserves multi-finger system gestures, Android OEM skins bind 3+ finger shortcuts, and the button is discoverable without fighting the OS.

## Open-source options (evaluated)

| Project                                                       | License       | Role for Potato Tomato                                                                                                                                                                |
| ------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[nipplejs](https://github.com/yoannmoinet/nipplejs)**       | MIT           | Virtual joystick: multitouch zones, normalized vector, CSS-friendly styling for the glass look. Candidate to replace the hand-rolled stick if stick feel needs more polish.           |
| **[interact.js](https://github.com/taye/interact.js)**        | MIT           | Drag + resize + hold/`manualStart` for every control (joystick, buttons, console rect) with bounds and min/max size. Best fit for “every component position **and** size adjustable.” |
| **[idb-keyval](https://github.com/jakearchibald/idb-keyval)** | Apache-2.0    | Tiny IndexedDB wrapper if layout JSON outgrows `localStorage` (large per-game / orientation profiles).                                                                                |
| **[better-xcloud](https://github.com/redphx/better-xcloud)**  | — (prior art) | Not a dependency. Browser overlay over a game it does not control; public layout JSON + community mockups by genre — reference for placement conventions.                             |
| **Xbox Touch Adaptation Kit schema**                          | Public schema | Microsoft tool is not OSS; the published layout JSON schema is a good model for context layouts (driving vs on-foot vs menu) later.                                                   |

**Current v1** keeps a zero-dep Pointer Events stick + hold-drag helper. Next layout pass should adopt **interact.js** for resize (today only position is drag-editable in-game; size is via Settings sliders / scale) and keep nipplejs optional.

## Related: game fullscreen on iOS

`requestFullscreen()` is blocked on iPhone (all browsers use WebKit). [`src/lib/utils/fullscreen.ts`](../src/lib/utils/fullscreen.ts) tries the native API first, then falls back to a `.pseudo-fullscreen` class (`position: fixed; inset: 0; height: 100dvh`) on the game surface — same button label either way. Escape exits the CSS fallback.

## Data model

**Global** — `localStorage` key `potato-tomato-touch-console-v1`:

```ts
{
  version: 1,
  enabled: true,
  availability: 'auto' | 'always' | 'off',
  joystickScheme: 'arrows' | 'wasd', // stick only; default arrows
```

opacity: 0.72,
scale: 1,
haptics: true,
autoEnableOnTouchOnly: true,
layouts: { landscape: TouchLayout, portrait: TouchLayout },
mapping: {
directions: { up, down, left, right }, // KeyboardEvent.code[]
buttons: { a, b, x, y }
}
}

```

**Per-game override** — `potato-tomato-touch-console-game-{id}` (sparse layouts / mapping).

Positions are **viewport percentages** so layouts survive screen size and orientation changes. Event: `potato-tomato-touch-console-changed`.

API: [`src/lib/utils/touch-console.ts`](../src/lib/utils/touch-console.ts).

Settings are edited as a draft inside the shared Settings shell. The common Save / Discard split
control persists the complete touch configuration atomically; changing a switch, slider, mapping,
layout, opacity, or scale does not write storage until Save is selected.

## Settings

**Settings → Touch Controls** ([`TouchControlsSection.svelte`](../src/lib/components/settings/sections/touch-controls/TouchControlsSection.svelte)):

- Enable / availability / opacity / scale / haptics
- Auto-enable by default on touch-only devices; keyboard-capable devices stay off until switched on
- Desktop two-column layout: a pinned Landscape / Portrait live preview on the left and a readable,
  independently scrolling controls column on the right. Narrow screens use one normal reading flow.
  The preview is built from the real `TouchJoystick` and `TouchButton`
  components; unsaved opacity, scale, size, and position changes update it immediately
- Separate appearance, layout, and mapping groups without compressing them below the preview
- Copy landscape → portrait, reset
- Key mapping recorder (same pattern as Games pause shortcut)

## Source map

| Path | Role |
|------|------|
| `src/lib/utils/touch-console.ts` | Persistence + defaults |
| `src/lib/utils/touch-input-dispatch.ts` | Injectability + `KeyDispatcher` |
| `src/lib/utils/game-key-tap.ts` | One-off key sends from chrome (Game menu / Esc) |
| `src/lib/components/game-player/touch-console/` | Overlay UI |
| `src/lib/components/settings/sections/touch-controls/` | Settings panel |
| `src/routes/games/[gameId]/+page.svelte` | Mount point inside `gameSurfaceEl` |

## Design history (assets)

Assets live in [`docs/touch-console/assets/`](./touch-console/assets/) in chronological order from the design conversation:

1. **Problem — uncomfortable mobile chrome**
   - [`uncomfortable-layout-compact.png`](./touch-console/assets/uncomfortable-layout-compact.png) — early game detail page: stacked Favourite / Dislike / Logs / Pause / Relaunch, little room for play.
   - [`uncomfortable-layout-with-fullscreen.png`](./touch-console/assets/uncomfortable-layout-with-fullscreen.png) — same flow with Fullscreen + offline download card; still meta-actions, not in-game controls.

2. **Architecture flowchart (conversation)** — origin check → gesture layer → overlay hold/drag → input translator (see mermaid above).

3. **First labeled mockup** — [`universal-console-mockup.svg`](./touch-console/assets/universal-console-mockup.svg)
   Landscape overlay legend: joystick, hold-2s drag, A/B, manual toggle, settings, orientation, size (five-finger zone is historical — removed from the product).

4. **Refined compact glass console** — [`compact-glass-console.svg`](./touch-console/assets/compact-glass-console.svg)
   Single frosted rectangle, drag handle, glass stick, clustered A/B/Y, optional second rectangle for twin-stick (deferred).

5. **Compact game page chrome** — [`compact-game-page.html`](./touch-console/assets/compact-game-page.html)
   Proposed pre-play mobile layout (Play Now, Online/Offline segmented control, icon action grid) to reduce choice overload before the overlay takes over during play.

## Follow-ups (not in v1)

- **interact.js** drag + resize for every control (position already editable; size still Settings/scale)
- Click passthrough vs Tap Zone (opt-in full-surface Space / bound key)
- Binding picker (key + mouseClick) and add/remove controls per game
- Broader puller `generic` mirroring coverage for permanent offline play
- Optional hosted live-relay Worker (today `/api/game-live` needs local puller)
- Genre / engine mapping presets + crowdsourced profiles
- Hardware gamepad passthrough and virtual trackpad / cursor mode
- Compact mobile game-page chrome (Play first, icon grid) from the mockup HTML
```
