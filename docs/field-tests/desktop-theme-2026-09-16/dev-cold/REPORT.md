# Desktop theme field test — 2026-09-16 06:53:00

Binary: `/tmp/potato-tomato-dev5` (dev server (Vite))  
Desktop: GNOME / wayland, GNOME Shell 50.2, GTK theme 'Adwaita', accent 'blue', scheme at start 'prefer-dark', monitor 1920x1080@60.000 at scale 1

Frames referenced below are cropped to the app window (`frames/`).

| Check | Result | Detail |
|---|---|---|
| dark: page loaded | ✅ pass | in 21880ms |
| dark: first visible frame is dark | ✅ pass | first frame at +760ms classified dark (lum 0.205, light 0.0004) |
| dark: no wrong-scheme frames during launch | ✅ pass | 0 frame(s) over 0ms |
| dark: exactly one window during launch | ✅ pass | one window throughout |
| dark: settled page is dark | ✅ pass | classified dark (lum 0.141) |
| dark: window opened at its configured size | ✅ pass | page inner 1280×673 css px (expected ≥ 1200×600), devicePixelRatio 1, on screen 1312×560 px |
| dark: prefers-color-scheme matches desktop | ✅ pass | mediaDark=true htmlDark=true colorScheme=dark |
| dark: nothing left on screen after close | ✅ pass | desktop matches pre-launch |
| light: page loaded | ✅ pass | in 23274ms |
| light: first visible frame is light | ✅ pass | first frame at +746ms classified light (lum 0.952, light 0.9936) |
| light: no wrong-scheme frames during launch | ✅ pass | 0 frame(s) over 0ms |
| light: exactly one window during launch | ✅ pass | one window throughout |
| light: settled page is light | ✅ pass | classified light (lum 0.976) |
| light: window opened at its configured size | ✅ pass | page inner 1280×673 css px (expected ≥ 1200×600), devicePixelRatio 1, on screen 1312×752 px |
| light: prefers-color-scheme matches desktop | ✅ pass | mediaDark=false htmlDark=false colorScheme=light |
| light: nothing left on screen after close | ✅ pass | desktop matches pre-launch |
| live switch dark→light: page followed | ✅ pass | in 2190ms (media query 86ms, .dark class 2190ms) |
| live switch dark→light: screen shows light | ✅ pass | classified light (lum 0.801) |
| live switch light→dark: page followed | ✅ pass | in 232ms (media query 232ms, .dark class 232ms) |
| live switch light→dark: screen shows dark | ✅ pass | classified dark (lum 0.231) |
| live switch light→dark: page followed | ✅ pass | in 1984ms (media query 98ms, .dark class 1984ms) |
| live switch light→dark: screen shows dark | ✅ pass | classified dark (lum 0.284) |
| live switch dark→light: page followed | ✅ pass | in 217ms (media query 102ms, .dark class 217ms) |
| live switch dark→light: screen shows light | ✅ pass | classified light (lum 0.866) |
| launched-dark-switched-light: maximize (Super+Up) — no stale-scheme area | ✅ pass | worst 0.0% of the page painted in the old scheme beyond the settled page |
| launched-dark-switched-light: maximize (Super+Up) — settled promptly | ✅ pass | still changing 1531ms after the action (content re-flow and thumbnail loads included) |
| launched-dark-switched-light: restore (Super+Down) — no stale-scheme area | ✅ pass | worst 0.1% of the page painted in the old scheme beyond the settled page |
| launched-dark-switched-light: restore (Super+Down) — settled promptly | ✅ pass | still changing 0ms after the action (content re-flow and thumbnail loads included) |
| launched-dark-switched-light: keyboard resize (Alt+F8, arrows) — no stale-scheme area | ✅ pass | worst 0.0% of the page painted in the old scheme beyond the settled page |
| launched-dark-switched-light: keyboard resize (Alt+F8, arrows) — settled promptly | ✅ pass | still changing 0ms after the action (content re-flow and thumbnail loads included) |
| launched-dark: maximize (Super+Up) — no stale-scheme area | ✅ pass | worst 0.0% of the page painted in the old scheme beyond the settled page |
| launched-dark: maximize (Super+Up) — settled promptly | ✅ pass | still changing 0ms after the action (content re-flow and thumbnail loads included) |
| launched-dark: restore (Super+Down) — no stale-scheme area | ✅ pass | worst 0.1% of the page painted in the old scheme beyond the settled page |
| launched-dark: restore (Super+Down) — settled promptly | ✅ pass | still changing 0ms after the action (content re-flow and thumbnail loads included) |
| launched-dark: keyboard resize (Alt+F8, arrows) — no stale-scheme area | ✅ pass | worst 0.1% of the page painted in the old scheme beyond the settled page |
| launched-dark: keyboard resize (Alt+F8, arrows) — settled promptly | ✅ pass | still changing 373ms after the action (content re-flow and thumbnail loads included) |
| launched-light-switched-dark: maximize (Super+Up) — no stale-scheme area | ✅ pass | worst 0.0% of the page painted in the old scheme beyond the settled page |
| launched-light-switched-dark: maximize (Super+Up) — settled promptly | ✅ pass | still changing 0ms after the action (content re-flow and thumbnail loads included) |
| launched-light-switched-dark: restore (Super+Down) — no stale-scheme area | ✅ pass | worst 0.0% of the page painted in the old scheme beyond the settled page |
| launched-light-switched-dark: restore (Super+Down) — settled promptly | ✅ pass | still changing 0ms after the action (content re-flow and thumbnail loads included) |
| launched-light-switched-dark: keyboard resize (Alt+F8, arrows) — no stale-scheme area | ✅ pass | worst 0.0% of the page painted in the old scheme beyond the settled page |
| launched-light-switched-dark: keyboard resize (Alt+F8, arrows) — settled promptly | ✅ pass | still changing 0ms after the action (content re-flow and thumbnail loads included) |
| launched-light: maximize (Super+Up) — no stale-scheme area | ✅ pass | worst 0.0% of the page painted in the old scheme beyond the settled page |
| launched-light: maximize (Super+Up) — settled promptly | ✅ pass | still changing 1105ms after the action (content re-flow and thumbnail loads included) |
| launched-light: restore (Super+Down) — no stale-scheme area | ✅ pass | worst 0.1% of the page painted in the old scheme beyond the settled page |
| launched-light: restore (Super+Down) — settled promptly | ✅ pass | still changing 0ms after the action (content re-flow and thumbnail loads included) |
| launched-light: keyboard resize (Alt+F8, arrows) — no stale-scheme area | ✅ pass | worst 0.1% of the page painted in the old scheme beyond the settled page |
| launched-light: keyboard resize (Alt+F8, arrows) — settled promptly | ✅ pass | still changing 549ms after the action (content re-flow and thumbnail loads included) |

