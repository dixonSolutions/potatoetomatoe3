# Native-first architecture

Potato Tomato has two deliberate product surfaces:

- The GitHub Pages site is a fast catalog and online game preview. It does not
  capture games, create offline downloads, relay arbitrary sites, register the
  offline service worker, or inject touch controls.
- The native app is the full player. Linux/Flatpak runs the local puller and
  Playwright capture flow, stores verified mirrors, and provides touch controls
  and saves. Android plays bundled or imported mirrors and does not package
  Node.js or Playwright.

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
