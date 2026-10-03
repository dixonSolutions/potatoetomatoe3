//! The display's real scale, for game frames on fractional-scaled desktops (Linux).
//!
//! GTK3 has no fractional scaling: on a monitor at 125 % it renders at scale 2 and the
//! compositor scales the result down, so WebKitGTK reports `devicePixelRatio` 2 and a game
//! sizes its canvas for 2.56 times the pixels a browser at 1.25 would draw. GPU-bound games
//! lose more than half their frame rate to it (engine bench: GL heavy 8 fps where Chromium
//! does 20, WebGL sprites 31 against 60). Capping `devicePixelRatio` in game frames at the
//! monitor's real scale brings both back (19 and 60), and leaves the app's own UI alone.
//!
//! GTK only knows the integer, so the real scale comes from the compositor: on GNOME,
//! `org.gnome.Mutter.DisplayConfig.GetCurrentState`, the logical monitor the window is on.
//! It is read at each game start (one D-Bus call), so a monitor change applies from the next
//! game. Anywhere the answer is not clear — another desktop, X11, a physical-pixel layout,
//! a Flatpak without access to that bus name, a window whose monitor cannot be matched — the
//! answer is "no cap", which is how the app behaved before.

#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use serde::Serialize;

/// One logical monitor as Mutter reports it: position in the layout, and scale.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LogicalMonitor {
  pub x: i32,
  pub y: i32,
  pub scale: f64,
}

/// The part of Mutter's display state this needs.
#[derive(Debug, Clone, PartialEq)]
pub struct Layout {
  pub monitors: Vec<LogicalMonitor>,
  /// Mutter's `layout-mode` is logical (1), where fractional scales exist. Physical (2)
  /// layouts only ever have integer scales.
  pub logical: bool,
}

/// Where GTK put the window: its monitor's logical origin and integer scale.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WindowMonitor {
  pub x: i32,
  pub y: i32,
  pub gtk_scale: i32,
}

/// The logical monitor the window is on: the one at the GDK monitor's origin, or the only
/// one there is.
pub fn real_scale(layout: &Layout, window: WindowMonitor) -> Option<f64> {
  if !layout.logical {
    return None;
  }
  let found = layout
    .monitors
    .iter()
    .find(|m| m.x == window.x && m.y == window.y)
    .or(if layout.monitors.len() == 1 {
      layout.monitors.first()
    } else {
      None
    })?;
  (found.scale.is_finite() && found.scale > 0.0).then_some(found.scale)
}

/// The `devicePixelRatio` cap for game frames: the real scale, when WebKit renders above it.
pub fn dpr_cap(real: Option<f64>, gtk_scale: i32) -> Option<f64> {
  let real = real?;
  (real + 0.01 < f64::from(gtk_scale)).then_some(real)
}

/// What Settings shows about the display.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayScaleStatus {
  /// The monitor's real scale, when it could be read.
  pub scale: Option<f64>,
  /// The scale WebKit renders at (GTK's integer scale).
  pub webkit_scale: Option<i32>,
  /// The cap game frames get: `Some` only when it is lower than WebKit's scale.
  pub cap: Option<f64>,
  /// Why there is no reading, when there is none.
  pub detail: Option<String>,
}

#[cfg(target_os = "linux")]
mod linux {
  use super::{Layout, LogicalMonitor, WindowMonitor};
  use gtk::gio;
  use gtk::glib::{Variant, VariantDict, VariantTy};
  use gtk::prelude::*;

  const NAME: &str = "org.gnome.Mutter.DisplayConfig";
  const PATH: &str = "/org/gnome/Mutter/DisplayConfig";
  const REPLY: &str = "(ua((ssss)a(siiddada{sv})a{sv})a(iiduba(ssss)a{sv})a{sv})";

  /// Mutter's layout. Blocking D-Bus call (a few ms): not for the GTK main thread.
  pub fn read_layout() -> Result<Layout, String> {
    let bus = gio::bus_get_sync(gio::BusType::Session, gio::Cancellable::NONE)
      .map_err(|e| format!("no session bus: {e}"))?;
    let reply = bus
      .call_sync(
        Some(NAME),
        PATH,
        NAME,
        "GetCurrentState",
        None,
        Some(VariantTy::new(REPLY).expect("reply type")),
        gio::DBusCallFlags::NONE,
        1000,
        gio::Cancellable::NONE,
      )
      .map_err(|e| format!("{NAME} unavailable (not GNOME, or no access): {e}"))?;
    Ok(parse(&reply))
  }

  pub fn parse(reply: &Variant) -> Layout {
    let logical_monitors = reply.child_value(2);
    let monitors = (0..logical_monitors.n_children())
      .map(|i| {
        let m = logical_monitors.child_value(i);
        LogicalMonitor {
          x: m.child_value(0).get::<i32>().unwrap_or(0),
          y: m.child_value(1).get::<i32>().unwrap_or(0),
          scale: m.child_value(2).get::<f64>().unwrap_or(1.0),
        }
      })
      .collect();
    /* Absent means an old Mutter, which only had logical layouts on Wayland. */
    let mode = VariantDict::new(Some(&reply.child_value(3)))
      .lookup_value("layout-mode", Some(VariantTy::UINT32))
      .and_then(|v| v.get::<u32>())
      .unwrap_or(1);
    Layout {
      monitors,
      logical: mode == 1,
    }
  }

