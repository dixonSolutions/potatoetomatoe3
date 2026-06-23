use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::Manager;
use tauri::path::BaseDirectory;

static PULLER_PORT: OnceLock<u16> = OnceLock::new();

pub fn puller_port() -> u16 {
  *PULLER_PORT.get_or_init(|| 18787)
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

fn catalog_dir(app: &tauri::AppHandle) -> PathBuf {
  if cfg!(debug_assertions) {
    return repo_root().join("static/games");
  }

  if let Ok(path) = app.path().resolve("catalog/games", BaseDirectory::Resource) {
    if path.exists() {
      return path;
    }
  }

  // Fallback: bundled frontend dist (same catalog as the webview)
  if let Ok(resource) = app.path().resource_dir() {
    let build_games = resource.join("_up_").join("build").join("games");
    if build_games.exists() {
      return build_games;
    }
  }

  repo_root().join("static/games")
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
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      spawn_puller(app.handle());
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
