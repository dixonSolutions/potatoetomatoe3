# Local play analytics & recommendations

All data lives in the browser (`localStorage` key `potato-tomato-play-analytics`). There is no server sync.

## Algorithm

See [recommendations.md](recommendations.md): hashed game features, a user vector trained
with BPR on this device, the catalog scored on WebGPU (CPU fallback), the last six months of
activity only.

## Routes

- **`/home`** — rows like the Roblox home: Continue, Favourites, Recommended for you, Today's picks, Top rated, and the categories you play (`home-feed.ts`).
- **`/play-analytics`** — Playtime totals, backend label, category sliders, global daily limit, and a preview list of top-ranked titles.

## Playtime

While a game is running (after **Play**), a 5s interval adds time when the tab is visible. Daily totals are keyed by UTC date. Limits use `dailyGlobalLimitMs` and optional `dailyPerGameLimitMs` in stored analytics (global limit is exposed in the UI).

## Root `/` redirect

`+page.server.ts` redirects to `/home` when the server runs. For static/SPA hosts, `src/routes/+page.svelte` also `goto(`${base}/home`)` so the personalized feed always appears.
