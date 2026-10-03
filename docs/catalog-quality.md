# Catalog quality — which games are good, which are rubbish

Audit of all 13,645 catalog games, 2026-09-23. Every game got a tier and a 0–99 score from
what could be measured about it: whether its embed is alive and frameable, whether it paints
in a real browser, what the portal's own players think of it, and whether its name and
description give it away as a test upload. The score and the NSW DoE filter status
([nsw-doe-filtering.md](./nsw-doe-filtering.md)) now travel in the catalog index, so browse
and home lists are ordered best-first and hide tests and broken games by default.

## Tiers

| Tier       | Score | Meaning                                                                                                  | Games |
| ---------- | ----: | -------------------------------------------------------------------------------------------------------- | ----: |
| `featured` | 80–99 | Verified to load and paint in a real browser, strong ratings/popularity, has a cover image.              |    50 |
| `good`     | 60–79 | Strong ratings or popularity, decent odds of launching, has a cover image.                               | 2,486 |
| `ok`       | 40–59 | Everything playable and serious that is not above: thin signals, lower ratings, relay-only, no cover.    | 8,862 |
| `joke`     | 20–39 | Playable meme games ("brainrot", Skibidi, Sprunki …). Kept and shown, ranked below every `ok` game.      |   184 |
| `test`     | 10–19 | Development tests, templates, tutorials, spam and duplicate uploads. Hidden by default.                  |   629 |
| `broken`   |   0–9 | Fails on every route of the app's play chain: gone, portal-locked, the wrong game, an ad bounce. Hidden. | 1,434 |

| Portal         |      Games | featured |      good |        ok |    joke |    test |    broken | DoE blocked or likely |
| -------------- | ---------: | -------: | --------: | --------: | ------: | ------: | --------: | --------------------: |
| CrazyGames     |      4,215 |       19 |     1,049 |     1,940 |      11 |       0 |     1,196 |                 4,215 |
| Unity Play     |      3,772 |        0 |        97 |     3,027 |       7 |     624 |        17 |                     0 |
| Playhop        |      2,404 |        0 |       646 |     1,567 |      95 |       1 |        95 |                 2,404 |
| AddictingGames |      1,175 |       11 |       237 |       878 |       0 |       4 |        45 |                 1,074 |
| FNF Games      |        635 |        1 |       191 |       381 |      61 |       0 |         1 |                   635 |
| Drive U 7      |        546 |        0 |        44 |       493 |       9 |       0 |         0 |                     0 |
| Local shells   |        492 |        1 |        61 |       350 |       1 |       0 |        79 |                     2 |
| Coolmath       |        405 |       18 |       161 |       225 |       0 |       0 |         1 |                   405 |
| GitHub         |          1 |        0 |         0 |         1 |       0 |       0 |         0 |                     0 |
| **Total**      | **13,645** |   **50** | **2,486** | **8,862** | **184** | **629** | **1,434** |             **8,735** |

The score is banded by tier, so a single number both orders the catalog and names the tier;
within a tier games are ordered by merit (below). Nothing was deleted from the repo.

## What was measured

All data is in `scripts/data/` and every step is resumable.

| Step                  | Script                                                                 | Output                                |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------- |
| HTTP probe, all games | `node scripts/audit-catalog.mjs --phase probe`                         | `catalog-audit/probe-<portal>.json`   |
| Portal ratings        | `node scripts/audit-catalog.mjs --phase signals`                       | `catalog-audit/signals-<portal>.json` |
| DoE host status       | `node scripts/catalog-quality/host-status.mjs`                         | `host-filter-status.json`             |
| Launch tests          | `node scripts/verify-game-launches.mjs … --record`                     | `catalog-audit/launch.json`           |
| Classification        | `node scripts/catalog-quality/classify.mjs`                            | `catalog-quality.json`                |
| Index                 | `node scripts/generate-games-list.js` (or `reindex-games-catalog.mjs`) | `static/games/games-index/`           |

### 1. HTTP probe