## Launch (dark)

| t (ms) | windows | screen | luminance | light % | page mediaDark | html.dark | readyState | file |
|---|---|---|---|---|---|---|---|---|
| 23 | 0 | - | - | - | - | - | - | 0001-launch-dark.png |
| 213 | 0 | - | - | - | - | - | - | 0002-launch-dark.png |
| 384 | 0 | - | - | - | - | - | - | 0003-launch-dark.png |
| 564 | 0 | - | - | - | - | - | - | 0004-launch-dark.png |
| 760 | 1 | dark | 0.205 | 0.0 | - | - | - | 0005-launch-dark.png |
| 943 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0006-launch-dark.png |
| 1119 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0007-launch-dark.png |
| 1295 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0008-launch-dark.png |
| 1483 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0009-launch-dark.png |
| 1657 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0010-launch-dark.png |
| 1819 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0011-launch-dark.png |
| 1978 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0012-launch-dark.png |
| 2136 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0013-launch-dark.png |
| 2341 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0014-launch-dark.png |
| 2648 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0015-launch-dark.png |
| 2917 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0016-launch-dark.png |
| 3079 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0017-launch-dark.png |
| 3240 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0018-launch-dark.png |
| 3395 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0019-launch-dark.png |
| 3557 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0020-launch-dark.png |
| 3715 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0021-launch-dark.png |
| 3872 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0022-launch-dark.png |
| 4035 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0023-launch-dark.png |
| 4196 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0024-launch-dark.png |
| 4357 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0025-launch-dark.png |
| 4518 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0026-launch-dark.png |
| 4677 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0027-launch-dark.png |
| 4831 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0028-launch-dark.png |
| 4993 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0029-launch-dark.png |
| 5153 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0030-launch-dark.png |
| 5315 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0031-launch-dark.png |
| 5481 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0032-launch-dark.png |
| 5648 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0033-launch-dark.png |
| 5810 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0034-launch-dark.png |
| 5968 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0035-launch-dark.png |
| 6130 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0036-launch-dark.png |
| 6298 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0037-launch-dark.png |
| 6463 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0038-launch-dark.png |
| 6626 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0039-launch-dark.png |
| 6789 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0040-launch-dark.png |
| 6955 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0041-launch-dark.png |
| 7126 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0042-launch-dark.png |
| 7293 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0043-launch-dark.png |
| 7458 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0044-launch-dark.png |
| 7623 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0045-launch-dark.png |
| 7783 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0046-launch-dark.png |
| 7956 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0047-launch-dark.png |
| 8113 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0048-launch-dark.png |
| 8279 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0049-launch-dark.png |
| 8439 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0050-launch-dark.png |
| 8602 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0051-launch-dark.png |
| 8770 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0052-launch-dark.png |
| 8944 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0053-launch-dark.png |
| 9104 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0054-launch-dark.png |
| 9263 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0055-launch-dark.png |
| 9433 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0056-launch-dark.png |
| 9597 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0057-launch-dark.png |
| 9765 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0058-launch-dark.png |
| 9934 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0059-launch-dark.png |
| 10096 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0060-launch-dark.png |
| 10263 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0061-launch-dark.png |
| 10428 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0062-launch-dark.png |
| 10591 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0063-launch-dark.png |
| 10761 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0064-launch-dark.png |
| 10927 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0065-launch-dark.png |
| 11093 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0066-launch-dark.png |
| 11257 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0067-launch-dark.png |
| 11422 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0068-launch-dark.png |
| 11593 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0069-launch-dark.png |
| 11759 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0070-launch-dark.png |
| 11918 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0071-launch-dark.png |
| 12080 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0072-launch-dark.png |
| 12243 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0073-launch-dark.png |
| 12406 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0074-launch-dark.png |
| 12569 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0075-launch-dark.png |
| 12730 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0076-launch-dark.png |
| 12894 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0077-launch-dark.png |
| 13053 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0078-launch-dark.png |
| 13218 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0079-launch-dark.png |
| 13384 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0080-launch-dark.png |
| 13547 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0081-launch-dark.png |
| 13705 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0082-launch-dark.png |
| 13875 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0083-launch-dark.png |
| 14032 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0084-launch-dark.png |
| 14194 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0085-launch-dark.png |
| 14368 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0086-launch-dark.png |
| 14530 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0087-launch-dark.png |
| 14695 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0088-launch-dark.png |
| 14862 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0089-launch-dark.png |
| 15033 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0090-launch-dark.png |
| 15192 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0091-launch-dark.png |
| 15360 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0092-launch-dark.png |
| 15527 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0093-launch-dark.png |
| 15694 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0094-launch-dark.png |
| 15862 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0095-launch-dark.png |
| 16028 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0096-launch-dark.png |
| 16193 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0097-launch-dark.png |
| 16363 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0098-launch-dark.png |
| 16531 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0099-launch-dark.png |
| 16700 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0100-launch-dark.png |
| 16862 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0101-launch-dark.png |
| 17027 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0102-launch-dark.png |
| 17189 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0103-launch-dark.png |
| 17343 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0104-launch-dark.png |
| 17505 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0105-launch-dark.png |
| 17661 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0106-launch-dark.png |
| 17830 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0107-launch-dark.png |
| 18005 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0108-launch-dark.png |
| 18291 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0109-launch-dark.png |
| 18532 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0110-launch-dark.png |
| 18694 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0111-launch-dark.png |
| 18860 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0112-launch-dark.png |
| 19017 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0113-launch-dark.png |
| 19172 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0114-launch-dark.png |
| 19331 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0115-launch-dark.png |
| 19494 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0116-launch-dark.png |
| 19646 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0117-launch-dark.png |
| 19799 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0118-launch-dark.png |
| 19955 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0119-launch-dark.png |
| 20115 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0120-launch-dark.png |
| 20274 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0121-launch-dark.png |
| 20432 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0122-launch-dark.png |
| 20590 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0123-launch-dark.png |
| 20750 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0124-launch-dark.png |
| 20911 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0125-launch-dark.png |
| 21068 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0126-launch-dark.png |
| 21235 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0127-launch-dark.png |
| 21399 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0128-launch-dark.png |
| 21558 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0129-launch-dark.png |
| 21718 | 1 | dark | 0.205 | 0.0 | true | false | complete | 0130-launch-dark.png |
| 21880 | 1 | dark | 0.205 | 0.0 | true | true | complete | 0131-launch-dark.png |

