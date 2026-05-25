# Game Porting Tools

## Quick Start - Port Everything!

```bash
# Port games from ALL open-source platforms at once
node scripts/port-all-opensource.js

# Then update the games list
node scripts/generate-games-list.js
```

---

## Open Source Game Porters

### 1. GitHub Games (`port-github-games.js`)

Port individual open-source HTML5 games from GitHub repositories. Downloads full source code for offline play.

```bash
node scripts/port-github-games.js
```

**Sources:** 2048, Tetris, Flappy Bird, Duck Hunt, A Dark Room, Hextris, and more!

### 2. js13kGames (`port-js13k-games.js`)

Port ultra-small (13KB) JavaScript games from the js13kGames competition.

```bash
node scripts/port-js13k-games.js
```

**Sources:** Award-winning games from js13kGames annual competition

### 3. itch.io Games (`port-itch-games.js`)

Port free HTML5 games from itch.io indie game platform.

```bash
node scripts/port-itch-games.js
```

**Sources:** Nicky Case games, educational games, indie experiments

### 4. Phaser Examples (`port-phaser-examples.js`)

Port complete game examples from the Phaser game framework.

```bash
node scripts/port-phaser-examples.js
```

**Sources:** Official Phaser 3 example games (Breakout, Space Invaders, Snake, etc.)

### 5. PlayCanvas Games (`port-playcanvas-games.js`)

Port 3D WebGL games from PlayCanvas engine.

```bash
node scripts/port-playcanvas-games.js
```

**Sources:** Public PlayCanvas projects (Swooop, Master Archer, etc.)

### 6. 3kh0 Games (`port-3kh0-games.js`)

Port games from the 3kh0 unblocked games repository.

```bash
node scripts/port-3kh0-games.js
```

### 7. Poki Games (`port-poki-games.js`)

Port games from Poki platform by game slug.

```bash
node scripts/port-poki-games.js subway-surfers stickman-hook
```

---

## Mirror a game URL into `static/games/html/` (`mirror-game-url.mjs`)

Uses `wget` (same idea as `download-games-offline.js`) to mirror an **entry page** and assets into `static/games/html/<id>/`, then writes a stub `metadata.json` if missing.

**Use case:** Mirroring **your own** live game URLs (e.g. preservation after losing source) is exactly what this is for. For URLs you do not own, you need the rights or permission before redistributing builds.

```bash
pnpm run mirror-game -- --url "https://example.com/my-game/" --id my-game --name "My Game"
node scripts/generate-games-list.js
```

Requires `wget` on your `PATH`.

---

## Local-first game bundles (firewall / CORS)

Many `static/games/html/<id>/index.html` files wrap a **remote** iframe (e.g. GitHub Pages). Browsers then load a second origin, which strict networks block.

**Pipeline:**

1. **Mirror** the remote game into `static/games/<id>/offline/` (see **`download-games-offline.js`** below).

   ```bash
   pnpm exec playwright install chromium   # once; recommended for games.poki.com (default capture path)
   node scripts/download-games-offline.js [gameId …]
   # Poki URLs only: add --use-wget-poki to skip Playwright and use wget only
   ```

### `download-games-offline.js` (batch mirror)

Run from the **repository root**. Requires **`wget`** on your `PATH`.

```bash
node scripts/download-games-offline.js                           # all games that have online/index.html
node scripts/download-games-offline.js subway-surfers stickman-hook   # only these ids
node scripts/download-games-offline.js --force aqua-thrills       # replace existing static/games/<id>/offline/
node scripts/download-games-offline.js --deep-only tag            # asset deep-pass only (existing offline/)
node scripts/download-games-offline.js --keep-broken some-id      # keep broken offline/ on failure
node scripts/download-games-offline.js --use-wget-poki some-id    # Poki: never use Playwright
```

For **`games.poki.com`** iframes, the script **tries Playwright first** (real browser + CDP capture). If Chromium cannot run (`pnpm exec playwright install chromium` missing, unsupported OS, launch errors, or import/runtime failures), it logs  
`⚠️  <id>: Playwright unavailable (…); falling back to wget`, **clears** `static/games/<id>/offline/`, and **runs `wget`** for that game so the run does not stop with only a deleted folder. The only case it still aborts after Playwright is the known **“has moved”** stub (same as plain `wget` usually). Use **`--use-wget-poki`** to skip Playwright entirely.

2. **Regenerate** `game-entries.json` so offline mode uses `offline/index.html`:

   ```bash
   pnpm run games:promote-offline   # alias: runs generate-games-list.js
   # or: node scripts/generate-games-list.js
   ```

3. The app iframe loads **`/games/<id>/offline/index.html`** when that file exists (see `static/games/game-entries.json`), so the playable build is **same-origin** with your static server.

