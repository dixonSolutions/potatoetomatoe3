# Desktop theme field test — 2026-09-16 06:50:51

Binary: `/tmp/potato-tomato-prod4` (embedded build)  
Desktop: GNOME / wayland, GNOME Shell 50.2, GTK theme 'Adwaita', accent 'blue', scheme at start 'prefer-dark', monitor 1920x1080@60.000 at scale 1

Frames referenced below are cropped to the app window (`frames/`).

| Check | Result | Detail |
|---|---|---|
| dark: page loaded | ✅ pass | in 841ms |
| dark: first visible frame is dark | ✅ pass | first frame at +621ms classified dark (lum 0.198, light 0.0002) |
| dark: no wrong-scheme frames during launch | ✅ pass | 0 frame(s) over 0ms |
| dark: exactly one window during launch | ✅ pass | one window throughout |
| dark: settled page is dark | ✅ pass | classified dark (lum 0.25) |
| dark: window opened at its configured size | ✅ pass | page inner 1280×673 css px (expected ≥ 1200×600), devicePixelRatio 1, on screen 1312×720 px |
| dark: prefers-color-scheme matches desktop | ✅ pass | mediaDark=true htmlDark=true colorScheme=dark |
| dark: nothing left on screen after close | ✅ pass | desktop matches pre-launch |
| light: page loaded | ✅ pass | in 898ms |
| light: first visible frame is light | ✅ pass | first frame at +733ms classified light (lum 0.952, light 0.9936) |
| light: no wrong-scheme frames during launch | ✅ pass | 0 frame(s) over 0ms |
| light: exactly one window during launch | ✅ pass | one window throughout |
| light: settled page is light | ✅ pass | classified light (lum 0.847) |
| light: window opened at its configured size | ✅ pass | page inner 1280×673 css px (expected ≥ 1200×600), devicePixelRatio 1, on screen 1312×752 px |
| light: prefers-color-scheme matches desktop | ✅ pass | mediaDark=false htmlDark=false colorScheme=light |
| light: nothing left on screen after close | ✅ pass | desktop matches pre-launch |
| live switch dark→light: page followed | ✅ pass | in 211ms (media query 97ms, .dark class 211ms) |
| live switch dark→light: screen shows light | ✅ pass | classified light (lum 0.844) |
| live switch light→dark: page followed | ✅ pass | in 206ms (media query 95ms, .dark class 206ms) |
| live switch light→dark: screen shows dark | ✅ pass | classified dark (lum 0.245) |
| live switch light→dark: page followed | ✅ pass | in 201ms (media query 90ms, .dark class 201ms) |
| live switch light→dark: screen shows dark | ✅ pass | classified dark (lum 0.248) |
| live switch dark→light: page followed | ✅ pass | in 125ms (media query 125ms, .dark class 125ms) |
| live switch dark→light: screen shows light | ✅ pass | classified light (lum 0.841) |
| launched-dark-switched-light: maximize (Super+Up) — no stale-scheme area | ✅ pass | worst 0.0% of the page painted in the old scheme beyond the settled page |
| launched-dark-switched-light: maximize (Super+Up) — settled promptly | ✅ pass | still changing 0ms after the action (content re-flow and thumbnail loads included) |
| launched-dark-switched-light: restore (Super+Down) — no stale-scheme area | ✅ pass | worst 0.1% of the page painted in the old scheme beyond the settled page |
| launched-dark-switched-light: restore (Super+Down) — settled promptly | ✅ pass | still changing 988ms after the action (content re-flow and thumbnail loads included) |
| launched-dark-switched-light: keyboard resize (Alt+F8, arrows) — no stale-scheme area | ✅ pass | worst 0.1% of the page painted in the old scheme beyond the settled page |
| launched-dark-switched-light: keyboard resize (Alt+F8, arrows) — settled promptly | ✅ pass | still changing 710ms after the action (content re-flow and thumbnail loads included) |
| launched-dark: maximize (Super+Up) — no stale-scheme area | ✅ pass | worst 0.1% of the page painted in the old scheme beyond the settled page |
| launched-dark: maximize (Super+Up) — settled promptly | ✅ pass | still changing 0ms after the action (content re-flow and thumbnail loads included) |
| launched-dark: restore (Super+Down) — no stale-scheme area | ✅ pass | worst 0.2% of the page painted in the old scheme beyond the settled page |
| launched-dark: restore (Super+Down) — settled promptly | ✅ pass | still changing 1276ms after the action (content re-flow and thumbnail loads included) |
| launched-dark: keyboard resize (Alt+F8, arrows) — no stale-scheme area | ✅ pass | worst 0.2% of the page painted in the old scheme beyond the settled page |
| launched-dark: keyboard resize (Alt+F8, arrows) — settled promptly | ✅ pass | still changing 738ms after the action (content re-flow and thumbnail loads included) |
| launched-light-switched-dark: maximize (Super+Up) — no stale-scheme area | ✅ pass | worst 0.0% of the page painted in the old scheme beyond the settled page |
| launched-light-switched-dark: maximize (Super+Up) — settled promptly | ✅ pass | still changing 0ms after the action (content re-flow and thumbnail loads included) |
| launched-light-switched-dark: restore (Super+Down) — no stale-scheme area | ✅ pass | worst 0.1% of the page painted in the old scheme beyond the settled page |
| launched-light-switched-dark: restore (Super+Down) — settled promptly | ✅ pass | still changing 784ms after the action (content re-flow and thumbnail loads included) |
| launched-light-switched-dark: keyboard resize (Alt+F8, arrows) — no stale-scheme area | ✅ pass | worst 0.1% of the page painted in the old scheme beyond the settled page |
| launched-light-switched-dark: keyboard resize (Alt+F8, arrows) — settled promptly | ✅ pass | still changing 593ms after the action (content re-flow and thumbnail loads included) |
| launched-light: maximize (Super+Up) — no stale-scheme area | ✅ pass | worst 0.1% of the page painted in the old scheme beyond the settled page |
| launched-light: maximize (Super+Up) — settled promptly | ✅ pass | still changing 0ms after the action (content re-flow and thumbnail loads included) |
| launched-light: restore (Super+Down) — no stale-scheme area | ✅ pass | worst 0.1% of the page painted in the old scheme beyond the settled page |
| launched-light: restore (Super+Down) — settled promptly | ✅ pass | still changing 720ms after the action (content re-flow and thumbnail loads included) |
| launched-light: keyboard resize (Alt+F8, arrows) — no stale-scheme area | ✅ pass | worst 0.0% of the page painted in the old scheme beyond the settled page |
| launched-light: keyboard resize (Alt+F8, arrows) — settled promptly | ✅ pass | still changing 922ms after the action (content re-flow and thumbnail loads included) |

