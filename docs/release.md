# Release & Flatpak remote

## Automated immutable release

Workflow: `.github/workflows/release.yml`

Every merge to `main` starts one coordinator run. It derives the next version from the
existing `release-<number>` tags (`0.0.<number>`), creates that immutable tag at the
merged commit, and uses it as the release identity. A manual dispatch follows the
same calculation; versions are never hardcoded in the workflow.

`Release preparation` is the central workflow. It calculates the version, creates or
resumes one draft GitHub Release, compiles the shared web and puller outputs, and
publishes an immutable release-context artifact containing the generated tag and SHA.

`Publish Linux Flatpak` and `Publish Android APK` start independently after preparation succeeds. Each downloads that context, checks out the exact SHA, stamps the same version into its platform build, and attaches only its own versioned asset to the already-created release. Platform workflows never query `latest`, so concurrent releases cannot mix artifacts.

Pages deployment runs asynchronously after release preparation and after Linux Flatpak publication. Every Pages deploy tries to keep a Flatpak OSTree: Flatpak-triggered runs use that run’s artifact, while prep/manual deploys fall back to the matching or latest successful `flatpak-bundle` so web-only publishes cannot wipe the remote.

Android is currently gated on generated Tauri Android sources. Run `pnpm tauri android init` after installing the Android SDK, then configure signing secrets before enabling APK publication. Android is a direct signed APK download with manual updates; it has no update remote.

APK packaging stays under the ZIP32 65535-entry limit via `SKIP_PAGES_GAME_FALLBACKS` and `scripts/slim-android-assets.mjs` (see `tauri.android.conf.json`).

### Android signing

Release 0.0.72 published `app-universal-release-unsigned.apk`. Android refuses to install
an unsigned package (`INSTALL_PARSE_FAILED_NO_CERTIFICATES`), so the download never
launched while the build stayed green. `Publish Android APK` now fails outright when the
keystore secrets are absent, picks the signed artefact by name, and runs `apksigner
verify` before uploading. `scripts/verify-android-apk.mjs` does the same check locally.

Generate the upload keystore once and keep it — an APK signed with a different key cannot
upgrade an installed app, only replace it after an uninstall:

```bash
keytool -genkeypair -v -keystore potato-tomato-release.jks -keyalg RSA -keysize 4096 \
  -validity 10000 -alias potato-tomato
base64 -w0 potato-tomato-release.jks
```

Store the output in repository secrets: `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. CI writes them
to `src-tauri/gen/android/key.properties` (gitignored) and deletes both the file and the
keystore in an `always()` step.

Without `key.properties` the release variant falls back to the debug key so local device
testing still installs. Those APKs are for testing only — CI never produces one because
the missing-secret check fails the job first.

R8 stays off for the release variant. `proguardFiles(fileTree(...))` is evaluated at
configuration time, before `tauri-build` writes `proguard-tauri.pro`, so a clean checkout
shrank away Tauri's JNI and reflection entry points and the app crashed on launch. The
payload is ~600 MB of game assets, so shrinking a few hundred KB of Kotlin buys nothing.
Re-enable only with keep rules committed to `proguard-rules.pro`.

Verify a build before publishing:

```bash
node scripts/verify-android-apk.mjs                      # newest release APK
node scripts/verify-android-apk.mjs dist/potato-tomato-0.0.73.apk
```

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

| Workflow               | Failure                                                              | Fix                                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Release                | `ConfigureRemote not allowed for user`                               | Use `flatpak --user` for remotes and installs on GitHub-hosted runners                                                                                                                                                                                                                                                                           |
| Build Flatpak          | `npm: command not found` in sandbox                                  | Build Tauri on the host in CI; Flatpak manifest only packages prebuilt binaries                                                                                                                                                                                                                                                                  |
| Remote install         | `Invalid gpg key`                                                    | Remove empty `GPGKey=` from `.flatpakrepo`; add remote with `--no-gpg-verify`                                                                                                                                                                                                                                                                    |
| GitHub Pages           | `/flatpak/summary` 404                                               | Usually no successful Release artifact was available to preserve, or Release Pages deploy had not finished yet. `pages.yml` restores OSTree from the latest Release artifact; `release.yml` publishes a fresh one. Verify `https://dixonsolutions.github.io/potatoetomatoe3/flatpak/summary` returns 200 before telling users to use the remote. |
| Remote install         | Prefer one-file bundle                                               | `flatpak install --user` the `.flatpak` from [GitHub Releases](https://github.com/dixonSolutions/potatoetomatoe3/releases/latest) if the OSTree remote is broken                                                                                                                                                                                 |
| Flatpak runtime        | `Game not in catalog` / `puller catalog is empty`                    | Tauri looks for resources at `/app/lib/<productName>/` (`Potato Tomato`). Catalog must be installed there (not only under `potato-tomato`). Check `/api/offline/health` → `catalogGameCount`.                                                                                                                                                    |
| Flatpak run            | `Failed to load ayatana-appindicator3` panic                         | Bundle `shared-modules/libappindicator` in the Flatpak manifest (submodule). Rebuild/reinstall the Flatpak.                                                                                                                                                                                                                                      |
| Flatpak build          | `Package 'libayatana-ido3-0.4' not found`                            | Ayatana cmake installs to `/app/lib64`; use classic `libappindicator-gtk3-12.10.json` instead.                                                                                                                                                                                                                                                   |
| Flatpak Unity download | `File '/**/static/unity/inject.js' was not included into executable` | Puller sidecar must inline inject/bridge via `pnpm embed-assets` before `pkg` (see `puller/scripts/embed-assets.mjs`).                                                                                                                                                                                                                           |
| Flatpak Unity download | Error path under repo `static/games/…`                               | Host puller on `:18787` stole traffic. Stop `pnpm dev` / local puller, or use a build with `get_puller_base_url` port isolation.                                                                                                                                                                                                                 |

## Manual web-only deploy

Run `.github/workflows/pages.yml` via **workflow_dispatch** for a site-only deploy. Production Pages releases are tag/release driven.

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