**Legacy cleanup** (if you still have `online/_offline_bundle/` from older checkouts):

```bash
node scripts/migrate-offline-bundle-to-offline.mjs
```

**Audit** games that still point at remote iframes:

```bash
pnpm run games:scan-external
```

The Svelte shell still uses **one** iframe for the game document (required for typical HTML5 builds); the important part is that **document** is local, not cross-origin.

### Portal URLs (Uptoplay, Poki, Play-Games, Todik, etc.)

**You cannot wget “every game” from a live portal** in one go: listings are usually SPAs or paginated APIs; homepages only get **shallow snapshots** (small `maxDepth`). For **one URL at a time**, use `mirror-game-url.mjs`, or the batch helper below.

**Batch manifest** — `scripts/data/portal-url-manifest.json` lists curated URLs (homepages + individual Play-Games / Todik pages). Each row runs `mirror-game-url.mjs`. Existing `static/games/<id>/online/` mirrors are **skipped** unless you pass `--force`.

```bash
pnpm run games:mirror-portal-manifest
pnpm run games:mirror-portal-manifest -- --dry-run
pnpm run games:mirror-portal-manifest -- --force
node scripts/mirror-portal-url-list.mjs --from-file ./my-manifest.json
```

Many sites use **Cloudflare** or block bots — wget may **403**; use a browser export or adjust the URL to a direct static game host when possible.

What you have in the repo in addition:

- Most catalog games are thin `online/index.html` shells whose iframe pointed at **third-party hosts** (e.g. GitHub Pages).
- **`download-games-offline.js`** mirrors **that iframe URL per game** into `static/games/<id>/offline/`. For **`games.poki.com`** it defaults to **Playwright + CDP** (real browser session + saved network bodies + live DOM as `index.html`), because plain `wget` often only receives the **“has moved”** stub. Install browsers once: `pnpm exec playwright install chromium`. If Playwright cannot start, the script **falls back to `wget`** automatically (see the subsection above). Pass **`--use-wget-poki`** to skip Playwright entirely. You can also set **`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`** to a system Chrome/Chromium binary.

Even inside `offline/`, some builds still reference **remote CDNs** (e.g. `a.poki.com` images) in HTML — fully offline means rewriting or re-mirroring those assets.

**JS-only and JSON-referenced paths** are not fully covered by `wget --page-requisites`. After each mirror, `download-games-offline.js` runs **`scripts/lib/mirror-deep-assets.mjs`**: it scans mirrored `.html`, `.js`, `.css`, `.json`, etc. for same-origin file references (quoted paths, `url()`, JSON string values, and real **`src` / `href` attributes** so `data-src` is not mistaken for `src`), downloads anything missing or zero-byte, and repeats until stable (no per-game hardcoded asset lists). Unity loader manifests are still handled separately so `Build/*.json` pulls WASM/data. Re-scan existing mirrors without re-wget: `pnpm run games:deep-only -- [gameId …]`.

**Ruffle (Flash) self-hosted builds:** `ruffle.js` often loads a sibling hashed `*.wasm` that `wget` does not always pull; without it the player fails with a WASM “magic number” error. `--deep-only` scans `ruffle.js` for those filenames and fetches them from the iframe base URL when missing.

**Root-absolute asset paths:** WebGL/Unity shells sometimes use `src="/UnityLoader.js"` or `href="/Build/…"`. Under `/games/<id>/offline/` that requests the **app** root, not the game folder. `--deep-only` rewrites those to relative paths when the matching file already exists beside `offline/index.html`.

**Poki / abinbins `master-loader.js`:** Many Unity games load `https://abinbins.github.io/master-loader.js`, which pulls `/poki-sdk.js` and defaults `unityWebglLoaderUrl` to `/UnityLoader.js` — all **site-root** paths, so under `/games/<id>/offline/` the browser requests your app root (`/poki-sdk.js`), not the game folder. Logic lives in `scripts/lib/poki-master-loader-offline.mjs`: it downloads the needed **abinbins root** scripts (`poki-sdk.js`, `unity.js`, `unity-2020.js` for `loader: 'unity-2020'`, and the correct `UnityLoader*.js` from `unityVersion`, e.g. 2019.x → `UnityLoader.2019.2.js`), patches `master-loader.js` to `root+"poki-sdk.js"`, rewrites the script tag to local `master-loader.js`, and injects a **relative** `unityWebglLoaderUrl` when missing. **`poki-sdk.js` also injects `/poki-sdk-core-<ver>.js` at the site root** — that string is patched to a relative `poki-sdk-core-…` and the core file is wget’d from abinbins (same folder as `index.html`). If that exact version is missing upstream, the tooling copies **`poki-sdk-core-v2.263.0.js`** as a fallback (last resort). Run **`node scripts/fix-poki-offline-loaders.mjs`** on the whole catalog (no full game wget), or **`node scripts/fix-poki-offline-loaders.mjs --scan-only`** to list games that still need fixes. The script includes **every** offline bundle that uses either the abinbins **master-loader** shell or a **standalone** `<script src="…poki-sdk…">` (e.g. Construct games). `download-games-offline.js --deep-only` runs the same Poki steps after the deep asset pass.