Page probe after load:
```json
{
  "readyState": "complete",
  "url": "http://127.0.0.1:5173/home",
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
+101ms [theme +43ms] after gtk::init: gtk-theme-name=Adwaita prefer-dark=false toplevels=0
+103ms [theme +44ms] portal Read color-scheme -> Some(true) in 1ms
+117ms [theme +59ms] apply(dark=true) changed=true; after apply: gtk-theme-name=Adwaita prefer-dark=true toplevels=0
+120ms [theme +62ms] theme_bg_color -> Some((53, 53, 53))
+282ms [2026-09-16][06:53:06][potato_tomato_lib::system_theme][INFO] [theme +43ms] after gtk::init: gtk-theme-name=Adwaita prefer-dark=false toplevels=0
+282ms [2026-09-16][06:53:06][potato_tomato_lib::system_theme][INFO] [theme +44ms] portal Read color-scheme -> Some(true) in 1ms
+282ms [2026-09-16][06:53:06][potato_tomato_lib::system_theme][INFO] [theme +59ms] apply(dark=true) changed=true; after apply: gtk-theme-name=Adwaita prefer-dark=true toplevels=0
+282ms [2026-09-16][06:53:06][potato_tomato_lib::system_theme][INFO] [theme +62ms] theme_bg_color -> Some((53, 53, 53))
+282ms [2026-09-16][06:53:06][potato_tomato_lib][INFO] desktop colour-scheme is dark
+282ms [2026-09-16][06:53:06][potato_tomato_lib::system_theme][INFO] [theme +224ms] theme_bg_color -> Some((53, 53, 53))
+282ms [2026-09-16][06:53:06][potato_tomato_lib][INFO] coloured main rgb(53, 53, 53)
+282ms [2026-09-16][06:53:06][potato_tomato_lib::system_theme][INFO] setup: gtk-theme-name=Adwaita prefer-dark=true toplevels=1 {title="Potato Tomato" visible=true mapped=true realized=true size=1332x772 type=Toplevel}
+283ms [2026-09-16][06:53:06][potato_tomato_lib::system_theme][INFO] subscribed to portal SettingChanged (bus unique name Some(":1.1334476"))
+2339ms [2026-09-16][06:53:08][potato_tomato_lib][INFO] 2s after setup: gtk-theme-name=Adwaita prefer-dark=true toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1332x772 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
+23065ms [2026-09-16][06:53:29][potato_tomato_lib::system_theme][INFO] desktop switched to light; after switch: gtk-theme-name=Adwaita prefer-dark=false toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1332x772 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
+23065ms [2026-09-16][06:53:29][potato_tomato_lib::system_theme][INFO] [theme +23007ms] theme_bg_color -> Some((246, 245, 244))
+23065ms [2026-09-16][06:53:29][potato_tomato_lib][INFO] coloured main rgb(246, 245, 244)
+47735ms [2026-09-16][06:53:54][potato_tomato_lib::system_theme][INFO] desktop switched to dark; after switch: gtk-theme-name=Adwaita prefer-dark=true toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1442x842 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
+47735ms [2026-09-16][06:53:54][potato_tomato_lib::system_theme][INFO] [theme +47677ms] theme_bg_color -> Some((53, 53, 53))
+47736ms [2026-09-16][06:53:54][potato_tomato_lib][INFO] coloured main rgb(53, 53, 53)
```

## Launch (light)

