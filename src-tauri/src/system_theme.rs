//! Tell GTK what the desktop already decided about light and dark.
//!
//! Modern Linux desktops moved "dark mode" to the freedesktop appearance portal:
//! GNOME sets `org.freedesktop.appearance color-scheme` (and its own
//! `org.gnome.desktop.interface color-scheme`) and leaves the GTK theme *name* alone —
//! `Adwaita`, not `Adwaita-dark`. GTK3 never followed that move, so
//! `gtk-application-prefer-dark-theme` stays false on a desktop the user has switched
//! to Dark, and those two are the only inputs WebKitGTK derives `prefers-color-scheme`
//! from. The page was therefore told "light" and rendered light — correctly, from the
//! only signal it had — under a titlebar the compositor had already drawn dark.
//!
//! Reading the portal and mirroring it onto `GtkSettings` fixes it at the source: the
//! media query, the `Canvas`/`CanvasText` system colours that resolve per `color-scheme`,
//! and GTK's own widgets all pick it up, with nothing in the frontend needing to know
//! this happened. Mirroring the changes too is what keeps it true while the app runs.
//!
//! No portal (no session bus, an older desktop, a Flatpak without the Settings portal)
//! means no signal to mirror, so we leave `GtkSettings` exactly as we found it and the
//! theme name keeps deciding, as it did before.

use gtk::gio;
use gtk::glib::Variant;
use gtk::prelude::*;
use std::cell::RefCell;

const PORTAL_NAME: &str = "org.freedesktop.portal.Desktop";
const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";
const PORTAL_IFACE: &str = "org.freedesktop.portal.Settings";
const APPEARANCE_NS: &str = "org.freedesktop.appearance";
const COLOR_SCHEME_KEY: &str = "color-scheme";

thread_local! {
  /// Holds the bus open for the life of the process; dropping it would drop the
  /// `SettingChanged` subscription with it and freeze the app on its startup scheme.
  static PORTAL_BUS: RefCell<Option<gio::DBusConnection>> = const { RefCell::new(None) };
}

/// Mirror the desktop's colour-scheme onto `GtkSettings`, now and on every change.
///
/// Call once, from the GTK thread, after Tauri has initialised GTK.
pub fn follow_desktop_color_scheme() {
  let bus = match gio::bus_get_sync(gio::BusType::Session, gio::Cancellable::NONE) {
    Ok(bus) => bus,
    Err(e) => {
      log::info!("no session bus, leaving the GTK theme to decide light/dark: {e}");
      return;
    }
  };

  match read_color_scheme(&bus) {
    Some(dark) => apply(dark),
    None => log::info!("appearance portal unavailable, leaving the GTK theme to decide light/dark"),
  }

  // Subscribed unconditionally: a desktop that cannot answer `Read` right now (portal
  // still starting up) can still announce the next change.
  let id = bus.signal_subscribe(
    Some(PORTAL_NAME),
    Some(PORTAL_IFACE),
    Some("SettingChanged"),
    Some(PORTAL_PATH),
    None,
    gio::DBusSignalFlags::NONE,
    |_, _, _, _, _, params| {
      // (namespace, key, value)
      let namespace = params.child_value(0).str().unwrap_or_default().to_owned();
      let key = params.child_value(1).str().unwrap_or_default().to_owned();
      if namespace != APPEARANCE_NS || key != COLOR_SCHEME_KEY {
        return;
      }
      if let Some(dark) = prefers_dark(&params.child_value(2)) {
        apply(dark);
      }
    },
  );
  // The subscription is meant to outlive this call; only process exit ends it.
  std::mem::forget(id);

  PORTAL_BUS.with(|slot| *slot.borrow_mut() = Some(bus));
}

fn read_color_scheme(bus: &gio::DBusConnection) -> Option<bool> {
  let reply = bus
    .call_sync(
      Some(PORTAL_NAME),
      PORTAL_PATH,
      PORTAL_IFACE,
      "Read",
      Some(&(APPEARANCE_NS, COLOR_SCHEME_KEY).to_variant()),
      None,
      gio::DBusCallFlags::NONE,
      1000,
      gio::Cancellable::NONE,
    )
    .map_err(|e| log::debug!("appearance portal Read failed: {e}"))
    .ok()?;
  prefers_dark(&reply.child_value(0))
}

/// `1` is prefer-dark, `2` is prefer-light and `0` is no preference; anything else is a
/// value this version of the spec does not define, and guessing at it would be worse than
/// leaving the GTK theme to decide.
///
/// The number arrives nested in variants, and how deeply depends on who answers: the
/// portal's `Read` wraps its `v` return in another `v`, while `SettingChanged` carries the
/// value bare. Unwrap until a number appears rather than assuming a depth.
fn prefers_dark(value: &Variant) -> Option<bool> {
  let mut value = value.clone();
  while let Some(inner) = value.as_variant() {
    value = inner;
  }
  match value.get::<u32>()? {
    1 => Some(true),
    2 => Some(false),
    _ => None,
  }
}

fn apply(dark: bool) {
  let Some(settings) = gtk::Settings::default() else {
    return;
  };
  if settings.is_gtk_application_prefer_dark_theme() == dark {
    return;
  }
  log::info!("desktop colour-scheme is {}", if dark { "dark" } else { "light" });
  settings.set_gtk_application_prefer_dark_theme(dark);
}
