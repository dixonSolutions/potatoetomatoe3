//! What the Linux app changes in WebKitGTK while a game is on screen, and undoes after.
//!
//! The engine bench (docs/field-tests/engine-bench-2026-09-23) found three things between
//! WebKitGTK and a game's full frame rate. For each launch, from `set_game_frame_context`:
//!
//! - power saver: the web process is told to ignore it while the game page is open
//!   (`power_profile.rs`, a flag file its GIO module watches);
//! - fractional scaling: game frames get `devicePixelRatio` capped at the display's real
//!   scale (`display_scale.rs`), by a document-start user script (`game_frame_tuning.js`);
//! - the cross-origin frame throttle: that script also swallows the one F24 key press the
//!   frontend asks for once the game frame has focus (`frame_first_input.rs`).
//!
//! It all ends when the page's path changes — the player left the game page; SvelteKit
//! navigates with `pushState`, which WebKitWebView reports as a new `uri` — or on
//! `clear_game_frame_context`. The next launch starts it again.
//!
//! For before/after measurements, each can be switched off for one run from the
//! environment: `POTATO_TOMATO_FULL_SPEED=0`, `POTATO_TOMATO_DPR_CAP=0`,
//! `POTATO_TOMATO_FIRST_INPUT=0`.

#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

/// The script for one launch: the function from `game_frame_tuning.js`, called with its
/// options.
pub fn tuning_script(app_origin: &str, dpr_cap: Option<f64>) -> String {
  let options = serde_json::json!({
    "appOrigin": app_origin,
    "dprCap": dpr_cap,
    "swallowFirstInput": true,
  });
  format!(
    "(function () {{\ntry {{\n({})({});\n}} catch (e) {{}}\n}})();\n",
    include_str!("game_frame_tuning.js"),
    options
  )
}

/// `/games/x` for `tauri://localhost/games/x?y#z`: the page, whatever its query or hash.
pub fn page_path(uri: &str) -> String {
  let rest = uri.split_once("://").map_or(uri, |(_, rest)| rest);
  let path = rest.find('/').map_or("/", |i| &rest[i..]);
  path.split(['?', '#']).next().unwrap_or("/").to_string()
}

#[cfg(target_os = "linux")]
mod linux {
  use crate::{display_scale, power_profile};
  use gtk::prelude::Cast;
  use std::cell::RefCell;
  use std::collections::HashMap;
  use webkit2gtk::{
    UserContentInjectedFrames, UserContentManagerExt, UserScript, UserScriptInjectionTime,
    WebViewExt,
  };

  #[derive(Default)]
  struct Active {
    script: Option<UserScript>,
    /// The page the game was launched from; leaving it ends the session.
    page: Option<String>,
    watching: bool,
  }

  thread_local! {
    /// Per webview label. GTK main thread only.
    static ACTIVE: RefCell<HashMap<String, Active>> = RefCell::new(HashMap::new());
  }

  fn remove_script(view: &webkit2gtk::WebView, active: &mut Active) {
    if let (Some(script), Some(manager)) = (active.script.take(), view.user_content_manager()) {
      manager.remove_script(&script);
    }
  }

  /// Main thread: install this launch's script, remember its page, follow the power flag.
  pub fn begin_on_main(
    view: &webkit2gtk::WebView,
    label: String,
    app_origin: &str,
    layout: Option<Result<display_scale::Layout, String>>,
    full_speed: bool,
  ) -> Result<Option<f64>, String> {
    let cap = match layout {
      None => {
        log::info!("game frames: rendering at WebKit's scale (setting off)");
        None
      }
      Some(Err(why)) => {
        log::info!("game frames: no display-scale cap: {why}");
        None
      }
      Some(Ok(layout)) => match display_scale::window_monitor(view.upcast_ref()) {
        Ok(window) => {
          let real = display_scale::real_scale(&layout, window);
          let cap = display_scale::dpr_cap(real, window.gtk_scale);
          match (real, cap) {
            (Some(real), Some(cap)) => log::info!(
              "game frames: devicePixelRatio capped at {cap} (display at {real}, WebKit at {})",
              window.gtk_scale
            ),
            (Some(real), None) => log::info!(
              "game frames: no cap needed (display at {real}, WebKit at {})",
              window.gtk_scale
            ),
            (None, _) => log::info!("game frames: no display-scale cap: monitor not matched"),
          }
          cap
        }
        Err(why) => {
          log::info!("game frames: no display-scale cap: {why}");
          None
        }
      },
    };
    let manager = view
      .user_content_manager()
      .ok_or("webview has no user content manager")?;
    let script = UserScript::new(
      &super::tuning_script(app_origin, cap),
      UserContentInjectedFrames::AllFrames,
      UserScriptInjectionTime::Start,
      &[],
      &[],
    );
    let page = view.uri().map(|uri| super::page_path(&uri));
    let first_watch = ACTIVE.with(|all| {
      let mut all = all.borrow_mut();
      let active = all.entry(label.clone()).or_default();
      remove_script(view, active);
      manager.add_script(&script);
      active.script = Some(script);
      active.page = page;
      !std::mem::replace(&mut active.watching, true)
    });
    if first_watch {
      view.connect_uri_notify(move |view| {
        let now = view.uri().map(|uri| super::page_path(&uri));
        let left = ACTIVE.with(|all| {
          all
            .borrow()
            .get(&label)
            .is_some_and(|a| a.page.is_some() && a.page != now)
        });
        if left {
          end_on_main(view, &label);
        }
      });
    }
    power_profile::set_game_open(full_speed);
    Ok(cap)
  }