## Launch (dark)

| t (ms) | windows | screen | luminance | light % | page mediaDark | html.dark | readyState | file |
|---|---|---|---|---|---|---|---|---|
| 22 | 0 | - | - | - | - | - | - | 0001-launch-dark.png |
| 210 | 0 | - | - | - | - | - | - | 0002-launch-dark.png |
| 391 | 0 | - | - | - | - | - | - | 0003-launch-dark.png |
| 621 | 1 | dark | 0.198 | 0.0 | - | - | - | 0004-launch-dark.png |
| 841 | 1 | dark | 0.118 | 0.1 | true | true | complete | 0005-launch-dark.png |

Page probe after load:
```json
{
  "readyState": "complete",
  "url": "tauri://localhost/home",
  "mediaDark": true,
  "mediaLight": false,
  "htmlDark": true,
  "colorScheme": "dark",
  "inlineColorScheme": "dark",
  "rootBg": "rgba(0, 0, 0, 0)",
  "bodyBg": "rgb(30, 30, 30)",
  "shellBg": "rgb(30, 30, 30)",
  "background": "Canvas",
  "primary": "AccentColor",
  "primaryResolved": "rgb(0, 122, 255)",
  "devicePixelRatio": 1,
  "inner": [
    1280,
    673
  ],
  "hasTauri": true,
  "shellRendered": true
}
```
App log (theme lines):
```
+91ms [theme +30ms] after gtk::init: gtk-theme-name=Adwaita prefer-dark=false toplevels=0
+93ms [theme +32ms] portal Read color-scheme -> Some(true) in 1ms
+108ms [theme +47ms] apply(dark=true) changed=true; after apply: gtk-theme-name=Adwaita prefer-dark=true toplevels=0
+111ms [theme +50ms] theme_bg_color -> Some((53, 53, 53))
+263ms [2026-09-16][06:50:53][potato_tomato_lib::system_theme][INFO] [theme +30ms] after gtk::init: gtk-theme-name=Adwaita prefer-dark=false toplevels=0
+263ms [2026-09-16][06:50:53][potato_tomato_lib::system_theme][INFO] [theme +32ms] portal Read color-scheme -> Some(true) in 1ms
+264ms [2026-09-16][06:50:53][potato_tomato_lib::system_theme][INFO] [theme +47ms] apply(dark=true) changed=true; after apply: gtk-theme-name=Adwaita prefer-dark=true toplevels=0
+264ms [2026-09-16][06:50:53][potato_tomato_lib::system_theme][INFO] [theme +50ms] theme_bg_color -> Some((53, 53, 53))
+264ms [2026-09-16][06:50:53][potato_tomato_lib][INFO] desktop colour-scheme is dark
+264ms [2026-09-16][06:50:53][potato_tomato_lib::system_theme][INFO] [theme +202ms] theme_bg_color -> Some((53, 53, 53))
+264ms [2026-09-16][06:50:53][potato_tomato_lib][INFO] coloured main rgb(53, 53, 53)
+264ms [2026-09-16][06:50:53][potato_tomato_lib::system_theme][INFO] setup: gtk-theme-name=Adwaita prefer-dark=true toplevels=1 {title="Potato Tomato" visible=true mapped=true realized=true size=1332x772 type=Toplevel}
+264ms [2026-09-16][06:50:53][potato_tomato_lib::system_theme][INFO] subscribed to portal SettingChanged (bus unique name Some(":1.1334015"))
+2103ms [2026-09-16][06:50:55][potato_tomato_lib::system_theme][INFO] desktop switched to light; after switch: gtk-theme-name=Adwaita prefer-dark=false toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1332x772 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
+2103ms [2026-09-16][06:50:55][potato_tomato_lib::system_theme][INFO] [theme +2042ms] theme_bg_color -> Some((246, 245, 244))
+2103ms [2026-09-16][06:50:55][potato_tomato_lib][INFO] coloured main rgb(246, 245, 244)
+2264ms [2026-09-16][06:50:55][potato_tomato_lib][INFO] 2s after setup: gtk-theme-name=Adwaita prefer-dark=false toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1332x772 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
+24551ms [2026-09-16][06:51:17][potato_tomato_lib::system_theme][INFO] desktop switched to dark; after switch: gtk-theme-name=Adwaita prefer-dark=true toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1442x842 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
+24552ms [2026-09-16][06:51:17][potato_tomato_lib::system_theme][INFO] [theme +24490ms] theme_bg_color -> Some((53, 53, 53))
+24552ms [2026-09-16][06:51:17][potato_tomato_lib][INFO] coloured main rgb(53, 53, 53)
```

