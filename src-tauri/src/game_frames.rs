//! Scripts the app runs inside game frames it cannot reach from JavaScript.
//!
//! A game embedded from its own host is a cross-origin document: the page that frames it
//! cannot read it, write to it or add a script to it. The webview can. On Linux the app
//! installs `static/game-storage-bridge.child.js` into the game's frames natively, as a
//! WebKitGTK user script, so virtual storage, key detection and the touch console work in
//! a game played straight from its own host — which is what the Node relay used to exist
//! for, at the price of re-fetching and rewriting every game through a proxy.
//!
//! The script is not permanent. The frontend calls `set_game_frame_context` while it
//! resolves a launch, before the frame exists, and the user script is swapped for one that
//! carries that game's id. A page with no game on it has no bridge in its frames at all.
//!
//! Android has its own document-start bridge (`native_touch_bridge.js`, installed by
//! `MainActivity`), so nothing here runs there.

// Only the Linux webview can install the script; elsewhere the commands answer "unsupported".
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use serde::Deserialize;

/// The shared in-frame bridge, byte for byte what the web build serves.
pub(crate) const BRIDGE_SOURCE: &str = include_str!("../../static/game-storage-bridge.child.js");
/// Decides whether a frame is a game frame and which part it plays; see the file.
const PREAMBLE_SOURCE: &str = include_str!("game_frames.js");

/// What the frontend knows about the launch it is resolving.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameFrameContext {
  /// Catalog id; the bridge keys the game's saved profile on it.
  pub game_id: String,
  /// Origin of the app document hosting the frames (`tauri://localhost`, or the dev server).
  pub app_origin: String,
  /// Origins that serve documents with the bridge already in their HTML (a running puller).
  #[serde(default)]
  pub own_origins: Vec<String>,
  /// The frame the app creates holds an app-made document that carries the bridge (a blob
  /// shell, an offline mirror), so frames inside it must not claim the game's profile.
  #[serde(default)]
  pub top_has_bridge: bool,
}

/// Catalog ids as they occur (`crazygames-2048`, `minecraft-1.8.8`, `2016 - diamond run`),
/// and nothing that could name another directory: shared by every command and scheme that
/// turns an id into a path or a URL.
pub fn is_catalog_id(id: &str) -> bool {
  let mut chars = id.chars();
  matches!(chars.next(), Some(c) if c.is_ascii_alphanumeric())
    && id.len() <= 200
    && !id.contains("..")
    && id
      .chars()
      .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ' '))
}

/// `scheme://host[:port]` and nothing more — the value is compared to `location.origin`.
fn is_origin(value: &str) -> bool {
  let Some((scheme, rest)) = value.split_once("://") else {
    return false;
  };
  !scheme.is_empty()
    && scheme
      .chars()
      .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '-' || c == '.')
    && !rest.is_empty()
    && !rest.contains(['/', '?', '#', '@', ' '])
}

impl GameFrameContext {
  pub fn validate(&self) -> Result<(), String> {
    if !is_catalog_id(&self.game_id) {
      return Err(format!("not a catalog game id: {:?}", self.game_id));
    }
    for origin in std::iter::once(&self.app_origin).chain(self.own_origins.iter()) {
      if !is_origin(origin) {
        return Err(format!("not an origin: {origin:?}"));
      }
    }
    Ok(())
  }
}

/// The user script for one launch: the context, the preamble, then the bridge — which
/// runs only in frames the preamble gives a role.
pub fn frame_script(context: &GameFrameContext) -> String {
  let ctx = serde_json::json!({
    "gameId": context.game_id,
    "appOrigin": context.app_origin,
    "ownOrigins": context.own_origins,
    "topHasBridge": context.top_has_bridge,
  });
  let mut out = String::with_capacity(BRIDGE_SOURCE.len() + PREAMBLE_SOURCE.len() + 512);
  out.push_str("(function () {\nvar ptRole;\ntry {\nptRole = (");
  out.push_str(PREAMBLE_SOURCE);
  out.push_str(")(");
  out.push_str(&ctx.to_string());
  out.push_str(");\n} catch (e) {\nreturn;\n}\nif (!ptRole) return;\n");
  out.push_str(BRIDGE_SOURCE);
  out.push_str("\n})();\n");
  out
}

#[cfg(target_os = "linux")]
mod linux {
  use std::cell::RefCell;
  use std::collections::HashMap;
  use webkit2gtk::{
    UserContentInjectedFrames, UserContentManagerExt, UserScript, UserScriptInjectionTime,
    WebViewExt,
  };

  thread_local! {
    /// The active script per webview label. Touched only on the GTK main thread, which is
    /// where `with_webview` runs its closure.
    static ACTIVE: RefCell<HashMap<String, UserScript>> = RefCell::new(HashMap::new());
  }

