# Release & Flatpak remote

## Automated release (main branch)

Workflow: `.github/workflows/release.yml`

On every push to `main`:

1. **Version bump** — `0.0.<run_number>` written to `package.json`, `tauri.conf.json`, `Cargo.toml`, `version.txt`
2. **Puller sidecar** — `pnpm puller:bundle:linux`
3. **Flatpak build** — `flatpak-builder` using `flatpak/com.potatotomato.games.yml` (GNOME 50 + Freedesktop SDK extensions)
4. **GitHub Release** — attaches `com.potatotomato.games-<version>.flatpak`
5. **GitHub Pages** — deploys web build + OSTree repo at `/flatpak/` + `.flatpakrepo` file

The standalone **Deploy GitHub Pages** workflow (`.github/workflows/pages.yml`) is manual-only so it does not race with the release deploy.

## Public Flatpak remote

After a successful release:

```bash
flatpak remote-add --user --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
flatpak remote-add --user --if-not-exists potatotomato \
  https://dixonsolutions.github.io/potatoetomatoe3/potatotomato.flatpakrepo
flatpak install --user potatotomato com.potatotomato.games
flatpak run com.potatotomato.games
```

The `.flatpakrepo` file lives in `static/potatotomato.flatpakrepo` and must use the `[Flatpak Repo]` section header (not `[Flatpak]`).

## Previous CI failures (fixed)

| Workflow | Failure | Fix |
| -------- | ------- | --- |
| Release | `ConfigureRemote not allowed for user` | Use `flatpak --user` for remotes and installs on GitHub-hosted runners |
| Build Flatpak | Malformed extension ref `…/50` | Use `version: '25.08'` under each sdk-extension in the manifest (not `//25.08` in the id) |
| Remote install | `Missing group 'Flatpak Repo'` | Corrected `.flatpakrepo` INI section header |
| GitHub Pages | `/flatpak/summary` 404 | Release workflow now copies the OSTree `repo/` into `build/flatpak/` before Pages deploy |

## Manual web-only deploy

Use `.github/workflows/pages.yml` or `.github/workflows/deploy.yml` via **workflow_dispatch**.

## Local Flatpak build

Requires Flathub and GNOME 50 runtimes:

```bash
flatpak install -y flathub org.gnome.Platform//50 org.gnome.Sdk//50 \
  org.freedesktop.Sdk.Extension.node22//25.08 \
  org.freedesktop.Sdk.Extension.rust-stable//25.08
pnpm puller:bundle:linux
pnpm flatpak:build    # build only
pnpm flatpak:install  # build + install to user
pnpm flatpak:run      # run installed app
```

## Tauri binary (without Flatpak)

```bash
pnpm tauri:build
# Output: src-tauri/target/release/potato-tomato
```
