# Desktop theme field test — 2026-09-16 06:47:44

Binary: `/tmp/potato-tomato-prod4` (embedded build)  
Desktop: GNOME / wayland, GNOME Shell 50.2, GTK theme 'Adwaita', accent 'blue', scheme at start 'prefer-dark', monitor 1920x1080@60.000 at scale 2

Frames referenced below are cropped to the app window (`frames/`).

| Check | Result | Detail |
|---|---|---|
| dark: page loaded | ✅ pass | in 759ms |
| dark: first visible frame is dark | ✅ pass | first frame at +759ms classified dark (lum 0.118, light 0) |
| dark: no wrong-scheme frames during launch | ✅ pass | 0 frame(s) over 0ms |
| dark: exactly one window during launch | ✅ pass | one window throughout |
| dark: settled page is dark | ✅ pass | classified dark (lum 0.287) |
| dark: window opened at its configured size | ✅ pass | page inner 960×461 css px (expected ≥ 920×420), devicePixelRatio 2, on screen 1648×912 px |
| dark: prefers-color-scheme matches desktop | ✅ pass | mediaDark=true htmlDark=true colorScheme=dark |
| dark: nothing left on screen after close | ❌ FAIL | regions still differing from the pre-launch desktop [{"x":1072,"y":208,"width":848,"height":880},{"x":288,"y":208,"width":736,"height":864}] — check the frame: another window repainting underneath looks the same to this diff |
| light: page loaded | ✅ pass | in 736ms |
| light: first visible frame is light | ❌ FAIL | first frame at +736ms classified dark (lum 0.04, light 0.047) |
| light: no wrong-scheme frames during launch | ❌ FAIL | 1 frame(s) over 0ms — first frames/0013-launch-light.png |
| light: exactly one window during launch | ✅ pass | one window throughout |
| light: settled page is light | ✅ pass | classified light (lum 0.841) |
| light: window opened at its configured size | ✅ pass | page inner 960×461 css px (expected ≥ 920×420), devicePixelRatio 2, on screen 1920×1024 px |
| light: prefers-color-scheme matches desktop | ✅ pass | mediaDark=false htmlDark=false colorScheme=light |
| light: nothing left on screen after close | ✅ pass | desktop matches pre-launch |

## Launch (dark)