| t (ms) | windows | screen | luminance | light % | page mediaDark | html.dark | readyState | file |
|---|---|---|---|---|---|---|---|---|
| 9 | 0 | - | - | - | - | - | - | 0244-launch-light.png |
| 174 | 0 | - | - | - | - | - | - | 0245-launch-light.png |
| 349 | 0 | - | - | - | - | - | - | 0246-launch-light.png |
| 549 | 0 | - | - | - | - | - | - | 0247-launch-light.png |
| 746 | 1 | light | 0.952 | 99.4 | - | - | - | 0248-launch-light.png |
| 911 | 1 | light | 0.952 | 99.4 | false | false | complete | 0249-launch-light.png |
| 1083 | 1 | light | 0.952 | 99.4 | false | false | complete | 0250-launch-light.png |
| 1254 | 1 | light | 0.952 | 99.4 | false | false | complete | 0251-launch-light.png |
| 1427 | 1 | light | 0.952 | 99.4 | false | false | complete | 0252-launch-light.png |
| 1593 | 1 | light | 0.952 | 99.4 | false | false | complete | 0253-launch-light.png |
| 1752 | 1 | light | 0.952 | 99.4 | false | false | complete | 0254-launch-light.png |
| 1915 | 1 | light | 0.952 | 99.4 | false | false | complete | 0255-launch-light.png |
| 2075 | 1 | light | 0.952 | 99.4 | false | false | complete | 0256-launch-light.png |
| 2226 | 1 | light | 0.952 | 99.4 | false | false | complete | 0257-launch-light.png |
| 2404 | 1 | light | 0.952 | 99.4 | false | false | complete | 0258-launch-light.png |
| 2632 | 1 | light | 0.952 | 99.4 | false | false | complete | 0259-launch-light.png |
| 2899 | 1 | light | 0.952 | 99.4 | false | false | complete | 0260-launch-light.png |
| 3068 | 1 | light | 0.952 | 99.4 | false | false | complete | 0261-launch-light.png |
| 3222 | 1 | light | 0.952 | 99.4 | false | false | complete | 0262-launch-light.png |
| 3382 | 1 | light | 0.952 | 99.4 | false | false | complete | 0263-launch-light.png |
| 3544 | 1 | light | 0.952 | 99.4 | false | false | complete | 0264-launch-light.png |
| 3702 | 1 | light | 0.952 | 99.4 | false | false | complete | 0265-launch-light.png |
| 3861 | 1 | light | 0.952 | 99.4 | false | false | complete | 0266-launch-light.png |
| 4024 | 1 | light | 0.952 | 99.4 | false | false | complete | 0267-launch-light.png |
| 4177 | 1 | light | 0.952 | 99.4 | false | false | complete | 0268-launch-light.png |
| 4346 | 1 | light | 0.952 | 99.4 | false | false | complete | 0269-launch-light.png |
| 4515 | 1 | light | 0.952 | 99.4 | false | false | complete | 0270-launch-light.png |
| 4671 | 1 | light | 0.952 | 99.4 | false | false | complete | 0271-launch-light.png |
| 4835 | 1 | light | 0.952 | 99.4 | false | false | complete | 0272-launch-light.png |
| 4991 | 1 | light | 0.952 | 99.4 | false | false | complete | 0273-launch-light.png |
| 5149 | 1 | light | 0.952 | 99.4 | false | false | complete | 0274-launch-light.png |
| 5309 | 1 | light | 0.952 | 99.4 | false | false | complete | 0275-launch-light.png |
| 5462 | 1 | light | 0.952 | 99.4 | false | false | complete | 0276-launch-light.png |
| 5623 | 1 | light | 0.952 | 99.4 | false | false | complete | 0277-launch-light.png |
| 5776 | 1 | light | 0.952 | 99.4 | false | false | complete | 0278-launch-light.png |
| 5936 | 1 | light | 0.952 | 99.4 | false | false | complete | 0279-launch-light.png |
| 6095 | 1 | light | 0.952 | 99.4 | false | false | complete | 0280-launch-light.png |
| 6271 | 1 | light | 0.952 | 99.4 | false | false | complete | 0281-launch-light.png |
| 6436 | 1 | light | 0.952 | 99.4 | false | false | complete | 0282-launch-light.png |
| 6600 | 1 | light | 0.952 | 99.4 | false | false | complete | 0283-launch-light.png |
| 6763 | 1 | light | 0.952 | 99.4 | false | false | complete | 0284-launch-light.png |
| 6924 | 1 | light | 0.952 | 99.4 | false | false | complete | 0285-launch-light.png |
| 7087 | 1 | light | 0.952 | 99.4 | false | false | complete | 0286-launch-light.png |
| 7250 | 1 | light | 0.952 | 99.4 | false | false | complete | 0287-launch-light.png |
| 7418 | 1 | light | 0.952 | 99.4 | false | false | complete | 0288-launch-light.png |
| 7584 | 1 | light | 0.952 | 99.4 | false | false | complete | 0289-launch-light.png |
| 7750 | 1 | light | 0.952 | 99.4 | false | false | complete | 0290-launch-light.png |
| 7915 | 1 | light | 0.952 | 99.4 | false | false | complete | 0291-launch-light.png |
| 8082 | 1 | light | 0.952 | 99.4 | false | false | complete | 0292-launch-light.png |
| 8243 | 1 | light | 0.952 | 99.4 | false | false | complete | 0293-launch-light.png |
| 8409 | 1 | light | 0.952 | 99.4 | false | false | complete | 0294-launch-light.png |
| 8572 | 1 | light | 0.952 | 99.4 | false | false | complete | 0295-launch-light.png |
| 8736 | 1 | light | 0.952 | 99.4 | false | false | complete | 0296-launch-light.png |
| 8904 | 1 | light | 0.952 | 99.4 | false | false | complete | 0297-launch-light.png |
| 9069 | 1 | light | 0.952 | 99.4 | false | false | complete | 0298-launch-light.png |
| 9241 | 1 | light | 0.952 | 99.4 | false | false | complete | 0299-launch-light.png |
| 9405 | 1 | light | 0.952 | 99.4 | false | false | complete | 0300-launch-light.png |
| 9568 | 1 | light | 0.952 | 99.4 | false | false | complete | 0301-launch-light.png |
| 9735 | 1 | light | 0.952 | 99.4 | false | false | complete | 0302-launch-light.png |
| 9898 | 1 | light | 0.952 | 99.4 | false | false | complete | 0303-launch-light.png |
| 10059 | 1 | light | 0.952 | 99.4 | false | false | complete | 0304-launch-light.png |
| 10218 | 1 | light | 0.952 | 99.4 | false | false | complete | 0305-launch-light.png |
| 10387 | 1 | light | 0.952 | 99.4 | false | false | complete | 0306-launch-light.png |
| 10554 | 1 | light | 0.952 | 99.4 | false | false | complete | 0307-launch-light.png |
| 10717 | 1 | light | 0.952 | 99.4 | false | false | complete | 0308-launch-light.png |
| 10882 | 1 | light | 0.952 | 99.4 | false | false | complete | 0309-launch-light.png |
| 11047 | 1 | light | 0.952 | 99.4 | false | false | complete | 0310-launch-light.png |
| 11208 | 1 | light | 0.952 | 99.4 | false | false | complete | 0311-launch-light.png |
| 11374 | 1 | light | 0.952 | 99.4 | false | false | complete | 0312-launch-light.png |
| 11553 | 1 | light | 0.952 | 99.4 | false | false | complete | 0313-launch-light.png |
| 11721 | 1 | light | 0.952 | 99.4 | false | false | complete | 0314-launch-light.png |
| 11890 | 1 | light | 0.952 | 99.4 | false | false | complete | 0315-launch-light.png |
| 12049 | 1 | light | 0.952 | 99.4 | false | false | complete | 0316-launch-light.png |
| 12220 | 1 | light | 0.952 | 99.4 | false | false | complete | 0317-launch-light.png |
| 12389 | 1 | light | 0.952 | 99.4 | false | false | complete | 0318-launch-light.png |
| 12562 | 1 | light | 0.952 | 99.4 | false | false | complete | 0319-launch-light.png |
| 12724 | 1 | light | 0.952 | 99.4 | false | false | complete | 0320-launch-light.png |
| 12887 | 1 | light | 0.952 | 99.4 | false | false | complete | 0321-launch-light.png |
| 13053 | 1 | light | 0.952 | 99.4 | false | false | complete | 0322-launch-light.png |
| 13229 | 1 | light | 0.952 | 99.4 | false | false | complete | 0323-launch-light.png |
| 13397 | 1 | light | 0.952 | 99.4 | false | false | complete | 0324-launch-light.png |
| 13568 | 1 | light | 0.952 | 99.4 | false | false | complete | 0325-launch-light.png |
| 13731 | 1 | light | 0.952 | 99.4 | false | false | complete | 0326-launch-light.png |
| 13900 | 1 | light | 0.952 | 99.4 | false | false | complete | 0327-launch-light.png |
| 14064 | 1 | light | 0.952 | 99.4 | false | false | complete | 0328-launch-light.png |
| 14232 | 1 | light | 0.952 | 99.4 | false | false | complete | 0329-launch-light.png |
| 14398 | 1 | light | 0.952 | 99.4 | false | false | complete | 0330-launch-light.png |
| 14566 | 1 | light | 0.952 | 99.4 | false | false | complete | 0331-launch-light.png |
| 14734 | 1 | light | 0.952 | 99.4 | false | false | complete | 0332-launch-light.png |
| 14896 | 1 | light | 0.952 | 99.4 | false | false | complete | 0333-launch-light.png |
| 15059 | 1 | light | 0.952 | 99.4 | false | false | complete | 0334-launch-light.png |
| 15219 | 1 | light | 0.952 | 99.4 | false | false | complete | 0335-launch-light.png |
| 15379 | 1 | light | 0.952 | 99.4 | false | false | complete | 0336-launch-light.png |
| 15551 | 1 | light | 0.952 | 99.4 | false | false | complete | 0337-launch-light.png |
| 15713 | 1 | light | 0.952 | 99.4 | false | false | complete | 0338-launch-light.png |
| 15873 | 1 | light | 0.952 | 99.4 | false | false | complete | 0339-launch-light.png |
| 16031 | 1 | light | 0.952 | 99.4 | false | false | complete | 0340-launch-light.png |
| 16193 | 1 | light | 0.952 | 99.4 | false | false | complete | 0341-launch-light.png |
| 16354 | 1 | light | 0.952 | 99.4 | false | false | complete | 0342-launch-light.png |
| 16527 | 1 | light | 0.952 | 99.4 | false | false | complete | 0343-launch-light.png |
| 16691 | 1 | light | 0.952 | 99.4 | false | false | complete | 0344-launch-light.png |
| 16856 | 1 | light | 0.952 | 99.4 | false | false | complete | 0345-launch-light.png |
| 17022 | 1 | light | 0.952 | 99.4 | false | false | complete | 0346-launch-light.png |
| 17184 | 1 | light | 0.952 | 99.4 | false | false | complete | 0347-launch-light.png |
| 17347 | 1 | light | 0.952 | 99.4 | false | false | complete | 0348-launch-light.png |
| 17506 | 1 | light | 0.952 | 99.4 | false | false | complete | 0349-launch-light.png |
| 17668 | 1 | light | 0.952 | 99.4 | false | false | complete | 0350-launch-light.png |
| 17838 | 1 | light | 0.952 | 99.4 | false | false | complete | 0351-launch-light.png |
| 18005 | 1 | light | 0.952 | 99.4 | false | false | complete | 0352-launch-light.png |
| 18172 | 1 | light | 0.952 | 99.4 | false | false | complete | 0353-launch-light.png |
| 18335 | 1 | light | 0.952 | 99.4 | false | false | complete | 0354-launch-light.png |
| 18505 | 1 | light | 0.952 | 99.4 | false | false | complete | 0355-launch-light.png |
| 18670 | 1 | light | 0.952 | 99.4 | false | false | complete | 0356-launch-light.png |
| 18834 | 1 | light | 0.952 | 99.4 | false | false | complete | 0357-launch-light.png |
| 18989 | 1 | light | 0.952 | 99.4 | false | false | complete | 0358-launch-light.png |
| 19180 | 1 | light | 0.952 | 99.4 | false | false | complete | 0359-launch-light.png |
| 19421 | 1 | light | 0.952 | 99.4 | false | false | complete | 0360-launch-light.png |
| 19629 | 1 | light | 0.952 | 99.4 | false | false | complete | 0361-launch-light.png |
| 19798 | 1 | light | 0.952 | 99.4 | false | false | complete | 0362-launch-light.png |
| 19967 | 1 | light | 0.952 | 99.4 | false | false | complete | 0363-launch-light.png |
| 20125 | 1 | light | 0.952 | 99.4 | false | false | complete | 0364-launch-light.png |
| 20293 | 1 | light | 0.952 | 99.4 | false | false | complete | 0365-launch-light.png |
| 20453 | 1 | light | 0.952 | 99.4 | false | false | complete | 0366-launch-light.png |
| 20614 | 1 | light | 0.952 | 99.4 | false | false | complete | 0367-launch-light.png |
| 20776 | 1 | light | 0.952 | 99.4 | false | false | complete | 0368-launch-light.png |
| 20932 | 1 | light | 0.952 | 99.4 | false | false | complete | 0369-launch-light.png |
| 21090 | 1 | light | 0.952 | 99.4 | false | false | complete | 0370-launch-light.png |
| 21247 | 1 | light | 0.952 | 99.4 | false | false | complete | 0371-launch-light.png |
| 21403 | 1 | light | 0.952 | 99.4 | false | false | complete | 0372-launch-light.png |
| 21561 | 1 | light | 0.952 | 99.4 | false | false | complete | 0373-launch-light.png |
| 21726 | 1 | light | 0.952 | 99.4 | false | false | complete | 0374-launch-light.png |
| 21885 | 1 | light | 0.952 | 99.4 | false | false | complete | 0375-launch-light.png |
| 22043 | 1 | light | 0.952 | 99.4 | false | false | complete | 0376-launch-light.png |
| 22203 | 1 | light | 0.952 | 99.4 | false | false | complete | 0377-launch-light.png |
| 22364 | 1 | light | 0.952 | 99.4 | false | false | complete | 0378-launch-light.png |
| 22530 | 1 | light | 0.952 | 99.4 | false | false | complete | 0379-launch-light.png |
| 22687 | 1 | light | 0.952 | 99.4 | false | false | complete | 0380-launch-light.png |
| 22855 | 1 | light | 0.952 | 99.4 | false | false | complete | 0381-launch-light.png |
| 23023 | 1 | light | 0.952 | 99.4 | false | false | interactive | 0382-launch-light.png |
| 23274 | 1 | light | 0.969 | 98.8 | false | false | complete | 0383-launch-light.png |

