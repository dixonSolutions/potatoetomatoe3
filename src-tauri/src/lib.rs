mod apk_update;
mod disguise;
mod display_scale;
mod frame_first_input;
mod game_frame_tuning;
mod game_frames;
mod memory_watchdog;
mod offline_download;
mod offline_games;
mod power_profile;
mod relay;
mod webview_crash;

#[cfg(desktop)]
mod tray;

#[cfg(target_os = "linux")]
mod system_theme;

#[cfg(mobile)]
mod tray {
  #[tauri::command]
  pub fn sync_tray_recent() {}
}

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
#[cfg(target_os = "linux")]
use tauri::Emitter;
use tauri::Manager;
use tauri::path::BaseDirectory;

static TRAY_AVAILABLE: AtomicBool = AtomicBool::new(false);
/** When false, window close quits the app (GNOME/Silverblue without a visible tray). */
static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(false);

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

/// Development harness mode (`console-test`) from env, or empty.
/// Only meaningful in debug builds; release always returns empty.
#[tauri::command]
fn get_dev_harness_mode() -> String {
  if !cfg!(debug_assertions) {
    return String::new();
  }
  match std::env::var("POTATO_TOMATO_DEV_HARNESS") {
    Ok(value) => {
      let trimmed = value.trim().to_string();
      if trimmed == "console-test" {
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

  log::error!("resource_dir unavailable — cannot resolve the offline catalog");
  PathBuf::from("/nonexistent/potato-tomato-catalog")
}

/// The games data dir and the bundled catalog, resolved once: the offline and relay schemes
/// ask on every request, and resolving the catalog can log a warning each time.
/// Is `url` one of the schemes that serve third-party game HTML? (`ptrelay://…` on Linux and
/// macOS; Windows spells a custom scheme `http://ptrelay.localhost/…`.)
#[cfg(desktop)]
fn is_game_scheme_url(url: &tauri::Url) -> bool {
  [relay::SCHEME, offline_games::SCHEME].iter().any(|scheme| {
    url.scheme() == *scheme
      || url
        .host_str()
        .is_some_and(|host| host.strip_prefix(*scheme).is_some_and(|rest| rest.starts_with('.')))
  })
}

/// The last page the main frame showed that was the app itself, where a refused game page
/// sends it back to.
#[cfg(desktop)]
static LAST_APP_PAGE: Mutex<Option<tauri::Url>> = Mutex::new(None);

/// Keep game pages out of the main frame. Tauri counts every registered scheme as the app's
/// own origin, so a relayed or offline game page that became the top document — a game frame
/// setting `top.location` to one — would get the app's IPC and every capability. Game frames
/// load those schemes legitimately, and a navigation hook cannot tell a frame from the top
/// document, but a page load is only ever the top document's: one that starts on a game
/// scheme is replaced by the app before the game's document is committed.
#[cfg(desktop)]
fn guard_main_frame(webview: &tauri::Webview, payload: &tauri::webview::PageLoadPayload<'_>) {
  let url = payload.url();
  let mut last = LAST_APP_PAGE.lock().unwrap_or_else(|e| e.into_inner());
  if !is_game_scheme_url(url) {
    if matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
      *last = Some(url.clone());
    }
    return;
  }
  log::warn!("refused a game page as the top document: {url}");
  let back = last.clone().or_else(|| {
    tauri::Url::parse(if cfg!(windows) { "http://tauri.localhost/" } else { "tauri://localhost/" }).ok()
  });
  drop(last);
  if let Some(back) = back {
    if let Err(why) = webview.navigate(back) {
      log::error!("could not leave the refused game page: {why}");
    }
  }
}

pub(crate) fn game_roots(app: &tauri::AppHandle) -> offline_games::GameRoots {
  static ROOTS: OnceLock<offline_games::GameRoots> = OnceLock::new();
  ROOTS
    .get_or_init(|| offline_games::GameRoots {
      data: games_data_dir(app),
      catalog: catalog_dir(app),
    })
    .clone()
}

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
#[cfg(target_os = "linux")]
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

/// Paint every window, and the webview inside it, in the desktop's window colour.
///
/// Read from the GTK theme *now*, so after a live scheme switch it is the new scheme's
/// colour. Both surfaces need it: the window shows through wherever the webview has not
/// painted yet, and the webview's own base colour is what WebKit clears to before the
/// page's first frame.
#[cfg(target_os = "linux")]
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
fn context(
  #[allow(unused_mut)] mut context: tauri::Context,
  desktop_scheme: &Result<bool, String>,
) -> tauri::Context {
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
  let generated = tauri::generate_context!();
  // First, while this is the only thread: the power-saver module is chosen through
  // environment variables that WebKit's web processes inherit (`power_profile.rs`).
  power_profile::prepare(&generated.config().identifier);
  // One portal read, shared: the window's colour is decided from it before the window
  // exists, and `setup` mirrors the same answer onto GtkSettings once GTK is up.
  #[cfg(target_os = "linux")]
  let desktop_scheme = system_theme::desktop_prefers_dark();
  #[cfg(not(target_os = "linux"))]
  let desktop_scheme: Result<bool, String> = Err(String::new());
  // `setup` needs its own copy: the context is still built inline at `.run()` below, where
  // Tauri expects it.
  #[cfg(target_os = "linux")]
  let scheme_for_setup = desktop_scheme.clone();

  let mut builder = tauri::Builder::default().plugin(tauri_plugin_shell::init());
  if let Some(probe) = game_frames::frame_probe_plugin() {
    builder = builder.plugin(probe);
  }
  #[cfg(desktop)]
  {
    builder = builder
      .on_page_load(guard_main_frame)
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
          let referer = request
            .headers()
            .get("referer")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
          tauri::async_runtime::spawn(async move {
            responder.respond(offline_games::handle(roots, path, referer).await);
          });
        },
      );
  }
  builder
    .invoke_handler(tauri::generate_handler![
      tray::sync_tray_recent,
      desktop_color_scheme_is_dark,
      get_dev_harness_mode,
      is_tray_available,
      is_close_to_tray_enabled,
      set_close_to_tray_enabled,
      quit_app,
      open_external_url,
      apk_update::download_and_install_apk,
      apk_update::cancel_apk_download,
      apk_update::can_install_apk,
      apk_update::open_install_permission_settings,
      disguise::native_identity_target,
      disguise::set_native_disguise,
      disguise::clear_native_disguise,
      game_frames::native_game_frames_supported,
      game_frames::set_game_frame_context,
      game_frames::clear_game_frame_context,
      power_profile::full_speed_status,
      power_profile::set_full_speed_setting,
      display_scale::display_scale_status,
      frame_first_input::lift_game_frame_throttle,
      offline_games::offline_statuses,
      offline_games::offline_entry,
      offline_games::offline_delete,
      offline_download::offline_download_start,
      offline_download::offline_download_cancel,
      offline_download::offline_download_progress,
      offline_games::game_profile_read,
      offline_games::game_profile_write,
      offline_games::game_profile_delete,
      webview_crash::take_webview_crash,
      webview_crash::debug_crash_webview
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
        power_profile::flush_early_log();
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
        // A game that crashes WebKit's web process takes the app page with it; reload
        // where the user was, without walking straight back into the same game.
        if let Some(window) = app.get_webview_window("main") {
          webview_crash::watch(&window);
          // Past its memory limit the web process is ended, so a leak cannot take the
          // desktop down with it (#59, #62); the crash handler above recovers the page.
          memory_watchdog::watch(&window);
        }
        // A second look once the window has been mapped and painted: this is where a
        // second toplevel, or a window that ended up a different size than configured,
        // would show up.
        gtk::glib::timeout_add_local_once(std::time::Duration::from_millis(2000), || {
          log::info!("{}", system_theme::gtk_state("2s after setup"));
        });
      }
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
      // Close-to-tray is desktop-only; mobile has no window close to intercept.
      #[cfg(mobile)]
      let _ = (window, event);
      #[cfg(desktop)]
      if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        if CLOSE_TO_TRAY.load(Ordering::SeqCst) {
          // Keep the tray alive; Quit from the tray exits for real.
          let _ = window.hide();
          api.prevent_close();
        } else {
          // No usable tray (common on Fedora Silverblue / stock GNOME): quit fully.
          api.prevent_close();
          window.app_handle().exit(0);
        }
      }
    })
    .run(context(generated, &desktop_scheme))
    .expect("error while running tauri application");
}

#[cfg(all(test, desktop))]
mod main_frame_guard_tests {
  use super::is_game_scheme_url;

  #[test]
  fn game_schemes_are_recognised_in_both_spellings() {
    for raw in [
      "ptrelay://localhost/game/abc",
      "ptoffline://localhost/abc/index.html",
      "http://ptrelay.localhost/game/abc",
      "http://ptoffline.localhost/abc",
    ] {
      assert!(is_game_scheme_url(&raw.parse().unwrap()), "{raw}");
    }
    for raw in ["tauri://localhost/games/abc", "http://localhost:5173/", "https://ptrelayx.com/"] {
      assert!(!is_game_scheme_url(&raw.parse().unwrap()), "{raw}");
    }
  }
}