  /// The GDK monitor under the webview's window. Wayland only: on X11 GTK's scale is a
  /// global setting and the compositor does not rescale what the app draws. Main thread.
  pub fn window_monitor(view: &gtk::Widget) -> Result<WindowMonitor, String> {
    let display = view.display();
    if display.type_().name() != "GdkWaylandDisplay" {
      return Err(format!(
        "not a Wayland session ({})",
        display.type_().name()
      ));
    }
    let window = view.window().ok_or("the webview has no window yet")?;
    let monitor = display
      .monitor_at_window(&window)
      .ok_or("no monitor for the window")?;
    let geometry = monitor.geometry();
    Ok(WindowMonitor {
      x: geometry.x(),
      y: geometry.y(),
      gtk_scale: monitor.scale_factor(),
    })
  }
}

#[cfg(target_os = "linux")]
pub use linux::{read_layout, window_monitor};

/// The display's scale as the next game would see it.
#[tauri::command]
pub async fn display_scale_status(webview: tauri::Webview) -> DisplayScaleStatus {
  #[cfg(target_os = "linux")]
  {
    let layout = tauri::async_runtime::spawn_blocking(read_layout)
      .await
      .unwrap_or_else(|e| Err(e.to_string()));
    let (tx, rx) = std::sync::mpsc::channel();
    let sent = webview.with_webview(move |platform| {
      use gtk::prelude::Cast;
      let view = platform.inner();
      let _ = tx.send(window_monitor(view.upcast_ref()));
    });
    let window = match sent {
      Ok(()) => rx
        .recv_timeout(std::time::Duration::from_secs(2))
        .unwrap_or_else(|_| Err("timed out asking GTK".into())),
      Err(e) => Err(e.to_string()),
    };
    let mut status = DisplayScaleStatus::default();
    match (layout, window) {
      (Ok(layout), Ok(window)) => {
        status.webkit_scale = Some(window.gtk_scale);
        status.scale = real_scale(&layout, window);
        status.cap = dpr_cap(status.scale, window.gtk_scale);
        if status.scale.is_none() {
          status.detail = Some(if layout.logical {
            "could not tell which monitor the window is on".into()
          } else {
            "the desktop lays monitors out in physical pixels".into()
          });
        }
      }
      (Err(why), Ok(window)) => {
        status.webkit_scale = Some(window.gtk_scale);
        status.detail = Some(why);
      }
      (_, Err(why)) => status.detail = Some(why),
    }
    status
  }
  #[cfg(not(target_os = "linux"))]
  {
    let _ = webview;
    DisplayScaleStatus {
      detail: Some("only the Linux app renders games through GTK".into()),
      ..Default::default()
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn layout(monitors: &[(i32, i32, f64)]) -> Layout {
    Layout {
      monitors: monitors
        .iter()
        .map(|&(x, y, scale)| LogicalMonitor { x, y, scale })
        .collect(),
      logical: true,
    }
  }

  fn at(x: i32, y: i32, gtk_scale: i32) -> WindowMonitor {
    WindowMonitor { x, y, gtk_scale }
  }

  #[test]
  fn a_single_fractional_monitor_caps_at_its_scale() {
    let l = layout(&[(0, 0, 1.25)]);
    assert_eq!(real_scale(&l, at(0, 0, 2)), Some(1.25));
    assert_eq!(dpr_cap(Some(1.25), 2), Some(1.25));
  }

  #[test]
  fn picks_the_monitor_the_window_is_on() {
    let l = layout(&[(0, 0, 1.0), (1920, 0, 1.5)]);
    assert_eq!(real_scale(&l, at(1920, 0, 2)), Some(1.5));
    assert_eq!(real_scale(&l, at(0, 0, 1)), Some(1.0));
    /* Two monitors and neither matches: no guess. */
    assert_eq!(real_scale(&l, at(5, 5, 2)), None);
  }

  #[test]
  fn no_cap_at_integer_scales_or_in_physical_layouts() {
    assert_eq!(dpr_cap(Some(2.0), 2), None);
    assert_eq!(dpr_cap(Some(1.0), 1), None);
    assert_eq!(dpr_cap(None, 2), None);
    let mut l = layout(&[(0, 0, 1.25)]);
    l.logical = false;
    assert_eq!(real_scale(&l, at(0, 0, 2)), None);
  }

  #[cfg(target_os = "linux")]
  #[test]
  fn parses_mutter_state() {
    use gtk::glib::{ToVariant, Variant, VariantDict};
    let props = VariantDict::new(None);
    props.insert_value("layout-mode", &1u32.to_variant());
    let empty_props = VariantDict::new(None).end();
    let spec = ("eDP-1", "BOE", "0x0", "0x0");
    let logical = Variant::array_from_iter_with_type(
      gtk::glib::VariantTy::new("(iiduba(ssss)a{sv})").unwrap(),
      [Variant::tuple_from_iter([
        0i32.to_variant(),
        0i32.to_variant(),
        1.25f64.to_variant(),
        0u32.to_variant(),
        true.to_variant(),
        vec![spec].to_variant(),
        empty_props.clone(),
      ])],
    );
    let monitors = Variant::array_from_iter_with_type(
      gtk::glib::VariantTy::new("((ssss)a(siiddada{sv})a{sv})").unwrap(),
      std::iter::empty::<Variant>(),
    );
    let reply = Variant::tuple_from_iter([1u32.to_variant(), monitors, logical, props.end()]);
    let parsed = linux::parse(&reply);
    assert!(parsed.logical);
    assert_eq!(
      parsed.monitors,
      vec![LogicalMonitor {
        x: 0,
        y: 0,
        scale: 1.25
      }]
    );
  }
}
