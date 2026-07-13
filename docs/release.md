# Release & Flatpak remote

## Automated release (main branch)

Workflow: `.github/workflows/release.yml`

On every push to `main`:

1. **Version bump** — `0.0.<run_number>` written to `package.json`, `tauri.conf.json`, `Cargo.toml`, `version.txt`
2. **Puller sidecar** — `pnpm puller:bundle:linux`
3. **Flatpak build** — packages prebuilt Tauri binary + puller sidecar via `flatpak/com.potatotomato.games.yml`
4. **GitHub Release** — attaches `com.potatotomato.games-<version>.flatpak`
5. **GitHub Pages** — deploys web build + OSTree repo at `/flatpak/` + `.flatpakrepo` file

The standalone **Deploy GitHub Pages** workflow (`.github/workflows/pages.yml`) runs on every `push` to `main` (and `workflow_dispatch`) for fast web updates, separate from the Flatpak Release. Before uploading it **mirrors the live `/flatpak/` OSTree** into the new artifact so web-only deploys do not wipe remote Flatpak installs. `release.yml` still rebuilds Pages with a freshly built OSTree when a Release finishes.

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
| GitHub Pages | `/flatpak/summary` 404 | Usually a Pages deploy raced before any OSTree existed, or the preserve-mirror step failed. `pages.yml` should copy live `/flatpak/`; `release.yml` publishes a fresh OSTree. Verify `https://dixonsolutions.github.io/potatoetomatoe3/flatpak/summary` returns 200 before telling users to use the remote. |
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

CI caches the Rust `src-tauri` target via `Swatinem/rust-cache` so subsequent workflow runs
skip most crate recompilation.

## Tauri binary (without Flatpak)

```bash
pnpm tauri:build
# Output: src-tauri/target/release/potato-tomato
```