Page probe after load:
```json
{
  "readyState": "complete",
  "url": "http://127.0.0.1:5173/home",
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
+86ms [theme +28ms] after gtk::init: gtk-theme-name=Adwaita prefer-dark=false toplevels=0
+89ms [theme +31ms] portal Read color-scheme -> Some(false) in 2ms
+89ms [theme +31ms] apply(dark=false) changed=false; after apply: gtk-theme-name=Adwaita prefer-dark=false toplevels=0
+92ms [theme +34ms] theme_bg_color -> Some((246, 245, 244))
+242ms [2026-09-16][06:54:21][potato_tomato_lib::system_theme][INFO] [theme +28ms] after gtk::init: gtk-theme-name=Adwaita prefer-dark=false toplevels=0
+242ms [2026-09-16][06:54:21][potato_tomato_lib::system_theme][INFO] [theme +31ms] portal Read color-scheme -> Some(false) in 2ms
+242ms [2026-09-16][06:54:21][potato_tomato_lib::system_theme][INFO] [theme +31ms] apply(dark=false) changed=false; after apply: gtk-theme-name=Adwaita prefer-dark=false toplevels=0
+242ms [2026-09-16][06:54:21][potato_tomato_lib::system_theme][INFO] [theme +34ms] theme_bg_color -> Some((246, 245, 244))
+242ms [2026-09-16][06:54:21][potato_tomato_lib][INFO] desktop colour-scheme is light
+242ms [2026-09-16][06:54:21][potato_tomato_lib::system_theme][INFO] [theme +184ms] theme_bg_color -> Some((246, 245, 244))
+242ms [2026-09-16][06:54:21][potato_tomato_lib][INFO] coloured main rgb(246, 245, 244)
+242ms [2026-09-16][06:54:21][potato_tomato_lib::system_theme][INFO] setup: gtk-theme-name=Adwaita prefer-dark=false toplevels=1 {title="Potato Tomato" visible=true mapped=true realized=true size=1332x772 type=Toplevel}
+242ms [2026-09-16][06:54:21][potato_tomato_lib::system_theme][INFO] subscribed to portal SettingChanged (bus unique name Some(":1.1334731"))
+2243ms [2026-09-16][06:54:23][potato_tomato_lib][INFO] 2s after setup: gtk-theme-name=Adwaita prefer-dark=false toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1332x772 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
+24462ms [2026-09-16][06:54:45][potato_tomato_lib::system_theme][INFO] desktop switched to dark; after switch: gtk-theme-name=Adwaita prefer-dark=true toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1332x772 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
+24462ms [2026-09-16][06:54:45][potato_tomato_lib::system_theme][INFO] [theme +24404ms] theme_bg_color -> Some((53, 53, 53))
+24462ms [2026-09-16][06:54:45][potato_tomato_lib][INFO] coloured main rgb(53, 53, 53)
+48475ms [2026-09-16][06:55:09][potato_tomato_lib::system_theme][INFO] desktop switched to light; after switch: gtk-theme-name=Adwaita prefer-dark=false toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1442x842 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
+48476ms [2026-09-16][06:55:09][potato_tomato_lib::system_theme][INFO] [theme +48417ms] theme_bg_color -> Some((246, 245, 244))
+48476ms [2026-09-16][06:55:09][potato_tomato_lib][INFO] coloured main rgb(246, 245, 244)
```

