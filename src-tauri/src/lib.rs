mod apk_update;
mod disguise;
mod game_frames;
mod offline_games;
mod relay;

#[cfg(desktop)]
mod tray;

#[cfg(target_os = "linux")]
mod system_theme;

#[cfg(mobile)]
mod tray {
  #[tauri::command]
  pub fn sync_tray_recent() {}
}

use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager};
use tauri::path::BaseDirectory;

static PULLER_PORT: OnceLock<u16> = OnceLock::new();
/** Held for the length of one `spawn_puller` attempt; see that function. */
static PULLER_SPAWN_LOCK: Mutex<()> = Mutex::new(());
static TRAY_AVAILABLE: AtomicBool = AtomicBool::new(false);
/** When false, window close quits the app (GNOME/Silverblue without a visible tray). */
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(false);

const DEFAULT_PULLER_PORT: u16 = 18787;

/// Prefer 18787; if occupied (e.g. host `pnpm dev` while Flatpak runs), pick the next free port.
/// When an existing puller is already healthy on 18787, reuse that port (no second spawn).
fn reserve_puller_port() -> u16 {
  *PULLER_PORT.get_or_init(|| {
    /*
     * `PULLER_PORT` pins it, the same variable the puller itself reads. Several dev
     * checkouts on one machine each run their own puller, and without a pin every app
     * would adopt whichever of them answered on 18787 first.
     */
    if let Some(port) = std::env::var("PULLER_PORT")
      .ok()
      .and_then(|raw| raw.trim().parse::<u16>().ok())
    {
      return port;
    }
    if wait_for_puller_health(DEFAULT_PULLER_PORT, 250) {
      log::info!("default puller port {} already healthy — will reuse", DEFAULT_PULLER_PORT);
      return DEFAULT_PULLER_PORT;
    }
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

fn puller_base_url() -> String {
  format!("http://127.0.0.1:{}", puller_port())
}

/// `async` for the same reason as `ensure_puller`: the first call reserves the port, which
/// probes 18787 for up to a quarter of a second, and a synchronous command would do that on
/// the GTK main thread while the window is starting.
#[tauri::command]
async fn get_puller_base_url() -> String {
  tauri::async_runtime::spawn_blocking(puller_base_url)
    .await
    .unwrap_or_else(|_| format!("http://127.0.0.1:{DEFAULT_PULLER_PORT}"))
}

/// Whether a puller answers right now. Never starts one: nothing the app does to *play* a
/// game needs the puller any more, so a probe must not be what brings it up.
#[tauri::command]
async fn puller_running() -> bool {
  tauri::async_runtime::spawn_blocking(|| wait_for_puller_health(puller_port(), 300))
    .await
    .unwrap_or(false)
}

/// Health-check the puller and start it if it is not running — the downloader calls this
/// when the user asks for an offline copy, which is the one thing that still needs Node
/// (Playwright capture).
///
/// `async`, so Tauri runs it on its worker pool: a synchronous command runs on the GTK
/// main thread, and this one waits up to twelve seconds for the puller to answer.
/// Every one of those seconds froze the whole window — no repaint, no input, no
/// desktop light/dark switch delivered.
#[tauri::command]
async fn ensure_puller(app: tauri::AppHandle) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let port = puller_port();
    if wait_for_puller_health(port, 600) {
      return Ok(puller_base_url());
    }
    log::info!("ensure_puller: nothing healthy on {} — spawning", port);
    spawn_puller(&app);
    if wait_for_puller_health(port, 12_000) {
      Ok(puller_base_url())
    } else {
      Err(format!(
        "puller failed to become healthy on http://127.0.0.1:{port}"
      ))
    }
  })
  .await
  .map_err(|e| format!("puller check did not complete: {e}"))?
}

