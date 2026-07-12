# Desktop system tray (StatusNotifierItem)

Potato Tomato’s Tauri desktop build registers a **StatusNotifierItem** (SNI) tray icon via AppIndicator. On Linux this is the de facto tray protocol (KDE/XFCE native; **stock GNOME / Fedora Silverblue need an AppIndicator extension** or the icon will not appear).

## Behavior

| Action | Result |
|--------|--------|
| Window close (✕) when **close-to-tray is on** | Hides the window; app + puller stay running in the tray |
| Window close (✕) when **close-to-tray is off** (default on GNOME) | Fully quits the app (stops puller) |
| Top bar **Quit** | Always exits the process |
| Tray → **Show window** | Shows and focuses the main window |
| Tray → **Close window** | Hides the window (same as ✕ with close-to-tray) |
| Tray → **Home** | Shows window and navigates to `/home` |
| Tray → recent game | Shows window and opens `/games/{id}` |
| Tray → **Quit Potato Tomato** | Exits the process (stops puller sidecar) |

Defaults:

- Tray registered **and** not GNOME → close-to-tray **on**
- Tray missing, or GNOME/Silverblue → close-to-tray **off** (so ✕ does not leave a stranded background process)
- Override with env: `POTATO_TOMATO_CLOSE_TO_TRAY=1` or `POTATO_TOMATO_NO_CLOSE_TO_TRAY=1`
- Toggle anytime in **Settings → Games → Keep running in tray when closing**

## Fedora Silverblue / GNOME

Silverblue uses GNOME Shell, which does **not** show legacy tray icons without an extension (e.g. **AppIndicator and KStatusNotifierItem Support**).

Without that extension:

1. Closing the window used to hide the app with no visible tray → looks like a leaky background process.
2. Current builds **quit on close** on GNOME by default and expose **Quit** in the top bar.

To use close-to-tray on Silverblue:

1. Install an AppIndicator / KStatusNotifierItem GNOME extension.
2. Enable **Keep running in tray when closing** in Settings → Games.

Kill a stuck old build:

```bash
flatpak kill com.potatotomato.games
# or
pkill -f potato-tomato
```

## Recent games

The frontend syncs the **top five** entries from play analytics (`potato-tomato-play-analytics`) into the tray menu via `sync_tray_recent`. Disliked games are omitted. Sync runs on:

- App startup (desktop layout mount)
- Window focus
- Each `recordGamePlay()` call

On Linux the tray menu is created once and **mutated in place** (SNI/AppIndicator cannot replace the menu after registration).

## Dependencies

Linux build/runtime needs AppIndicator (already in project CI):

```bash
sudo apt install libayatana-appindicator3-dev
```

## Flatpak

The Flatpak runtime does **not** ship AppIndicator. The manifest builds classic
`libappindicator` from Flathub [shared-modules](https://github.com/flathub/shared-modules)
(`flatpak/shared-modules` git submodule) and talks to:

- `org.kde.StatusNotifierWatcher`
- `com.canonical.AppMenu.Registrar`
- `com.canonical.indicator.application`

Also grants `--socket=pulseaudio` for game audio in WebKitGTK.

Tray icon PNGs are written under app local data (or `$XDG_RUNTIME_DIR/potato-tomato-tray`
with `--filesystem=xdg-run/potato-tomato-tray:create`) so the host StatusNotifier can read them.

After clone, initialize the submodule once:

```bash
git submodule update --init --recursive
```

## Code map

| Path | Role |
|------|------|
| `src-tauri/src/tray.rs` | Tray icon, menu, `sync_tray_recent` command |
| `src-tauri/src/lib.rs` | Setup, tray flags, conditional hide-on-close / quit |
| `src/lib/utils/desktop-tray.ts` | Frontend sync + tray lifecycle + Quit |
| `src-tauri/permissions/tray.toml` | ACL for tray / quit commands |