`scripts/audit-catalog.mjs --phase probe` fetched every game's embed URL the way a framing
browser would (at most 2–3 requests in flight per host, 250 ms apart, bodies capped at
192 KB), plus the iframe target of every local shell, the jsDelivr gadget behind every Drive
U 7 Google Site, and Playhop's script redirects to re-published builds. It records status,
final URL, content type, `X-Frame-Options` / CSP `frame-ancestors`, size, title and flags.

| Portal         |     Probed | 200, frameable | Frame refused | HTML as text/plain | Flash .swf | Portal-exclusive | Dead (4xx/5xx, unreachable, no target) |
| -------------- | ---------: | -------------: | ------------: | -----------------: | ---------: | ---------------: | -------------------------------------: |
| CrazyGames     |      4,215 |          3,021 |             0 |                  0 |          0 |            1,171 |                                     23 |
| Unity Play     |      3,772 |          3,755 |             0 |                  0 |          0 |                0 |                                     17 |
| Playhop        |      2,404 |          2,397 |             1 |                  0 |          0 |                0 |                                      6 |
| AddictingGames |      1,175 |            797 |             9 |                  0 |        338 |                0 |                                     31 |
| FNF Games      |        635 |            635 |             0 |                  0 |          0 |                0 |                                      0 |
| Drive U 7      |        546 |              0 |           321 |                215 |          0 |                0 |                                     10 |
| Local shells   |        492 |            484 |             0 |                  0 |          0 |                0 |                                      8 |
| Coolmath       |        405 |            405 |             0 |                  0 |          0 |                0 |                                      0 |
| GitHub         |          1 |              1 |             0 |                  0 |          0 |                0 |                                      0 |
| **Total**      | **13,645** |     **11,495** |       **331** |            **215** |    **338** |        **1,171** |                                 **95** |

What it found that matters:

- **338 AddictingGames entries are bare Flash `.swf` files** served with
  `X-Frame-Options: SAMEORIGIN`. No frame can show one; the desktop app's relay serves them in
  Ruffle, so they play on desktop only. → `ok` at most (relay-only), not `broken`.
- **1,171 CrazyGames builds are CrazyGames-exclusive.** The game frame carries
  `"disableEmbedding":true` and, embedded anywhere else, shows "Oooops … This version of … can
  be played exclusively on CrazyGames.com". → `broken`.
- **73 local shells point at `let3r45jj02l930rzh903me09f3g9lhh5fz66play356hhjz30.com`**, which
  serves an obfuscated, ad-block-detecting "Redirecting…" page and then sends the frame to
  `cf.true-junction.site`, an ad-network redirect. It never shows the game. → `broken`.
- **Six lapsed `.io` domains from AddictingGames now serve gambling or domain-sale pages** —
  Vietnamese bookmakers ("Nhà Cái Uy Tín … Kèo"), a football-streaming/betting site, an
  "Australia Casino … No Deposit Bonus" page and two domain marketplaces. These were one tap
  away from students. → `broken` (`hijacked-domain`, `redirects-to`).
- **89 entries load a different game than they name.** The Playhop importer stored
  another app's build for 88 entries ("Chess" loads Tank Stars, "Backgammon" a sniper
  game). → `broken` (`wrong-game`). (Several Drive U 7 titles share one remote jsDelivr
  file, but the app plays Drive U 7 from each game's own `online/embed.html`, which differs
  per game, so those are not counted.)
- Unity Play frame URLs always answer with the same SPA shell, so the probe cannot tell a
  deleted game from a live one; the Unity Play game API can (below).

### 2. Portal ratings

`--phase signals` read each portal's own verdict:

| Portal         | Signal                                                                 | Games with a signal |
| -------------- | ---------------------------------------------------------------------- | ------------------: |
| CrazyGames     | schema.org `AggregateRating` (0–10) and up/down votes on the game page |               4,138 |
| AddictingGames | `AggregateRating` (0–5)                                                |               1,174 |
| Coolmath       | `AggregateRating` (0–5)                                                |                 404 |
| Unity Play     | public game API: live plays, likes, moderation, tutorial/student flags |               3,755 |
| Playhop        | rating and rating count stored by the importer                         |               2,403 |
| FNF Games      | portal rating and count stored by the importer                         |                 635 |

