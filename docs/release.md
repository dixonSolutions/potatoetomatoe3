# Release & Flatpak remote

## Automated release (main branch)

Workflow: `.github/workflows/release.yml`

On every push to `main`:

1. **Version bump** — `0.0.<run_number>` written to `package.json`, `tauri.conf.json`, `Cargo.toml`, `version.txt`
2. **Flatpak build** — `flatpak-builder` using `flatpak/com.potatotomato.games.yml`
3. **Puller sidecar** — `pnpm puller:bundle:linux` (optional; continues on failure)
4. **GitHub Release** — attaches `com.potatotomato.games-<version>.flatpak`
5. **GitHub Pages** — deploys web build + OSTree repo at `/flatpak/` + `.flatpakrepo` file

## Public Flatpak remote

After a successful release, users can add the remote:

```bash
flatpak remote-add --if-not-exists potatotomato \
  https://dixonsolutions.github.io/potatoetomatoe3/potatotomato.flatpakrepo
flatpak install potatotomato com.potatotomato.games
```

The `.flatpakrepo` file is copied from `static/potatotomato.flatpakrepo` during CI.

## Manual web-only deploy

Use `.github/workflows/deploy.yml` via **workflow_dispatch** for a GitHub Pages deploy without Flatpak/release steps.

## Local Flatpak build

```bash
pnpm flatpak:build    # build only
pnpm flatpak:install  # build + install to user
pnpm flatpak:run      # run installed app
```

## Tauri binary (without Flatpak)

```bash
pnpm tauri:build
# Output: src-tauri/target/release/potato-tomato
```
