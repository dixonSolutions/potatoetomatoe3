# Game launch quality — why games fail to launch

Investigation of "very few games actually launch" (2026-08-10). Measured against the
dev build (`pnpm dev`) with the puller sidecar up, plus direct probes of every distinct
embed host in the catalog.

> **Measured under the old routing.** Every number in this document up to "Portal
> orientation gates" was taken when the desktop app and `pnpm dev` played online embeds
> through the puller's Node relay (`/api/game-live`, `/api/unity-play`). Play no longer
> works that way: a launch walks a route chain — `direct` → `local` (the catalog's
> `embed.html` in a blob) → `shell` (host HTML in a blob with `<base>`) → `relay` (the
> desktop app's in-process relay, `relay.rs`) → `puller` (only if one is already running;
> never started for play) → Open in browser — and on the desktop app the in-frame bridge is
> injected natively into the game's own frames. See
> [native-first.md](./native-first.md#play-path-no-puller), which also has the before/after
> launch measurements for the new path. The findings below are kept as measured; notes in
> _italics_ say what changed since.

The launch pipeline itself is **not** the problem. `LazyGameFrame.svelte` renders a
plain iframe and Unity Play titles launch and play correctly. Failures come from the
embed URLs the catalog points at, and from where the app is running.

## Failure classes

Each class is independent — a game can be affected by more than one.

| Class              |  Games | Fails on                      | Root cause                                       |
| ------------------ | -----: | ----------------------------- | ------------------------------------------------ |
| Network filter     | ~7,700 | Filtered networks only        | Portal hosts blocked upstream                    |
| Frame-blocked      |    334 | Everywhere without the puller | `X-Frame-Options: DENY`                          |
| Wrong content type |    215 | Everywhere without the puller | jsDelivr serves HTML as `text/plain`             |
| Malformed URL      |    150 | Everywhere                    | Importer string concatenation (**fixed**)        |
| Dead embed URL     |      6 | Everywhere                    | `origin + undefined` (**pruned**)                |
| Phantom entry      |      1 | Everywhere                    | Generator scanned its own output dir (**fixed**) |

_Since the route chain: the Drive U 7 games among the frame-blocked and wrong-content-type
classes play from the catalog's `embed.html` in a blob (`local`), on every platform
including the public site; other `text/plain` hosts get the `shell` route; AddictingGames
Flash (`prod.addictinggames.com`, `SAMEORIGIN`) goes through the desktop app's in-process
relay; Coolmath's `public_games/` URLs no longer refuse framing and play direct._

### 1. Network filter (largest class)

On a NSW Department of Education network the edge proxy MITM-intercepts TLS and returns
a 403 "NSW DoE Secure Internet at Edge" page. Confirmed from the certificate chain:

```
0 s:CN=crazygames.com
1 s:C=AU, ST=NSW, O=NSW Department of Education, CN=edgeportal.det.nsw.edu.au
```

Blocked hosts include `games.crazygames.com`, `app-*.games.s3.yandex.net`,
`cdn2.addictinggames.com`, `www.coolmathgames.com`, and most `.io` game domains.
`play.unity.com`, `cdn.jsdelivr.net` and `abinbins.github.io` pass.

**The puller does not help here.** It fetches from the same machine, so it hits the same
filter. Node's fetch does not trust the DoE root CA, so the relay fails with
`{"error":"fetch failed"}` and the iframe renders empty. _The in-process relay that
replaced it trusts the OS roots, the DoE CA included, but it fetches from the same machine
too: a blocked host is still a 403._

Measured launch rate per portal on a filtered network (20-game random sample each,
driven through the app's real resolution path):

| Portal         | Games |                        Launched |
| -------------- | ----: | ------------------------------: |
| Unity Play     | 3,772 |                           20/20 |
| Drive U 7      |   546 | 20/20 (via puller, old routing) |
| CrazyGames     | 4,215 |                            0/20 |
| Playhop        | 2,404 |                            0/20 |
| AddictingGames | 1,181 |                            1/20 |
| Coolmath       |   405 |                            0/20 |

## Measured launch rate on an unfiltered network

Off the filtered network every portal host answers with HTTP 200 — 11,587 of the 12,517
remote embeds. Reachability is therefore **not** what limits the catalog.

Verified with `scripts/verify-game-launches.mjs`, which drives a real browser, clicks
Play, and walks the frame tree looking for a painted canvas. 12 games per portal, sampled
by even stride across each portal, 150s budget per game:

| Portal         | Games |  Launched |    Rate |
| -------------- | ----: | --------: | ------: |
| Unity Play     | 3,772 |     12/12 |    100% |
| Coolmath       |   405 |     10/12 |     83% |
| Local shells   |   492 |      8/12 |     67% |
| AddictingGames | 1,181 |      6/12 |     50% |
| Drive U 7      |   546 |      5/12 |     42% |
| CrazyGames     | 4,215 |      4/12 |     33% |
| Playhop        | 2,404 |      2/12 |     17% |
| **Overall**    |       | **47/84** | **56%** |

Weighted across the catalog that is roughly 6,000 of 13,009 games that actually play.

**Timeouts produce false failures.** Under software WebGL a working game can take 40–65s
to paint — `crazygames-blaster-pranks` needs 41s, `run-3-editor` 65s. A first pass at 45s
reported 47 failures, 10 of which launched when given 150s. Always re-test failures with
`--timeout 150000` before believing them.

### Playhop is blocked by its portal SDK, not by the network

Playhop is the worst portal and its failure is specific. Games load the Yandex/Playgama
bridge and stall on a handshake with the portal shell:

```
SDK initialization failed Error: Get external iframe timeout
```

Their embed URLs carry `#origin=https%3A%2F%2Fplayhop.com`, and the SDK expects a parent
frame on that origin to answer a `postMessage` handshake. Loaded **top level** the same
URL paints a 1280×720 canvas; loaded in an iframe from any other origin it hangs.
Dropping the `?sdk=` query parameter does not help — `full`, `noSdk` and bare variants all
behave identically. Making these 2,404 games work needs a shim that answers the SDK
handshake from the parent frame, alongside the existing storage bridge.

### 2. Frame-blocked and wrong content type (Drive U 7)

These 546 games can never load in a direct iframe on **any** network:

- 331 point at `sites.google.com`, which sends `X-Frame-Options: DENY`.
- 215 point at `cdn.jsdelivr.net`, which serves HTML as `Content-Type: text/plain`
  so the browser shows source text instead of rendering a page.

They only worked because the puller refetched server-side and re-served same-origin with a
corrected content type. **On the GitHub Pages build there was no puller, so all 546
failed.** _Now the catalog ships each one's playable document as `online/embed.html`, played
from a blob with the bridge first (the `local` route) on every platform, the public site
included. In the Tauri bench the jsDelivr and Sites games play from it in 0.3–1.9 s, where
two of four were dead frames through the puller._

### 3. Local shells are not local

The 492 games with no `onlineEmbedUrl` look local but are 700-byte shells that iframe a
third party — 408 of them `abinbins.github.io`. Only a thumbnail lives in their `assets/`
directory. Seven have no iframe or no `index.html` at all.

## Relay gap: JS-constructed asset URLs

_Old routing only: CrazyGames titles now play direct, with the bridge injected natively on
the desktop app, so nothing depends on the relay rewriting them._

`rewriteHtmlForLiveSession` in `puller/src/live/proxy.ts` rewrites `src`/`href`
attributes and CSS `url()`. It cannot see URLs that a page builds at runtime in
JavaScript.

CrazyGames pages do exactly that. Their bootstrap assembles the loader URL from string
parts and reads asset URLs out of an options object:

```js
var gfBuildPath = 'https://builds.crazygames.com/gameframe';
var gameframeJs = gfBuildPath + '/v' + (version || '1') + '/bundle.js';
loadScript(gameframeJs, function () {
	Crazygames.load(options);
});
```

So for all 4,215 CrazyGames titles the relay is effectively a passthrough: the browser
fetches `builds.crazygames.com` and `<slug>.game-files.crazygames.com` directly, the
touch/storage bridge is never applied to the real game, and nothing is proxied.

### Correction to the previous field report

`docs/field-tests/marinesurface-2026-07-30/REPORT.md` attributes CrazyGames failures to
proxied HTML containing `gameframeJs = 'http://localhost:3002/bundle.js'`. That string is
present in **CrazyGames' own upstream bootstrap**, inside an `if (useLocalGF)` branch
where `useLocalGF` is `false`. It is dead code and not the cause. Stripping it would have
no effect.

## The desktop app used to break games that work on the web

Separate from catalog quality: the same game that plays instantly at
`dixonsolutions.github.io/potatoetomatoe3` would stall, freeze, or never start in the
Tauri app. That was not the catalog — it was routing.

`getGamePlayerUrl` sent **every** online launch with an `onlineEmbedUrl` through
`/api/game-live/:id`, the puller's live relay, whenever the app was not the public site.
The relay re-fetches the page and every asset in Node and rewrites the HTML, so a launch
that is one CDN request in a browser became a serialised proxy crawl — hence the latency
and the freezes. Worse, the launch first waited up to **12 seconds** for a cold puller
before it would even start.

The first fix kept the Node relay for what seemed to need it — our own code _inside_ a
cross-origin game document (the touch console), and hosts that refuse to be framed — and
sent everything else direct. That interim policy, in `online-play-routing.ts` at the time:

| Situation                                          | Route            |
| -------------------------------------------------- | ---------------- |
| Public site                                        | direct           |
| Tauri mobile (no sidecar exists)                   | direct           |
| Same-origin catalog shell                          | direct           |
| Host sends X-Frame-Options (334 games)             | relay, mandatory |
| Touch console on, cross-origin game                | relay, mandatory |
| A previous direct launch of this game did not load | relay, mandatory |
| Unity embed                                        | relay, optional  |
| Everything else                                    | direct           |

_It is gone too. The puller is no longer started with the app or for play, and the
console no longer needs a relay: the desktop webview injects the bridge into the game's
own frames. A launch now walks the route chain (`planOnlineRoutes` in
[`online-play-routing.ts`](../src/lib/utils/online-play-routing.ts)):_

| Route    | What the frame loads                                                          | Platforms            |
| -------- | ----------------------------------------------------------------------------- | -------------------- |
| `direct` | The game's own URL; on desktop the bridge is injected into its frames         | all                  |
| `local`  | The catalog's `online/embed.html` (Drive U 7) from a blob, bridge first       | all                  |
| `shell`  | HTML a host labels `text/plain` (jsDelivr), fetched into a blob with `<base>` | all                  |
| `relay`  | `ptrelay://localhost/game/<id>`: the in-process relay (`relay.rs`)            | desktop              |
| `puller` | The Node relay — only if a puller already answers; never started              | desktop / `pnpm dev` |
| —        | Every route failed: a toast offers **Open in browser**                        | all                  |

Two supporting pieces carried over and changed shape:

- **A launch watchdog.** `LazyGameFrame` reports `loading` / `loaded` / `stalled`. A frame
  that never fires `load` within 25s, or (on desktop) loads without its document ever
  running a script, marks that route failed for the session and the page moves on to the
  next route by itself. _It used to leave a "Retry via relay" action under the player;
  the user now hears about it only when every route failed._ The timeout is deliberately
  generous: `load` waits for every subresource, and a Unity build is tens of megabytes — a
  false stall would push a working game onto a worse route. A frame that already said
  hello is left alone however late its `load` is.
- **A frame-blocked host list.** A framing refusal still fires `load`, so no timeout can
  see it. `prod.addictinggames.com` skips `direct` (checked against a catalog embed on
  2026-09-23). `sites.google.com` games play from `embed.html` instead, and
  `coolmathgames.com` has stopped refusing frames for the `public_games/` URLs the catalog
  uses.

### The touch console does not need the proxy either

`ensureTouchCapablePlayUrl` started at the relay for every online game. It now tries, in
order: direct DOM dispatch into a same-origin document, a bridge already inside the game
frame (native injection on the desktop app and Android, or an app-made shell, relay page
or offline copy), and on the public site a hosted relay. See
[touch-console.md](./touch-console.md).

## Portal orientation gates — why CrazyGames titles never started

Measured on a Galaxy Tab Active3 with WebView devtools attached to the release build.
`crazygames-home-pin-2-fpx` painted no canvas after 40 seconds even though the portal shell
had initialised fine (`[GameFrame] version 1.357.2`, translations, storage). Reading the
cross-origin frame's DOM gave the answer at once — its entire body text was:

```
Rotate your screen
```

The frame was not confused about the device. It reported `916x514`,
`orientation: landscape-primary`, `innerWidth > innerHeight`. The bootstrap held the real
reason:

```
orientationInBootstrap: "PORTRAIT"     the game declares portrait
window.orientation: 90                 the device is landscape
```

`window.orientation` and `screen.orientation` report the **physical device**, never the
iframe, so the gate is unreachable from CSS — it never looks at element size. Forcing the
device to `user_rotation 0` did not help either: this tablet is landscape-native, so
rotation 0 _is_ landscape. Sampling confirmed it is not one title:

```
crazygames-tower-swap        ROTATE-GATE (declares PORTRAIT)
crazygames-2048              ROTATE-GATE (declares PORTRAIT)
crazygames-home-pin-2-fpx    ROTATE-GATE (declares PORTRAIT)
```

**A first attempt was wrong.** `LazyGameFrame` hard-coded `aspect-ratio: 16 / 9`, so a
portrait game was never offered a portrait box, and making that follow device orientation
looked like the fix. It changed nothing, because the gate reads device APIs rather than
layout. The CSS is still worth having, but it was not the cause.

The fix needs code running _inside_ the game document, which
[native injection](./touch-console.md) provides on Android:

- the bridge defines `window.orientation` and `screen.orientation` from **the frame's own
  box**, at document start, before the page's script runs — an embedder presents a
  viewport, so that is the honest answer to "which way up are you?";
- it reads the declared orientation and posts `potato-tomato-frame-orientation` to the app,
  which reshapes the surface to match. Reporting "portrait" without a portrait-shaped box
  would only trade the gate for a game rendering sideways.

The app's own top frame keeps the real values; only game frames are overridden.

### Diagnosing a frame you cannot script from the app

The app cannot inject into a cross-origin game frame — that is Blink's same-origin policy,
not a WebView limitation, and an embedded Chromium would behave identically. Chrome
extensions can (`all_frames` plus host permissions); embedders cannot.

Debugging is a different matter. `WebView.setWebContentsDebuggingEnabled` exposes the
DevTools protocol, which reads any frame through an isolated world:

```bash
adb shell am start -n com.potatotomato.games/.MainActivity --ez webviewDebug true
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.potatotomato.games)
```

Playwright attaches over CDP with `chromium.connectOverCDP('http://127.0.0.1:9222')` and
needs no local browser binary, so `frame.evaluate()` works against the real release APK on
a real device. That is how the orientation gate was found; screenshots alone had produced
three wrong hypotheses first.

## CrazyGames on mobile: unresolved

After the orientation gate was fixed the shell stops rendering "Rotate your screen" — the
frame body is just "Exit" — but the game still never starts. Measured on the tablet across
`crazygames-2048`, `crazygames-tower-swap` and `crazygames-home-pin-2-fpx`: `[GameFrame]
version 1.357.2` initialises, then **no request is ever made to `game-files.crazygames.com`
or `builds.crazygames.com`**. Of 323 requests during a launch, the only failures are two
ad scripts.

Hypotheses tested on the device and **falsified** — none of these is the cause:

| Hypothesis                | Test                                                      | Result                          |
| ------------------------- | --------------------------------------------------------- | ------------------------------- |
| Device orientation        | forced both rotations                                     | gate cleared, game still absent |
| Mobile user agent         | `Network.setUserAgentOverride` to desktop                 | no change                       |
| Touch capability          | spoofed `maxTouchPoints: 0`, `pointer: fine` in subframes | no change                       |
| UA **and** touch together | both overrides at once                                    | no change                       |
| IMA video-ad preroll      | injected a full `google.ima` stub that fails fast         | no change                       |

`cdn-ima.33across.com/ima.js` does fail to load in this WebView while `gpt.js` loads, and
the host resolves and serves it 200 from a desktop on another network — but stubbing the
SDK entirely did not unblock the game, so the ad SDK is not the gate either.

Control experiment in an independent browser, same URL:

| Context                                           | Result                                                    |
| ------------------------------------------------- | --------------------------------------------------------- |
| Desktop UA, `maxTouchPoints: 0`, 1280x720         | loads `2048.game-files.crazygames.com/2048/5/index.html`  |
| Desktop UA, `maxTouchPoints: 0`, 280x423 portrait | loads — viewport size is irrelevant                       |
| Mobile UA + touch, 375x812                        | identical stall to the tablet: body "Exit", no game frame |

So the behaviour reproduces outside the app, in a plain mobile browser profile. This is
portal-side and is **not** specific to Tauri, the WebView, or this device. It affects the
4,215 CrazyGames entries; the rest of the catalog is unaffected.

Verified playing on the same device and network in the same session:

```
road-rage-by-paul-ellison  (Unity Play)      PLAYING canvas=1832x1030
coolmath-1-push            (Coolmath)        PLAYING canvas=528x528
addicting-100-arrows       (AddictingGames)  PLAYING canvas=916x514
```

Next step when this is picked up: capture the GameFrame's own state machine rather than
probing inputs — the bundle is available at `builds.crazygames.com/gameframe/v1/bundle.js`
and native injection can instrument it from inside the frame.

## Android

The published APK never launched, for two reasons that had nothing to do with games:

- It was **unsigned**. `release-android.yml` picked up
  `app-universal-release-unsigned.apk`, and Android rejects unsigned packages outright.
  The build was green because nothing checked. See [release.md](./release.md).
- **R8 was enabled** with `proguardFiles(fileTree(...))`, which resolves at configuration
  time — before `tauri-build` writes `proguard-tauri.pro` — so a clean checkout stripped
  Tauri's JNI and reflection entry points.

Both are fixed and the app was verified launching on a Galaxy Tab Active3 (Android 13).

Mobile has no puller sidecar, and `shouldProbePullerBackend()` says so — but the UI gated
its puller affordances on `isLocalAppDeployment()`, which is true in _any_ Tauri build.
The Android app therefore showed "Starting puller", a Retry puller button, advice to run
`pnpm puller:start` on a tablet, and a 12-second wait before the touch console gave up.
Anything mentioning the puller is now gated on `shouldProbePullerBackend()`.

To inspect the shipped Android build on a device:

```bash
adb shell am start -n com.potatotomato.games/.MainActivity --ez webviewDebug true
adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.potatotomato.games)
```

`MainActivity` enables WebView debugging only for a launch that carries that extra, so an
ordinary tap on the launcher icon never turns it on.

### Legacy Unity titles hung at 0% behind an invisible popup

Field test 2026-08-26, Galaxy Tab Active3. House of Hazards launched, showed its loading
bar, and sat at **0%** forever. Not the network — the same URL hangs identically in
Firefox on the device, with the app out of the picture — and not a missing asset; all
three `.unityweb` files and the build JSON serve 200.

Unity 2018-era `UnityLoader.js` runs a compatibility check and, when
`UnityLoader.SystemInfo.mobile` is true, injects a confirm popup into the game container:

> Please note that Unity WebGL is not currently supported on mobiles. Press OK if you
> wish to continue anyway.

`UnityLoader.instantiate` does not fetch the build until that OK is clicked. The game's
own loader overlay (`#loader`, the 0% bar) is painted **on top** of the popup, so it is
both invisible and unclickable. Reaching into the frame and clicking the button took the
game from 0% to 100% immediately.

The popup lives in a cross-origin frame (`abinbins.github.io`) nested inside the
same-origin shell, so the app cannot script it away, and Android has no relay to proxy it
same-origin. `SystemInfo.mobile` is derived from the user agent, so the fix is to stop the
WebView looking like a phone: `userAgent` is set on the window in
`tauri.android.conf.json`. Verified live — `mobile:false`, no popup, build fetched, 100%.

This is scoped to `tauri.android.conf.json` on purpose. Desktop and Flatpak keep their
real user agent, which is not a phone's, so they never trip this check.

Safe because nothing in the app reads the user agent to decide it is mobile.
`isTouchOnlyDevice()` uses `maxTouchPoints` + `(pointer: coarse)` + `(hover: hover)`, and
`IsMobile` is a viewport-width media query — both are capability checks that a spoofed UA
does not affect, so the touch console still auto-enables.

## Error reporting makes every failure look the same

_Both fixed since: the launch watchdog above, and the game page no longer mentions the
puller for playing._ As measured then, two issues made diagnosis harder than it should be:

- `LazyGameFrame.svelte` sets no load timeout and no error handler, so a failed launch
  renders as a black box.
- When the relay fails upstream, the page still advises "Local puller required for
  touch-enabled play — run `pnpm puller:start`", even when the puller is running and
  healthy. The real error (`fetch failed`) is only visible in the play log.

## Fixes applied

| Change                                                                                                                     | File                                        |
| -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Shared `normalizeEmbedUrl` — resolves protocol-relative URLs by scheme, upgrades `http:`, rejects `undefined`/`null` hosts | `scripts/lib/game-shell.mjs`                |
| `writeOnlineShell` normalises before writing, so no importer can emit a malformed URL                                      | `scripts/lib/game-shell.mjs`                |
| Removed the concatenation that produced doubled hosts                                                                      | `scripts/import-addictinggames-catalog.mjs` |
| Generator requires a real game marker, so `games-index/` is no longer a phantom game                                       | `scripts/generate-games-list.js`            |
| One-shot repair for URLs already in the catalog                                                                            | `scripts/repair-catalog-embed-urls.mjs`     |
| Real-browser launch verifier, so launch rate is measured rather than assumed                                               | `scripts/verify-game-launches.mjs`          |

Repair run: 190 URLs corrected (80 `http:` → `https:`, 64 doubled hosts, 4 embedded
second URLs, 42 bare origins normalised), 6 unrecoverable games pruned, 1 phantom entry
removed. Catalog went from 13,016 to 13,009 entries.

```bash
node scripts/repair-catalog-embed-urls.mjs                             # report
node scripts/repair-catalog-embed-urls.mjs --write --prune-unrecoverable
node scripts/generate-games-list.js
```

## Recommended next steps

Ordered by games recovered per unit of work.

1. **Playhop SDK shim — 2,404 games, currently 17%.** Answer the Yandex/Playgama
   handshake from the parent frame so the bridge resolves instead of timing out. Biggest
   single win available and the failure mode is well understood.
2. **Gate the catalog on launchability — affects all 13,009.** Run
   `verify-game-launches.mjs` in bulk, store the result per game, and demote or hide
   titles that never launch. Browse surfaces are currently dominated by dead games; the
   recommendation rail beside a working Unity title was four CrazyGames entries, three of
   which do not run. This improves perceived quality without fixing a single game.
3. ~~**CrazyGames relay rewriting — 4,215 games, currently 33%.**~~ _Moot: CrazyGames
   plays direct and the desktop app injects the bridge natively, so no relay rewriting is
   involved. The failures still need diagnosing on their own terms._
4. ~~**Surface real launch errors.**~~ _Done: the launch watchdog walks the route chain
   and says when every route failed._
5. ~~**Flag puller-only games.**~~ _Moot: the 546 Drive U 7 titles play from the catalog's
   `embed.html` without any relay, the Pages build included._
6. **Decide the network story.** On a filtered network the only things that work are
   offline mirrors built elsewhere, or a relay whose fetches originate outside the filter
   (`workers/unity-play-proxy` via `PUBLIC_PLAY_PROXY_URL`). No catalog edit changes this.

## Reproducing the measurements

The numbers above were taken with the dev server and puller up (old routing). With the
current routing the puller is not needed, and when one is running it is only the last
route:

```bash
pnpm dev --port 5178

# Playwright ships no Chromium for every distro; point at the system browser.
node scripts/verify-game-launches.mjs --browser /usr/bin/chromium --sample 12
node scripts/verify-game-launches.mjs --browser /usr/bin/chromium --portal playhop --sample 40
node scripts/verify-game-launches.mjs --browser /usr/bin/chromium --ids slope,fractals

# Re-test failures before believing them — slow is not broken.
node scripts/verify-game-launches.mjs --browser /usr/bin/chromium \
  --timeout 150000 --concurrency 2 --ids <failed-ids>
```

Results are written to `scripts/data/launch-verification.json` with per-game console
errors, failed requests and the frame tree at timeout.

The verifier refuses to run on a filtered network, because every game would fail for a
reason unrelated to the catalog:

```
Network appears filtered: cannot reach games.crazygames.com (TypeError: fetch failed)
Results would measure the proxy, not the catalog.
```

Override with `--ignore-network-check` only when you specifically want to measure
behaviour behind the filter.

Probe every distinct embed host and classify the response:

```bash
# Distinct hosts and their game counts come from games-metadata.json;
# a 403 body containing "Secure Internet at Edge" means filter-blocked,
# X-Frame-Options DENY/SAMEORIGIN means frame-blocked.
curl -skI -A 'Mozilla/5.0' <embedUrl>
```

`r.jina.ai` reaches blocked hosts from outside the filter and returns raw HTML with
`-H 'x-respond-with: html'`, which is how the upstream pages above were inspected.