Drive U 7, local shells and GitHub have no ratings; they borrow the rating of the same title
on another portal when one exists (196 do), and otherwise start neutral.

### 3. Launch tests

`scripts/verify-game-launches.mjs --direct --gpu` loads each game the way the web and
Android builds do — the first relay-free route of its play chain (below) in an iframe on the
app's origin — in headless
Chromium on the real GPU (ANGLE/GL on Mesa; the renderer string is the Intel GPU, not
SwiftShader). A game counts as **launched** only when all of these hold:

- a sized canvas (or a playing video) exists somewhere in its frame tree, and no Unity loader
  is visible;
- a screenshot of the surface is **rich** — at least 30 colours on a coarse grid and no single
  colour over 90 % of it;
- it **holds still** for 3 s (≤ 15 % of the grid changes), within 40 s of first painting;
- no frame shows loading text ("Loading…", "40 % (12 / 30 MB)").

A picture that paints but never settles into that is recorded as `LOADER`, not a launch. The
verifier presses a visible Play/Start button (text, or an image/id/class "play" button) the
way a player would, and gives up early only on a frame the browser refused ("refused to
connect"), a portal refusal ("can be played exclusively on CrazyGames.com", "Gone"), or a
blank game with nothing downloading for 25 s.

Two sets were tested:

- **A stratified random sample: 40 games per portal** (seed 2026, shared with the classifier
  through `stratifiedSample`, so its results estimate each portal's launch rate without the
  top-tier bias).
- **Top-tier candidates** — the highest-merit games that could be featured — so that
  everything in `featured` has been seen to load.

Anything that failed without an outright refusal got a second pass at 150 s, as
[game-launch-quality.md](./game-launch-quality.md) advises; only a game that failed that too,
or that the browser or portal refused, counts as failed.

| Portal         | Sampled | Launched (strict) | Painted, not re-tested | Unconfirmed | Failed (tested route) | Main failure                        |
| -------------- | ------: | ----------------: | ---------------------: | ----------: | --------------------: | ----------------------------------- |
| CrazyGames     |      40 |                 7 |                      0 |          27 |                     6 | CrazyGames-exclusive (6)            |
| Unity Play     |      40 |                10 |                      0 |          30 |                     0 |                                     |
| Playhop        |      40 |                 7 |                      0 |          32 |                     1 | NO_RENDER (1)                       |
| AddictingGames |      40 |                11 |                      0 |          12 |                    17 | NO_RENDER (17)                      |
| FNF Games      |      40 |                 8 |                      0 |          14 |                    18 | fnf.kdata1.com refuses framing (17) |
| Drive U 7      |      40 |                11 |                      0 |          26 |                     3 | NO_RENDER (3)                       |
| Local shells   |      40 |                12 |                      0 |          27 |                     1 | NO_RENDER (1)                       |
| Coolmath       |      40 |                12 |                      0 |          21 |                     7 | NO_RENDER (7)                       |
| GitHub         |       1 |                 0 |                      0 |           1 |                     0 |                                     |
| **Total**      | **321** |            **78** |                  **0** |     **190** |                **53** |                                     |

"Unconfirmed" means the game painted but never settled into a rich, still, loading-free screen
within the time allowed — a slow download, a DOM or Ruffle game (Ruffle draws in a shadow root
the canvas check cannot see), or a start screen the verifier could not get past. Most of
AddictingGames' route failures are bare `.swf` files, which the app never frames directly (the
desktop relay plays them in Ruffle); FNF's are a nested `fnf.kdata1.com` frame that refuses to
be framed. Only the CrazyGames failures (site-locked) count as broken. Strict passes across
both sets: 78 in the sample, 42 of 247 top-tier candidates.

Screenshots were reviewed by hand, and the detector was wrong three ways before it settled:

1. A Unity canvas exists long before the build has loaded, so "a sized canvas" alone passed
   loading screens. Now the screenshot must be rich and no Unity loader visible.
