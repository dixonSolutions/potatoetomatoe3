//! System tray via StatusNotifierItem (Ayatana AppIndicator / SNI on Linux).
//! Window close hides to tray; Quit exits the app (and puller sidecar).

use std::sync::Mutex;

use serde::Deserialize;
use tauri::{
  AppHandle, Emitter, Manager, Runtime,
  menu::{Menu, MenuItem, PredefinedMenuItem},
  tray::{TrayIconBuilder, TrayIconEvent},
};

pub const TRAY_ID: &str = "potato-tomato-tray";
const RECENT_SLOTS: usize = 5;

#[derive(Debug, Clone, Deserialize)]
pub struct TrayGame {
  pub id: String,
  pub name: String,
}

pub struct TrayMenuState {
  recent_ids: Mutex<[Option<String>; RECENT_SLOTS]>,
  recent_items: [MenuItem<tauri::Wry>; RECENT_SLOTS],
}

fn truncate_label(name: &str, max_chars: usize) -> String {
  let trimmed = name.trim();
  if trimmed.is_empty() {
    return "Untitled game".to_string();
  }
  let count = trimmed.chars().count();
  if count <= max_chars {
    return trimmed.to_string();
  }
  let mut out: String = trimmed.chars().take(max_chars.saturating_sub(1)).collect();
  out.push('…');
  out
}

fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

fn hide_main_window<R: Runtime>(app: &AppHandle<R>) {
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.hide();
  }
}

fn open_game_from_tray<R: Runtime>(app: &AppHandle<R>, game_id: &str) {
  show_main_window(app);
  let _ = app.emit("tray-open-game", game_id);
}

fn open_path_from_tray<R: Runtime>(app: &AppHandle<R>, path: &str) {
  show_main_window(app);
  let _ = app.emit("tray-navigate", path);
}

pub fn build_tray(app: &AppHandle) -> tauri::Result<()> {
  let header = MenuItem::with_id(app, "tray-header", "Potato Tomato", false, None::<&str>)?;
  let recent_label =
    MenuItem::with_id(app, "tray-recent-label", "Recent games", false, None::<&str>)?;

  let recent_items: [MenuItem<tauri::Wry>; RECENT_SLOTS] = [
    MenuItem::with_id(app, "recent-0", "No recent games", false, None::<&str>)?,
    MenuItem::with_id(app, "recent-1", "—", false, None::<&str>)?,
    MenuItem::with_id(app, "recent-2", "—", false, None::<&str>)?,
    MenuItem::with_id(app, "recent-3", "—", false, None::<&str>)?,
    MenuItem::with_id(app, "recent-4", "—", false, None::<&str>)?,
  ];

  let sep1 = PredefinedMenuItem::separator(app)?;
  let sep2 = PredefinedMenuItem::separator(app)?;
  let sep3 = PredefinedMenuItem::separator(app)?;

  let show = MenuItem::with_id(app, "show", "Show window", true, None::<&str>)?;
  let hide = MenuItem::with_id(app, "hide", "Close window", true, None::<&str>)?;
  let home = MenuItem::with_id(app, "home", "Home", true, None::<&str>)?;
  let quit = MenuItem::with_id(app, "quit", "Quit Potato Tomato", true, None::<&str>)?;

  let menu = Menu::with_items(
    app,
    &[
      &header,
      &sep1,
      &recent_label,
      &recent_items[0],
      &recent_items[1],
      &recent_items[2],
      &recent_items[3],
      &recent_items[4],
      &sep2,
      &show,
      &hide,
      &home,
      &sep3,
      &quit,
    ],
  )?;

  app.manage(TrayMenuState {
    recent_ids: Mutex::new(std::array::from_fn(|_| None)),
    recent_items: recent_items.clone(),
  });

  let icon = app
    .default_window_icon()
    .cloned()
    .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".into()))?;

  let mut builder = TrayIconBuilder::with_id(TRAY_ID)
    .icon(icon)
    .tooltip("Potato Tomato")
    .menu(&menu)
    .show_menu_on_left_click(true)
    .on_menu_event(|app, event| {
      let id = event.id().as_ref();
      match id {
        "show" => show_main_window(app),
        "hide" => hide_main_window(app),
        "home" => open_path_from_tray(app, "/home"),
        "quit" => app.exit(0),
        _ => {
          if let Some(slot) = id.strip_prefix("recent-") {
            if let Ok(index) = slot.parse::<usize>() {
              if let Some(state) = app.try_state::<TrayMenuState>() {
                if let Ok(ids) = state.recent_ids.lock() {
                  if let Some(Some(game_id)) = ids.get(index) {
                    open_game_from_tray(app, game_id);
                  }
                }
              }
            }
          }
        }
      }
    })
    .on_tray_icon_event(|tray, event| {
      // Linux SNI often does not emit click events; menu is the primary UX.
      if let TrayIconEvent::DoubleClick { .. } = event {
        show_main_window(tray.app_handle());
      }
    });

  #[cfg(target_os = "linux")]
  {
    // Prefer a host-visible path so StatusNotifier can load the icon PNG.
    // Flatpak grants xdg-run/potato-tomato-tray; AppLocalData (~/.var/app/…) is
    // also host-readable when XDG_RUNTIME_DIR is private to the sandbox.
    let tray_dir = app
      .path()
      .app_local_data_dir()
      .ok()
      .map(|d| d.join("tray-icon"))
      .or_else(|| {
        std::env::var_os("XDG_RUNTIME_DIR").filter(|v| !v.is_empty()).map(|runtime| {
          std::path::PathBuf::from(runtime).join("potato-tomato-tray")
        })
      });
    if let Some(dir) = tray_dir {
      let _ = std::fs::create_dir_all(&dir);
      builder = builder.temp_dir_path(dir);
    }
  }

  let _tray = builder.build(app)?;
  Ok(())
}

#[tauri::command]
pub fn sync_tray_recent(app: AppHandle, games: Vec<TrayGame>) -> Result<(), String> {
  let state = app
    .try_state::<TrayMenuState>()
    .ok_or_else(|| "Tray not initialized".to_string())?;

  let mut ids = state
    .recent_ids
    .lock()
    .map_err(|_| "Tray state lock poisoned".to_string())?;

  for i in 0..RECENT_SLOTS {
    let item = &state.recent_items[i];
    if let Some(game) = games.get(i) {
      ids[i] = Some(game.id.clone());
      let label = truncate_label(&game.name, 40);
      item
        .set_text(label)
        .map_err(|e| e.to_string())?;
      item.set_enabled(true).map_err(|e| e.to_string())?;
    } else {
      ids[i] = None;
      if i == 0 && games.is_empty() {
        item
          .set_text("No recent games")
          .map_err(|e| e.to_string())?;
      } else {
        item.set_text("—").map_err(|e| e.to_string())?;
      }
      item.set_enabled(false).map_err(|e| e.to_string())?;
    }
  }

  Ok(())
}