| t (ms) | windows | screen | luminance | light % | page mediaDark | html.dark | readyState | file |
|---|---|---|---|---|---|---|---|---|
| 23 | 0 | - | - | - | - | - | - | 0001-launch-dark.png |
| 200 | 0 | - | - | - | - | - | - | 0002-launch-dark.png |
| 372 | 0 | - | - | - | - | - | - | 0003-launch-dark.png |
| 554 | 0 | - | - | - | - | - | - | 0004-launch-dark.png |
| 759 | 1 | dark | 0.118 | 0.0 | true | true | complete | 0005-launch-dark.png |

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
  "devicePixelRatio": 2,
  "inner": [
    960,
    461
  ],
  "hasTauri": true,
  "shellRendered": true
}
```
App log (theme lines):
```
+92ms [theme +35ms] after gtk::init: gtk-theme-name=Adwaita prefer-dark=false toplevels=0
+93ms [theme +36ms] portal Read color-scheme -> Some(true) in 1ms
+107ms [theme +50ms] apply(dark=true) changed=true; after apply: gtk-theme-name=Adwaita prefer-dark=true toplevels=0
+110ms [theme +53ms] theme_bg_color -> Some((53, 53, 53))
+260ms [2026-09-16][06:47:46][potato_tomato_lib::system_theme][INFO] [theme +35ms] after gtk::init: gtk-theme-name=Adwaita prefer-dark=false toplevels=0
+260ms [2026-09-16][06:47:46][potato_tomato_lib::system_theme][INFO] [theme +36ms] portal Read color-scheme -> Some(true) in 1ms
+260ms [2026-09-16][06:47:46][potato_tomato_lib::system_theme][INFO] [theme +50ms] apply(dark=true) changed=true; after apply: gtk-theme-name=Adwaita prefer-dark=true toplevels=0
+260ms [2026-09-16][06:47:46][potato_tomato_lib::system_theme][INFO] [theme +53ms] theme_bg_color -> Some((53, 53, 53))
+260ms [2026-09-16][06:47:46][potato_tomato_lib][INFO] desktop colour-scheme is dark
+260ms [2026-09-16][06:47:46][potato_tomato_lib::system_theme][INFO] [theme +204ms] theme_bg_color -> Some((53, 53, 53))
+260ms [2026-09-16][06:47:46][potato_tomato_lib][INFO] coloured main rgb(53, 53, 53)
+260ms [2026-09-16][06:47:46][potato_tomato_lib::system_theme][INFO] setup: gtk-theme-name=Adwaita prefer-dark=true toplevels=1 {title="Potato Tomato" visible=true mapped=true realized=true size=1332x772 type=Toplevel}
+260ms [2026-09-16][06:47:46][potato_tomato_lib::system_theme][INFO] subscribed to portal SettingChanged (bus unique name Some(":1.1333339"))
```

## Launch (light)

| t (ms) | windows | screen | luminance | light % | page mediaDark | html.dark | readyState | file |
|---|---|---|---|---|---|---|---|---|
| 5 | 0 | - | - | - | - | - | - | 0009-launch-light.png |
| 185 | 0 | - | - | - | - | - | - | 0010-launch-light.png |
| 361 | 0 | - | - | - | - | - | - | 0011-launch-light.png |
| 556 | 0 | - | - | - | - | - | - | 0012-launch-light.png |
| 736 | 1 | dark | 0.04 | 4.7 | false | false | complete | 0013-launch-light.png |

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
  "devicePixelRatio": 2,
  "inner": [
    960,
    461
  ],
  "hasTauri": true,
  "shellRendered": true
}
```
App log (theme lines):
```
+95ms [theme +36ms] after gtk::init: gtk-theme-name=Adwaita prefer-dark=false toplevels=0
+96ms [theme +38ms] portal Read color-scheme -> Some(false) in 1ms
+96ms [theme +38ms] apply(dark=false) changed=false; after apply: gtk-theme-name=Adwaita prefer-dark=false toplevels=0
+98ms [theme +40ms] theme_bg_color -> Some((246, 245, 244))
+262ms [2026-09-16][06:47:51][potato_tomato_lib::system_theme][INFO] [theme +36ms] after gtk::init: gtk-theme-name=Adwaita prefer-dark=false toplevels=0
+262ms [2026-09-16][06:47:51][potato_tomato_lib::system_theme][INFO] [theme +38ms] portal Read color-scheme -> Some(false) in 1ms
+262ms [2026-09-16][06:47:51][potato_tomato_lib::system_theme][INFO] [theme +38ms] apply(dark=false) changed=false; after apply: gtk-theme-name=Adwaita prefer-dark=false toplevels=0
+262ms [2026-09-16][06:47:51][potato_tomato_lib::system_theme][INFO] [theme +40ms] theme_bg_color -> Some((246, 245, 244))
+262ms [2026-09-16][06:47:51][potato_tomato_lib][INFO] desktop colour-scheme is light
+262ms [2026-09-16][06:47:51][potato_tomato_lib::system_theme][INFO] [theme +203ms] theme_bg_color -> Some((246, 245, 244))
+262ms [2026-09-16][06:47:51][potato_tomato_lib][INFO] coloured main rgb(246, 245, 244)
+262ms [2026-09-16][06:47:51][potato_tomato_lib::system_theme][INFO] setup: gtk-theme-name=Adwaita prefer-dark=false toplevels=1 {title="Potato Tomato" visible=true mapped=true realized=true size=1332x772 type=Toplevel}
+262ms [2026-09-16][06:47:51][potato_tomato_lib::system_theme][INFO] subscribed to portal SettingChanged (bus unique name Some(":1.1333364"))
```

