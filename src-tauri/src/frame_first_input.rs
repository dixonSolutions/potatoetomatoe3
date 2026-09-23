//! Let a game frame run at full rate before the player first touches it (Linux).
//!
//! WebKit throttles `requestAnimationFrame` in a cross-origin frame the user has not
//! interacted with to 30 fps, and every game the app plays is cross-origin to the app page.
//! The throttle lifts on the first user gesture inside the frame: a click, or a key press
//! while the frame has focus (both measured, see the engine bench report's "Implemented"
//! section). The app does not want a "click to play" cover, so once the game frame has loaded
//! and has keyboard focus, the frontend asks for one key press here, which is sent to the
//! WebKitWebView as a GDK event — WebKit handles it as the user's own input, and the frame's
//! document counts as interacted with.
//!
//! The key is F24: nothing on a normal keyboard sends it, no browser game binds it, WebKit
//! reports it as `key: "Unidentified"`, `keyCode: 135`, and GTK has no accelerator on it.
//! The app's game-frame script (`game_frame_tuning.js`) swallows it in every game frame
//! before any game listener, so no game ever sees it.
//!
//! Anything that fails here just leaves the throttle to lift on the player's first input,
//! which is what happened before.

/// Send one F24 press and release to this webview's focused frame. `Ok(false)` where the
/// platform has no such throttle (not Linux).
#[tauri::command]
pub async fn lift_game_frame_throttle(webview: tauri::Webview) -> Result<bool, String> {
  if std::env::var("POTATO_TOMATO_FIRST_INPUT").as_deref() == Ok("0") {
    return Ok(false);
  }
  #[cfg(target_os = "linux")]
  {
    let (tx, rx) = std::sync::mpsc::channel();
    webview
      .with_webview(move |platform| {
        let _ = tx.send(linux::press_f24(&platform.inner()));
      })
      .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
      rx.recv_timeout(std::time::Duration::from_secs(2))
        .map_err(|_| "timed out waiting for GTK".to_string())?
    })
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

#[cfg(target_os = "linux")]
mod linux {
  use gtk::gdk;
  use gtk::glib::translate::{ToGlibPtr, ToGlibPtrMut};
  use gtk::prelude::*;

  const GDK_KEY_F24: u32 = 0xffd5;

  /// Main thread only (`with_webview` runs its closure there).
  pub fn press_f24(view: &webkit2gtk::WebView) -> Result<(), String> {
    let window = view.window().ok_or("the webview has no window yet")?;
    let display = view.display();
    let keyboard = display.default_seat().and_then(|seat| seat.keyboard());
    /* The key's code on this keymap, when it has one; WebKit copes with 0. */
    let (keycode, group) = gdk::Keymap::for_display(&display)
      .and_then(|keymap| keymap.entries_for_keyval(GDK_KEY_F24).into_iter().next())
      .map(|key| (key.keycode() as u16, key.group() as u8))
      .unwrap_or((0, 0));
    for kind in [gdk::EventType::KeyPress, gdk::EventType::KeyRelease] {
      let mut event = gdk::Event::new(kind);
      unsafe {
        let raw: *mut gdk::ffi::GdkEvent = event.to_glib_none_mut().0;
        let key = &mut (*raw).key;
        /* The event owns a reference to its window: gdk_event_free drops it. */
        key.window = window.to_glib_full();
        key.send_event = 0;
        key.time = gtk::current_event_time();
        key.state = 0;
        key.keyval = GDK_KEY_F24;
        key.hardware_keycode = keycode;
        key.group = group;
        key.is_modifier = 0;
      }
      event.set_device(keyboard.as_ref());
      view.event(&event);
    }
    log::info!("first input: sent F24 to the game frame (keycode {keycode})");
    Ok(())
  }
}
