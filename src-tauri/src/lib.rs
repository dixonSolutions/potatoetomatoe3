#[cfg(desktop)]
mod tray;

#[cfg(mobile)]
mod tray {
  #[tauri::command]
  pub fn sync_tray_recent() {}
}

use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use tauri::Manager;
use tauri::path::BaseDirectory;

static PULLER_PORT: OnceLock<u16> = OnceLock::new();
static TRAY_AVAILABLE: AtomicBool = AtomicBool::new(false);
/** When false, window close quits the app (GNOME/Silverblue without a visible tray). */
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(false);

const DEFAULT_PULLER_PORT: u16 = 18787;

/// Prefer 18787; if occupied (e.g. host `pnpm dev` while Flatpak runs), pick the next free port.
fn reserve_puller_port() -> u16 {
  *PULLER_PORT.get_or_init(|| {
    for port in DEFAULT_PULLER_PORT..DEFAULT_PULLER_PORT + 32 {
      if TcpListener::bind(("127.0.0.1", port)).is_ok() {
        return port;
      }
    }
    DEFAULT_PULLER_PORT
  })
}

pub fn puller_port() -> u16 {
  reserve_puller_port()
}

/// GNOME Shell does not show SNI tray icons without an extension (common on Fedora Silverblue).
fn is_gnome_desktop() -> bool {
  let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default();
  desktop
    .split(':')
    .any(|part| part.eq_ignore_ascii_case("gnome"))
}

fn compute_close_to_tray(tray_ok: bool) -> bool {
  if !tray_ok {
    return false;
  }
  if std::env::var_os("POTATO_TOMATO_CLOSE_TO_TRAY").is_some() {
    return true;
  }
  if std::env::var_os("POTATO_TOMATO_NO_CLOSE_TO_TRAY").is_some() {
    return false;
  }
  /* Invisible tray + hide-on-close = stranded background process on Silverblue. */
  !is_gnome_desktop()
}

#[tauri::command]
fn get_puller_base_url() -> String {
  format!("http://127.0.0.1:{}", puller_port())
}

#[tauri::command]
fn is_tray_available() -> bool {
  TRAY_AVAILABLE.load(Ordering::SeqCst)
}

#[tauri::command]
fn is_close_to_tray_enabled() -> bool {
  CLOSE_TO_TRAY.load(Ordering::SeqCst)
}

#[tauri::command]
fn set_close_to_tray_enabled(enabled: bool) -> bool {
  let tray_ok = TRAY_AVAILABLE.load(Ordering::SeqCst);
  let next = enabled && tray_ok;
  CLOSE_TO_TRAY.store(next, Ordering::SeqCst);
  next
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
  app.exit(0);
}

