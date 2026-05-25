# Local play analytics & recommendations

All data lives in the browser (`localStorage` key `potato-tomato-play-analytics`). There is no server sync.

## Algorithm

- **Signals:** category and author weights (EMA from opens), per-game sessions and total play time, recent category queue, explicit category affinity sliders (-1…+1), favourites and dislikes from `potato-tomato-preferences`.
- **Scoring:** An 8-dimensional feature vector per game is multiplied by a **fixed** weight vector (hand-tuned linear model, not gradient-trained in the browser). **TensorFlow.js** runs this batch `matMul` on **WebGPU** when the browser supports it, then WebGL, then CPU (`recommendation-tf.ts`). Weights do not change from user data automatically; analytics only adjust the **features** fed into that product.
- **Cold start:** If learning signal is very low, the home feed uses a deterministic shuffle instead.

## Routes

- **`/home`** — “Continue”, **“Recommended”**, and “More to explore” rows; feed reloads on each client navigation to `/home`.
- **`/play-analytics`** — Playtime totals, backend label, category sliders, global daily limit, and a preview list of top-ranked titles.

## Playtime

While a game is running (after **Play**), a 5s interval adds time when the tab is visible. Daily totals are keyed by UTC date. Limits use `dailyGlobalLimitMs` and optional `dailyPerGameLimitMs` in stored analytics (global limit is exposed in the UI).

## Root `/` redirect

`+page.server.ts` redirects to `/home` when the server runs. For static/SPA hosts, `src/routes/+page.svelte` also `goto(`${base}/home`)` so the personalized feed always appears.