## Launch (light)

| t (ms) | windows | screen | luminance | light % | page mediaDark | html.dark | readyState | file |
|---|---|---|---|---|---|---|---|---|
| 9 | 0 | - | - | - | - | - | - | 0115-launch-light.png |
| 184 | 0 | - | - | - | - | - | - | 0116-launch-light.png |
| 358 | 0 | - | - | - | - | - | - | 0117-launch-light.png |
| 564 | 0 | - | - | - | - | - | - | 0118-launch-light.png |
| 733 | 1 | light | 0.952 | 99.4 | - | - | - | 0119-launch-light.png |
| 898 | 1 | light | 0.989 | 99.4 | false | false | complete | 0120-launch-light.png |

Page probe after load:
```json
{
  "readyState": "complete",
  "url": "tauri://localhost/home",
  "mediaDark": false,
  "mediaLight": true,
  "htmlDark": false,
  "colorScheme": "light",
  "inlineColorScheme": "light",
  "rootBg": "rgba(0, 0, 0, 0)",
  "bodyBg": "rgb(255, 255, 255)",
  "shellBg": "rgb(255, 255, 255)",
  "background": "Canvas",
  "primary": "AccentColor",
  "primaryResolved": "rgb(0, 122, 255)",
  "devicePixelRatio": 1,
  "inner": [
    1280,
    673
  ],
  "hasTauri": true,
  "shellRendered": true
}
```
App log (theme lines):
```
+94ms [theme +35ms] after gtk::init: gtk-theme-name=Adwaita prefer-dark=false toplevels=0
+95ms [theme +36ms] portal Read color-scheme -> Some(false) in 1ms
+95ms [theme +36ms] apply(dark=false) changed=false; after apply: gtk-theme-name=Adwaita prefer-dark=false toplevels=0
+97ms [theme +38ms] theme_bg_color -> Some((246, 245, 244))
+249ms [2026-09-16][06:51:42][potato_tomato_lib::system_theme][INFO] [theme +35ms] after gtk::init: gtk-theme-name=Adwaita prefer-dark=false toplevels=0
+249ms [2026-09-16][06:51:42][potato_tomato_lib::system_theme][INFO] [theme +36ms] portal Read color-scheme -> Some(false) in 1ms
+249ms [2026-09-16][06:51:42][potato_tomato_lib::system_theme][INFO] [theme +36ms] apply(dark=false) changed=false; after apply: gtk-theme-name=Adwaita prefer-dark=false toplevels=0
+249ms [2026-09-16][06:51:42][potato_tomato_lib::system_theme][INFO] [theme +38ms] theme_bg_color -> Some((246, 245, 244))
+249ms [2026-09-16][06:51:42][potato_tomato_lib][INFO] desktop colour-scheme is light
+249ms [2026-09-16][06:51:42][potato_tomato_lib::system_theme][INFO] [theme +190ms] theme_bg_color -> Some((246, 245, 244))
+249ms [2026-09-16][06:51:42][potato_tomato_lib][INFO] coloured main rgb(246, 245, 244)
+249ms [2026-09-16][06:51:42][potato_tomato_lib::system_theme][INFO] setup: gtk-theme-name=Adwaita prefer-dark=false toplevels=1 {title="Potato Tomato" visible=true mapped=true realized=true size=1332x772 type=Toplevel}
+250ms [2026-09-16][06:51:42][potato_tomato_lib::system_theme][INFO] subscribed to portal SettingChanged (bus unique name Some(":1.1334186"))
+2124ms [2026-09-16][06:51:44][potato_tomato_lib::system_theme][INFO] desktop switched to dark; after switch: gtk-theme-name=Adwaita prefer-dark=true toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1332x772 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
+2124ms [2026-09-16][06:51:44][potato_tomato_lib::system_theme][INFO] [theme +2064ms] theme_bg_color -> Some((53, 53, 53))
+2124ms [2026-09-16][06:51:44][potato_tomato_lib][INFO] coloured main rgb(53, 53, 53)
+2250ms [2026-09-16][06:51:44][potato_tomato_lib][INFO] 2s after setup: gtk-theme-name=Adwaita prefer-dark=true toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1332x772 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
+24614ms [2026-09-16][06:52:07][potato_tomato_lib::system_theme][INFO] desktop switched to light; after switch: gtk-theme-name=Adwaita prefer-dark=false toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1442x842 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
+24614ms [2026-09-16][06:52:07][potato_tomato_lib::system_theme][INFO] [theme +24554ms] theme_bg_color -> Some((246, 245, 244))
+24614ms [2026-09-16][06:52:07][potato_tomato_lib][INFO] coloured main rgb(246, 245, 244)
```

