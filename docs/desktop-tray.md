# Desktop system tray (StatusNotifierItem)

Potato Tomato’s Tauri desktop build registers a **StatusNotifierItem** (SNI) tray icon via Ayatana AppIndicator. On Linux this is the de facto tray protocol (KDE/XFCE native; GNOME needs an AppIndicator / KStatusNotifierItem extension).

## Behavior

| Action | Result |
|--------|--------|
| Window close (✕) | Hides the window; app + puller stay running in the tray |
| Tray → **Show window** | Shows and focuses the main window |
| Tray → **Close window** | Hides the window (same as ✕) |
| Tray → **Home** | Shows window and navigates to `/home` |
| Tray → recent game | Shows window and opens `/games/{id}` |
| Tray → **Quit Potato Tomato** | Exits the process (stops puller sidecar) |

The tray uses the same Potato Tomato app icon as the window (`default_window_icon` / bundled icons).

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

Tray icon PNGs are written under app local data (or `$XDG_RUNTIME_DIR/potato-tomato-tray`
with `--filesystem=xdg-run/potato-tomato-tray:create`) so the host StatusNotifier can read them.

After clone, initialize the submodule once:

```bash
git submodule update --init --recursive
```

GNOME users still need a tray extension (e.g. AppIndicator and KStatusNotifierItem Support).

If AppIndicator is still missing at runtime, tray init is caught and the windowed app continues
(close-to-tray will hide without a quit path from the notification area).

## Code map

| Path | Role |
|------|------|
| `src-tauri/src/tray.rs` | Tray icon, menu, `sync_tray_recent` command |
| `src-tauri/src/lib.rs` | Setup + hide-on-close |
| `src/lib/utils/desktop-tray.ts` | Frontend sync + tray navigation listeners |
| `src-tauri/permissions/tray.toml` | ACL for `sync_tray_recent` |
