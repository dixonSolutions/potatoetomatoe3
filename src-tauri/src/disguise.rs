//! Mirror the privacy disguise onto the app's *native* identity.
//!
//! The tab `<title>` and favicon already follow the selected disguise, but a native build
//! is identified in places no browser tab reaches: the Android recents card, and on Linux
//! the window title, the taskbar/overview entry and the tray. Those kept saying "Potato
//! Tomato" next to a potato logo while the tab claimed to be Google Docs, which is the
//! only view of the app a shoulder-surfer actually gets on a phone.
//!
//! The icon arrives from the frontend as a base64 PNG that the WebView rasterised from
//! the very asset the favicon is using. That keeps the two from ever disagreeing about
//! which service is being imitated, and means adding a disguise to the registry needs no
//! second set of native icon assets.
//!
//! Deliberately *not* covered: the Android launcher icon. Swapping that needs an
//! `<activity-alias>` per disguise plus `setComponentEnabledSetting`, which kills the
//! running task and breaks any home-screen shortcut pointing at the old alias.

#[cfg(desktop)]
use base64::Engine;
use tauri::AppHandle;

/// Where this platform's identity is read from, so the frontend knows *when* to disguise.
///
/// `task` (Android) is only ever seen once the app is backgrounded, and the system may
/// snapshot the recents card as the app pauses — waiting for `visibilitychange` to fire
/// races that, and loses. The frontend therefore keeps a `task` identity disguised the
/// whole time privacy mode is armed. A `window` title is live and visible while the app
/// is in use, so there it tracks the tab exactly.
#[tauri::command]
pub fn native_identity_target() -> &'static str {
  if cfg!(target_os = "android") {
    "task"
  } else {
    "window"
  }
}

/// Point the native surfaces at a decoy identity.
#[tauri::command]
pub fn set_native_disguise(
  app: AppHandle,
  label: String,
  icon_png_base64: String,
) -> Result<(), String> {
  apply(&app, Some((&label, icon_png_base64.trim())))
}

/// Hand the native surfaces back their real identity.
///
/// The real label and icon are read from the platform's own metadata — the Tauri window
/// config on desktop, the package manager on Android — rather than passed in. The
/// frontend's idea of the app's name (`REAL_APP_TITLE`, "Potato Tomato Games") is not the
/// manifest's ("Potato Tomato"), and echoing it back here would quietly relabel the window
/// and the recents card of every install, including the ones that never turn privacy mode
/// on. Restoring from the source of truth cannot drift.
#[tauri::command]
pub fn clear_native_disguise(app: AppHandle) -> Result<(), String> {
  apply(&app, None)
}

#[cfg(desktop)]
fn real_window_title(app: &AppHandle) -> String {
  app
    .config()
    .app
    .windows
    .iter()
    .find(|w| w.label == "main")
    .map(|w| w.title.clone())
    .unwrap_or_else(|| app.package_info().name.clone())
}

/// `Some((label, icon))` disguises; `None` restores.
#[cfg(desktop)]
fn apply(app: &AppHandle, decoy: Option<(&str, &str)>) -> Result<(), String> {
  use tauri::Manager;
  use tauri::image::Image;

  let real_title = real_window_title(app);
  let decoded = match decoy {
    Some((_, icon_png_base64)) => Some(
      base64::engine::general_purpose::STANDARD
        .decode(icon_png_base64)
        .map_err(|e| format!("icon is not valid base64: {e}"))?,
    ),
    None => None,
  };
  let label = decoy.map(|(label, _)| label).unwrap_or(real_title.as_str());

  if let Some(window) = app.get_webview_window("main") {
    window
      .set_title(label)
      .map_err(|e| format!("could not set window title: {e}"))?;

    /*
     * Wayland takes the window icon from the .desktop file's app_id and ignores this
     * call; X11 honours it. Best-effort either way — the title is the half that always
     * lands, and it is the half GNOME shows in the top bar and the overview.
     */
    match decoded.as_deref() {
      Some(png) => {
        if let Ok(image) = Image::from_bytes(png) {
          let _ = window.set_icon(image);
        }
      }
      None => {
        if let Some(default_icon) = app.default_window_icon().cloned() {
          let _ = window.set_icon(default_icon);
        }
      }
    }
  }

  crate::tray::apply_disguise(app, label, decoded.as_deref());
  Ok(())
}

#[cfg(target_os = "android")]
fn apply(_app: &AppHandle, decoy: Option<(&str, &str)>) -> Result<(), String> {
  use jni::objects::JValue;

  crate::apk_update::with_activity(|env, activity| match decoy {
    /* Kotlin decodes the base64 PNG itself — one fewer copy across the JNI boundary. */
    Some((label, icon_png_base64)) => {
      let jlabel = env
        .new_string(label)
        .map_err(|e| format!("bad label string: {e}"))?;
      let jicon = env
        .new_string(icon_png_base64)
        .map_err(|e| format!("bad icon string: {e}"))?;
      env
        .call_method(
          activity,
          "setTaskDisguise",
          "(Ljava/lang/String;Ljava/lang/String;)V",
          &[JValue::Object(&jlabel), JValue::Object(&jicon)],
        )
        .map(|_| ())
        .map_err(|e| format!("setTaskDisguise failed: {e}"))
    }
    None => env
      .call_method(activity, "clearTaskDisguise", "()V", &[])
      .map(|_| ())
      .map_err(|e| format!("clearTaskDisguise failed: {e}")),
  })
}

#[cfg(all(mobile, not(target_os = "android")))]
fn apply(_app: &AppHandle, _decoy: Option<(&str, &str)>) -> Result<(), String> {
  /* iOS gives an app no way to rename or re-icon itself at runtime. */
  Ok(())
}
