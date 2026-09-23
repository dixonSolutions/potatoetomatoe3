//! Full frame rate in power saver, while a game is open (Linux).
//!
//! WebKitGTK halves rendering updates — `requestAnimationFrame` at 30 fps — whenever GLib's
//! power-profile monitor says the system is in power saver, and it asks in the web process.
//! GNOME switches to power saver on its own on low battery, and the engine bench
//! (docs/field-tests/engine-bench-2026-09-23) found every game capped at 30 fps for it.
//!
//! The app ships a small GIO module (`gio/full-speed-power-monitor.c`, built by build.rs and
//! embedded here) that WebKit's web process picks as its power-profile monitor. It wraps
//! GLib's own monitor and reports "not in power saver" only while a flag file exists, which
//! this module creates when a game frame starts and removes when the game page is left
//! (`game_frame_tuning.rs`). Outside games WebKit keeps saving power as before.
//!
//! GIO reads its module path in each process it starts in, so everything is decided once,
//! in [`prepare`], before the first webview exists: write the module to the cache directory
//! if it is missing or different, then point `GIO_EXTRA_MODULES` and
//! `GIO_USE_POWER_PROFILE_MONITOR` at it. The web processes WebKit spawns inherit both.
//! Nothing is bundled or installed, so the Flatpak (whose web processes run in the same
//! sandbox, with the same cache directory) needs nothing extra.
//!
//! Every failure falls back to WebKit's normal behaviour: no module built into this binary,
//! the setting off, a write that fails, or a module GIO cannot load (GIO then warns and uses
//! its own monitor). One more guard: the bench saw one web-process abort in 24 launches with
//! the first version of the module (cause unproven). If the web process crashes twice in a
//! session with the module active, or once within [`EARLY_CRASH`] of startup, the module is
//! turned off for the following launches of this build of it, and the log says so.
//!
//! `POTATO_TOMATO_FULL_SPEED=0` skips the module for one launch, `=1` loads it even when the
//! setting or the crash guard would not.

#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[cfg(target_os = "linux")]
const MODULE: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/libpotato-full-speed.so"));
#[cfg(not(target_os = "linux"))]
const MODULE: &[u8] = &[];

const MODULE_FILE: &str = "libpotato-full-speed.so";
/// The name the module registers its monitor under (see the C source).
const MONITOR_NAME: &str = "potato-full-speed";
/// Tells the module where the "a game is open" flag lives.
const FLAG_ENV: &str = "POTATO_TOMATO_GAME_OPEN_FLAG";
const OVERRIDE_ENV: &str = "POTATO_TOMATO_FULL_SPEED";
/// A crash this soon after startup, with the module active, turns it off by itself.
pub const EARLY_CRASH: Duration = Duration::from_secs(30);
/// Crashes in one session, with the module active, that turn it off.
pub const CRASHES_TO_DISABLE: u32 = 2;

/// Why the module is, or is not, running this session. Shown next to the setting.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FullSpeedStatus {
  /// `active`, `off-setting`, `off-crash`, `off-env`, `unavailable` or `unsupported`.
  pub state: String,
  /// A sentence for the log and for Settings when it is not active.
  pub detail: Option<String>,
}

/// The setting as the frontend last reported it; read at the next startup.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Prefs {
  full_speed_in_power_saver: bool,
}

impl Default for Prefs {
  fn default() -> Self {
    Prefs {
      full_speed_in_power_saver: true,
    }
  }
}

/// Written when the crash guard turns the module off.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct Disabled {
  /// Hash of the module build that crashed: a new build is tried again.
  module: String,
  reason: String,
  at: u64,
}

struct Session {
  status: FullSpeedStatus,
  started: Instant,
  /// `<cache>/<identifier>/webkit-tuning`, when there is a cache directory.
  tuning_dir: Option<PathBuf>,
  /// The flag file, when the module is active.
  flag: Option<PathBuf>,
  module_hash: String,
  crashes: u32,
  game_open: bool,
  /// Web processes whose status line was already logged.
  logged_web: Vec<String>,
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);
/// Lines from before the logger exists (`prepare` runs before Tauri starts).
static EARLY_LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn note(line: String) {
  let line = format!("full frame rate in power saver: {line}");
  if cfg!(debug_assertions) {
    eprintln!("{line}");
  }
  if let Ok(mut early) = EARLY_LOG.lock() {
    early.push(line);
  }
}

/// Replay what [`prepare`] logged, once the log plugin is installed.
pub fn flush_early_log() {
  if let Ok(mut early) = EARLY_LOG.lock() {
    for line in early.drain(..) {
      log::info!("{line}");
    }
  }
}