## Live scheme switch

- dark → light: page followed in 211 ms (media query 97 ms, .dark class 211 ms); screen light (lum 0.844); mediaDark=false htmlDark=false shellBg=rgb(255, 255, 255)
  page events: media-change(light) @118ms, html-class(light) @118ms
  ```
  [2026-09-16][06:50:55][potato_tomato_lib][INFO] puller started on port 18787 (data=/home/borys/Projects/potatoetomatoe3/.claude/worktrees/bridge-cse_019wEnJFSMGnLEQApXmGcbBU/src-tauri/../static/games, catalog=/home/borys/Projects/potatoetomatoe3/.claude/worktrees/bridge-cse_019wEnJFSMGnLEQApXmGcbBU/src-tauri/../static/games)
  [2026-09-16][06:50:55][potato_tomato_lib::system_theme][INFO] desktop switched to light; after switch: gtk-theme-name=Adwaita prefer-dark=false toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1332x772 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
  [2026-09-16][06:50:55][potato_tomato_lib::system_theme][INFO] [theme +2042ms] theme_bg_color -> Some((246, 245, 244))
  [2026-09-16][06:50:55][potato_tomato_lib][INFO] coloured main rgb(246, 245, 244)
  [2026-09-16][06:50:55][potato_tomato_lib][INFO] 2s after setup: gtk-theme-name=Adwaita prefer-dark=false toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1332x772 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
  [2026-09-16][06:50:55][potato_tomato_lib][INFO] puller started on port 18787 (data=/home/borys/Projects/potatoetomatoe3/.claude/worktrees/bridge-cse_019wEnJFSMGnLEQApXmGcbBU/src-tauri/../static/games, catalog=/home/borys/Projects/potatoetomatoe3/.claude/worktrees/bridge-cse_019wEnJFSMGnLEQApXmGcbBU/src-tauri/../static/games)
  undefined
  ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "tsx" not found
  Did you mean "pnpm exec tsc"?
  undefined
  ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "tsx" not found
  Did you mean "pnpm exec tsc"?
  ```