2. Portal splash and loader screens — AddictingGames, Ninja Kiwi, Max Games, Coolmath's
   logo loader, CrazyGames' loader — are colourful enough to pass a loose colour check. Now
   the screen must be rich, still and free of loading text. Every earlier pass was
   re-tested under this rule.
3. A Unity or CrazyGames build is often one 50 MB request, which fires no events while it
   downloads; the first stall check read that as idle and gave up on games mid-download.
   Now requests still in flight count as activity, and the affected games were re-run.

The machine was shared with other agents (load average 12–33 on 14 cores) on a home
connection that at times delivered 150–600 KB/s, so timings are pessimistic; a heavy game
that needed longer than 150 s is recorded as unconfirmed, not failed.

### What "broken" means with the play chain

The app no longer launches a game one way. `planOnlineRoutes`
(`src/lib/utils/online-play-routing.ts`) gives each game a chain, tried in order until one
runs: `local` (Drive U 7's own `online/embed.html`, a document the app builds), `direct` (the
game's URL in a frame), `shell` (for HTML served as `text/plain`), then the desktop app's
in-process `relay` for anything with an online URL, which also runs `.swf` files in Ruffle.

The launch tests cover the first route that needs no desktop relay — `local` for Drive U 7,
`direct` for everything else — so they speak for the web and Android builds. The relay was
not tested. A game is therefore `broken` only when **every** route must fail:

- the content itself is gone or wrong, which every route fetches alike: HTTP 4xx/5xx,
  unreachable, parked or hijacked domain, redirected to an unrelated site, a deleted Unity
  Play game, the wrong game, a shell that bounces to an ad network, an NPAPI Unity Web Player
  page, a Flash page with no emulator (the relay only wraps bare `.swf` URLs);
- the portal refuses any page but its own (1,171 CrazyGames-exclusive builds: the game checks
  where it is running, which no relay can fake);
- or a catalog shell with no online URL — so no relay — failed its launch after the 150 s
  retry.

A game with an online URL that failed the tested route keeps the untested desktop relay: it is
not broken, it gets launch odds of 0.1 and stays out of `good` and `featured`. The same goes
for Flash `.swf` files (relay-only, 0.2).

## How a game gets its tier

`scripts/catalog-quality/classify.mjs`, first match wins:

1. **broken** — fails every route (above): the probe says the content is gone or wrong, the
   Unity Play API says the game is deleted, the portal refuses other origins, or a shell with
   no other route failed its launch after the 150 s retry.
2. **test** — NSFW; a duplicate (same embed as another entry, or a Unity re-upload of the same
   title by the same author); spam (piracy, cheat and giveaway titles, "𝙵ancy 𝚞nicode"
   names); a description that only sends players elsewhere; negative Unity likes. On Unity
   Play only, and only when the game is not popular (≥ 5,000 plays, ≥ 50 votes, or a Unity
   showcase win): default names ("New Unity Project", "Test", "Game"), build/version names
   ("0.14.3", "v0.0.39", "FPS WebGL Demo"), keyboard-mash names, tutorial coursework (Create
   with Code, Junior Programmer, Brackeys follow-alongs, Roll-a-Ball, "Prototype 3"), the
   untouched microgame template description ("My latest microgame.") under 2,000 plays, and
   the API's own tutorial flag.
3. **joke** — a meme title (brainrot, Skibidi, Sprunki, rizz, gyatt, Ohio, "67", Italian
   brainrot names, nextbots, "rip-off" …).
4. **featured** — launch verified, intrinsic quality `q ≥ 0.64`, has a cover.
5. **good** — `q ≥ 0.56`, launch odds ≥ 0.25 (not relay-only, portal not mostly failing), has
   a cover.
6. **ok** — the rest.

**Intrinsic quality** `q = 0.4·prior + 0.35·ratingPct + 0.25·popularityPct`, where

- `prior` reflects how the portal curates: Coolmath 0.74, CrazyGames 0.70, GitHub 0.70,
  local shells 0.60, AddictingGames 0.58, Playhop 0.55, FNF 0.50, Drive U 7 0.45, Unity Play
  0.30 (anyone can upload; median game has 253 plays and no likes);
- `ratingPct` is the percentile, within the portal, of the Bayesian-smoothed rating (a 10/10
  from three votes does not beat 9/10 from thirty thousand; the prior weight is the portal's
  median vote count);
- `popularityPct` is the percentile of log plays (Unity) or log votes;
- small adjustments: −0.08 no cover image, −0.04 no description, +0.10 Unity showcase
  winner, +0.04 showcase entry, +0.05 a Steam/Play Store listing, −0.06 for a copy of a
  better-ranked game on another portal.

**Launch odds**: 1 when verified; 0 when broken; 0.1 when the tested route failed and only the
desktop relay is left; 0.2 when the host refuses framing or the game is a bare `.swf` (plays
only through the desktop relay); otherwise the portal's sampled launch rate (a loose pass
counts 0.75, an unconfirmed result 0.4), halved for a game that failed once and awaits its
retry.

