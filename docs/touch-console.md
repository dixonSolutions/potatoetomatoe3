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
    cap -->|bridge inside the game frame: native injection, app-made shell, relay page, offline copy| bridgepath[postMessage bridge]
    cap -->|cross-origin frame with no bridge in it| unavailable[Show controls-unavailable note]

    subgraph controls [Glass controls - pointer-events auto]
        joy[TouchJoystick vector] --> translate[Map vector to held direction keys]
        btns[TouchButton A/B/X/Y] --> translate
    end
    translate --> dispatch
    dispatch -->|keydown/keyup with code+keyCode+bubbles+composed, canvas focused| gamedoc[Game document]
    bridgepath -->|potato-tomato-touch-input| gamedoc

    The in-game **Console** control lives in the page toolbar (with Pause / Fullscreen) and in the in-game menu over a fullscreen game — not as a floating switch over the game. Turning it on shows the glass joystick / buttons overlay.

    settings[Settings - Touch Controls] --> draft[(unsaved settings draft)]
    draft --> saveSplit[shared settings Save / Discard]
    saveSplit --> store[(touch-console store: global + per-game)]
    editmode[In-game Move mode, toggled on the panel] --> store
    store --> overlay
```

### Isolation guarantees

1. **Overlay → page:** the overlay root is `pointer-events: none`; only widgets (joystick, buttons, toggle, drag handle) are `pointer-events: auto`. Touches that miss a widget pass through to the game.
2. **Overlay → game only:** `KeyDispatcher` targets `iframe.contentDocument` / nested same-origin docs. It never calls `window.dispatchEvent` on the parent.
3. **Focus → pause:** the injected child bridge blocks game blur, focus-out, and visibility-loss listeners before game code registers them. Using the touch console therefore cannot pause a game; only the app's explicit Pause control sends a pause command.

### Same-origin matrix (injectability)

Online play resolves to a chain of routes, best first — `direct` → `local` (the catalog's
`embed.html` in a blob) → `shell` (host HTML in a blob with `<base>`) → `relay` (the desktop
app's in-process relay) → `puller` (only if one is already running) → Open in browser. See
[native-first.md](./native-first.md#play-path-no-puller). What the console can reach depends
on the route and the platform:

| Play URL                                                                  | Route / where                                    | Top iframe vs app   | Game document injectable?                                                                                                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct `https://…` embed                                                  | `direct`, desktop app (Linux)                    | Cross-origin        | **Yes** via postMessage bridge — the webview injects it into the game frame at document start (`game_frames.rs`)                                                                   |
| Direct `https://…` embed                                                  | `direct`, Android                                | Cross-origin        | **Yes** via `native_touch_bridge.js` (below)                                                                                                                                       |
| Direct `https://…` embed                                                  | `direct`, public site / `pnpm dev` in a browser  | Cross-origin        | **No**                                                                                                                                                                             |
| `blob:` of `online/embed.html` (Drive U 7)                                | `local`, everywhere                              | Same-origin         | **Yes** — the bridge is first in the blob's HTML                                                                                                                                   |
| `blob:` of host HTML with `<base>` (jsDelivr serves HTML as `text/plain`) | `shell`, everywhere                              | Same-origin         | **Yes** — the bridge is first in the blob's HTML                                                                                                                                   |
| `ptrelay://localhost/game/{id}`                                           | `relay`, desktop app                             | Cross-origin        | **Yes** via postMessage bridge — the relay page carries it                                                                                                                         |
| `http://127.0.0.1:<port>/api/game-live/…` / `/api/unity-play/…`           | `puller`, only when a puller already runs        | Cross-origin        | **Yes** via postMessage bridge                                                                                                                                                     |
| `/api/game-live/{id}` / `/api/unity-play/{id}` on the app origin          | Vite proxy or `offline-sw.js` → a running puller | Same-origin         | **Yes** — only while a puller runs on this machine                                                                                                                                 |
| `PUBLIC_PLAY_PROXY_URL/api/unity-play/{id}`                               | public site, hosted Unity proxy                  | Cross-origin Worker | **Yes** via postMessage bridge                                                                                                                                                     |
| `ptoffline://localhost/{id}/…`                                            | desktop offline copy                             | Cross-origin        | **Yes** via postMessage bridge — the bridge is first in the served HTML                                                                                                            |
| `/games/{id}/offline/…`                                                   | bundled / static offline copy                    | Same-origin         | **Yes** (DOM or postMessage bridge)                                                                                                                                                |
| `/puller-games/{id}/offline/…`                                            | dev proxy                                        | Same-origin         | **Yes**                                                                                                                                                                            |
| `/browser-offline/{id}/…`, `blob:` offline shells                         | browser download                                 | Same-origin         | **Yes** if canvas in top doc; **No** if the online shell only wraps a cross-origin iframe (browser IndexedDB refuses shell-only “offline”; the desktop app's download captures it) |
| `/unity/player.html?src=…`                                                | Unity embed, no native frames                    | Same-origin shell   | **No** — nested cross-origin `#game`. The desktop app skips this wrapper and frames the Unity page itself                                                                          |
| `/games/{id}/online/index.html`                                           | catalog shell, no native frames                  | Same-origin shell   | **No** — nested external embed. The desktop app unwraps a shell that only frames a third-party page                                                                                |

The puller's job is offline download (`/api/offline`). Its live relay (`/api/game-live`)
is a play route only as the last one before Open in browser, and only when a puller is
already running: the desktop app never starts one to play, and on the public site
`offline-sw.js` forwards the same-origin relay paths to a puller on the visitor's own
machine when one is up.

Without a bridge, touch on the public web app needs the game document to be same-origin
already — a browser download saved under `/browser-offline/`, a bundled mirror, an
app-made shell, or a self-hosted game. That is the case worth optimising for: **Download
for offline** on the web makes the console work for that title as a side effect, because
the mirror is then served from this origin.

Expanding puller mirroring ([offline-downloader.md](./offline-downloader.md)) unlocks
permanent offline play.

**Rule of thumb:** take the cheapest path that works, in this order.

1. **Direct DOM dispatch.** If `resolveInjectable(iframe)` finds a canvas in a same-origin
   document, the console already has a target. No proxy, no reload, no added latency.
2. **A bridge already inside the game frame** (`canUseTouchBridge`) — the desktop app
   (Linux) and Android inject it into every game frame natively; offline copies, app-made
   shells and relay pages carry it in their HTML.
3. **On the public site, a hosted relay** that puts the game back on this origin
   (`PUBLIC_PLAY_PROXY_URL`). A game playing from its own host is never reloaded through a
   proxy just for the console.

Offline + console → **inject** into the mirrored HTML. Never inject into a same-origin
shell that only wraps a cross-origin Unity iframe — that causes Unity “Script error” when
the console steals focus.

`ensureTouchCapablePlayUrl` in [`+page.svelte`](../src/routes/games/[gameId]/+page.svelte)
implements exactly this order. It used to start at the puller relay for every online game,
which reloaded games that were already injectable and put the relay's latency on the
critical path for launches that never needed it.

### Native injection on the desktop (Linux)

The desktop app does in WebKitGTK what Android does below. While a launch resolves, the
page calls `set_game_frame_context` ([`game_frames.rs`](../src-tauri/src/game_frames.rs)),
which installs `game-storage-bridge.child.js` as a user script that runs at document start
in every frame, before the page's own script. A preamble decides the frame's part: the
outermost frame the app did not serve itself is the game (full bridge under the game's
id); frames inside it get the bridge without an id, plus console input relayed down from
the game frame; known ad hosts get nothing. So a game played straight from its own host
takes console input with no relay at all. Details in
[native-first.md](./native-first.md#the-bridge-in-cross-origin-game-frames).

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
a capture-phase `pointerdown` handler to stop presses stealing focus from the game. It sees
every press inside the console; preventing the default activation also kills the press for
any control in there, which is how the Arrows/WASD picker first came to look dead (back
when it was a `<select>`, the suppressed default stopped Android WebView opening the native
picker). `isInteractiveControl` exempts `select`, `input`, `textarea` and anything marked
`data-console-control` — mark every new console control with that attribute.

**The scheme picker is a custom listbox, not a `<select>`.** A native picker paints its
popup from the platform theme, and no CSS on the `<select>` can reach it: on Android
WebView the Arrows/WASD list opened as an opaque white system sheet over the translucent
glass console. The replacement is a glass trigger pill plus a popup the console owns.

Two details in that popup are load-bearing. It renders as a _sibling_ of the console panel,
not a child: the panel carries `opacity: config.opacity`, opacity applies to the whole
subtree, and a nested menu would be dimmed to the same 40% as the chrome behind it. Losing
the panel's layout is the price, so `schemeMenuPos` recomputes its position from the same
numbers the panel is drawn from, flipping the popup above the trigger when the console sits
too low to open downwards. And a full-surface scrim closes it on an outside tap — presses
on the game go straight to the iframe and never reach a document listener, so an
outside-click handler alone would leave the menu stuck open.

### Platforms with no sidecar (Tauri mobile)

`shouldProbePullerBackend()` is false on Android and iOS: those builds ship no puller and
no relay. On Android the console still reaches cross-origin games through native
injection (above); where that is unavailable (an old WebView, iOS) it works for same-origin
catalog shells and downloaded mirrors only — on a touch device the game still takes real
touches directly.

Anything that names the puller must be gated on `shouldProbePullerBackend()`, not on
`isLocalAppDeployment()`. Both are true in the desktop app, but only the former is false
on mobile — gating on deployment is why the Android build showed “Starting puller”, a
Retry puller button, a 12-second wait for a sidecar that cannot start, and advice to run
`pnpm puller:start` on a tablet.

**Unity iframe shells (abinbins / similar):** on the desktop app the Unity page is framed from its own host, with the bridge injected natively; the `/unity/player.html` wrapper is skipped. Elsewhere Unity embeds play inside that wrapper, which the console cannot reach, and `/api/unity-play/:id` (unwrap remote HTML, inject, absolutize CDN asset URLs) is used only when a puller already runs. _Under the old routing_ the desktop app sent every Unity title through `/api/unity-play/:id` and showed a Retry-puller warning when the puller was down; launching the nested shell alone usually failed with a masked Unity `Script error`.

**OpenFL / Lime (G-Switch 3):** abinbins hosts these next to Unity builds. The app must **not** treat every abinbins URL as Unity: an OpenFL page played through the puller's `/api/game-live/:id` needs a `<base href>` that includes the live session prefix so runtime `assets/…` loads succeed. Played direct (the desktop default now), its assets resolve against its own host.

**CrazyGames (Color Tunnel):** treat as a **portal shell**, not a Unity document. Online play frames the real CrazyGames page (gameframe + CrazySDK stay intact); on the desktop app the portal page is the game frame and the nested gameframe gets console input relayed down to it. Do **not** unwrap into a synthetic UnityLoader page — that caused `CrazySDK` / `isModularized` crashes. Playability comes first.

### Touch postMessage bridge

When the parent cannot read `iframe.contentDocument` (cross-origin), [`KeyDispatcher`](../src/lib/utils/touch-input-dispatch.ts) sends:

```js
{ type: 'potato-tomato-touch-input', action: 'down'|'up'|'releaseAll', codes?: string[] }
```

Handlers live in [`static/unity/inject.js`](../static/unity/inject.js) and [`static/game-storage-bridge.child.js`](../static/game-storage-bridge.child.js). They synthesize the same rich `KeyboardEvent`s as the DOM path.

Live probe: `resolveInjectable(iframe)` for same-origin; `canUseTouchBridge(playerUrl)` enables the bridge path when inject is known to be present.

### Unity / live embeds on GitHub Pages (local puller + Service Worker)

The public site has no native injection and no relay of its own. A visitor who runs a
puller can still get the console on cross-origin embeds. HTTPS Pages must not iframe
`http://127.0.0.1` (mixed content). Instead:

1. On your machine: `pnpm puller:start` (listens on `127.0.0.1:18787`).
2. Open the Pages site; the app registers [`offline-sw.js`](../static/offline-sw.js).
3. Unity online play uses same-origin `{base}/api/unity-play/{id}`; other external online embeds use `{base}/api/game-live/{id}`.
4. The service worker relays that request to the local puller and returns HTML with the touch bridge — touch works.

If the puller is not running, the iframe shows an error page telling you to start it.

**Optional (Unity only, no local puller):** deploy [`workers/unity-play-proxy/`](../workers/unity-play-proxy/), set Actions variable `PUBLIC_PLAY_PROXY_URL`, and Pages prefers that hosted proxy for Unity. Live HTML5 relay always needs the local puller. Random visitors without puller or `PUBLIC_PLAY_PROXY_URL` cannot use touch on online Unity CDN shells.

## Gestures and UX

| Action                 | Behavior                                                                                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gamepad switch         | Blue on/off switch for the console (when enabled / availability allows).                                                                                                                                      |
| Joystick               | Analog stick → 8-way keys. Scheme picker: **Arrows** (default) or **WASD** — stored in touch settings.                                                                                                        |
| Space                  | Glass pill button → `Space` (same overlay as A/B/X/Y).                                                                                                                                                        |
| A / B / X / Esc        | Hold = keydown, release = keyup (Z / Enter / Shift / Escape by default; remappable). The fourth face button is labelled by what it sends, because Escape is the one whose job is not guessable from a letter. |
| Hold on a control      | Just a held key, for as long as the game needs (charge, sprint, crouch). Holding never turns a control into a drag handle — that used to drop the key after 2 s mid-game.                                     |
| Move (✥) on panel      | Layout-edit mode. Every control shows a dashed outline; dragging one moves it and sends no key. ↺ resets the layout, **Done** leaves the mode.                                                                |
| Drag the panel grip    | Moves the whole compact console at once. Starts after a few pixels of travel — the grip does nothing else, so there is no long press to discover.                                                             |
| Controls (⌨) on panel | Opens the Controls menu — see below.                                                                                                                                                                          |
| Pause / privacy lock   | Overlay hides and all keys are released.                                                                                                                                                                      |

### The game's own menu

Escape opens almost every game's own pause / options menu. It is the **Esc** face
button on the console, and a key in the Controls menu. A separate "Game menu"
toolbar button used to send the same key from the page chrome; it duplicated the
console and was removed.

This is the game's Escape, not the app's: it does not exit the game, leave
fullscreen, or close the page.

### Controls menu, live key detection and the dynamic console

**Controls** sits in the player toolbar next to Console (and in the in-game menu), with
a ⌨ shortcut on the console panel. It opens a glass menu over the top of the game — not
a keyboard parked on it:

- **Controls detected** — what this game reads and what each key does ("↑ ↓ ← → Move",
  "J Jump"), five rows high and scrolling beyond that. Keys that do the same thing share a
  row. Every key cap is a real hold (press = keydown, release = keyup).
- **All keys** — the full board, for accessibility and for anything detection missed.
- **Search** filters both, by key or by what it does ("jump").

**Only what the running game does decides anything.** Page and description text says
what a page _claims_ — reading prose is guesswork however careful the parser — so it
supplies captions and an "unconfirmed" list, never the console layout.

Evidence behind each key, most reliable first:

| Evidence  | Where it comes from                                                                                      | Effect on the console              |
| --------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| In use    | The game handled a press (`preventDefault`) — real keyboard or console. Grows as you play.               | Shown; added if the pad lacks it   |
| Bound     | The game's **engine** registered it, read from the engine at runtime (below). Exact.                     | Shown; added; other buttons hidden |
| Likely    | A literal in a function the game registered as a key handler.                                            | Shown; never hides or adds         |
| Mentioned | Only named in text: portal blurb, in-page "How to play", catalog description. Listed as "not confirmed". | Caption only                       |

**Engine bindings** ([`game-storage-bridge.child.js`](../static/game-storage-bridge.child.js)) —
the bridge hooks the key APIs of the engine as the game calls them, catching the engine
the moment its global is assigned so boot-time registrations are seen:

| Engine        | Hooked                                                                             | Purposes                            |
| ------------- | ---------------------------------------------------------------------------------- | ----------------------------------- |
| Phaser 3      | `KeyboardPlugin.addKey / addKeys / createCursorKeys / checkDown / on('keydown-X')` | `addKeys({ jump: 'SPACE' })` → Jump |
| Phaser 2 / CE | `Keyboard.addKey / addKeys / isDown / createCursorKeys / addKeyCapture`            | same                                |
| PlayCanvas    | `Keyboard.isPressed / wasPressed / wasReleased`                                    | —                                   |
| GDevelop      | `gdjs.evtTools.input.isKeyPressed / wasKeyReleased / wasKeyJustPressed`            | —                                   |
| Kaboom/Kaplay | `onKeyPress / onKeyDown / isKeyDown / …` (globals or context)                      | —                                   |
| Scratch       | the project's "when key pressed" / "key pressed?" blocks                           | —                                   |

`pnpm bridge-test` runs real Phaser 3, Phaser CE, PlayCanvas and Kaplay builds (fetched
with `npm pack`) and checks their keys come through as Bound. Unity keeps its input map
inside wasm and exposes nothing, so for Unity titles only live use is reliable.

Only Bound evidence lets the console _hide_ buttons, and a button whose key a handler
mentions fades instead of vanishing (a game can bind a raw DOM listener beside its
engine). In use / Likely evidence alone only fades. Keys are added to the pad only when
Bound or In use.

**What kind of key it is** ([`key-profile.ts`](../src/lib/utils/key-profile.ts) `keyKind`):

- **Game control** — press it on the console.
- **Shortcut** — the game only ever handled it with Ctrl / Alt / Meta held (Ctrl+S). Listed,
  never put on the pad: the console cannot send the combination, and a bare S is not it.
- **Typing** — the player typed into a text box in the game (the bridge sees keys land on
  an editable element, or one take focus), or a handler compares against most of the
  alphabet. Letters with no other evidence are text entry: the menu offers **Type**, which
  puts the caret in the game's text box so the device keyboard opens, instead of growing a
  button per letter. A letter the engine bound, or that was seen driving play, stays a
  game control even when the game also has a text box.

**The dynamic console.** The same evidence reshapes the pad itself:

- With Bound evidence, face buttons whose keys the engine never bound are hidden (the
  "−N unused" badge); with only Likely or In use evidence they are dimmed — one press of
  Space says Space matters, not that Z does not. Text never hides anything.
- Game controls the pad lacks (Bound or In use — never Mentioned, shortcuts or typing)
  are **added** as small buttons just above the panel, captioned with what they do — at
  most four.
- Buttons whose key has a known purpose carry it as a caption ("Space · Dash").

On Android the detector is [`native_touch_bridge.js`](../src-tauri/gen/android/app/src/main/res/raw/native_touch_bridge.js);
on the web and desktop it is the same logic inside
[`game-storage-bridge.child.js`](../static/game-storage-bridge.child.js), which also
reports live use, shortcuts, text entry and the raw controls text. Both post
`potato-tomato-key-profile`, merged in [`key-profile.ts`](../src/lib/utils/key-profile.ts).

### Latency

One press is one event. The bridge used to fire each synthetic key at canvas, body, html,
document and window in turn — and since key events bubble, a window listener saw every
press up to five times; on Unity pages `inject.js` handled the same message too. Now a
key is dispatched once, at the element the game bound its key handler to (else `body`),
the game is focused once per press burst rather than per key, and the joystick measures
itself once per touch instead of on every move. The stick also has hysteresis (engage at
0.35, release at 0.22), so a thumb resting near a diagonal holds the key instead of
tapping it every frame.

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

## Related: game fullscreen

Games open fullscreen by default, with an in-game menu as the only chrome over them —
see [`in-game-menu.md`](./in-game-menu.md). The game filling the window is a
`.pseudo-fullscreen` class on the surface (`position: fixed; inset: 0; height: 100dvh`),
which works everywhere including iPhone, where `requestFullscreen()` is blocked. Esc is
left to the game; the in-game menu's **Exit fullscreen** returns to the page.

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

**Settings → Controls** ([`ControlsSection.svelte`](../src/lib/components/settings/sections/controls/ControlsSection.svelte)):

- Enable / availability / opacity / scale / haptics
- Auto-enable by default on touch-only devices; keyboard-capable devices stay off until switched on
- Desktop two-column layout: a pinned Landscape / Portrait live preview on the left and a readable,
  independently scrolling controls column on the right. Narrow screens use one normal reading flow.
  The preview is built from the real `TouchJoystick` and `TouchButton`
  components; unsaved opacity, scale, size, and position changes update it immediately
- Separate appearance, layout, and mapping groups without compressing them below the preview
- Copy landscape → portrait, reset
- Key mapping recorder (same pattern as the Playing pause shortcut)

## Source map

| Path | Role |
|------|------|
| `src/lib/utils/touch-console.ts` | Persistence + defaults |
| `src/lib/utils/touch-input-dispatch.ts` | Injectability + `KeyDispatcher` |
| `src/lib/utils/key-profile.ts` | Live key detection: merge reports, evidence and kind per key, what to hide and add |
| `src/lib/utils/controls-text.ts` | Read a game's controls text: which keys, and what each does |
| `static/game-storage-bridge.child.js` | In-frame bridge: key detection, console input, virtual storage |
| `src/lib/components/game-player/touch-console/` | Overlay UI |
| `src/lib/components/settings/sections/controls/` | Settings panel |
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
- Optional hosted live-relay Worker for the public site (today its `/api/game-live` needs a local puller; the desktop app needs neither)
- Genre / engine mapping presets + crowdsourced profiles
- Hardware gamepad passthrough and virtual trackpad / cursor mode
- Compact mobile game-page chrome (Play first, icon grid) from the mockup HTML
```