/// Development harness mode (`console-test` | `puller-test`) from env, or empty.
/// Only meaningful in debug builds; release always returns empty.
#[tauri::command]
fn get_dev_harness_mode() -> String {
  if !cfg!(debug_assertions) {
    return String::new();
  }
  match std::env::var("POTATO_TOMATO_DEV_HARNESS") {
    Ok(value) => {
      let trimmed = value.trim().to_string();
      if trimmed == "console-test" || trimmed == "puller-test" {
        trimmed
      } else {
        String::new()
      }
    }
    Err(_) => String::new(),
  }
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

/// Hand a URL to the operating system.
///
/// Android: `tauri-plugin-shell` routes this to `Intent.ACTION_VIEW`, which is the only
/// way the app can start a download. The Tauri Android WebView registers no
/// `DownloadListener`, so an in-page `<a download>` click is silently dropped — the APK
/// updater looked like it worked (release metadata resolved, no error) while nothing was
/// ever written to /sdcard/Download. Desktop: opens the default handler.
///
/// https-only: the caller passes URLs derived from GitHub Releases metadata, and an
/// ACTION_VIEW on an arbitrary scheme is a much wider door than this needs.
#[tauri::command]
fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
  let target = url.trim();
  if !target.starts_with("https://") {
    return Err(format!("refusing to open non-https URL: {target}"));
  }
  #[allow(deprecated)]
  {
    use tauri_plugin_shell::ShellExt;
    app
      .shell()
      .open(target, None)
      .map_err(|err| format!("could not open {target}: {err}"))
  }
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

/// The games data dir and the bundled catalog, resolved once: the offline and relay schemes
/// ask on every request, and resolving the catalog can log a warning each time.
pub(crate) fn game_roots(app: &tauri::AppHandle) -> offline_games::GameRoots {
  static ROOTS: OnceLock<offline_games::GameRoots> = OnceLock::new();
  ROOTS
    .get_or_init(|| offline_games::GameRoots {
      data: games_data_dir(app),
      catalog: catalog_dir(app),
    })
    .clone()
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

  match app.shell().sidecar("puller-sidecar") {
    Ok(sidecar) => {
      return sidecar
        .env("GAMES_DATA_DIR", games_dir)
        .env("CATALOG_DIR", catalog_dir)
        .env("PULLER_PORT", port.to_string())
        .spawn()
        .map(|_| {
          log::info!("puller sidecar spawned on port {}", port);
        })
        .map_err(|e| e.to_string());
    }
    Err(e) => {
      log::warn!(
        "tauri sidecar('puller-sidecar') failed ({e}) — trying exe-adjacent binaries"
      );
    }
  }

  /*
   * Flatpak historically installed only `/app/bin/puller-sidecar` while Tauri looks for
   * `puller-sidecar-<target-triple>`. Fall back to plain paths so Offline/Online play
   * still works when the triple-named file is missing.
   */
  let mut candidates = Vec::new();
  if let Ok(exe) = std::env::current_exe() {
    if let Some(dir) = exe.parent() {
      candidates.push(dir.join("puller-sidecar-x86_64-unknown-linux-gnu"));
      candidates.push(dir.join("puller-sidecar"));
    }
  }
  candidates.push(PathBuf::from("/app/bin/puller-sidecar-x86_64-unknown-linux-gnu"));
  candidates.push(PathBuf::from("/app/bin/puller-sidecar"));

  for path in candidates {
    if !path.is_file() {
      continue;
    }
    let cmd = std::process::Command::new(&path);
    match spawn_with_env(cmd, games_dir, catalog_dir, port) {
      Ok(()) => {
        log::info!(
          "puller spawned via fallback binary {} on port {}",
          path.display(),
          port
        );
        return Ok(());
      }
      Err(err) => log::warn!("fallback puller spawn failed for {}: {err}", path.display()),
    }
  }

  Err("puller-sidecar binary not found next to app or under /app/bin".into())
}

fn spawn_puller_node_bundle(
  app: &tauri::AppHandle,
  games_dir: &Path,
  catalog_dir: &Path,
  port: u16,
) -> Result<(), String> {
  let script = app
    .path()
    .resolve("puller/index.cjs", BaseDirectory::Resource)
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

  /*
   * `pnpm exec tsx` resolves against the *root* package, which never depends on tsx —
   * in a workspace pnpm turns that into a recursive exec and fails with
   * ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL, costing every dev launch a 10s health wait
   * before the sidecar fallback takes over. Run the binary the puller package owns.
   */
  let root = repo_root();
  let tsx = ["puller/node_modules/.bin/tsx", "node_modules/.bin/tsx"]
    .iter()
    .map(|rel| root.join(rel))
    .find(|path| path.exists());

  let mut cmd = match &tsx {
    Some(path) => {
      let mut cmd = std::process::Command::new(path);
      cmd.arg("puller/src/index.ts");
      cmd
    }
    /* No install layout we know — let pnpm resolve it from the puller package itself. */
    None => {
      let mut cmd = std::process::Command::new("pnpm");
      cmd.args(["--filter", "./puller", "exec", "tsx", "src/index.ts"]);
      cmd
    }
  };
  cmd.current_dir(&root);
  spawn_with_env(cmd, games_dir, catalog_dir, port)
}

/// `pnpm puller:bundle:linux` replaces this stub; until then spawning it "succeeds" then exits 1.
fn is_placeholder_puller_sidecar() -> bool {
  let dir = repo_root().join("src-tauri/binaries");
  let Ok(entries) = std::fs::read_dir(&dir) else {
    return false;
  };
  for entry in entries.flatten() {
    let name = entry.file_name();
    let name = name.to_string_lossy();
    if !name.starts_with("puller-sidecar") {
      continue;
    }
    if let Ok(contents) = std::fs::read_to_string(entry.path()) {
      if contents.contains("Placeholder") || contents.contains("puller sidecar not built") {
        return true;
      }
    }
  }
  false
}

/// Confirm the puller HTTP API is actually listening (spawn alone is not enough).
fn wait_for_puller_health(port: u16, timeout_ms: u64) -> bool {
  use std::io::{Read, Write};
  use std::net::{TcpStream, ToSocketAddrs};
  use std::time::{Duration, Instant};

  let deadline = Instant::now() + Duration::from_millis(timeout_ms);
  let addr = format!("127.0.0.1:{port}");
  let req = format!(
    "GET /api/offline/health HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
  );

  while Instant::now() < deadline {
    if let Ok(mut addrs) = addr.to_socket_addrs() {
      if let Some(sock) = addrs.next() {
        if let Ok(mut stream) = TcpStream::connect_timeout(&sock, Duration::from_millis(250)) {
          let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
          let _ = stream.set_write_timeout(Some(Duration::from_millis(400)));
          if stream.write_all(req.as_bytes()).is_ok() {
            let mut buf = [0u8; 512];
            if let Ok(n) = stream.read(&mut buf) {
              let text = String::from_utf8_lossy(&buf[..n]);
              if text.contains("200") && text.contains("\"ok\"") {
                return true;
              }
            }
          }
        }
      }
    }
    std::thread::sleep(Duration::from_millis(150));
  }
  false
}

fn spawn_puller(app: &tauri::AppHandle) {
  /*
   * One attempt at a time. `setup` launches the puller on its own thread and
   * `ensure_puller` runs on a worker, so callers overlap: each would find the port
   * unhealthy and start its own process on it, and every process but the one that won
   * the bind exits — leaving its caller to report the puller as unavailable. Whoever
   * waits here falls into the health check below and reuses what the winner started.
   */
  let _spawning = PULLER_SPAWN_LOCK
    .lock()
    .unwrap_or_else(|poisoned| poisoned.into_inner());

  let (games_dir, catalog_dir, port) = puller_env(app);

  /*
   * Reuse an already-healthy puller on the reserved port (e.g. leftover from a prior
   * harness session) instead of spawning a duplicate Node/Playwright process.
   */
  if wait_for_puller_health(port, 400) {
    log::info!("reusing healthy puller already listening on port {}", port);
    return;
  }

  /*
   * `tauri dev` / `pnpm app` must not treat the unbuilt sidecar stub as success —
   * that previously skipped the tsx fallback and left the UI on "puller unavailable"
   * (often while Flatpak still owned :18787).
   */
  if cfg!(debug_assertions) {
    match spawn_puller_dev(&games_dir, &catalog_dir, port) {
      Ok(()) => {
        if wait_for_puller_health(port, 10_000) {
          log::info!("dev puller healthy on port {}", port);
          return;
        }
        log::warn!("dev puller spawned but health check failed on port {}", port);
      }
      Err(e) => log::warn!("dev puller spawn failed: {e}"),
    }
  }

  if is_placeholder_puller_sidecar() {
    log::info!(
      "skipping unbuilt puller-sidecar placeholder (run pnpm puller:bundle:linux for release builds)"
    );
  } else if spawn_puller_sidecar(app, &games_dir, &catalog_dir, port).is_ok() {
    if wait_for_puller_health(port, 10_000) {
      return;
    }
    log::warn!("puller sidecar spawned but health check failed on port {}", port);
  }

  if spawn_puller_node_bundle(app, &games_dir, &catalog_dir, port).is_ok() {
    if wait_for_puller_health(port, 10_000) {
      return;
    }
    log::warn!("bundled puller script spawned but health check failed on port {}", port);
  }

  log::warn!("puller could not be started — offline download disabled");
}

/// Paint every window, and the webview inside it, in the desktop's window colour.
///
/// Read from the GTK theme *now*, so after a live scheme switch it is the new scheme's
/// colour. Both surfaces need it: the window shows through wherever the webview has not
/// painted yet, and the webview's own base colour is what WebKit clears to before the
/// page's first frame.
#[cfg(target_os = "linux")]
/// Register the tray, then settle everything that depends on whether it exists.
#[cfg(not(mobile))]
fn build_tray_now(app: &tauri::AppHandle) {
  /*
   * An A/B switch for the startup window flash: the tray is the only thing in the app
   * that creates toplevels of its own (muda's GtkMenu, plus whatever libappindicator
   * exports), so running once without it says whether a stray window belongs to it.
   */
  if std::env::var_os("POTATO_TOMATO_NO_TRAY").is_some() {
    log::info!("POTATO_TOMATO_NO_TRAY set — skipping tray registration");
    finish_tray_setup(false);
    return;
  }
  // libappindicator-sys panics (does not return Err) when the .so is missing
  // — e.g. Flatpak without shared-modules ayatana. Catch so the app still runs.
  let tray_ok = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| tray::build_tray(app)))
  {
    Ok(Ok(())) => true,
    Ok(Err(e)) => {
      log::warn!("system tray unavailable: {e}");
      false
    }
    Err(_) => {
      log::warn!("system tray unavailable: appindicator library missing or panic during init");
      false
    }
  };
  finish_tray_setup(tray_ok);
}

