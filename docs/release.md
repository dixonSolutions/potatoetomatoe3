# Release & Flatpak remote

## Automated release (main branch)

Workflow: `.github/workflows/release.yml`

On every push to `main`:

1. **Version bump** — `0.0.<run_number>` written to `package.json`, `tauri.conf.json`, `Cargo.toml`, `version.txt`
2. **Puller sidecar** — `pnpm puller:bundle:linux`
3. **Flatpak build** — packages prebuilt Tauri binary + puller sidecar via `flatpak/com.potatotomato.games.yml`
4. **GitHub Release** — attaches `com.potatotomato.games-<version>.flatpak`
5. **GitHub Pages** — deploys web build + OSTree repo at `/flatpak/` + `.flatpakrepo` file

The standalone **Deploy GitHub Pages** workflow (`.github/workflows/pages.yml`) is **workflow_dispatch only**. It must not run on `push` to `main`: a web-only Pages deploy overwrites the site and drops `/flatpak/`, which breaks remote Flatpak installs (`server has no summary file`).

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
| GitHub Pages | `/flatpak/summary` 404 | Usually a web-only `pages.yml` deploy wiped the OSTree tree, or release deploy had not finished yet. Prefer `release.yml` for Pages; keep `pages.yml` manual-only. Verify `https://dixonsolutions.github.io/potatoetomatoe3/flatpak/summary` returns 200 before telling users to use the remote. |
| Remote install | Prefer one-file bundle | `flatpak install --user` the `.flatpak` from [GitHub Releases](https://github.com/dixonSolutions/potatoetomatoe3/releases/latest) if the OSTree remote is broken |

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