## Live scheme switch

- dark → light: page followed in 2190 ms (media query 86 ms, .dark class 2190 ms); screen light (lum 0.801); mediaDark=false htmlDark=false shellBg=rgb(255, 255, 255)
  page events: media-change(light) @86ms, html-class(light) @2168ms, html-class(light) @2179ms, html-class(light) @2179ms, html-class(light) @2179ms, html-class(light) @2179ms, html-class(light) @2179ms, html-class(light) @2179ms, html-class(light) @2179ms
  ```
  [2026-09-16][06:53:29][potato_tomato_lib::system_theme][INFO] desktop switched to light; after switch: gtk-theme-name=Adwaita prefer-dark=false toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1332x772 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
  [2026-09-16][06:53:29][potato_tomato_lib::system_theme][INFO] [theme +23007ms] theme_bg_color -> Some((246, 245, 244))
  [2026-09-16][06:53:29][potato_tomato_lib][INFO] coloured main rgb(246, 245, 244)
  [2026-09-16][06:53:32][potato_tomato_lib][INFO] ensure_puller: nothing healthy on 18787 — spawning
  [2026-09-16][06:53:32][potato_tomato_lib][INFO] ensure_puller: nothing healthy on 18787 — spawning
  [2026-09-16][06:53:32][potato_tomato_lib][INFO] puller started on port 18787 (data=/home/borys/Projects/potatoetomatoe3/.claude/worktrees/bridge-cse_019wEnJFSMGnLEQApXmGcbBU/src-tauri/../static/games, catalog=/home/borys/Projects/potatoetomatoe3/.claude/worktrees/bridge-cse_019wEnJFSMGnLEQApXmGcbBU/src-tauri/../static/games)
  undefined
  ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "tsx" not found
  Did you mean "pnpm exec tsc"?
  [2026-09-16][06:53:33][potato_tomato_lib][INFO] puller started on port 18787 (data=/home/borys/Projects/potatoetomatoe3/.claude/worktrees/bridge-cse_019wEnJFSMGnLEQApXmGcbBU/src-tauri/../static/games, catalog=/home/borys/Projects/potatoetomatoe3/.claude/worktrees/bridge-cse_019wEnJFSMGnLEQApXmGcbBU/src-tauri/../static/games)
  undefined
  ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "tsx" not found
  Did you mean "pnpm exec tsc"?
  ```