  /// Main thread: take the script out and let power saver apply again.
  pub fn end_on_main(view: &webkit2gtk::WebView, label: &str) {
    ACTIVE.with(|all| {
      if let Some(active) = all.borrow_mut().get_mut(label) {
        remove_script(view, active);
        active.page = None;
      }
    });
    power_profile::set_game_open(false);
  }
}

/// Start this launch's tuning. Blocking (one D-Bus call for the display scale): call it off
/// the main thread. Never fails the launch: a problem only means less tuning.
pub fn begin(webview: &tauri::Webview, app_origin: &str, cap_dpr: bool, full_speed: Option<bool>) {
  if let Some(on) = full_speed {
    crate::power_profile::remember_setting(on);
  }
  let full_speed = full_speed.unwrap_or(true);
  /* For before/after measurements: `POTATO_TOMATO_DPR_CAP=0` leaves the scale alone. */
  let cap_dpr = cap_dpr && std::env::var("POTATO_TOMATO_DPR_CAP").as_deref() != Ok("0");
  #[cfg(target_os = "linux")]
  {
    let layout = cap_dpr.then(crate::display_scale::read_layout);
    let label = webview.label().to_string();
    let origin = app_origin.to_string();
    let (tx, rx) = std::sync::mpsc::channel();
    let sent = webview.with_webview(move |platform| {
      let _ = tx.send(linux::begin_on_main(
        &platform.inner(),
        label,
        &origin,
        layout,
        full_speed,
      ));
    });
    let result = sent
      .map_err(|e| e.to_string())
      .and_then(|()| {
        rx.recv_timeout(std::time::Duration::from_secs(3))
          .map_err(|_| "timed out".to_string())
      })
      .and_then(|r| r);
    if let Err(why) = result {
      log::warn!("game frames: tuning not applied: {why}");
    }
  }
  #[cfg(not(target_os = "linux"))]
  let _ = (webview, app_origin, cap_dpr, full_speed);
}

/// End the tuning now (`clear_game_frame_context`).
pub fn end(webview: &tauri::Webview) {
  #[cfg(target_os = "linux")]
  {
    let label = webview.label().to_string();
    if let Err(e) =
      webview.with_webview(move |platform| linux::end_on_main(&platform.inner(), &label))
    {
      log::warn!("game frames: could not end tuning: {e}");
    }
  }
  #[cfg(not(target_os = "linux"))]
  let _ = webview;
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn page_path_ignores_query_and_hash() {
    assert_eq!(page_path("tauri://localhost/games/x?y=1#z"), "/games/x");
    assert_eq!(
      page_path("http://127.0.0.1:5173/games/2016%20-%20a"),
      "/games/2016%20-%20a"
    );
    assert_eq!(page_path("tauri://localhost"), "/");
    assert_eq!(page_path("tauri://localhost/home#top"), "/home");
  }

  #[test]
  fn script_calls_the_tuning_function_with_its_options() {
    let script = tuning_script("tauri://localhost", Some(1.25));
    assert!(script.contains("function ptGameFrameTuning(T)"));
    assert!(script.contains("\"dprCap\":1.25"));
    assert!(script.contains("\"appOrigin\":\"tauri://localhost\""));
    assert!(tuning_script("tauri://localhost", None).contains("\"dprCap\":null"));
    assert!(script.trim_end().ends_with("})();"));
  }
}
