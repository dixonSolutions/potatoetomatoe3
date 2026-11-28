# Performance baseline (M1, 2026-11-27)

Baseline for the offline/perf job; later milestones (M4, M5, M9, M16) compare against these numbers.
Commit measured: `0b1b3080a` (main) + `scripts/perf-baseline.mjs`. Host: Bluefin laptop, headless Chromium (Playwright), loopback server, no throttling.

## Sizes

| What                                                        | Bytes                                  | Command                                                                                                              |
| ----------------------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `static/games/games-list.json` (13,646 entries)             | 418,540 (gzip 113,868)                 | `ls -l static/games/games-list.json; gzip -c static/games/games-list.json \| wc -c`                                  |
| `static/games/games-metadata.json` (legacy, 13,646 entries) | 12,440,146 (gzip 2,078,229)            | same, for `games-metadata.json`                                                                                      |
| Catalog index total (list + metadata)                       | 12,858,686 (gzip 2,192,097)            | sum of the two above                                                                                                 |
| `build/` total (incl. copied games, 13,649 game dirs)       | 466 MB (`build/games` = 386,985,475 B) | `du -sh build; du -sb build/games`                                                                                   |
| `build/_app` (JS + CSS, no games)                           | 3,684,049 (gzip of all js+css 742,656) | `du -sb build/_app; find build/_app \( -name '*.js' -o -name '*.css' \) -print0 \| xargs -0 cat \| gzip -c \| wc -c` |
| Tauri release binary `potato-tomato` (Linux x86_64)         | 20,478,688 (gzip 5,862,687)            | see below                                                                                                            |

Never walk `static/games/` for sizes beyond the two index files; `build/games` is a copy and was measured with a single `du`.

Release binary (the project has no `[profile.release]` tuning yet, so this is the untuned default). `cargo` on the Fedora host lacks `libdbus` headers, so build inside the `dev` distrobox:

```sh
distrobox enter dev -- bash -lc 'cd src-tauri && CARGO_TARGET_DIR=/tmp/ptb-target2 cargo build --release'   # ~1 min with warm cache
ls -l /tmp/ptb-target2/release/potato-tomato
```

## Cold-cache web perf

`node scripts/perf-baseline.mjs` (needs `pnpm build` first). It serves `build/`, opens `/games` and `/home` in a fresh Chromium context (empty HTTP cache, service workers blocked, 1280x800) and prints JSON. "Card images" are `a[href*="/games/"] img`.

Three runs, all consistent:

| Route    | first paint / FCP | first card `<img>` in DOM | card images in viewport decoded | cards in DOM                           | requests | bytes      |
| -------- | ----------------- | ------------------------- | ------------------------------- | -------------------------------------- | -------- | ---------- |
| `/games` | 72 ms             | ~295 ms                   | ~460-640 ms                     | 24 (of 13,646; paged, not virtualised) | ~100     | 0.7-1.3 MB |
| `/home`  | 48-68 ms          | ~285 ms                   | **never within 60 s timeout**   | 58 (57 imgs, 50-51 complete)           | ~179     | 1.7-2.3 MB |

Notes: `/home` has a handful of card images that never complete (missing thumbnails or stuck lazy loads), so "all viewport images done" hits the 60 s cap; M5 should fix that. `/games` shows only 24 cards at once, so a "grid render of all ~13k entries" time does not exist yet; the grid is paged. Re-run the same command at M5/M16 for comparison.

## App start time (Tauri)

Not measured in this run: the session has no X/Wayland display for the GUI and no `xvfb`. Reproduce on a desktop:

```sh
# window-visible time: run the release binary and note when the home grid appears
time /tmp/ptb-target2/release/potato-tomato      # or `cluster eva` for the GUI box
```

The webview-side equivalent (paint and card-image times inside the app) is `/dev/perf-bench` driven by `scripts/perf-bench-collector.mjs` (`pnpm puller-test` / the perf-bench Tauri config `tauri.perf-bench.conf.json`). Fill the start-to-home number here once measured on a display.

## M4: catalog packaging (2026-11-27, commit `fb89aa6db`)

The client loads `static/games/games-index/` (manifest + shards). M4 replaced the v1 row
shards with v2 columnar shards (`scripts/catalog-quality/index-format.mjs`, decoder
`src/lib/utils/catalog-index-format.ts`) and moved `games-metadata.json` out of `static/`.

| What                                                     | M1                                         | M4                                                 |
| -------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------- |
| `games-index/` total                                     | 3,276,990 (gzip 631,392), 28 shards of 500 | 1,509,497 (gzip 560,648, brotli 449,459), 8 shards |
| First request to paint Home (manifest + shard 0)         | manifest + 500-row shard                   | 13,105 + 23,610 (gzip 7,187 + 8,858)               |
| Shipped `games-metadata.json` (web build and app bundle) | 12,440,146                                 | 0 (now `scripts/data/`, build tooling only)        |
| Decode of the full catalog (13,646 games, Node)          | n/a (rows)                                 | ~17 ms                                             |

Sizes: `du -cb static/games/games-index/*.json | tail -1`, `gzip -9c <file> | wc -c` per file.
Every decoded entry matched the v1 index (0 differences).

## M6: web bundle after dropping TensorFlow.js

Cluster job `20261127T065838-potatoetomatoe3-Lg7VD0` at `4b9fbd1eb`, same commands as M1.

| Item                              | M1                       | M6                       |
| --------------------------------- | ------------------------ | ------------------------ |
| `build/_app` (JS + CSS)           | 3,684,049 (gzip 742,656) | 1,204,162 (gzip 354,782) |
| `build/games/games-index`         | 3,276,990                | 1,509,497                |
| `build/games/games-metadata.json` | 12,440,146               | not shipped              |

## M9: Tauri release binary after profile tuning

Cluster job `20261127T070858-potatoetomatoe3-9gj9ui` at `919c5ec2d`, built with
`scripts/cluster-cargo.sh` (`cargo build --release`, 4 m 30 s). The profile is
`[profile.release] codegen-units = 1, lto = "fat", opt-level = "s", strip = true`.

| Item                                          | M1                          | M9                              |
| --------------------------------------------- | --------------------------- | ------------------------------- |
| Tauri release binary `potato-tomato` (x86_64) | 20,478,688 (gzip 5,862,687) | 8,961,168 (`gzip -c` 3,824,406) |

The binary is 56% smaller. The M1 gzip figure may have used a different gzip level, so
compare the raw sizes.

## M16: cold-cache web, 2026-11-28 (job `fOvatf`)

`node scripts/perf-baseline.mjs /home /games` after a production web build, three runs, headless
Chromium, fresh context. Covers count as on screen only inside the viewport in both directions
(Home rows scroll sideways; lazy covers past the right edge are not meant to load).
`build/_app` 1,227,020 B.

| Route    | FCP      | covers on screen | on-screen covers decoded           | requests | bytes      |
| -------- | -------- | ---------------- | ---------------------------------- | -------- | ---------- |
| `/home`  | 80-92 ms | 14               | 736-927 ms (M1: never within 60 s) | ~178     | 0.8-1.1 MB |
| `/games` | 68-72 ms | 18 (virtualised) | 520-678 ms (M1: ~460-640 ms)       | ~120     | 0.7-1.1 MB |