- light → dark: page followed in 206 ms (media query 95 ms, .dark class 206 ms); screen dark (lum 0.245); mediaDark=true htmlDark=true shellBg=rgb(30, 30, 30)
  page events: media-change(dark) @122ms, html-class(dark) @122ms
  ```
  [2026-09-16][06:51:17][potato_tomato_lib::system_theme][INFO] desktop switched to dark; after switch: gtk-theme-name=Adwaita prefer-dark=true toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1442x842 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
  [2026-09-16][06:51:17][potato_tomato_lib::system_theme][INFO] [theme +24490ms] theme_bg_color -> Some((53, 53, 53))
  [2026-09-16][06:51:17][potato_tomato_lib][INFO] coloured main rgb(53, 53, 53)
  ```
- light → dark: page followed in 201 ms (media query 90 ms, .dark class 201 ms); screen dark (lum 0.248); mediaDark=true htmlDark=true shellBg=rgb(30, 30, 30)
  page events: media-change(dark) @106ms, html-class(dark) @106ms
  ```
  [2026-09-16][06:51:44][potato_tomato_lib::system_theme][INFO] desktop switched to dark; after switch: gtk-theme-name=Adwaita prefer-dark=true toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1332x772 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
  [2026-09-16][06:51:44][potato_tomato_lib::system_theme][INFO] [theme +2064ms] theme_bg_color -> Some((53, 53, 53))
  [2026-09-16][06:51:44][potato_tomato_lib][INFO] coloured main rgb(53, 53, 53)
  [2026-09-16][06:51:44][potato_tomato_lib][INFO] 2s after setup: gtk-theme-name=Adwaita prefer-dark=true toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1332x772 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
  undefined
  ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "tsx" not found
  Did you mean "pnpm exec tsc"?
  [2026-09-16][06:51:44][potato_tomato_lib][INFO] puller started on port 18787 (data=/home/borys/Projects/potatoetomatoe3/.claude/worktrees/bridge-cse_019wEnJFSMGnLEQApXmGcbBU/src-tauri/../static/games, catalog=/home/borys/Projects/potatoetomatoe3/.claude/worktrees/bridge-cse_019wEnJFSMGnLEQApXmGcbBU/src-tauri/../static/games)
  undefined
  ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "tsx" not found
  Did you mean "pnpm exec tsc"?
  ```
- dark → light: page followed in 125 ms (media query 125 ms, .dark class 125 ms); screen light (lum 0.841); mediaDark=false htmlDark=false shellBg=rgb(255, 255, 255)
  page events: media-change(light) @79ms, html-class(light) @79ms
  ```
  [2026-09-16][06:52:07][potato_tomato_lib::system_theme][INFO] desktop switched to light; after switch: gtk-theme-name=Adwaita prefer-dark=false toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1442x842 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
  [2026-09-16][06:52:07][potato_tomato_lib::system_theme][INFO] [theme +24554ms] theme_bg_color -> Some((246, 245, 244))
  [2026-09-16][06:52:07][potato_tomato_lib][INFO] coloured main rgb(246, 245, 244)
  ```

