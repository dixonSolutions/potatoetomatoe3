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
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;

/// Lines logged before the Tauri log plugin exists — everything that happens ahead of
/// `setup`, which is exactly the part that decides the launch colour. Buffered here and
/// replayed through `log` once a logger is installed, and echoed to stderr in debug
/// builds so a `tauri dev` terminal sees them live.
static EARLY_LOG: Mutex<Vec<String>> = Mutex::new(Vec::new());
static STARTED: Mutex<Option<Instant>> = Mutex::new(None);
static LOGGER_READY: AtomicBool = AtomicBool::new(false);

fn since_start_ms() -> u128 {
  let mut started = STARTED.lock().unwrap();
  started.get_or_insert_with(Instant::now).elapsed().as_millis()
}

/// Log a theme-bridge line, whether or not a logger exists yet.
pub fn trace(line: impl Into<String>) {
  let line = format!("[theme +{}ms] {}", since_start_ms(), line.into());
  if LOGGER_READY.load(Ordering::SeqCst) {
    log::info!("{line}");
    return;
  }
  if cfg!(debug_assertions) {
    eprintln!("{line}");
  }
  EARLY_LOG.lock().unwrap().push(line);
}

/// Replay everything logged before `setup` through the real logger, and log directly
/// from here on.
pub fn flush_early_log() {
  for line in EARLY_LOG.lock().unwrap().drain(..) {
    log::info!("{line}");
  }
  LOGGER_READY.store(true, Ordering::SeqCst);
}

/// The GTK-side inputs WebKit derives `prefers-color-scheme` from, plus every toplevel
/// GTK window this process owns — a second toplevel is what a "ghost window" would be.
pub fn gtk_state(context: &str) -> String {
  let settings = gtk::Settings::default();
  let theme = settings
    .as_ref()
    .and_then(|s| s.gtk_theme_name())
    .map(|n| n.to_string())
    .unwrap_or_else(|| "?".into());
  let prefer_dark = settings
    .as_ref()
    .map(|s| s.is_gtk_application_prefer_dark_theme().to_string())
    .unwrap_or_else(|| "?".into());
  let toplevels: Vec<String> = gtk::Window::list_toplevels()
    .iter()
    .filter_map(|w| w.downcast_ref::<gtk::Window>())
    .map(|w| {
      let alloc = w.allocation();
      format!(
        "{{title={:?} visible={} mapped={} realized={} size={}x{} type={:?}}}",
        w.title().map(|t| t.to_string()).unwrap_or_default(),
        w.is_visible(),
        w.is_mapped(),
        w.is_realized(),
        alloc.width(),
        alloc.height(),
        w.window_type()
      )
    })
    .collect();
  format!(
    "{context}: gtk-theme-name={theme} prefer-dark={prefer_dark} toplevels={} {}",
    toplevels.len(),
    toplevels.join(" ")
  )
}

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
  let _ = since_start_ms();
  gtk::init().map_err(|e| format!("GTK would not start, leaving light/dark alone: {e}"))?;
  trace(gtk_state("after gtk::init"));
  let bus = session_bus()?;
  let started = Instant::now();
  let read = read_color_scheme(&bus);
  trace(format!(
    "portal Read color-scheme -> {:?} in {}ms",
    read,
    started.elapsed().as_millis()
  ));
  let dark = read.ok_or_else(portal_unavailable)?;
  // Settle GTK now so the colour read below resolves against the right variant. `setup`
  // writes it again from the shared answer; the second write is a no-op.
  let changed = apply(dark);
  trace(format!("apply(dark={dark}) changed={changed}; {}", gtk_state("after apply")));
  Ok(dark)
}

/// The colour the desktop paints a window with, for the gap before the page paints.
///
/// Looked up from the GTK theme rather than assumed, because the app does not get to pick
/// its own colours — the same rule `app.css` follows with `Canvas`/`CanvasText`. A constant
/// here would be one more thing to disagree with the desktop, and would be wrong on any
/// theme but the one it was copied from.
///
/// `theme_bg_color` is the name Adwaita and its derivatives (Yaru included) give the window
/// base. A theme that does not define it gets no override at all, which leaves the webview
/// on its own default rather than on a guess.
pub fn theme_window_background() -> Option<(u8, u8, u8)> {
  let widget = gtk::Box::new(gtk::Orientation::Horizontal, 0);
  let rgba = widget.style_context().lookup_color("theme_bg_color");
  let to_u8 = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
  let colour = rgba.map(|rgba| (to_u8(rgba.red()), to_u8(rgba.green()), to_u8(rgba.blue())));
  trace(format!("theme_bg_color -> {colour:?}"));
  colour
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
///
/// `on_change` runs on the GTK thread after each switch has been mirrored, so callers
/// can repaint anything that was coloured from the old scheme.
pub fn follow_desktop_color_scheme(
  scheme: &Result<bool, String>,
  on_change: impl Fn(bool) + 'static,
) -> Result<(), String> {
  let bus = session_bus()?;
  log::info!("{}", gtk_state("setup"));

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
    move |_, sender, _, _, _, params| {
      // (namespace, key, value)
      let namespace = params.child_value(0).str().unwrap_or_default().to_owned();
      let key = params.child_value(1).str().unwrap_or_default().to_owned();
      log::debug!("portal SettingChanged from {sender}: {namespace} {key}");
      if namespace != APPEARANCE_NS || key != COLOR_SCHEME_KEY {
        return;
      }
      let value = params.child_value(2);
      let dark = prefers_dark(&value);
      log::debug!(
        "portal color-scheme announced as {} -> dark={dark:?}",
        value.print(true)
      );
      // Both xdg-desktop-portal-gnome and -gtk announce the same change, so log from the
      // write rather than the signal or every switch is reported twice.
      if let Some(dark) = dark {
        if apply(dark) {
          log::info!(
            "desktop switched to {}; {}",
            if dark { "dark" } else { "light" },
            gtk_state("after switch")
          );
          on_change(dark);
        }
      }
    },
  );
  // The subscription is meant to outlive this call; only process exit ends it.
  std::mem::forget(id);
  log::info!(
    "subscribed to portal SettingChanged (bus unique name {:?})",
    bus.unique_name().map(|n| n.to_string())
  );

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