fn finish_tray_setup(tray_ok: bool) {
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
}

/// Payload is `true` for dark. Mirrors the portal's `SettingChanged` to the frontend.
const SYSTEM_COLOR_SCHEME_EVENT: &str = "system-color-scheme";

/// The desktop's current colour scheme, for the page to read at startup.
///
/// `Ok(None)` is a platform or desktop that has no such notion — the page keeps its own
/// `prefers-color-scheme` answer there rather than being told something wrong.
#[tauri::command]
fn desktop_color_scheme_is_dark() -> Option<bool> {
  #[cfg(target_os = "linux")]
  {
    system_theme::desktop_prefers_dark().ok()
  }
  #[cfg(not(target_os = "linux"))]
  {
    None
  }
}

fn paint_windows_from_theme(app: &tauri::AppHandle) {
  match system_theme::theme_window_background() {
    Some((r, g, b)) => {
      let base = tauri::window::Color(r, g, b, 255);
      for (label, window) in app.webview_windows() {
        match window.set_background_color(Some(base)) {
          Ok(()) => log::info!("coloured {label} rgb({r}, {g}, {b})"),
          Err(e) => log::info!("could not colour {label}: {e}"),
        }
      }
    }
    None => log::info!("theme defines no theme_bg_color; leaving the webview default"),
  }
}

