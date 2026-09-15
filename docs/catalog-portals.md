# Catalog portals & quality filtering

Potato Tomato builds its library from multiple HTML5 portals. Imports write
`static/games/<id>/online/` shells (iframe + `metadata.json`) and regenerate
`games-list.json` / `games-metadata.json` / `games-index/` shards.

## Catalog index (lazy load)

The SPA does **not** fetch the full `games-metadata.json` (~11 MB). Instead
`scripts/generate-games-list.js` writes a lean progressive index:

| Path | Role |
|------|------|
| `static/games/games-index/manifest.json` | `total`, `shardSize` (500), `shardCount`, `categories[]` |
| `static/games/games-index/shard-NNN.json` | Lean rows: `id`, `name`, `author`, `category`, `thumbnail`, optional `engine` |

Client load order:

1. manifest + **shard-000** (first paint on All Games)
2. **More shards as you scroll** (`loadMoreCatalogShards`) for default A–Z browse
3. Full index (concurrency 4) when searching or sorting by author/category/shuffle

Shards are written **A–Z by name** so scroll prefetch appends the next page of the
library. Rebuild with `node scripts/reindex-games-catalog.mjs` (or full
`generate-games-list`). Browse Fuse search builds only when the user types a query.
Full descriptions / embed URLs stay on per-game `online/metadata.json` for detail pages.

`games-list.json` and `games-metadata.json` remain for puller / Flatpak tooling.

## Quality filter (Unity Play)

Unity Play is a noisy UGC WebGL dump. Before keeping or importing:

- Drop NSFW / spam title-description matches
- Drop exact junk titles (`WebGL Builds`, tutorials, microgames, homework, etc.)
- Drop games with `plays < 100` (default)

Scripts:

```bash
pnpm games:purge-low-quality-unity          # remove low-quality unity-play entries
pnpm games:purge-low-quality-unity -- --dry-run
pnpm games:import-unity-play                # applies the same filter on import
```

Report: `scripts/data/unity-quality-purge-report.json`

Always kept: `shrek-escape`, `shrek-5`.

## Portal importers

| Portal | Command | Discovery |
|--------|---------|-----------|
| Coolmath Games | `pnpm games:import-coolmath` | Complete game list → `public_games/` embeds |
| CrazyGames | `pnpm games:import-crazygames` | Sitemap → `games.crazygames.com/.../index.html` |
| AddictingGames | `pnpm games:import-addictinggames` | Genre `__NEXT_DATA__` → page embeds |
| Playhop (Yandex) | `pnpm games:import-playhop` | Digraph search + feed → `app-*.games.s3.yandex.net` |
| Y8 | `pnpm games:import-y8` | RSS → `storage.y8.com` |
| Drive U 7 | `pnpm games:import-drive-u7` | Google Sites home → jsDelivr gadget XML → local `embed.html` |
| FNF Games | `pnpm games:import-fnf-games` | Sitemap → embed URL read out of each game page |
| All of the above | `pnpm games:import-all-portals` | Purge → Shrek → portals → regenerate list |

Common flags: `--limit N`, `--skip-existing`, `--discover-only`, `--concurrency N`.

Manifests land in `scripts/data/*-catalog.json`.

## Shrek Escape

`pnpm games:update-shrek-playhop` sets `shrek-escape` online embed to Playhop app
`415567` (Yandex S3 build URL). Offline bundle remains under
`static/games/shrek-escape/offline/` (git allowlisted).

## FNF Games

`fnf-games.io` is a curated Friday Night Funkin' mod portal (~635 entries, mostly
`rhythm`). Two things make its importer differ from the others:

- **Robots.** The portal disallows `/embed/`, `/game/`, `?page=` pagination and
  the engine payload extensions. Discovery therefore uses only the sitemap and
  the game detail pages, and reads the embed URL *out of* each page's markup
  instead of following it. The shell iframe still points at `/embed/<slug>`,
  which is the URL the portal frames itself.
- **Quality gate.** It does not use `assessPortalTitleQuality`. That helper's
  junk-title heuristic is tuned for Unity Play, where `test`/`sandbox` mark dead
  user uploads; here the same words are in real mod names (Character Test
  Playground, FNAF Test, Ragdoll Sandbox), so it only produced false negatives.
  The importer keeps the NSFW and exact-junk checks and adds a narrow adult-tone
  list — which deliberately omits "erect", the name of an official FNF remix
  style.

Covers stay remote (`thumbnailStored: "remote"`): the local thumbnail budget is
already spent, so no mod cover art is copied into the repo.

## Notes

- Many Coolmath titles are legacy Flash and have no `public_games/` HTML5 folder — those are skipped.
- CrazyGames / AddictingGames may site-lock some embeds; shells still point at the CDN URL.
- Scraping third-party catalogs may conflict with portal terms; prefer official embed programs when redistributing publicly.

## Thumbnail storage budget

Catalog card covers are downloaded into `online/assets/` **only while** total local
image bytes stay under a budget (default **64 MiB**). After that — or if a single
cover exceeds **256 KiB** — `metadata.thumbnail` stores the remote HTTPS URL instead.

| Field | Meaning |
|-------|---------|
| `thumbnail` | What the UI loads (local path **or** `https://…`) |
| `thumbnailRemote` | Original portal cover URL (always kept when known) |
| `thumbnailStored` | `local` \| `remote` \| `none` |

```bash
# Inspect / reclaim local covers once over budget (needs thumbnailRemote)
pnpm games:prune-thumbs -- --dry-run
pnpm games:prune-thumbs
pnpm games:prune-thumbs -- --budget-mb 48
```

Env overrides: `CATALOG_THUMB_BUDGET_MB`, `CATALOG_THUMB_MAX_SINGLE_KB`.

Offline play is unchanged: the puller still caches a local cover into
`offline/assets/thumbnail.*` when you download a game.