**Whole catalog:** `pnpm run games:deep-all` runs `--deep-only` for **every** game that has `online/index.html` and `offline/index.html` (hundreds of titles). Expect a long run (network-bound); run after pulling mirrors or when fixing offline regressions. `pnpm run games:audit-offline` also flags `src="/foo"` when `offline/foo` exists (same fix: run `games:deep-all`).

**Catalog thumbnails** (`metadata.thumbnail` as `/games/<id>/online/assets/...`): run `pnpm run games:sync-thumbnails` (add `--missing` for only missing/tiny files). The sync resolves relative icons against a **directory-style iframe base URL** (fixes `flashtetris.png`-style paths), pulls `og:image`, Twitter image, `shortcut icon`, JSON-LD `image`, same-origin or remote `<img>`, and common `favicon.ico` guesses. If the file is still missing, `pnpm run games:strip-missing-thumbnails` clears the path in `metadata.json` so the app does not request a 404; the UI uses an inline neutral SVG when `thumbnail` is blank.

Deep mirroring is **static analysis + wget**: paths built at runtime by string concatenation without literal substrings, or assets loaded only after WebSocket/auth flows, may still require a headless browser pass or manual follow-up — not solvable by regex alone.

**Bulk operations**

```bash
pnpm run games:deep-all              # deep asset pass for every game that has offline/index.html (long run)
node scripts/fix-poki-offline-loaders.mjs              # Poki master-loader chain for all affected games (wget abinbins root assets)
node scripts/fix-poki-offline-loaders.mjs --scan-only  # report Poki shells that still need the fix
pnpm run games:audit-offline         # static check: 0-byte files + local src/href in offline/index.html
pnpm run games:safe-health           # read-only summary; --repair-plan / --repair --yes (see scripts/safe-offline-health.mjs)
pnpm run games:smoke-playwright      # needs: pnpm run build && pnpm exec vite preview --port 4173
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm run games:smoke-playwright -- --limit 30
```

### Scheduled low-RAM offline mirroring (`offline-mirror-worker.mjs`)

For **large catalogs**, mirroring everything in one long-lived process can exhaust RAM. Use **`offline-mirror-worker.mjs`** to process a **bounded slice** per invocation (default **100 games**, one child process per game), persist **resume state**, and run on a **timer** (cron/systemd). Set **`OFFLINE_MAX_GAMES=1`** (or `--max-games 1`) if RAM is very tight.

- **Queue:** Games with `online/metadata.json`, an **http(s)** iframe in `online/index.html`, and **no valid** `offline/index.html` (same validity check as `ensure-all-local.mjs`). Sorted **alphabetically** for stable ordering.
- **`--force` remirror:** If `offline/` exists but `offline/index.html` is missing or tiny, the worker passes **`--force`** to `download-games-offline.js`.
- **`--deep-only`:** Optional second phase — only games that **already** have a valid `offline/index.html`; passes **`--deep-only`** through (deep asset / Unity / Ruffle / Poki passes without re-wget). Use a **separate** schedule from initial mirrors.
- **State:** `scripts/data/offline-mirror-state.json` stores `nextIndex` and a hash of the pending list; if the catalog changes, the hash resets the cursor.
- **End of run:** Runs `generate-games-list.js` unless **`OFFLINE_SKIP_GENERATE=1`** or **`--skip-generate`**.

```bash
pnpm run games:offline-slice
node scripts/offline-mirror-worker.mjs --max-minutes 120 --pause-ms 3000
OFFLINE_MAX_GAMES=1 OFFLINE_MAX_MINUTES=90 node scripts/offline-mirror-worker.mjs
node scripts/offline-mirror-worker.mjs --deep-only --max-games 20
```

**systemd (user)** — run every 2 hours, cap 2 games per wake (adjust paths):

```ini
# ~/.config/systemd/user/potato-offline-mirror.service
[Unit]
Description=Potato Tomato offline mirror slice

[Service]
Type=oneshot
WorkingDirectory=/absolute/path/to/potato-tomato-2
Environment=OFFLINE_MAX_GAMES=100
Environment=OFFLINE_MAX_MINUTES=110
Environment=OFFLINE_PAUSE_MS=5000
ExecStart=/usr/bin/node scripts/offline-mirror-worker.mjs

# ~/.config/systemd/user/potato-offline-mirror.timer
[Unit]
Description=Timer for offline mirror slices

[Timer]
OnBootSec=10min
OnUnitActiveSec=2h
Persistent=true

[Install]
WantedBy=timers.target
```