fn repo_root() -> PathBuf {
  PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn games_data_dir(app: &tauri::AppHandle) -> PathBuf {
  if cfg!(debug_assertions) {
    repo_root().join("static/games")
  } else if let Ok(dir) = app.path().app_data_dir() {
    let games = dir.join("games");
    let _ = std::fs::create_dir_all(&games);
    games
  } else {
    repo_root().join("static/games")
  }
}

/// Candidate resource roots next to the executable (`../lib/<name>/catalog/games`).
/// Tauri's PackageInfo.name is `productName` ("Potato Tomato"); Flatpak may also
/// expose the crate-style `potato-tomato` alias.
fn catalog_dir_beside_exe() -> Option<PathBuf> {
  let exe = std::env::current_exe().ok()?;
  let exe_dir = exe.parent()?;
  for name in ["Potato Tomato", "potato-tomato"] {
    let candidate = exe_dir.join("../lib").join(name).join("catalog/games");
    if let Ok(canonical) = candidate.canonicalize() {
      if canonical.is_dir() {
        return Some(canonical);
      }
    }
  }
  None
}

fn catalog_dir(app: &tauri::AppHandle) -> PathBuf {
  if cfg!(debug_assertions) {
    return repo_root().join("static/games");
  }

  // Prefer the bundled Resource tree (catalog/games from tauri.conf.json).
  if let Ok(path) = app.path().resolve("catalog/games", BaseDirectory::Resource) {
    if path.exists() {
      return path;
    }
    log::warn!(
      "Tauri Resource catalog missing at {} — trying exe-adjacent lib paths",
      path.display()
    );
  }

  if let Some(beside) = catalog_dir_beside_exe() {
    log::info!("using exe-adjacent catalog at {}", beside.display());
    return beside;
  }

  // Secondary: older list-style resource layout under _up_/build/games.
  if let Ok(resource) = app.path().resource_dir() {
    let build_games = resource.join("_up_").join("build").join("games");
    if build_games.exists() {
      return build_games;
    }
    let expected = resource.join("catalog").join("games");
    log::error!(
      "could not resolve catalog/games under resource dir {} — offline downloads will fail",
      resource.display()
    );
    return expected;
  }

  log::error!("resource_dir unavailable — cannot resolve catalog for offline puller");
  PathBuf::from("/nonexistent/potato-tomato-catalog")
}

fn puller_env(app: &tauri::AppHandle) -> (PathBuf, PathBuf, u16) {
  (
    games_data_dir(app),
    catalog_dir(app),
    puller_port(),
  )
}

fn spawn_with_env(
  mut command: std::process::Command,
  games_dir: &Path,
  catalog_dir: &Path,
  port: u16,
) -> Result<(), String> {
  command
    .env("GAMES_DATA_DIR", games_dir)
    .env("CATALOG_DIR", catalog_dir)
    .env("PULLER_PORT", port.to_string());

  command
    .spawn()
    .map(|_| {
      log::info!(
        "puller started on port {} (data={}, catalog={})",
        port,
        games_dir.display(),
        catalog_dir.display()
      );
    })
    .map_err(|e| e.to_string())
}

fn spawn_puller_sidecar(
  app: &tauri::AppHandle,
  games_dir: &Path,
  catalog_dir: &Path,
  port: u16,
) -> Result<(), String> {
  use tauri_plugin_shell::ShellExt;

  let sidecar = app
    .shell()
    .sidecar("puller-sidecar")
    .map_err(|e| e.to_string())?
    .env("GAMES_DATA_DIR", games_dir)
    .env("CATALOG_DIR", catalog_dir)
    .env("PULLER_PORT", port.to_string());

  sidecar
    .spawn()
    .map(|_| {
      log::info!("puller sidecar spawned on port {}", port);
    })
    .map_err(|e| e.to_string())
}

fn spawn_puller_node_bundle(
  app: &tauri::AppHandle,
  games_dir: &Path,
  catalog_dir: &Path,
  port: u16,
) -> Result<(), String> {
  let script = app
    .path()
    .resolve("puller/index.js", BaseDirectory::Resource)
    .map_err(|e| e.to_string())?;

  if !script.exists() {
    return Err(format!("bundled puller script missing: {}", script.display()));
  }

  let mut cmd = std::process::Command::new("node");
  cmd.arg(&script);
  spawn_with_env(cmd, games_dir, catalog_dir, port)
}

fn spawn_puller_dev(
  games_dir: &Path,
  catalog_dir: &Path,
  port: u16,
) -> Result<(), String> {
  let puller_entry = repo_root().join("puller/src/index.ts");
  if !puller_entry.exists() {
    return Err(format!("dev puller entry missing: {}", puller_entry.display()));
  }

  let mut cmd = std::process::Command::new("pnpm");
  cmd.args(["exec", "tsx", "puller/src/index.ts"]).current_dir(repo_root());
  spawn_with_env(cmd, games_dir, catalog_dir, port)
}

fn spawn_puller(app: &tauri::AppHandle) {
  let (games_dir, catalog_dir, port) = puller_env(app);

  if spawn_puller_sidecar(app, &games_dir, &catalog_dir, port).is_ok() {
    return;
  }

  if spawn_puller_node_bundle(app, &games_dir, &catalog_dir, port).is_ok() {
    return;
  }

  if cfg!(debug_assertions) {
    if let Err(e) = spawn_puller_dev(&games_dir, &catalog_dir, port) {
      log::warn!("puller unavailable: {e}");
    }
    return;
  }

  log::warn!("puller could not be started — offline download disabled");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![
      tray::sync_tray_recent,
      get_puller_base_url,
      is_tray_available,
      is_close_to_tray_enabled,
      set_close_to_tray_enabled,
      quit_app
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // Reserve port before spawn so get_puller_base_url matches the sidecar.
      let _ = puller_port();
      #[cfg(not(mobile))]
      spawn_puller(app.handle());
      #[cfg(mobile)]
      log::info!("mobile build: puller capture sidecar is intentionally disabled");
      // libappindicator-sys panics (does not return Err) when the .so is missing
      // — e.g. Flatpak without shared-modules ayatana. Catch so the app still runs.
      #[cfg(not(mobile))]
      let tray_ok = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        tray::build_tray(app.handle())
      })) {
        Ok(Ok(())) => true,
        Ok(Err(e)) => {
          log::warn!("system tray unavailable: {e}");
          false
        }
        Err(_) => {
          log::warn!(
            "system tray unavailable: appindicator library missing or panic during init"
          );
          false
        }
      };
      #[cfg(mobile)]
      let tray_ok = false;
      TRAY_AVAILABLE.store(tray_ok, Ordering::SeqCst);
      let close_to_tray = compute_close_to_tray(tray_ok);
      CLOSE_TO_TRAY.store(close_to_tray, Ordering::SeqCst);
      if tray_ok && !close_to_tray {
        log::info!(
          "tray registered but close-to-tray disabled (GNOME/Silverblue — closing the window will quit)"
        );
      } else if !tray_ok {
        log::info!("no system tray — closing the window will quit the app");
      }
      Ok(())
    })
    .on_window_event(|window, event| {
      #[cfg(desktop)]
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        if CLOSE_TO_TRAY.load(Ordering::SeqCst) {
          // Keep puller + tray alive; Quit from the tray exits for real.
          let _ = window.hide();
          api.prevent_close();
        } else {
          // No usable tray (common on Fedora Silverblue / stock GNOME): quit fully.
          api.prevent_close();
          window.app_handle().exit(0);
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
