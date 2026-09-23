# Playing a game: start, fullscreen, in-game menu, cursor lock

How the game page behaves from the click on a game to leaving it. Settings live in
**Settings → Playing** ([`GamesSection.svelte`](../src/lib/components/settings/sections/games/GamesSection.svelte),
stored by [`game-player-settings.ts`](../src/lib/utils/game-player-settings.ts)).

## Games start by themselves

There is no Play poster any more. As soon as the game's metadata is in, the player
appears with the cover art and a "Starting…" card; the frame is given its URL the moment
the play URL resolves ([`LazyGameFrame.svelte`](../src/lib/components/game-player/LazyGameFrame.svelte)).
The cover fades out on the frame's `load`, or when the stall watchdog gives up. It lets
presses through, so a game that draws before its last asset lands is already playable.

- **Audio.** The Play click used to be the gesture that unlocked WebKitGTK audio. Audio
  is now unlocked by the first press on the surface, on the in-game menu, and inside the
  frame by the bridge.
- **Saves.** The browser profile read runs alongside URL resolution, with a 600 ms cap on
  top so a hung backend cannot hold the game back. Late saves still arrive through the
  bridge (one reload).
- **Gates.** The frame does not start behind the privacy lock or the daily-limit gate; it
  starts once they clear. Both gates sit above a fullscreen game (the surface is z-index
  9000, the gates 9998 and 9999).

## Fullscreen

"Open games in fullscreen" is on by default. Fullscreen is two things, done separately
([`game-fullscreen-mode.ts`](../src/lib/utils/game-fullscreen-mode.ts)):

1. **The game fills the window** — the `pseudo-fullscreen` class on the surface. Always
   allowed, works on every engine (iPhone included), and it is what the layout, the
   hidden top bar and the in-game menu key on.
2. **The browser or window chrome goes away** — the Fullscreen API on the whole document
   in a browser; the native window (`getCurrentWindow().setFullscreen`) in the desktop
   app. Browsers allow the API only inside a user gesture. Opening fullscreen as soon as
   the player appears keeps it inside the click that opened the game; when there is no
   gesture (a direct link, a reload), the game fills the window and the next press on
   the in-game menu upgrades to real fullscreen, once.

The document is made fullscreen, not the surface: an element in fullscreen hides
everything outside it, and toasts and dialogs render into `<body>`.

The desktop app needs the `core:window:allow-set-fullscreen` capability for (2). Without
it, the menu-press upgrade goes through the document API, which WebKitGTK answers by
fullscreening its window.

**Esc belongs to the game.** Many games open their pause menu with Esc, so the page no
longer binds it. Browsers still leave their own fullscreen on Esc; the game keeps filling
the window, and **Exit fullscreen** in the in-game menu returns to the page. A player who
leaves fullscreen stays windowed for that visit, restarts included.

**No F by default.** The fullscreen key is opt-in ("Fullscreen shortcut", off). The key is
still stored while the switch is off. Installs from before this change had `F` saved by
every settings write, so a saved `F` does not turn it on; a key the user recorded does.

## The in-game menu

The only chrome over a fullscreen game
([`InGameMenu.svelte`](../src/lib/components/game-player/in-game-menu/InGameMenu.svelte)):
Pause/Resume, Restart, Console (when the touch console is available), Controls (when
controls were detected), Exit fullscreen, Back to games.

| Setting                    | Options                                           | Default                                   |
| -------------------------- | ------------------------------------------------- | ----------------------------------------- |
| Show the in-game menu with | a menu button · hovering the edge · both          | menu button                               |
| Size (under "Menu button") | auto · small · medium · large                     | auto: small with a mouse, medium on touch |
| Corner                     | top left · top right · bottom left · bottom right | top left                                  |

- **Button:** faint at rest (45 %, 70 % on touch), full on hover. Touch devices always
  get it, whatever the mode, because touch cannot hover. The press target is at least
  36 px on touch even when the disc is drawn small.
- **Hover:** a 10 px strip along the edge by the chosen corner, 40 % of the width, so the
  game keeps its corners. The menu hides 1.5 s after the pointer leaves it.
- **Focus:** the button is out of the tab order and presses on the menu do not move
  focus, so the game keeps the keyboard; closing the menu hands focus back to the frame.
  Opening it does not pause the game.

## The toolbar (windowed)

One row of icon buttons with tooltips
([`GameToolbar.svelte`](../src/lib/components/game-player/GameToolbar.svelte)): Pause,
Restart, Fullscreen, and Console and Controls only when they apply. Logs and the play
version / offline copy panel are under **More**; the panel opens by itself when a launch
stalls, since that is when it is needed.

## Cursor lock

Games that call `requestPointerLock()` keep it. The frame bridge's "Pointer lock guard"
block ([`game-storage-bridge.child.js`](../static/game-storage-bridge.child.js), the last
block) watches the game's own document and posts `potato-tomato-pointer-lock` to the app:

- `locked` → one toast per visit: "Site locked the cursor — double-click twice to unlock".
- `stuck` → presses on a hidden cursor (`cursor: none`) with no lock, three within 2.5 s:
  "Cursor hidden by the game — double-click twice to show it".
- **Two quick double-clicks** release the lock (`exitPointerLock()`), force the cursor
  visible until the game locks again, and swallow that press and the clicks right after
  it so a game that locks on click cannot grab the mouse straight back.

The gesture is two double-clicks, not any four clicks: each pair within 400 ms, a pause
between the pairs at least 1.25× the slower pair, all within 1.4 s, and under 48 px of
mouse travel. Rapid fire in a shooter is evenly spaced and moves the mouse; a clicker
game is evenly spaced. Esc still releases a lock wherever the browser does that itself.

[`pointer-lock.ts`](../src/lib/utils/pointer-lock.ts) holds the same rules and guards the
documents the page can reach itself (its own, and same-origin frames served without the
bridge). `pointer-lock.spec.ts` runs both copies against the same cases.

The game iframe has no `sandbox` attribute, which is all pointer lock needs in Chromium
and WebKitGTK; there is no permissions-policy feature for it.
