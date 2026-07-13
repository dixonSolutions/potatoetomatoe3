# Release & Flatpak remote

## Automated release (main branch)

Workflow: `.github/workflows/release.yml`

On every push to `main`:

1. **Version bump** — `0.0.<run_number>` written to `package.json`, `tauri.conf.json`, `Cargo.toml`, `version.txt`
2. **Puller sidecar** — `pnpm puller:bundle:linux`
3. **Flatpak build** — packages prebuilt Tauri binary + puller sidecar via `flatpak/com.potatotomato.games.yml`
4. **GitHub Release** — attaches `com.potatotomato.games-<version>.flatpak`
5. **Pages refresh** — `pages.yml` asynchronously deploys the web build and the new OSTree repo after Release completes

The standalone **Deploy GitHub Pages** workflow (`.github/workflows/pages.yml`) runs on every `push` to `main` (and `workflow_dispatch`) for fast web updates. It also runs after a successful `Release` workflow and uses that exact Release artifact, so `/flatpak/` is refreshed without making Release wait for a second site build. Push-triggered Pages runs copy the latest successful Release OSTree so web-only deploys do not wipe remote Flatpak installs.

## Public Flatpak remote

After a successful release:

```bash
flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak remote-delete potatotomato 2>/dev/null || true
flatpak remote-add --user --if-not-exists --no-gpg-verify potatotomato \
  https://dixonsolutions.github.io/potatoetomatoe3/potatotomato.flatpakrepo
flatpak install --user potatotomato com.potatotomato.games
flatpak run com.potatotomato.games
```

The `.flatpakrepo` file lives in `static/potatotomato.flatpakrepo` and must use the `[Flatpak Repo]` section header (not `[Flatpak]`).

## Previous CI failures (fixed)

| Workflow | Failure | Fix |
| -------- | ------- | --- |
| Release | `ConfigureRemote not allowed for user` | Use `flatpak --user` for remotes and installs on GitHub-hosted runners |
| Build Flatpak | `npm: command not found` in sandbox | Build Tauri on the host in CI; Flatpak manifest only packages prebuilt binaries |
| Remote install | `Invalid gpg key` | Remove empty `GPGKey=` from `.flatpakrepo`; add remote with `--no-gpg-verify` |
| GitHub Pages | `/flatpak/summary` 404 | Usually no successful Release artifact was available to preserve, or Release Pages deploy had not finished yet. `pages.yml` restores OSTree from the latest Release artifact; `release.yml` publishes a fresh one. Verify `https://dixonsolutions.github.io/potatoetomatoe3/flatpak/summary` returns 200 before telling users to use the remote. |
| Remote install | Prefer one-file bundle | `flatpak install --user` the `.flatpak` from [GitHub Releases](https://github.com/dixonSolutions/potatoetomatoe3/releases/latest) if the OSTree remote is broken |
| Flatpak runtime | `Game not in catalog` / `puller catalog is empty` | Tauri looks for resources at `/app/lib/<productName>/` (`Potato Tomato`). Catalog must be installed there (not only under `potato-tomato`). Check `/api/offline/health` → `catalogGameCount`. |
| Flatpak run | `Failed to load ayatana-appindicator3` panic | Bundle `shared-modules/libappindicator` in the Flatpak manifest (submodule). Rebuild/reinstall the Flatpak. |
| Flatpak build | `Package 'libayatana-ido3-0.4' not found` | Ayatana cmake installs to `/app/lib64`; use classic `libappindicator-gtk3-12.10.json` instead. |
| Flatpak Unity download | `File '/**/static/unity/inject.js' was not included into executable` | Puller sidecar must inline inject/bridge via `pnpm embed-assets` before `pkg` (see `puller/scripts/embed-assets.mjs`). |
| Flatpak Unity download | Error path under repo `static/games/…` | Host puller on `:18787` stole traffic. Stop `pnpm dev` / local puller, or use a build with `get_puller_base_url` port isolation. |

## Manual web-only deploy

Push to `main` (or run `.github/workflows/pages.yml` / `deploy.yml` via **workflow_dispatch**). Prefer `pages.yml` — it preserves `/flatpak/`.

## Local Flatpak build

Requires Flathub and GNOME 50 runtime/SDK for packaging. AppIndicator is built from the
`flatpak/shared-modules` submodule (required — GNOME Platform does not ship it):

```bash
git submodule update --init --recursive
flatpak install -y flathub org.gnome.Platform//50 org.gnome.Sdk//50
pnpm puller:bundle:linux
pnpm tauri:build:flatpak
pnpm flatpak:build    # package only
pnpm flatpak:install  # package + install to user
pnpm flatpak:run      # run installed app
```

CI caches the Rust `src-tauri` target via `Swatinem/rust-cache`, pnpm packages, Flatpak runtimes,
Flatpak builder state, and ccache. Subsequent workflow runs skip most crate recompilation and
avoid rebuilding the GNOME runtime and app-indicator module from scratch. Routine CI publishes
the OSTree without static deltas; the GitHub Release `.flatpak` bundle remains available for
single-file installation.

## Tauri binary (without Flatpak)

```bash
pnpm tauri:build
# Output: src-tauri/target/release/potato-tomato
```