- light → dark: page followed in 232 ms (media query 232 ms, .dark class 232 ms); screen dark (lum 0.231); mediaDark=true htmlDark=true shellBg=rgb(30, 30, 30)
  page events: media-change(dark) @152ms, html-class(dark) @155ms
  ```
  [2026-09-16][06:53:54][potato_tomato_lib::system_theme][INFO] desktop switched to dark; after switch: gtk-theme-name=Adwaita prefer-dark=true toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1442x842 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
  [2026-09-16][06:53:54][potato_tomato_lib::system_theme][INFO] [theme +47677ms] theme_bg_color -> Some((53, 53, 53))
  [2026-09-16][06:53:54][potato_tomato_lib][INFO] coloured main rgb(53, 53, 53)
  ```
- light → dark: page followed in 1984 ms (media query 98 ms, .dark class 1984 ms); screen dark (lum 0.284); mediaDark=true htmlDark=true shellBg=rgb(30, 30, 30)
  page events: media-change(dark) @77ms, html-class(dark) @1965ms, html-class(dark) @1976ms, html-class(dark) @1976ms, html-class(dark) @1976ms, html-class(dark) @1976ms, html-class(dark) @1976ms, html-class(dark) @1976ms, html-class(dark) @1976ms
  ```
  [2026-09-16][06:54:45][potato_tomato_lib::system_theme][INFO] desktop switched to dark; after switch: gtk-theme-name=Adwaita prefer-dark=true toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1332x772 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
  [2026-09-16][06:54:45][potato_tomato_lib::system_theme][INFO] [theme +24404ms] theme_bg_color -> Some((53, 53, 53))
  [2026-09-16][06:54:45][potato_tomato_lib][INFO] coloured main rgb(53, 53, 53)
  [2026-09-16][06:54:48][potato_tomato_lib][INFO] ensure_puller: nothing healthy on 18787 — spawning
  [2026-09-16][06:54:48][potato_tomato_lib][INFO] ensure_puller: nothing healthy on 18787 — spawning
  [2026-09-16][06:54:48][potato_tomato_lib][INFO] puller started on port 18787 (data=/home/borys/Projects/potatoetomatoe3/.claude/worktrees/bridge-cse_019wEnJFSMGnLEQApXmGcbBU/src-tauri/../static/games, catalog=/home/borys/Projects/potatoetomatoe3/.claude/worktrees/bridge-cse_019wEnJFSMGnLEQApXmGcbBU/src-tauri/../static/games)
  undefined
  ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "tsx" not found
  Did you mean "pnpm exec tsc"?
  [2026-09-16][06:54:49][potato_tomato_lib][INFO] puller started on port 18787 (data=/home/borys/Projects/potatoetomatoe3/.claude/worktrees/bridge-cse_019wEnJFSMGnLEQApXmGcbBU/src-tauri/../static/games, catalog=/home/borys/Projects/potatoetomatoe3/.claude/worktrees/bridge-cse_019wEnJFSMGnLEQApXmGcbBU/src-tauri/../static/games)
  undefined
  ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "tsx" not found
  Did you mean "pnpm exec tsc"?
  ```
- dark → light: page followed in 217 ms (media query 102 ms, .dark class 217 ms); screen light (lum 0.866); mediaDark=false htmlDark=false shellBg=rgb(255, 255, 255)
  page events: media-change(light) @119ms, html-class(light) @121ms
  ```
  [2026-09-16][06:55:09][potato_tomato_lib::system_theme][INFO] desktop switched to light; after switch: gtk-theme-name=Adwaita prefer-dark=false toplevels=3 {title="Potato Tomato" visible=true mapped=true realized=true size=1442x842 type=Toplevel} {title="" visible=false mapped=false realized=false size=1x1 type=Popup} {title="" visible=false mapped=false realized=false size=1x1 type=Popup}
  [2026-09-16][06:55:09][potato_tomato_lib::system_theme][INFO] [theme +48417ms] theme_bg_color -> Some((246, 245, 244))
  [2026-09-16][06:55:09][potato_tomato_lib][INFO] coloured main rgb(246, 245, 244)
  ```

## Resize

### launched-dark-switched-light
- maximize (Super+Up): 15 frames; window 1920×1040 at 0,40; stale-scheme excess worst 0.0% (0136-maximize-launched-dark-switched-light.png); settled after 1531ms; page light-on-dark content 7.5%
  0ms:33%/0% 174ms:8%/0% 347ms:8%/0% 506ms:8%/0% 662ms:8%/0% 825ms:8%/0% 997ms:8%/0% 1184ms:8%/0% 1366ms:8%/0% 1531ms:7%/0% 1706ms:0%/0% 1886ms:0%/0% 2088ms:0%/0% 2298ms:0%/0% 2471ms:0%/0%
- restore (Super+Down): 15 frames; window 1332×772 at 432,448; stale-scheme excess worst 0.1% (0152-restore-launched-dark-switched-light.png); settled after 0ms; page light-on-dark content 5.7%
  0ms:30%/0% 183ms:1%/0% 364ms:1%/0% 542ms:1%/0% 733ms:1%/0% 912ms:1%/0% 1082ms:1%/0% 1259ms:1%/0% 1433ms:0%/0% 1611ms:0%/0% 1782ms:0%/0% 1959ms:0%/0% 2133ms:0%/0% 2305ms:0%/0% 2490ms:0%/0%
- keyboard resize (Alt+F8, arrows) (during): 7 frames; window 1332×772 at 1328,192; stale-scheme excess worst 0.0% (0168-keyresize-launched-dark-switched-light.png); settled after 0ms; page light-on-dark content 10.2%
  0ms:2%/0% 194ms:2%/0% 366ms:2%/0% 553ms:2%/0% 724ms:0%/0% 906ms:0%/0% 1076ms:0%/0%
- keyboard resize (Alt+F8, arrows) (after): 9 frames; window 1442×842 at 264,184; stale-scheme excess worst 0.0% (0177-keyresize-done-launched-dark-switched-light.png); settled after 0ms; page light-on-dark content 8.7%
  0ms:0%/0% 183ms:0%/0% 361ms:0%/0% 535ms:0%/0% 702ms:0%/0% 886ms:0%/0% 1057ms:0%/0% 1238ms:0%/0% 1415ms:0%/0%