## Resize

### launched-dark-switched-light
- maximize (Super+Up): 14 frames; window 1920×1040 at 0,40; stale-scheme excess worst 0.0% (0011-maximize-launched-dark-switched-light.png); settled after 0ms; page light-on-dark content 12.4%
  0ms:51%/0% 254ms:1%/0% 419ms:1%/0% 604ms:1%/0% 803ms:1%/0% 980ms:0%/0% 1162ms:0%/0% 1326ms:0%/0% 1491ms:0%/0% 1676ms:0%/0% 1850ms:0%/0% 2023ms:0%/0% 2203ms:0%/0% 2392ms:0%/0%
- restore (Super+Down): 14 frames; window 1332×772 at 304,184; stale-scheme excess worst 0.1% (0025-restore-launched-dark-switched-light.png); settled after 988ms; page light-on-dark content 10.5%
  0ms:50%/0% 219ms:2%/0% 403ms:2%/0% 611ms:2%/0% 800ms:2%/0% 988ms:2%/0% 1163ms:0%/0% 1337ms:0%/0% 1524ms:0%/0% 1710ms:0%/0% 1894ms:0%/0% 2064ms:0%/0% 2257ms:0%/0% 2425ms:0%/0%
- keyboard resize (Alt+F8, arrows) (during): 7 frames; window 1332×772 at 304,184; stale-scheme excess worst 0.1% (0040-keyresize-launched-dark-switched-light.png); settled after 710ms; page light-on-dark content 11.0%
  0ms:3%/0% 178ms:3%/0% 351ms:3%/0% 533ms:3%/0% 710ms:3%/0% 877ms:0%/0% 1056ms:0%/0%
- keyboard resize (Alt+F8, arrows) (after): 9 frames; window 1442×842 at 264,184; stale-scheme excess worst 0.0% (0049-keyresize-done-launched-dark-switched-light.png); settled after 0ms; page light-on-dark content 11.0%
  0ms:0%/0% 187ms:0%/0% 359ms:0%/0% 548ms:0%/0% 726ms:0%/0% 925ms:0%/0% 1118ms:0%/0% 1295ms:0%/0% 1474ms:0%/0%

### launched-dark
- maximize (Super+Up): 15 frames; window 1920×1040 at 0,40; stale-scheme excess worst 0.1% (0064-maximize-launched-dark.png); settled after 0ms; page light-on-dark content 17.6%
  0ms:45%/0% 200ms:1%/0% 383ms:1%/0% 564ms:1%/0% 740ms:1%/0% 909ms:0%/0% 1089ms:0%/0% 1258ms:0%/0% 1429ms:0%/0% 1610ms:0%/0% 1777ms:0%/0% 1942ms:0%/0% 2120ms:0%/0% 2303ms:0%/0% 2479ms:0%/0%
- restore (Super+Down): 14 frames; window 1442×842 at 272,192; stale-scheme excess worst 0.2% (0083-restore-launched-dark.png); settled after 1276ms; page light-on-dark content 12.9%
  0ms:39%/0% 180ms:4%/0% 354ms:3%/0% 540ms:3%/0% 716ms:3%/0% 891ms:2%/0% 1087ms:2%/0% 1276ms:2%/0% 1463ms:0%/0% 1645ms:0%/0% 1826ms:0%/0% 2010ms:0%/0% 2183ms:0%/0% 2359ms:0%/0%
- keyboard resize (Alt+F8, arrows) (during): 7 frames; window 1442×842 at 776,192; stale-scheme excess worst 0.2% (0094-keyresize-launched-dark.png); settled after 738ms; page light-on-dark content 14.4%
  0ms:4%/0% 180ms:4%/0% 364ms:4%/0% 561ms:4%/0% 738ms:4%/0% 913ms:0%/0% 1114ms:0%/0%
- keyboard resize (Alt+F8, arrows) (after): 8 frames; window 1552×912 at 224,192; stale-scheme excess worst 0.0% (0103-keyresize-done-launched-dark.png); settled after 0ms; page light-on-dark content 16.0%
  0ms:0%/0% 188ms:0%/0% 362ms:0%/0% 538ms:0%/0% 716ms:0%/0% 920ms:0%/0% 1139ms:0%/0% 1340ms:0%/0%