  /// Replace this webview's game-frame script; `None` just removes it.
  pub fn swap(webview: &tauri::Webview, source: Option<String>) -> Result<(), String> {
    let label = webview.label().to_string();
    let (done_tx, done_rx) = std::sync::mpsc::channel();
    webview
      .with_webview(move |platform| {
        let view = platform.inner();
        let Some(manager) = view.user_content_manager() else {
          let _ = done_tx.send(Err("webview has no user content manager".to_string()));
          return;
        };
        ACTIVE.with(|active| {
          let mut active = active.borrow_mut();
          if let Some(previous) = active.remove(&label) {
            manager.remove_script(&previous);
          }
          if let Some(source) = source {
            let script = UserScript::new(
              &source,
              UserContentInjectedFrames::AllFrames,
              UserScriptInjectionTime::Start,
              &[],
              &[],
            );
            manager.add_script(&script);
            active.insert(label, script);
          }
        });
        let _ = done_tx.send(Ok(()));
      })
      .map_err(|e| e.to_string())?;
    /*
     * Wait for the main thread to have done it: the frontend sets the frame's src as soon
     * as this command returns, and the frame's first document must already see the script.
     */
    done_rx
      .recv_timeout(std::time::Duration::from_secs(3))
      .map_err(|_| "timed out installing the game-frame script".to_string())?
  }
}

/// Whether this build can put the bridge into cross-origin game frames itself.
#[tauri::command]
pub fn native_game_frames_supported() -> bool {
  cfg!(target_os = "linux")
}

/// Install the in-frame bridge for the game about to launch in this webview.
///
/// Returns `false` where the platform has no way to do it (the frontend then keeps its
/// same-origin fallbacks), `true` once the script is in place for the next frame load.
#[tauri::command]
pub async fn set_game_frame_context(
  webview: tauri::Webview,
  context: GameFrameContext,
) -> Result<bool, String> {
  context.validate()?;
  #[cfg(target_os = "linux")]
  {
    let source = frame_script(&context);
    tauri::async_runtime::spawn_blocking(move || linux::swap(&webview, Some(source)))
      .await
      .map_err(|e| e.to_string())??;
    Ok(true)
  }
  #[cfg(not(target_os = "linux"))]
  {
    let _ = webview;
    Ok(false)
  }
}

/// Take the bridge back out of this webview's frames (no game on screen).
#[tauri::command]
pub async fn clear_game_frame_context(webview: tauri::Webview) -> Result<(), String> {
  #[cfg(target_os = "linux")]
  {
    tauri::async_runtime::spawn_blocking(move || linux::swap(&webview, None))
      .await
      .map_err(|e| e.to_string())??;
  }
  #[cfg(not(target_os = "linux"))]
  let _ = webview;
  Ok(())
}

/// Debug builds only: `POTATO_TOMATO_FRAME_PROBE=<path to a .js file>` runs that file at
/// document start in every frame, for launch measurements (`scripts/play-path-bench.mjs`
/// passes `scripts/play-path/frame-probe.js`). A release build never reads the variable.
pub fn frame_probe_plugin<R: tauri::Runtime>() -> Option<tauri::plugin::TauriPlugin<R>> {
  if !cfg!(debug_assertions) {
    return None;
  }
  let path = std::env::var_os("POTATO_TOMATO_FRAME_PROBE")?;
  match std::fs::read_to_string(&path) {
    Ok(source) => Some(
      tauri::plugin::Builder::new("frame-probe")
        .js_init_script_on_all_frames(source)
        .build(),
    ),
    Err(e) => {
      eprintln!("POTATO_TOMATO_FRAME_PROBE: could not read {path:?}: {e}");
      None
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn ctx() -> GameFrameContext {
    GameFrameContext {
      game_id: "crazygames-2048".into(),
      app_origin: "tauri://localhost".into(),
      own_origins: vec!["http://127.0.0.1:18787".into()],
      top_has_bridge: false,
    }
  }

  #[test]
  fn accepts_catalog_ids_and_origins() {
    assert!(ctx().validate().is_ok());
    let mut dev = ctx();
    dev.app_origin = "http://127.0.0.1:5177".into();
    dev.game_id = "002".into();
    assert!(dev.validate().is_ok());
  }

  #[test]
  fn rejects_anything_that_is_not_an_id_or_an_origin() {
    for bad in [
      "",
      "../x",
      "x\"y",
      "a/b",
      "</script>",
      ".hidden",
      "a..b",
      "a\\b",
    ] {
      let mut c = ctx();
      c.game_id = bad.into();
      assert!(c.validate().is_err(), "{bad:?} accepted as a game id");
    }
    for bad in [
      "tauri://localhost/",
      "http://x/y",
      "localhost",
      "http://a@b",
      "javascript:1",
    ] {
      let mut c = ctx();
      c.app_origin = bad.into();
      assert!(c.validate().is_err(), "{bad:?} accepted as an origin");
    }
  }

  #[test]
  fn script_carries_context_as_json_before_the_bridge() {
    let script = frame_script(&ctx());
    let ctx_at = script
      .find("\"gameId\":\"crazygames-2048\"")
      .expect("context present");
    let bridge_at = script
      .find("potato-tomato-game-storage")
      .expect("bridge present");
    assert!(ctx_at < bridge_at);
    assert!(script.contains("function ptGameFramePreamble(CTX)"));
    assert!(script.contains("\"topHasBridge\":false"));
    assert!(script.trim_end().ends_with("})();"));
  }
}