**Score**: tiers map to bands; inside a band games are ordered by merit
`q × (0.35 + 0.65 × launch odds)`.

## Spot check

Reviewed by hand on 2026-09-23, before the final run:

- **120 games by name, description and reasons**: 20 drawn at random from each tier
  (`classify.mjs --spot 20`);
- **90 more as contact sheets** with cover image and description: 30 random each from `test`,
  `ok` and `good`;
- **every sizeable reason group** read in full or in part: the tutorial matches, "my first
  game" descriptions, all joke titles outside the obvious brainrot/Skibidi/Sprunki ones, the
  hijacked and redirected domains, the Playhop wrong-game entries;
- **launch screenshots**: passes and failures per portal, which is how the splash-screen and
  stalled-download problems below were found.

Misclassifications found, and what changed:

| Found                                                                                          | Change                                                                    |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| "A Roll in the Park", a Unity showcase **winner**, filed as `test` via the API's tutorial flag | A showcase win exempts a game from the template/tutorial rules            |
| "19-(6x4-(1+4))=0", a puzzle, read as a keyboard-mash name                                     | Keyboard-mash names must be letters and digits only                       |
| Playhop "Chess for free", "Tap Away Story" filed as duplicates                                 | They load another app's build: 88 Playhop entries are now `wrong-game`    |
| Drive U 7 judged by its remote URL (0/40 launched, 69 "broken")                                | The app plays its per-game `embed.html`: re-tested that way, 11/40 launch |
| Descriptions that mention an in-game "tutorial" or "Unit 3" filed as coursework                | Description rule narrowed to phrases that say the upload is coursework    |
| "FPS WebGL Demo", "… Prototype" uploads left in `ok`                                           | Build/prototype/demo names count on Unity Play                            |
| Coverless CrazyGames placeholders ("aground", "break a skyscraper") in `good`                  | `good` and `featured` need a cover image                                  |
| "Catch the Candy Xmas \| Christmas at Coolmath Games", "Burnin&#x27; Rubber"                   | Name clean-up covers these patterns and HTML entities                     |
| AddictingGames, Ninja Kiwi and Max Games splash logos counted as launches                      | The picture must settle; 18 such passes were re-tested (12 held)          |
| Coolmath/Unity games killed mid-download by the stall check (one long request fires no events) | Requests still in flight count as activity; affected games were re-run    |
| CrazyGames games showing "can be played exclusively on CrazyGames.com" counted as unconfirmed  | Detected over HTTP (`disableEmbedding`) for all 4,215 and in the browser  |

Left as judgement calls: "My first game" Unity uploads under 5,000 plays are `test` (some
are decent first attempts); the meme rule puts "Doge Miner" and "Level 67" in `joke`.

One measurement is not trusted: Unity builds whose canvas never drew. Several that launched
in 15 s early in the run stayed blank for 2 minutes later, on the same machine under heavier
load, so a blank canvas is recorded as unconfirmed rather than as a failure.

## In the product