Enable: `systemctl --user enable --now potato-offline-mirror.timer`

**cron** — hourly, two games max:

```cron
0 * * * * cd /absolute/path/to/potato-tomato-2 && OFFLINE_MAX_MINUTES=55 /usr/bin/node scripts/offline-mirror-worker.mjs >> /tmp/offline-mirror.log 2>&1
```

`download-games-offline.js` rewrites Unity `build.json` fields that point at full `https://` asset URLs into host/path strings, stores files under `offline/<hostname>/…`, and resolves those paths back to `https://` when re-running `--deep-only` (so incremental passes do not treat them as paths on the iframe host).

Guaranteeing **every** title is interactively perfect is not realistic at catalog scale (upstream hosts, DRM, WebSockets, anti-bot). Use audit + smoke to find regressions after bulk mirrors.

### Deduplicate games (`dedupe-games.mjs`)

Removes **only** folders that share the **same iframe URL** (normalized). It does **not** delete games because titles look alike.

```bash
node scripts/dedupe-games.mjs           # dry-run: lists KEEP vs REMOVE
node scripts/dedupe-games.mjs --apply   # moves duplicates to static/games/_quarantine_duplicates/<timestamp>/
```

A **name report** flags the same normalized title with **different** URLs (e.g. two “Wordle” builds) — **manual review**, never auto-deleted.

### Ensure **every** game has `offline/index.html` (`ensure-all-offline-bundles.mjs`)

Runs `ensure-all-local.mjs`: wget mirrors for games missing a valid offline bundle, then **`seed-offline-from-online.mjs`** copies `online/` → `offline/` for anything still missing (self-contained games and iframe shells that could not be mirrored).

```bash
pnpm run games:ensure-all-offline-bundles
pnpm run games:ensure-all-offline-bundles -- --keep-broken
```

### Pull mirrors + make everything local (`make-all-local.mjs`)

Runs: `download-games-offline.js` → `seed-offline-from-online.mjs` → `generate-games-list.js` (via `ensure-all-local.mjs`).

**Failed mirrors:** `download-games-offline.js` removes only `static/games/<id>/offline/` when wget fails, Unity manifests are missing, or the mirror has no usable `index.html` — your `online/` shell (metadata, thumbnails) is kept. Use `--keep-broken` to leave `offline/` in place for debugging.

```bash
pnpm run games:make-all-local
pnpm run download-offline-games -- --keep-broken   # optional: never delete on failure
```

### Full catalog pipeline (`run-catalog-pipeline.mjs`)

Optional: run dedupe with `--apply` first, then `make-all-local`.

```bash
pnpm run games:catalog-pipeline
pnpm run games:catalog-pipeline -- --dedupe-apply
```

**Suggested order:** `dedupe-games.mjs` (dry-run) → review name warnings → `dedupe-games.mjs --apply` → `games:make-all-local`.

---

## Legacy Tools

### Port Games (`port-game.js`)

Port games from tag2game.github.io with automatic thumbnail downloads.

```bash
node scripts/port-game.js
node scripts/port-game.js --no-thumbnails
node scripts/port-game.js --local path/to/game.html
```

---

## 2. Localize Games (`localize-games.js`)

⚠️ **Note:** Currently embeds HTML only. For full offline support with all assets (JS/CSS/images), keep games as iframes pointing to external sources, or manually download and host assets.

### Usage

```bash
# Localize all games (embeds HTML content)
node scripts/localize-games.js --all

# Localize specific games
node scripts/localize-games.js slope tag-2 moto-x3m

# Restore original iframe versions
node scripts/localize-games.js --restore --all
node scripts/localize-games.js --restore slope tag-2
```

### What it does

- Downloads the HTML content from iframe URLs
- Embeds content directly (removes iframe)
- Backs up original files as `index.html.backup`
- Can restore from backup with `--restore`

### Limitations

- Only embeds HTML content
- External assets (JS, CSS, images) still load from original URLs
- Games still need internet for full functionality
- Some games may not work due to CORS or missing assets

### Why keep iframes?

For most use cases, keeping the iframe is better because:
- ✅ Games work immediately
- ✅ No asset download needed
- ✅ Automatic updates from source
- ✅ No CORS issues

---

## Complete Workflow

```bash
# Step 1: Port all games
node scripts/port-game.js

# Step 2: Make them fully local (optional but recommended)
node scripts/localize-games.js --all

# Done! All games are now fully offline and unblocked
```