### launched-light-switched-dark
- maximize (Super+Up): 15 frames; window 1920×1040 at 0,40; stale-scheme excess worst 0.0% (0126-maximize-launched-light-switched-dark.png); settled after 0ms; page light-on-dark content 17.6%
  0ms:54%/0% 209ms:1%/0% 394ms:1%/0% 574ms:1%/0% 759ms:1%/0% 926ms:1%/0% 1106ms:1%/0% 1267ms:1%/0% 1446ms:1%/0% 1605ms:1%/0% 1771ms:1%/0% 1945ms:1%/0% 2111ms:1%/0% 2285ms:1%/0% 2475ms:0%/0%
- restore (Super+Down): 14 frames; window 1332×772 at 304,216; stale-scheme excess worst 0.1% (0141-restore-launched-light-switched-dark.png); settled after 784ms; page light-on-dark content 12.8%
  0ms:60%/0% 222ms:2%/0% 411ms:2%/0% 586ms:2%/0% 784ms:2%/0% 964ms:0%/0% 1154ms:0%/0% 1344ms:0%/0% 1546ms:0%/0% 1725ms:0%/0% 1913ms:0%/0% 2109ms:0%/0% 2287ms:0%/0% 2468ms:0%/0%
- keyboard resize (Alt+F8, arrows) (during): 7 frames; window 1332×772 at 304,216; stale-scheme excess worst 0.1% (0156-keyresize-launched-light-switched-dark.png); settled after 593ms; page light-on-dark content 14.4%
  0ms:3%/0% 203ms:3%/0% 394ms:3%/0% 593ms:3%/0% 768ms:0%/0% 970ms:0%/0% 1153ms:0%/0%
- keyboard resize (Alt+F8, arrows) (after): 8 frames; window 1442×842 at 776,192; stale-scheme excess worst 0.0% (0165-keyresize-done-launched-light-switched-dark.png); settled after 0ms; page light-on-dark content 14.0%
  0ms:0%/0% 222ms:0%/0% 450ms:0%/0% 652ms:0%/0% 844ms:0%/0% 1031ms:0%/0% 1210ms:0%/0% 1397ms:0%/0%

### launched-light
- maximize (Super+Up): 14 frames; window 1920×1040 at 0,40; stale-scheme excess worst 0.1% (0179-maximize-launched-light.png); settled after 0ms; page light-on-dark content 13.2%
  0ms:55%/0% 197ms:1%/0% 383ms:1%/0% 552ms:1%/0% 730ms:1%/0% 908ms:0%/0% 1090ms:0%/0% 1270ms:0%/0% 1452ms:0%/0% 1662ms:0%/0% 1834ms:0%/0% 2013ms:0%/0% 2203ms:0%/0% 2382ms:0%/0%
- restore (Super+Down): 14 frames; window 1442×842 at 264,184; stale-scheme excess worst 0.1% (0193-restore-launched-light.png); settled after 720ms; page light-on-dark content 11.0%
  0ms:43%/0% 182ms:2%/0% 359ms:2%/0% 542ms:2%/0% 720ms:2%/0% 899ms:0%/0% 1076ms:0%/0% 1258ms:0%/0% 1441ms:0%/0% 1625ms:0%/0% 1804ms:0%/0% 1982ms:0%/0% 2169ms:0%/0% 2353ms:0%/0%
- keyboard resize (Alt+F8, arrows) (during): 7 frames; window 1442×842 at 264,184; stale-scheme excess worst 0.0% (0208-keyresize-launched-light.png); settled after 0ms; page light-on-dark content 12.1%
  0ms:2%/0% 191ms:2%/0% 374ms:2%/0% 558ms:1%/0% 734ms:0%/0% 935ms:0%/0% 1128ms:0%/0%
- keyboard resize (Alt+F8, arrows) (after): 9 frames; window 1552×912 at 224,184; stale-scheme excess worst 0.0% (0217-keyresize-done-launched-light.png); settled after 922ms; page light-on-dark content 12.2%
  0ms:2%/0% 189ms:2%/0% 371ms:2%/0% 555ms:2%/0% 729ms:2%/0% 922ms:2%/0% 1104ms:1%/0% 1278ms:1%/0% 1465ms:0%/0%