- The generator (`scripts/generate-games-list.js`, and `reindex-games-catalog.mjs` for a
  quick rebuild) reads `scripts/data/catalog-quality.json` and adds `q` (score) and `d` (DoE
  status: `b`, `l`, `a`, `?`) to every index row — about 15 bytes a game — and writes the
  shards **best-first**, so shard 0, the page All Games and Home paint first, is the top of
  the catalog. `manifest.json` says `"order": "quality"`. It also strips the portal noise the
  importers left in names ("🕹️ Play on CrazyGames", "- Play it Online at Coolmath Games").
  Shards total 3.28 MB, against 3.18 MB before.
- `src/lib/utils/catalog-quality.ts` holds the ordering and filter rules (unit-tested).
- **All games** defaults to **Best first**, hides `test` and `broken`, and has two toggles:
  **School network** (only games whose hosts are not blocked or likely blocked by the DoE
  filter) and **Show all** (include tests and broken games). Once the whole catalog has
  loaded, a line says how many are hidden, with a link to show them. Favourites and
  downloaded games are never hidden. Name, author, category and shuffle sorts still work.
- **Home**: Recommended and "More to explore" draw only from visible games, "More to explore"
  from the featured and good tiers, and the browse page's School network choice carries over.
  Continue keeps everything the user actually played.

## Re-running

```bash
node --max-http-header-size=131072 scripts/audit-catalog.mjs --phase probe      # resumes
node scripts/audit-catalog.mjs --phase signals
node scripts/catalog-quality/host-status.mjs
npx vite dev --port 5176 --host 127.0.0.1 &
B=--browser ~/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome
node scripts/verify-game-launches.mjs --direct --gpu $B --base http://127.0.0.1:5176 \
  --sample 40 --random --seed 2026 --concurrency 3 --timeout 120000 --record --skip-recorded
node scripts/catalog-quality/classify.mjs --candidates 300 > top.txt
node scripts/verify-game-launches.mjs --direct --gpu $B --base http://127.0.0.1:5176 \
  --ids-file top.txt --concurrency 3 --timeout 120000 --record --skip-recorded
node scripts/verify-game-launches.mjs --direct --gpu $B --base http://127.0.0.1:5176 \
  --retry-failed --timeout 150000 --concurrency 3 --record
node scripts/catalog-quality/classify.mjs
node scripts/generate-games-list.js
node scripts/catalog-quality/classify.mjs --spot 20        # eyeball 20 random games per tier
```

The probe caches expire after 30 days (`--max-age-days`), so a monthly rerun re-checks
everything.

## Limitations and next steps

- **DoE status is mostly inferred.** Four hosts are measured blocked and five measured or
  known allowed; the rest is same-site and category reasoning. A teacher running the 198
  hosts through DoE's Web Filter Check tool would turn this into measurement (see
  [nsw-doe-filtering.md](./nsw-doe-filtering.md)).
- **1,613 games qualify for `featured` on quality but have not been launch-tested**; they stay
  `good` until they are. `classify.mjs --candidates N` lists them best-first.
- **The desktop relay was not launch-tested.** Games that failed the web/Android route are
  kept as `ok` on the strength of the relay alone; a relay pass (e.g. with
  `scripts/play-path-bench.mjs --mode tauri --force relay`) would settle them either way.
- **Ruffle draws inside a shadow root**, which the canvas check does not look into, so Flash
  games that play in Ruffle (most Drive U 7 titles) are recorded as painted-but-unconfirmed,
  not as launches.
- **Playhop needs the SDK shim** [game-launch-quality.md](./game-launch-quality.md) recommends:
  its games stall on the Yandex handshake without a playhop.com parent. That alone would
  lift about 2,000 games.
- **1,171 CrazyGames-exclusive entries** could be pruned or re-imported; they are hidden, not
  deleted. The 338 Flash entries play only on desktop.
- **Content policy is out of scope**: slot-machine and casino simulations from AddictingGames
  and Playhop are playable and stay in `ok`/`good`; horror FNF mods are rated like any other.
- **The game page's "recommended" rail** (another area of the app) still draws from the whole
  index; `isHiddenByDefault` from `catalog-quality.ts` is ready to filter it.
- The machine was shared and on a home connection; slow downloads were given 120–150 s,
  but a heavy game that needed longer is recorded as unconfirmed, not failed.
