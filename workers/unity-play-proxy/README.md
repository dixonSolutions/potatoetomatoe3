# Unity play proxy (Cloudflare Worker)

Proxies Unity Play / allow-listed embed HTML so GitHub Pages can load games with
`inject.js` in the **top iframe document**. Touch controls then use
`potato-tomato-touch-input` postMessage (cross-origin safe).

## Endpoints

| Path | Description |
|------|-------------|
| `GET /api/unity-play/:gameId` | Resolve embed from catalog metadata, fetch + inject, return HTML |
| `GET /health` | Liveness |

## Deploy

```bash
cd workers/unity-play-proxy
npx wrangler deploy
```

Set vars (wrangler.toml or dashboard):

| Var | Example |
|-----|---------|
| `CATALOG_BASE` | `https://dixonsolutions.github.io/potatoetomatoe3` |
| `FRAME_ANCESTORS` | `https://dixonsolutions.github.io` |

Then set the GitHub Actions variable `PUBLIC_PLAY_PROXY_URL` to the Worker URL
(no trailing slash), e.g. `https://potato-tomato-unity-play-proxy.<account>.workers.dev`.

The Pages workflow passes it into `pnpm build` so Unity online play uses the proxy
instead of `/unity/player.html`.
