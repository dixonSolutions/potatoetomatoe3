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

| Play URL pattern                                                               | Top iframe vs app   | Game document injectable?                                                                                                                                          |
| ------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/games/{id}/offline/…`                                                        | Same-origin         | **Yes** (DOM or postMessage bridge)                                                                                                                                |
| `/puller-games/{id}/offline/…` (dev proxy)                                     | Same-origin         | **Yes**                                                                                                                                                            |
| `/browser-offline/{id}/…`                                                      | Same-origin         | **Yes** if canvas in top doc; **No** if the online shell only wraps a cross-origin iframe (browser IndexedDB refuses shell-only “offline”; use puller full scrape) |
| `/api/unity-play/{id}` (Vite / Pages SW relay)                                 | Same-origin         | **Yes** — inject.js in game doc                                                                                                                                    |
| `/api/game-live/{id}` (local app puller relay)                                 | Same-origin         | **Yes** in local app/Tauri; **not a public-site touch path**                                                                                                       |
| `PUBLIC_PLAY_PROXY_URL/api/unity-play/{id}`                                    | Cross-origin Worker | **Yes** via postMessage bridge                                                                                                                                     |
| `blob:…`                                                                       | Same-origin         | Same as browser-offline                                                                                                                                            |
| `/unity/player.html?src=…`                                                     | Same-origin shell   | **No** — nested cross-origin `#game`                                                                                                                               |
| `/games/{id}/online/index.html`                                                | Same-origin shell   | **No** — nested external embed                                                                                                                                     |
| Direct `https://…` embed                                                       | Cross-origin        | **No** without local puller live relay                                                                                                                             |
| `http://127.0.0.1:18787/api/unity-play/…` or `/api/game-live/…` (Tauri puller) | Cross-origin        | **Yes** via postMessage bridge                                                                                                                                     |

The puller’s **main job** is offline download (`/api/offline`). Live relay (`/api/game-live`) is an extra **local-app/Tauri** capability. On the public web app, mobile touch requires a local/offline mirror saved under `/browser-offline/` or served from same-origin game files.

Expanding puller mirroring ([offline-downloader.md](./offline-downloader.md)) unlocks permanent offline play. Live relay covers the “play online with touch now” case without a download.

**Rule of thumb:** online + console → puller **proxy** (`/api/game-live` or `/api/unity-play`); offline + console → **inject** into the mirrored HTML. Never inject into a same-origin shell that only wraps a cross-origin Unity iframe — that causes Unity “Script error” when the console steals focus.

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

| Action               | Behavior                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Gamepad switch       | Blue on/off switch for the console (when enabled / availability allows).                                                        |
| Joystick             | Analog stick → 8-way direction keys (Arrows + WASD by default).                                                                 |
| A / B / X / Y        | Hold = keydown, release = keyup (Space / Enter / Shift / Esc by default).                                                       |
| Hold on a control    | After 650 ms, enter drag mode (dashed highlight), move, release commits to store.                                               |
| Hold on panel grip   | After 650 ms, drag the whole compact console rectangle. Pointer capture keeps the drag active after the finger leaves the grip. |
| Pause / privacy lock | Overlay hides and all keys are released.                                                                                        |

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