/// The generated context, with the window's background colour settled first.
///
/// A webview paints white until the page does, so on a dark desktop the whole page load
/// was a white sheet inside a dark window — seconds of it under `tauri dev`, which waits
/// on the dev server. Setting it from `setup` is too late: the window exists and has
/// already painted by then. Config is the one place early enough. These are WebKit's own
/// canvas colours per `color-scheme`, so the gap matches what the page paints next.
#[cfg_attr(not(target_os = "linux"), allow(unused_variables))]
fn context(desktop_scheme: &Result<bool, String>) -> tauri::Context {
  #[allow(unused_mut)]
  let mut context = tauri::generate_context!();
  #[cfg(target_os = "linux")]
  if let Ok(dark) = *desktop_scheme {
    // `theme` is what tao acts on, and it acts while building the window — before the
    // webview is mapped. Without it the GTK window itself is still light at that moment,
    // so whichever of the two got painted first decided what you saw: sometimes the dark
    // webview background, sometimes a white GTK window.
    let theme = Some(if dark {
      tauri::Theme::Dark
    } else {
      tauri::Theme::Light
    });
    // And the colour comes from the desktop's own theme, not from a constant here — the
    // app does not pick its colours. No `theme_bg_color` means no override, leaving the
    // webview's default rather than a guess.
    let base = system_theme::theme_window_background()
      .map(|(r, g, b)| tauri::window::Color(r, g, b, 255));
    for window in &mut context.config_mut().app.windows {
      window.theme = theme;
      if let Some(base) = base {
        window.background_color = Some(base);
      }
    }
  }
  context
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // One portal read, shared: the window's colour is decided from it before the window
  // exists, and `setup` mirrors the same answer onto GtkSettings once GTK is up.
  #[cfg(target_os = "linux")]
  let desktop_scheme = system_theme::desktop_prefers_dark();
  #[cfg(not(target_os = "linux"))]
  let desktop_scheme: Result<bool, String> = Err(String::new());
  // `setup` needs its own copy: the context is still built inline at `.run()` below, where
  // Tauri expects it.
  let scheme_for_setup = desktop_scheme.clone();

  let mut builder = tauri::Builder::default().plugin(tauri_plugin_shell::init());
  if let Some(probe) = game_frames::frame_probe_plugin() {
    builder = builder.plugin(probe);
  }
  #[cfg(desktop)]
  {
    builder = builder
      .register_asynchronous_uri_scheme_protocol(relay::SCHEME, |ctx, request, responder| {
        let catalog = game_roots(ctx.app_handle()).catalog;
        let path = request.uri().path().to_string();
        tauri::async_runtime::spawn(async move {
          responder.respond(relay::handle(catalog, path).await);
        });
      })
      .register_asynchronous_uri_scheme_protocol(
        offline_games::SCHEME,
        |ctx, request, responder| {
          let roots = game_roots(ctx.app_handle());
          let path = request.uri().path().to_string();
          tauri::async_runtime::spawn(async move {
            responder.respond(offline_games::handle(roots, path).await);
          });
        },
      );
  }
  builder
    .invoke_handler(tauri::generate_handler![
      tray::sync_tray_recent,
      get_puller_base_url,
      puller_running,
      desktop_color_scheme_is_dark,
      ensure_puller,
      get_dev_harness_mode,
      is_tray_available,
      is_close_to_tray_enabled,
      set_close_to_tray_enabled,
      quit_app,
      open_external_url,
      apk_update::download_and_install_apk,
      apk_update::can_install_apk,
      apk_update::open_install_permission_settings,
      disguise::native_identity_target,
      disguise::set_native_disguise,
      disguise::clear_native_disguise,
      game_frames::native_game_frames_supported,
      game_frames::set_game_frame_context,
      game_frames::clear_game_frame_context,
      offline_games::offline_statuses,
      offline_games::offline_entry,
      offline_games::offline_delete,
      offline_games::game_profile_read,
      offline_games::game_profile_write,
      offline_games::game_profile_delete
    ])
    .setup(move |app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      #[cfg(target_os = "linux")]
      {
        system_theme::flush_early_log();
        match scheme_for_setup {
          Ok(dark) => log::info!("desktop colour-scheme is {}", if dark { "dark" } else { "light" }),
          Err(ref why) => log::info!("{why}"),
        }
        // Dress the window and the webview in the desktop's own window colour, and keep
        // doing so every time the desktop switches. The colour matters twice: before the
        // page paints, and in the strip a resize exposes before WebKit catches up. Both
        // were left on the launch colour, so after a live light/dark switch every resize
        // flashed the *old* scheme along the growing edge — the "ghost" of the previous
        // theme — until the page repainted over it.
        let handle = app.handle().clone();
        paint_windows_from_theme(&handle);
        if let Err(why) = system_theme::follow_desktop_color_scheme(&scheme_for_setup, move |dark| {
          paint_windows_from_theme(&handle);
          /*
           * The page is supposed to notice this through `prefers-color-scheme`, which
           * WebKitGTK derives from the GTK settings we just wrote. It does not always
           * arrive — under `tauri dev` the first switch after launch took seconds, and a
           * webview that misses the media event has no other way to learn the desktop
           * changed, so the page stayed in its launch scheme under a titlebar that had
           * already followed. The portal told us directly; tell the page directly.
           */
          if let Err(e) = handle.emit(SYSTEM_COLOR_SCHEME_EVENT, dark) {
            log::info!("could not announce colour-scheme change to the page: {e}");
          }
        }) {
          log::info!("{why}");
        }
        // A second look once the window has been mapped and painted: this is where a
        // second toplevel, or a window that ended up a different size than configured,
        // would show up.
        gtk::glib::timeout_add_local_once(std::time::Duration::from_millis(2000), || {
          log::info!("{}", system_theme::gtk_state("2s after setup"));
        });
      }
      /*
       * No puller at startup. Games play straight from their hosts with the bridge put into
       * their frames natively (`game_frames.rs`), a few through the in-process relay
       * (`relay.rs`); offline copies and saves are read from disk here
       * (`offline_games.rs`). The Node process is started by `ensure_puller` when the user
       * downloads a game, the one job that still needs Playwright — so a normal session
       * never pays for it, and its port is not even reserved until then.
       */
      #[cfg(not(mobile))]
      log::info!("puller not started: it runs on demand for offline downloads");
      #[cfg(mobile)]
      log::info!("mobile build: puller capture sidecar is intentionally disabled");
      #[cfg(mobile)]
      finish_tray_setup(false);
      /*
       * Building the tray realises muda's GtkMenu, and GTK gives that menu its own
       * toplevel — the two 1x1 `Popup`s the startup log lists next to the real window.
       * Done inside `setup` that happens while the app window exists but has not been
       * mapped yet, so the popup is the first thing the compositor gets to show: a tiny
       * window that appears and vanishes just before the app itself. Waiting for the
       * real window to be mapped keeps the menu's plumbing behind it where it belongs.
       */
      #[cfg(all(not(mobile), target_os = "linux"))]
      {
        let handle = app.handle().clone();
        match app.get_webview_window("main").map(|w| w.gtk_window()) {
          Some(Ok(gtk_window)) => {
            use gtk::prelude::{WidgetExt, WidgetExtManual};
            if gtk_window.is_mapped() {
              build_tray_now(&handle);
            } else {
              let once = std::cell::Cell::new(false);
              gtk_window.connect_map_event(move |_, _| {
                if !once.replace(true) {
                  log::info!("{}", system_theme::gtk_state("window mapped; building tray"));
                  build_tray_now(&handle);
                }
                gtk::glib::Propagation::Proceed
              });
            }
          }
          other => {
            if let Some(Err(e)) = other {
              log::warn!("no GTK window to hang tray setup off ({e}); building it now");
            }
            build_tray_now(&handle);
          }
        }
      }
      #[cfg(all(not(mobile), not(target_os = "linux")))]
      build_tray_now(app.handle());
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
    .run(context(&desktop_scheme))
    .expect("error while running tauri application");
}
