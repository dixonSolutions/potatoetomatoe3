# Release & Flatpak remote

## Automated release (main branch)

Workflow: `.github/workflows/release.yml`

On every push to `main`:

1. **Version bump** — `0.0.<run_number>` written to `package.json`, `tauri.conf.json`, `Cargo.toml`, `version.txt`
2. **Puller sidecar** — `pnpm puller:bundle:linux`
3. **Flatpak build** — packages prebuilt Tauri binary + puller sidecar via `flatpak/com.potatotomato.games.yml`
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
| Build Flatpak | `npm: command not found` in sandbox | Build Tauri on the host in CI; Flatpak manifest only packages prebuilt binaries |
| Remote install | `Invalid gpg key` | Remove empty `GPGKey=` from `.flatpakrepo`; add remote with `--no-gpg-verify` |
| GitHub Pages | `/flatpak/summary` 404 | Release workflow now copies the OSTree `repo/` into `build/flatpak/` before Pages deploy |

## Manual web-only deploy

Use `.github/workflows/pages.yml` or `.github/workflows/deploy.yml` via **workflow_dispatch**.

## Local Flatpak build

Requires Flathub and GNOME 50 runtime/SDK for packaging:

```bash
flatpak install -y flathub org.gnome.Platform//50 org.gnome.Sdk//50
pnpm puller:bundle:linux
pnpm tauri:build:flatpak
pnpm flatpak:build    # package only
pnpm flatpak:install  # package + install to user
pnpm flatpak:run      # run installed app
```

## Tauri binary (without Flatpak)

```bash
pnpm tauri:build
# Output: src-tauri/target/release/potato-tomato
```