/// FNV-1a: names the module build in paths and in the crash record.
fn module_hash(bytes: &[u8]) -> String {
  let mut h: u64 = 0xcbf2_9ce4_8422_2325;
  for b in bytes {
    h ^= u64::from(*b);
    h = h.wrapping_mul(0x0100_0000_01b3);
  }
  format!("{h:016x}")
}

fn now_ms() -> u64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis() as u64)
    .unwrap_or(0)
}

/// The same directory Tauri's `app_cache_dir` resolves to, without a running app.
fn cache_dir(identifier: &str) -> Option<PathBuf> {
  let base = std::env::var_os("XDG_CACHE_HOME")
    .map(PathBuf::from)
    .filter(|p| p.is_absolute())
    .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".cache")))?;
  Some(base.join(identifier))
}

/// Per-launch directory for the flag, created: under the runtime directory (tmpfs, so a
/// crashed session cannot leave it behind across a reboot), else under the cache directory.
fn create_run_dir(identifier: &str, tuning_dir: &Path) -> Result<PathBuf, String> {
  let pid = std::process::id().to_string();
  let runtime = std::env::var_os("XDG_RUNTIME_DIR")
    .map(PathBuf::from)
    .filter(|p| p.is_absolute() && p.is_dir())
    .map(|p| p.join(identifier).join("full-speed").join(&pid));
  let mut last_error = String::new();
  for dir in runtime
    .into_iter()
    .chain([tuning_dir.join("run").join(&pid)])
  {
    match std::fs::create_dir_all(&dir) {
      Ok(()) => return Ok(dir),
      Err(e) => last_error = format!("could not create {}: {e}", dir.display()),
    }
  }
  Err(last_error)
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
  serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// Write via a temporary file and a rename, so no reader ever sees half a file — least of
/// all a web process of another running instance mapping the module.
fn write_atomic(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
  let dir = path
    .parent()
    .ok_or_else(|| std::io::Error::other("no parent"))?;
  std::fs::create_dir_all(dir)?;
  let tmp = dir.join(format!(
    ".{}.{}.tmp",
    path.file_name().and_then(|n| n.to_str()).unwrap_or("file"),
    std::process::id()
  ));
  std::fs::write(&tmp, bytes)?;
  std::fs::rename(&tmp, path).inspect_err(|_| {
    let _ = std::fs::remove_file(&tmp);
  })
}

/// Whether to load the module this launch, and if not, why.
fn decide(
  override_env: Option<&str>,
  module_built: bool,
  prefs: Prefs,
  disabled: Option<&Disabled>,
  hash: &str,
  monitor_env: Option<&str>,
) -> Result<(), (&'static str, String)> {
  if !module_built {
    return Err((
      "unavailable",
      "this build has no power-profile module (it could not be compiled)".into(),
    ));
  }
  if let Some(other) = monitor_env.filter(|m| *m != MONITOR_NAME) {
    return Err((
      "off-env",
      format!("GIO_USE_POWER_PROFILE_MONITOR={other} is set, so GIO uses that one"),
    ));
  }
  match override_env.map(str::trim) {
    Some("0") => return Err(("off-env", format!("{OVERRIDE_ENV}=0"))),
    Some("1") => return Ok(()),
    _ => {}
  }
  if !prefs.full_speed_in_power_saver {
    return Err(("off-setting", "turned off in Settings".into()));
  }
  if let Some(d) = disabled.filter(|d| d.module == hash) {
    return Err(("off-crash", d.reason.clone()));
  }
  Ok(())
}

/// `dir` first, then whatever `GIO_EXTRA_MODULES` already held (never clobbered).
fn prepend_path(existing: Option<std::ffi::OsString>, dir: &Path) -> Option<std::ffi::OsString> {
  let mut paths = vec![dir.to_path_buf()];
  if let Some(existing) = existing {
    paths
      .extend(std::env::split_paths(&existing).filter(|p| p != dir && !p.as_os_str().is_empty()));
  }
  std::env::join_paths(paths).ok()
}

/// Remove flag directories of earlier launches that are no longer running.
fn clean_stale_runs(own: &Path) {
  let Some(parent) = own.parent() else { return };
  let Ok(entries) = std::fs::read_dir(parent) else {
    return;
  };
  for entry in entries.flatten() {
    let name = entry.file_name();
    let Some(pid) = name.to_str().and_then(|n| n.parse::<u32>().ok()) else {
      continue;
    };
    if pid != std::process::id() && !Path::new(&format!("/proc/{pid}")).exists() {
      let _ = std::fs::remove_dir_all(entry.path());
    }
  }
}

/// Put the module in place and point GIO at it. Returns the flag path.
fn install(identifier: &str, tuning_dir: &Path, hash: &str) -> Result<PathBuf, String> {
  let gio_dir = tuning_dir.join("gio");
  let module_dir = gio_dir.join(hash);
  let module_path = module_dir.join(MODULE_FILE);
  let current = std::fs::read(&module_path).ok();
  if current.as_deref() != Some(MODULE) {
    write_atomic(&module_path, MODULE)
      .map_err(|e| format!("could not write {}: {e}", module_path.display()))?;
  }
  /* Older builds of the module, left by earlier versions of the app. */
  if let Ok(entries) = std::fs::read_dir(&gio_dir) {
    for entry in entries.flatten() {
      if entry.file_name().to_str() != Some(hash) {
        let _ = std::fs::remove_dir_all(entry.path());
      }
    }
  }

  let run = create_run_dir(identifier, tuning_dir)?;
  clean_stale_runs(&run);
  let flag = run.join("game-open");
  let _ = std::fs::remove_file(&flag);

  let extra = prepend_path(std::env::var_os("GIO_EXTRA_MODULES"), &module_dir)
    .ok_or_else(|| format!("{} cannot go into GIO_EXTRA_MODULES", module_dir.display()))?;
  /*
   * `set_var` is only sound while no other thread reads the environment. This runs first
   * thing in `run()`, before Tauri, GTK or any D-Bus connection has started a thread.
   */
  std::env::set_var("GIO_EXTRA_MODULES", extra);
  std::env::set_var("GIO_USE_POWER_PROFILE_MONITOR", MONITOR_NAME);
  std::env::set_var(FLAG_ENV, &flag);
  Ok(flag)
}

/// Decide and set up the module for this launch. Call before anything starts a thread and
/// before the first webview exists.
pub fn prepare(identifier: &str) {
  let started = Instant::now();
  let hash = module_hash(MODULE);
  /* Only WebKitGTK has this throttle: elsewhere, touch nothing. */
  let tuning_dir = cfg!(target_os = "linux")
    .then(|| cache_dir(identifier).map(|dir| dir.join("webkit-tuning")))
    .flatten();
  let prefs = tuning_dir
    .as_ref()
    .and_then(|dir| read_json::<Prefs>(&dir.join("settings.json")))
    .unwrap_or_default();
  let disabled = tuning_dir
    .as_ref()
    .and_then(|dir| read_json::<Disabled>(&dir.join("disabled-after-crash.json")));
  let monitor_env = std::env::var("GIO_USE_POWER_PROFILE_MONITOR").ok();
  let override_env = std::env::var(OVERRIDE_ENV).ok();

  let mut flag = None;
  let status = if !cfg!(target_os = "linux") {
    FullSpeedStatus {
      state: "unsupported".into(),
      detail: None,
    }
  } else {
    match decide(
      override_env.as_deref(),
      !MODULE.is_empty(),
      prefs,
      disabled.as_ref(),
      &hash,
      monitor_env.as_deref(),
    )
    .and_then(|()| {
      let dir = tuning_dir.as_ref().ok_or((
        "unavailable",
        "no cache directory (HOME is not set)".to_string(),
      ))?;
      install(identifier, dir, &hash).map_err(|why| ("unavailable", why))
    }) {
      Ok(path) => {
        note(format!(
          "module {hash} loaded for WebKit's web processes; flag {}",
          path.display()
        ));
        flag = Some(path);
        FullSpeedStatus {
          state: "active".into(),
          detail: None,
        }
      }
      Err((state, detail)) => {
        note(format!("not in use: {detail}"));
        FullSpeedStatus {
          state: state.into(),
          detail: Some(detail),
        }
      }
    }
  };

  if let Ok(mut session) = SESSION.lock() {
    *session = Some(Session {
      status,
      started,
      tuning_dir,
      flag,
      module_hash: hash,
      crashes: 0,
      game_open: false,
      logged_web: Vec::new(),
    });
  }
}

/// Mirror the setting for the next startup (the setting lives in the page's storage, which
/// nothing can read before the webview exists). Writes only on a change.
pub fn remember_setting(full_speed_in_power_saver: bool) {
  let Some(dir) = SESSION
    .lock()
    .ok()
    .and_then(|s| s.as_ref().and_then(|s| s.tuning_dir.clone()))
  else {
    return;
  };
  let path = dir.join("settings.json");
  let prefs = Prefs {
    full_speed_in_power_saver,
  };
  if read_json::<Prefs>(&path).unwrap_or_default() == prefs && path.exists() {
    return;
  }
  match serde_json::to_vec(&prefs) {
    Ok(bytes) => {
      if let Err(e) = write_atomic(&path, &bytes) {
        log::warn!("full frame rate in power saver: could not save the setting: {e}");
      }
    }
    Err(e) => log::warn!("full frame rate in power saver: {e}"),
  }
}

/// A game is on screen (`true`) or no longer (`false`). With the module active and the
/// setting on, the web process stops following power saver until the game is left.
pub fn set_game_open(open: bool) {
  let Ok(mut guard) = SESSION.lock() else {
    return;
  };
  let Some(session) = guard.as_mut() else {
    return;
  };
  let Some(flag) = session.flag.clone() else {
    return;
  };
  if open == session.game_open {
    return;
  }
  let result = if open {
    std::fs::write(&flag, b"1")
  } else {
    match std::fs::remove_file(&flag) {
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
      other => other,
    }
  };
  match result {
    Ok(()) => {
      session.game_open = open;
      log::info!(
        "full frame rate in power saver: game {}",
        if open {
          "open — full frame rate"
        } else {
          "closed — following the power profile"
        }
      );
    }
    Err(e) => log::warn!(
      "full frame rate in power saver: could not {} {}: {e}",
      if open { "create" } else { "remove" },
      flag.display()
    ),
  }
  if open {
    log_web_processes(session);
  }
}

/// One line per web process the module started in (the module writes them next to the flag).
fn log_web_processes(session: &mut Session) {
  let Some(dir) = session
    .flag
    .as_ref()
    .and_then(|f| f.parent().map(Path::to_path_buf))
  else {
    return;
  };
  let Ok(entries) = std::fs::read_dir(&dir) else {
    return;
  };
  let mut any = !session.logged_web.is_empty();
  for entry in entries.flatten() {
    let name = entry.file_name().to_string_lossy().to_string();
    if !name.starts_with("web-") || session.logged_web.contains(&name) {
      continue;
    }
    any = true;
    if let Ok(line) = std::fs::read_to_string(entry.path()) {
      log::info!(
        "full frame rate in power saver: module running in web process: {}",
        line.trim()
      );
    }
    session.logged_web.push(name);
  }
  if !any {
    log::warn!(
      "full frame rate in power saver: no web process reported the module; WebKit is using \
       GLib's own monitor (games follow power saver)"
    );
  }
}

/// Whether this crash turns the module off for the next launches.
fn crash_disables(crashes: u32, since_start: Duration) -> bool {
  crashes >= CRASHES_TO_DISABLE || since_start < EARLY_CRASH
}

/// Called from the webview's `web-process-terminated` handler (`webview_crash.rs`).
pub fn web_process_terminated(reason: &str) {
  let Ok(mut guard) = SESSION.lock() else {
    return;
  };
  let Some(session) = guard.as_mut() else {
    return;
  };
  /* The page is being reloaded; a new launch sets the flag again. */
  if session.game_open {
    if let Some(flag) = &session.flag {
      let _ = std::fs::remove_file(flag);
    }
    session.game_open = false;
  }
  if session.status.state != "active" || reason != "crashed" {
    return;
  }
  session.crashes += 1;
  let since = session.started.elapsed();
  if !crash_disables(session.crashes, since) {
    log::warn!(
      "full frame rate in power saver: the web process crashed with the module active \
       ({} s after startup, crash {} this session); watching",
      since.as_secs(),
      session.crashes
    );
    return;
  }
  let reason = if session.crashes >= CRASHES_TO_DISABLE {
    format!(
      "turned off after the game engine crashed {} times in one session",
      session.crashes
    )
  } else {
    format!(
      "turned off after the game engine crashed {} s after the app started",
      since.as_secs()
    )
  };
  let record = Disabled {
    module: session.module_hash.clone(),
    reason: reason.clone(),
    at: now_ms(),
  };
  let saved = session
    .tuning_dir
    .as_ref()
    .map(|dir| dir.join("disabled-after-crash.json"))
    .map(|path| {
      serde_json::to_vec(&record)
        .map_err(std::io::Error::other)
        .and_then(|bytes| write_atomic(&path, &bytes))
    });
  let message = match saved {
    Some(Ok(())) => format!("full frame rate in power saver: {reason}; off from the next launch"),
    Some(Err(e)) => format!("full frame rate in power saver: {reason}, but could not save it: {e}"),
    None => format!("full frame rate in power saver: {reason}, but there is no cache directory"),
  };
  log::error!("{message}");
  if !cfg!(debug_assertions) {
    eprintln!("potato-tomato: {message}");
  }
}

/// This session's state, for Settings.
#[tauri::command]
pub fn full_speed_status() -> FullSpeedStatus {
  SESSION
    .lock()
    .ok()
    .and_then(|s| s.as_ref().map(|s| s.status.clone()))
    .unwrap_or(FullSpeedStatus {
      state: "unsupported".into(),
      detail: None,
    })
}

/// Settings changed the switch: remembered for the next startup. Switching it on is also
/// the user's way to try the module again after the crash guard turned it off.
#[tauri::command]
pub fn set_full_speed_setting(enabled: bool) {
  remember_setting(enabled);
  if !enabled {
    return;
  }
  let dir = SESSION
    .lock()
    .ok()
    .and_then(|s| s.as_ref().and_then(|s| s.tuning_dir.clone()));
  if let Some(path) = dir.map(|dir| dir.join("disabled-after-crash.json")) {
    if std::fs::remove_file(&path).is_ok() {
      log::info!("full frame rate in power saver: switched on again; the crash guard is reset");
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  const H: &str = "abc";

  fn on() -> Prefs {
    Prefs::default()
  }

  #[test]
  fn loads_by_default_and_explains_every_refusal() {
    assert_eq!(decide(None, true, on(), None, H, None), Ok(()));
    assert_eq!(
      decide(None, false, on(), None, H, None).unwrap_err().0,
      "unavailable"
    );
    let off = Prefs {
      full_speed_in_power_saver: false,
    };
    assert_eq!(
      decide(None, true, off, None, H, None).unwrap_err().0,
      "off-setting"
    );
    let crashed = Disabled {
      module: H.into(),
      reason: "r".into(),
      at: 0,
    };
    assert_eq!(
      decide(None, true, on(), Some(&crashed), H, None)
        .unwrap_err()
        .0,
      "off-crash"
    );
    assert_eq!(
      decide(Some("0"), true, on(), None, H, None).unwrap_err().0,
      "off-env"
    );
    assert_eq!(
      decide(None, true, on(), None, H, Some("dbus"))
        .unwrap_err()
        .0,
      "off-env"
    );
    assert_eq!(
      decide(None, true, on(), None, H, Some(MONITOR_NAME)),
      Ok(())
    );
  }

  #[test]
  fn a_new_module_build_is_tried_again_after_a_crash() {
    let crashed = Disabled {
      module: "old".into(),
      reason: "r".into(),
      at: 0,
    };
    assert_eq!(decide(None, true, on(), Some(&crashed), H, None), Ok(()));
  }

  #[test]
  fn the_override_beats_setting_and_crash_guard_but_not_a_missing_module() {
    let off = Prefs {
      full_speed_in_power_saver: false,
    };
    let crashed = Disabled {
      module: H.into(),
      reason: "r".into(),
      at: 0,
    };
    assert_eq!(
      decide(Some("1"), true, off, Some(&crashed), H, None),
      Ok(())
    );
    assert!(decide(Some("1"), false, off, None, H, None).is_err());
  }

  #[test]
  fn crash_guard_trips_on_an_early_crash_or_a_second_one() {
    assert!(crash_disables(1, Duration::from_secs(5)));
    assert!(!crash_disables(1, Duration::from_secs(300)));
    assert!(crash_disables(2, Duration::from_secs(300)));
  }

  #[test]
  fn prepends_without_clobbering_or_duplicating() {
    let dir = Path::new("/c/gio/h");
    let joined = prepend_path(Some("/a:/c/gio/h:/b".into()), dir).unwrap();
    assert_eq!(joined, std::ffi::OsString::from("/c/gio/h:/a:/b"));
    assert_eq!(
      prepend_path(None, dir).unwrap(),
      std::ffi::OsString::from("/c/gio/h")
    );
  }

  #[test]
  fn hash_is_stable_and_content_addressed() {
    assert_eq!(module_hash(b""), "cbf29ce484222325");
    assert_ne!(module_hash(b"a"), module_hash(b"b"));
  }

  #[test]
  fn the_module_is_built_into_linux_binaries() {
    if cfg!(target_os = "linux")
      && std::env::var_os("POTATO_TOMATO_SKIP_FULL_SPEED_MODULE").is_none()
    {
      assert!(
        MODULE.starts_with(b"\x7fELF"),
        "embedded module is not an ELF file"
      );
    }
  }
}
