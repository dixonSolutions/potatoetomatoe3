# Recommendations

Everything runs on the device. Nothing is sent anywhere.

## Method

A small hybrid recommender (code: `src/lib/utils/recommendation-model.ts`):

1. **Item features by feature hashing** (Weinberger et al., 2009). Each game's category,
   author, engine, portal and title words are signed-hashed into a 64-dim vector and
   L2-normalised. Games that share features sit close together, so a game nobody has
   played can still rank high when it looks like what you play.
2. **User vector by BPR** (Bayesian Personalized Ranking, Rendle et al., 2009), trained on
   those features: the item side of LightFM's hybrid model, with one user. Each positive
   game is pushed above a randomly sampled game, and each negative game below one. This is 40
   epochs of SGD, deterministic, and a few milliseconds.
3. **Score** = user·item (one mat-vec over the whole catalog) + a quality prior that fades
   as history grows + explicit category affinity from Play analytics.
4. **Diversity**: at most a quarter of a row from one category, then fill.

The game page's "more like this" uses the same matrix, scored against the current game's
own vector plus a little of the user vector.

### Signals (last six months only, 30-day half-life)

| Signal           | Source                               | Effect              |
| ---------------- | ------------------------------------ | ------------------- |
| Start            | play analytics `perGame.sessions`    | + (capped)          |
| Playtime         | play analytics `perGame.totalPlayMs` | + log2(1 + minutes) |
| Favourite        | preferences `liked`                  | +3                  |
| Dislike          | preferences `disliked`               | −5, never shown     |
| Launch error     | event log (`error`)                  | −2 each             |
| Left within 30 s | event log (`leave`)                  | −0.75 each          |

Played games are included in the ranking but Home leaves them out of Recommended, because
they already appear in Continue. Unplayed games make up most of the row.

### Cold start

With no history the user vector is zero, so the ranking is the catalog's quality order,
diversified by category. It is never empty. The Games tab's Recommended filter uses the
same function, and falls back to catalog order if ranking ever fails
(`home-feed-recommended.ts`).

## Acceleration

`src/lib/utils/recommendation-gpu.ts` runs the catalog mat-vec as one WebGPU compute
dispatch. The feature matrix (13.6k × 64 floats, about 3.5 MB) is uploaded once per
catalog; each ranking writes 64 floats and reads back n. Below 4096 games, or with no
WebGPU or a failed device, it uses the CPU loop instead. Either way the whole ranking is
well under the 50 ms budget. This replaced TensorFlow.js, which was a large download for a
single mat-vec.

## Storage

| Data                                                        | Where                                            | Why                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------- |
| Play analytics (starts, playtime, limits, affinity)         | localStorage `potato-tomato-play-analytics`      | small, read synchronously to paint Home and enforce limits                        |
| Favourites / dislikes                                       | localStorage `potato-tomato-preferences`         | small, synchronous                                                                |
| Event log (errors, early leaves), ≤ 4000 events, ≤ 6 months | IndexedDB `potato-tomato-recs` / `kv` / `events` | grows with every session; only needed when ranking, so it stays off the sync path |
| Feature matrix, user vector                                 | memory only                                      | rebuilt per catalog (~20-30 ms) and per ranking (~10 ms)                          |

## Evaluation

`src/lib/utils/recommendation-model.spec.ts` (vitest, offline):

- Synthetic catalog of 3000 games (25 categories, a long tail of authors, genre-leaning
  titles) and 60 synthetic players, each with two liked categories and three liked
  authors. History is 12 liked plays plus 6 early leaves or errors elsewhere.
- **Hit rate @10** (share of the top 10 that the player would like): **0.570** for the
  model against **0.092** for the popularity (quality order) baseline.
- Cold start returns exactly the quality order. Six-month window and half-life are
  tested.
- Ranking 13,646 games: about 10 ms (feature build, once per catalog, 20-30 ms) on the
  Bluefin laptop under Node.
