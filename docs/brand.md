# Brand & app icons

## Mark

Potato over tomato on a transparent background — the product logo for Potato Tomato Games.

## Source assets

| File | Role |
| ---- | ---- |
| `buildResources/icons/potato-tomato-source.png` | Portrait illustration (canonical art) |
| `buildResources/icons/potato-tomato-master.png` | Square 1024×1024 master used to regenerate platform icons |

Do not edit platform exports by hand. Change the source, rebuild the square master (trim transparent padding, scale the stacked mark to ~92% of the square on the long axis, pad transparent margins), then regenerate. Keep potato-over-tomato and a transparent background — never flatten onto white.

## Where icons are produced

| Target | Path | How |
| ------ | ---- | --- |
| Browser tab icon | `src/routes/+layout.svelte` → `$lib/assets/logo.png` | Same PNG as TopBar via `<link rel="icon">` / `activeFavicon` |
| Static / GitHub Pages favicons | `static/favicon.png`, `static/favicon.svg`, and `src/lib/assets/favicon.svg` (SVG pair stay identical) | Raster copy of `logo.png`; SVG embeds the same PNG for `/favicon.svg` requests |
| Privacy disguise tab icons | `static/privacy-favicons/<serviceId>.svg` | Stable public paths used by `getDecoyFaviconUrl` and the early script in `app.html` (SPA prerender cannot bake per-user cookies) |
| TopBar / in-app logo | `src/lib/assets/logo.png` | 128×128 export from the square master |
| Tauri desktop icons | `src-tauri/icons/` (`icon.png`, `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.ico`, `icon.icns`, Store/Square logos) | `pnpm tauri icon buildResources/icons/potato-tomato-master.png` |
| Flatpak | `buildResources/icons/potato-tomato-512.png` | 512×512 export from the square master |

## Out of scope

Privacy-mode decoy artwork under `src/lib/assets/privacy/` (and the Google Docs source SVG) are intentional lookalikes for other products. When changing those sources, also refresh the matching file under `static/privacy-favicons/`. Leave them alone when updating brand icons.
