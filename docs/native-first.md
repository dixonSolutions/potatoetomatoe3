# Native-first architecture

Potato Tomato has two deliberate product surfaces:

- The GitHub Pages site is a fast catalog and online game preview. It does not
  capture games, create offline downloads, relay arbitrary sites, register the
  offline service worker, or inject touch controls. It is stamped with
  `PUBLIC_OFFLINE_DEPLOYMENT=public-site`.
- The native app is the full player. Linux/Flatpak runs the local puller and
  Playwright capture flow, stores verified mirrors, and provides touch controls
  and saves. Android plays bundled or imported mirrors and does not package
  Node.js or Playwright. Native frontend builds are stamped with
  `PUBLIC_OFFLINE_DEPLOYMENT=local-app` and also accept runtime Tauri signals
  (`globalThis.isTauri`, `tauri.localhost`, `TAURI_ENV_PLATFORM`).

## Native touch proxy (always on)

On `local-app` / Tauri desktop builds the puller is required for online play with
touch. `getGamePlayerUrl` waits briefly for puller health, then always routes:

- Unity → `/api/unity-play/:id`
- Other online titles → `/api/game-live/:id`

Touch console availability is forced to `always` (and enabled) in the native app
so the overlay chrome stays available without a settings trip.

Catalog importers may write `online/embed.html` (+ `localEmbed: true`) when the
only playable document lives inside a Google Sites gadget XML. The puller serves
that file through the same proxies when `onlineEmbedUrl` is a Sites page or missing.

## Native runtime diagnostics

In the packaged webview DevTools:

```js
({
	hostname: location.hostname,
	isTauri: globalThis.isTauri,
	PUBLIC_OFFLINE_DEPLOYMENT: import.meta.env.PUBLIC_OFFLINE_DEPLOYMENT,
	TAURI_ENV_PLATFORM: import.meta.env.TAURI_ENV_PLATFORM
});
```

Healthy Flatpak expectations:

- deployment resolves to `local-app`
- `PUBLIC_OFFLINE_DEPLOYMENT` is `local-app` (never `public-site`)
- `Download app` nav / browser-preview banner are hidden
- Offline download controls are visible and the puller health endpoint answers

Android Settings → Updates downloads the latest `.apk` asset from this repository’s
GitHub Releases. Flatpak updates remain system-managed (`flatpak update`).

Android APK packaging must stay under the ZIP32 **65535 entry** limit. The Android
Tauri config skips GitHub Pages per-game SPA fallbacks, drops `.gitkeep` / non-bundled
`offline/` trees via `scripts/slim-android-assets.mjs`, and does not re-bundle the
catalog as a separate `resources` tree (the WebView already serves `build/games`).

## Capture contract

The puller captures interactive pages with Playwright, observes successful
responses, discovers nested frames, rewrites assets to local paths, and writes
`mirror-manifest.json` beside the offline entry document. Each manifest records
the game ID, entry path, capture method, source URL, file sizes, SHA-256 hashes,
capture time, and diagnostics. `capture-manifest.json` retains response-level
metadata for debugging and future import tooling.

Playwright is a capture and clean-context verification tool, not a renderer.
Mirrors always play in the platform WebView. The existing wget path remains a
bounded fallback and is marked as such in the manifest.

## Platform distribution

The central release workflow calculates the next `0.0.<number>` version and creates
an immutable `release-<number>` tag at the merged commit. Linux/Flatpak and Android
jobs use that same tag and commit SHA but publish independently. The download site
links to the matching GitHub Release and presents Linux/Flatpak first.
Android is a manually updated APK; there is no F-Droid repository or app
update remote.

Windows, macOS, and iOS remain future targets until each has a tested capture,
packaging, signing, and update strategy.
