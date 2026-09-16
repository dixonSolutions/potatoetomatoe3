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
//!
//! Two phases, because they need different things: the colour the window is *built* with
//! has to be decided before GTK exists — D-Bus alone can answer that — while writing to
//! `GtkSettings` needs GTK up, which only happens once Tauri has started.
//!
//! Linux-only, and only because Linux needs it: Android's WebView, WebView2 and WKWebView
//! all answer `prefers-color-scheme` from the OS themselves, so the page already follows
//! there and a bridge would be a second opinion to disagree with. What is read here is the
//! cross-desktop freedesktop spec, not a GNOME detail — KDE, Cinnamon and the wlroots
//! portals publish the same `org.freedesktop.appearance color-scheme` — and the values are
//! the spec's, so it is only GTK3's absence from that spec that is being patched over.

use gtk::gio;
use gtk::glib::{Variant, VariantTy};
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

/// What the desktop published, with nothing done about it yet.
///
/// Only D-Bus, so unlike the rest of this module it can be asked before GTK exists — which
/// is the point: the window's background colour has to be decided before the window is, or
/// the app spends the whole page load as a white sheet inside a dark window.
///
/// Ask once and pass the answer around. Asking again in `setup` looked equivalent and was
/// not: the portal is still starting up alongside the app, so the first `Read` can time out
/// while a second one a moment later succeeds. That combination is what produced a white
/// launch under a log line that said "dark" — the colour had already been skipped.
pub fn desktop_prefers_dark() -> Result<bool, String> {
  let bus = session_bus()?;
  read_color_scheme(&bus).ok_or_else(portal_unavailable)
}

/// Mirror an already-read scheme onto `GtkSettings`, and keep mirroring every change.
///
/// Call once from the GTK thread, after Tauri has initialised GTK.
///
/// A scheme the early read missed is asked for again rather than written off, because that
/// read raced the portal's own startup and the portal has had all of Tauri's init to finish
/// since. `SettingChanged` is no substitute: it announces a change, not the portal becoming
/// ready, so without the retry one timed-out `Read` would leave a dark desktop light for
/// the rest of the session.
pub fn follow_desktop_color_scheme(scheme: &Result<bool, String>) -> Result<(), String> {
  let bus = session_bus()?;

  let scheme = match *scheme {
    Ok(dark) => Some(dark),
    Err(_) => read_color_scheme(&bus).inspect(|dark| {
      log::info!(
        "appearance portal answered on retry: desktop colour-scheme is {}",
        if *dark { "dark" } else { "light" }
      );
    }),
  };
  if let Some(dark) = scheme {
    let _ = apply(dark);
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
      // Both xdg-desktop-portal-gnome and -gtk announce the same change, so log from the
      // write rather than the signal or every switch is reported twice.
      if let Some(dark) = prefers_dark(&params.child_value(2)) {
        if apply(dark) {
          log::info!("desktop switched to {}", if dark { "dark" } else { "light" });
        }
      }
    },
  );
  // The subscription is meant to outlive this call; only process exit ends it.
  std::mem::forget(id);

  PORTAL_BUS.with(|slot| *slot.borrow_mut() = Some(bus));
  Ok(())
}

fn session_bus() -> Result<gio::DBusConnection, String> {
  gio::bus_get_sync(gio::BusType::Session, gio::Cancellable::NONE)
    .map_err(|e| format!("no session bus, leaving the GTK theme to decide light/dark: {e}"))
}

fn portal_unavailable() -> String {
  "appearance portal unavailable, leaving the GTK theme to decide light/dark".to_owned()
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

/// `1` is prefer-dark, and both `2` (prefer-light) and `0` (no preference) are "not dark":
/// GNOME's Appearance panel writes `0` for Light and never writes `2`, so letting `0` skip
/// the apply would leave a dark scheme this process already wrote stuck on. False is GTK's
/// own default, so writing it is how the theme name gets the decision back. Anything else is
/// a value this version of the spec does not define, and guessing at it would be worse than
/// leaving the GTK theme to decide.
///
/// The number arrives nested in variants, and how deeply depends on who answers: the
/// portal's `Read` wraps its `v` return in another `v`, while `SettingChanged` carries the
/// value bare. Unwrap until a number appears rather than assuming a depth — checking the
/// type first, because `as_variant()` on anything else is a GLib assertion failure, which
/// it logged as a CRITICAL on every single startup.
fn prefers_dark(value: &Variant) -> Option<bool> {
  let mut value = value.clone();
  while value.type_() == VariantTy::VARIANT {
    match value.as_variant() {
      Some(inner) => value = inner,
      None => break,
    }
  }
  match value.get::<u32>()? {
    1 => Some(true),
    0 | 2 => Some(false),
    _ => None,
  }
}

/// Returns whether this actually changed anything.
fn apply(dark: bool) -> bool {
  let Some(settings) = gtk::Settings::default() else {
    return false;
  };
  if settings.is_gtk_application_prefer_dark_theme() == dark {
    return false;
  }
  settings.set_gtk_application_prefer_dark_theme(dark);
  true
}