### launched-dark
- maximize (Super+Up): 15 frames; window 1920×1040 at 0,40; stale-scheme excess worst 0.0% (0192-maximize-launched-dark.png); settled after 0ms; page light-on-dark content 16.1%
  0ms:41%/0% 175ms:1%/0% 343ms:1%/0% 511ms:1%/0% 675ms:1%/0% 846ms:1%/0% 1018ms:1%/0% 1192ms:0%/0% 1375ms:0%/0% 1547ms:0%/0% 1719ms:0%/0% 1918ms:0%/0% 2091ms:0%/0% 2266ms:0%/0% 2460ms:0%/0%
- restore (Super+Down): 14 frames; window 1442×842 at 776,192; stale-scheme excess worst 0.1% (0207-restore-launched-dark.png); settled after 0ms; page light-on-dark content 13.0%
  0ms:24%/0% 190ms:2%/0% 358ms:1%/0% 548ms:1%/0% 733ms:1%/0% 912ms:0%/0% 1093ms:0%/0% 1269ms:0%/0% 1472ms:0%/0% 1659ms:0%/0% 1836ms:0%/0% 2010ms:0%/0% 2188ms:0%/0% 2357ms:0%/0%
- keyboard resize (Alt+F8, arrows) (during): 7 frames; window 1442×842 at 776,192; stale-scheme excess worst 0.1% (0222-keyresize-launched-dark.png); settled after 373ms; page light-on-dark content 12.3%
  0ms:2%/0% 193ms:2%/0% 373ms:2%/0% 568ms:2%/0% 745ms:2%/0% 921ms:0%/0% 1094ms:0%/0%
- keyboard resize (Alt+F8, arrows) (after): 9 frames; window 1552×912 at 224,216; stale-scheme excess worst 0.0% (0231-keyresize-done-launched-dark.png); settled after 0ms; page light-on-dark content 13.5%
  1ms:0%/0% 191ms:0%/0% 365ms:0%/0% 546ms:0%/0% 726ms:0%/0% 901ms:0%/0% 1092ms:0%/0% 1279ms:0%/0% 1454ms:0%/0%

### launched-light-switched-dark
- maximize (Super+Up): 15 frames; window 1920×1040 at 0,40; stale-scheme excess worst 0.0% (0388-maximize-launched-light-switched-dark.png); settled after 0ms; page light-on-dark content 5.8%
  0ms:29%/0% 180ms:2%/0% 351ms:2%/0% 520ms:2%/0% 682ms:2%/0% 852ms:2%/0% 1011ms:2%/0% 1177ms:2%/0% 1330ms:0%/0% 1495ms:0%/0% 1662ms:0%/0% 1824ms:0%/0% 1988ms:0%/0% 2158ms:0%/0% 2324ms:0%/0%
- restore (Super+Down): 14 frames; window 1332×772 at 304,216; stale-scheme excess worst 0.0% (0404-restore-launched-light-switched-dark.png); settled after 0ms; page light-on-dark content 9.6%
  0ms:35%/0% 176ms:1%/0% 360ms:1%/0% 560ms:1%/0% 746ms:1%/0% 941ms:1%/0% 1131ms:1%/0% 1305ms:0%/0% 1471ms:0%/0% 1651ms:0%/0% 1827ms:0%/0% 2023ms:0%/0% 2197ms:0%/0% 2385ms:0%/0%
- keyboard resize (Alt+F8, arrows) (during): 7 frames; window 1332×772 at 1328,192; stale-scheme excess worst 0.0% (0419-keyresize-launched-light-switched-dark.png); settled after 0ms; page light-on-dark content 12.4%
  0ms:0%/0% 186ms:0%/0% 369ms:0%/0% 542ms:0%/0% 731ms:0%/0% 915ms:0%/0% 1094ms:0%/0%
- keyboard resize (Alt+F8, arrows) (after): 8 frames; window 1442×842 at 776,192; stale-scheme excess worst 0.0% (0428-keyresize-done-launched-light-switched-dark.png); settled after 0ms; page light-on-dark content 10.8%
  0ms:1%/0% 185ms:1%/0% 370ms:0%/0% 559ms:0%/0% 753ms:0%/0% 927ms:0%/0% 1123ms:0%/0% 1316ms:0%/0%

### launched-light
- maximize (Super+Up): 14 frames; window 1920×1040 at 0,40; stale-scheme excess worst 0.0% (0441-maximize-launched-light.png); settled after 1105ms; page light-on-dark content 11.3%
  0ms:44%/0% 197ms:3%/0% 421ms:3%/0% 582ms:3%/0% 758ms:3%/0% 941ms:3%/0% 1105ms:3%/0% 1282ms:1%/0% 1449ms:1%/0% 1619ms:1%/0% 1795ms:1%/0% 1957ms:1%/0% 2128ms:1%/0% 2318ms:0%/0%
- restore (Super+Down): 14 frames; window 1442×842 at 264,184; stale-scheme excess worst 0.1% (0456-restore-launched-light.png); settled after 0ms; page light-on-dark content 9.5%
  0ms:49%/0% 179ms:2%/0% 355ms:1%/0% 534ms:1%/0% 705ms:1%/0% 888ms:1%/0% 1069ms:1%/0% 1275ms:1%/0% 1456ms:0%/0% 1636ms:0%/0% 1818ms:0%/0% 1991ms:0%/0% 2168ms:0%/0% 2340ms:0%/0%
- keyboard resize (Alt+F8, arrows) (during): 7 frames; window 1442×842 at 264,184; stale-scheme excess worst 0.1% (0472-keyresize-launched-light.png); settled after 549ms; page light-on-dark content 11.3%
  0ms:4%/0% 184ms:3%/0% 359ms:3%/0% 549ms:2%/0% 736ms:0%/0% 922ms:0%/0% 1103ms:0%/0%
- keyboard resize (Alt+F8, arrows) (after): 9 frames; window 1552×912 at 224,184; stale-scheme excess worst 0.0% (0481-keyresize-done-launched-light.png); settled after 0ms; page light-on-dark content 11.1%
  0ms:0%/0% 197ms:0%/0% 375ms:0%/0% 564ms:0%/0% 751ms:0%/0% 921ms:0%/0% 1119ms:0%/0% 1297ms:0%/0% 1494ms:0%/0%

