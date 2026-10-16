//! Recovering from a crashed web process.
//!
//! Some games take WebKitGTK's web process down with them — the AddictingGames HTML5
//! titles crash it through WebGL here (see docs/native-first.md) — and the app page dies
//! with it: the window goes blank and stays blank. On Linux the app listens for
//! `web-process-terminated` on its webview and reloads the page the user was on.
//!
//! A game page is not simply reloaded into the same game: that would crash again, reload
//! again, and so on. The crash is recorded here, and the reloaded game page takes it
//! (`take_webview_crash`) and shows "This game crashed the player" with an "Open in
//! browser" action instead of starting the game. Reloads are capped as well, at
//! `MAX_RELOADS` a minute; past that a static page says what happened and offers a way back.
//! The same page is not reloaded twice within `REPEAT_WINDOW` either: a leak that takes a
//! few minutes to get the web process killed (issue #59: 10 GB in 2.5 minutes, on Home)
//! never reaches the per-minute cap, so it reloaded into the same leak forever and dragged
//! the desktop through memory pressure each time.
//!
//! Debug builds can crash the web process on purpose: the `debug_crash_webview` command,
//! or `POTATO_TOMATO_DEBUG_CRASH_ON_GAME=<ms>`, which terminates it once a game page has
//! been open that long (every time, with `POTATO_TOMATO_DEBUG_CRASH_REPEAT=1`, to exercise
//! the reload cap).

// Only the Linux webview is watched; elsewhere the commands answer "nothing happened".
#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use serde::Serialize;
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Automatic reloads allowed within `RELOAD_WINDOW` before the app stops reloading.
pub const MAX_RELOADS: usize = 3;
pub const RELOAD_WINDOW: Duration = Duration::from_secs(60);
/// A page that crashes again this soon after being reloaded from a crash stays down.
pub const REPEAT_WINDOW: Duration = Duration::from_secs(10 * 60);

/// What the reloaded page learns about the crash.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewCrash {
  /// The game whose page was open, when it was a game page.
  pub game_id: Option<String>,
  /// `crashed`, `exceeded-memory-limit` or `terminated` (the debug trigger).
  pub reason: String,
  /// The page that was open.
  pub url: String,
  /// Milliseconds since the Unix epoch.
  pub at: u64,
}

static LAST_CRASH: Mutex<Option<WebviewCrash>> = Mutex::new(None);
static RELOADS: Mutex<Reloads> = Mutex::new(Reloads {
  recent: VecDeque::new(),
  last: None,
});

/// The automatic reloads so far.
#[derive(Default)]
pub struct Reloads {
  /// Within the last `RELOAD_WINDOW`.
  recent: VecDeque<Instant>,
  /// The page last reloaded, without query or hash, and when.
  last: Option<(String, Instant)>,
}

/// What to do about a crash.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Recovery {
  Reload,
  /// `MAX_RELOADS` within `RELOAD_WINDOW` already.
  TooMany,
  /// This page was reloaded from a crash less than `REPEAT_WINDOW` ago.
  CrashedAgain,
}

fn percent_decode(s: &str) -> Option<String> {
  let bytes = s.as_bytes();
  let mut out = Vec::with_capacity(bytes.len());
  let mut i = 0;
  while i < bytes.len() {
    if bytes[i] == b'%' {
      let hex = s.get(i + 1..i + 3)?;
      out.push(u8::from_str_radix(hex, 16).ok()?);
      i += 3;
    } else {
      out.push(bytes[i]);
      i += 1;
    }
  }
  String::from_utf8(out).ok()
}

/// The catalog id when `url` is the app's game page (`…/games/<id>`), else `None`.
pub fn game_id_of_url(url: &str) -> Option<String> {
  let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
  let path = &rest[rest.find('/')?..];
  let path = path.split(['?', '#']).next().unwrap_or_default();
  let mut segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
  let id = segments.pop()?;
  if segments.last() != Some(&"games") {
    return None;
  }
  let id = percent_decode(id)?;
  crate::game_frames::is_catalog_id(&id).then_some(id)
}

/// Whether `url` may be reloaded after a crash now; counts the reload when it may.
pub fn decide_reload(reloads: &mut Reloads, url: &str, now: Instant) -> Recovery {
  let page = crate::game_frame_tuning::page_path(url);
  if reloads
    .last
    .as_ref()
    .is_some_and(|(last, at)| *last == page && now.duration_since(*at) < REPEAT_WINDOW)
  {
    return Recovery::CrashedAgain;
  }
  let recent = &mut reloads.recent;
  while let Some(first) = recent.front() {
    if now.duration_since(*first) >= RELOAD_WINDOW {
      recent.pop_front();
    } else {
      break;
    }
  }
  if recent.len() >= MAX_RELOADS {
    return Recovery::TooMany;
  }
  recent.push_back(now);
  reloads.last = Some((page, now));
  Recovery::Reload
}

fn now_ms() -> u64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_millis() as u64)
    .unwrap_or(0)
}

/// Keep the crash for the reloaded page, and decide whether to reload it.
fn note_crash(url: &str, reason: &str) -> (WebviewCrash, Recovery) {
  let crash = WebviewCrash {
    game_id: game_id_of_url(url),
    reason: reason.to_string(),
    url: url.to_string(),
    at: now_ms(),
  };
  if let Ok(mut last) = LAST_CRASH.lock() {
    *last = Some(crash.clone());
  }
  let recovery = RELOADS
    .lock()
    .map(|mut reloads| decide_reload(&mut reloads, url, Instant::now()))
    .unwrap_or(Recovery::TooMany);
  (crash, recovery)
}

/// `scheme://host[:port]` of `url`, or empty.
fn origin_of(url: &str) -> String {
  url
    .split_once("://")
    .map(|(scheme, rest)| format!("{scheme}://{}", rest.split('/').next().unwrap_or_default()))
    .unwrap_or_default()
}

/// Why the page was not reloaded, for the log and the stopped page.
fn stopped_because(recovery: Recovery) -> String {
  match recovery {
    Recovery::CrashedAgain => format!(
      "it crashed again within {} minutes of being reloaded",
      REPEAT_WINDOW.as_secs() / 60
    ),
    _ => format!(
      "it crashed {MAX_RELOADS} times within {}s",
      RELOAD_WINDOW.as_secs()
    ),
  }
}

/// What the page shows once it is no longer reloaded.
fn stopped_page(crash: &WebviewCrash, recovery: Recovery) -> String {
  let origin = origin_of(&crash.url);
  let game = match &crash.game_id {
    Some(id) => format!("<p>It happened on the page of <code>{}</code>.</p>", html_escape(id)),
    None => String::new(),
  };
  format!(
    "<!doctype html><meta charset=utf-8><title>Potato Tomato stopped</title>\
     <style>body{{font:15px system-ui,sans-serif;margin:0;display:grid;place-items:center;\
     min-height:100vh;background:#1b1b1f;color:#eee}}main{{max-width:34em;padding:24px}}\
     a{{color:#8ab4f8}}code{{background:#333;padding:0 4px;border-radius:3px}}\
     @media (prefers-color-scheme: light){{body{{background:#fafafa;color:#222}}code{{background:#e8e8e8}}}}</style>\
     <main><h1>The player keeps crashing</h1>\
     <p>The page was not reloaded: {}.</p>{game}\
     <p><a href=\"{origin}/home\">Back to the games</a></p></main>",
    stopped_because(recovery)
  )
}

fn html_escape(s: &str) -> String {
  s.replace('&', "&amp;")
    .replace('<', "&lt;")
    .replace('>', "&gt;")
    .replace('"', "&quot;")
}

/// The crash the page was reloaded after, once: the first caller takes it.
#[tauri::command]
pub fn take_webview_crash() -> Option<WebviewCrash> {
  LAST_CRASH.lock().ok()?.take()
}

/// Debug builds only: terminate this webview's web process, as a crash would.
#[tauri::command]
pub fn debug_crash_webview(webview: tauri::Webview) -> Result<(), String> {
  if !cfg!(debug_assertions) {
    return Err("only debug builds can crash the web process on purpose".into());
  }
  #[cfg(target_os = "linux")]
  {
    webview
      .with_webview(|platform| {
        use webkit2gtk::WebViewExt;
        log::warn!("debug_crash_webview: terminating the web process");
        platform.inner().terminate_web_process();
      })
      .map_err(|e| e.to_string())
  }
  #[cfg(not(target_os = "linux"))]
  {
    let _ = webview;
    Err("crashing the web process is only wired up on Linux".into())
  }
}

#[cfg(target_os = "linux")]
mod linux {
  use super::{note_crash, stopped_because, stopped_page, Recovery};
  use webkit2gtk::{WebProcessTerminationReason, WebViewExt};

  fn reason_name(reason: WebProcessTerminationReason) -> &'static str {
    match reason {
      WebProcessTerminationReason::Crashed => "crashed",
      WebProcessTerminationReason::ExceededMemoryLimit => "exceeded-memory-limit",
      WebProcessTerminationReason::TerminatedByApi => "terminated",
      _ => "unknown",
    }
  }

  pub fn attach(view: &webkit2gtk::WebView) {
    view.connect_web_process_terminated(|view, reason| {
      crate::power_profile::web_process_terminated(reason_name(reason));
      let url = view.uri().map(|u| u.to_string()).unwrap_or_default();
      let (crash, recovery) = note_crash(&url, reason_name(reason));
      if recovery == Recovery::Reload {
        let message = format!(
          "web process {} on {url}{}; reloading the page",
          crash.reason,
          crash
            .game_id
            .as_deref()
            .map(|id| format!(" (game {id})"))
            .unwrap_or_default()
        );
        log::warn!("{message}");
        if !cfg!(debug_assertions) {
          eprintln!("potato-tomato: {message}");
        }
        /* Not from inside the signal: let WebKit finish tearing the old process down. */
        let view = view.clone();
        gtk::glib::idle_add_local_once(move || view.reload());
      } else {
        let message = format!(
          "web process {} on {url}: {} — not reloading",
          crash.reason,
          stopped_because(recovery)
        );
        log::error!("{message}");
        if !cfg!(debug_assertions) {
          eprintln!("potato-tomato: {message}");
        }
        let page = stopped_page(&crash, recovery);
        /* Based on the app's origin, not the game page: it is no longer that page. */
        let base = format!("{}/", super::origin_of(&url));
        let view = view.clone();
        gtk::glib::idle_add_local_once(move || view.load_html(&page, Some(&base)));
      }
    });
    debug_crash_trigger(view);
  }

  /// `POTATO_TOMATO_DEBUG_CRASH_ON_GAME=<ms>` (debug builds): crash once a game page has
  /// been open that long — once per run, or each time with `POTATO_TOMATO_DEBUG_CRASH_REPEAT=1`.
  fn debug_crash_trigger(view: &webkit2gtk::WebView) {
    if !cfg!(debug_assertions) {
      return;
    }
    let Some(after_ms) = std::env::var("POTATO_TOMATO_DEBUG_CRASH_ON_GAME")
      .ok()
      .and_then(|raw| raw.trim().parse::<u64>().ok())
    else {
      return;
    };
    let repeat = std::env::var_os("POTATO_TOMATO_DEBUG_CRASH_REPEAT").is_some();
    log::info!("debug: crashing the web process {after_ms} ms into a game page (repeat={repeat})");
    let view = view.clone();
    /* The game page on screen, since when, and whether the crash already fired. */
    let mut page: Option<String> = None;
    let mut since = std::time::Instant::now();
    let mut fired = false;
    gtk::glib::timeout_add_local(std::time::Duration::from_millis(250), move || {
      if fired && !repeat {
        return gtk::glib::ControlFlow::Break;
      }
      let game = view
        .uri()
        .and_then(|u| super::game_id_of_url(u.as_str()));
      if game.is_none() || game != page {
        page = game;
        since = std::time::Instant::now();
        return gtk::glib::ControlFlow::Continue;
      }
      if since.elapsed().as_millis() as u64 >= after_ms {
        log::warn!(
          "debug: terminating the web process on the game page of {}",
          page.as_deref().unwrap_or_default()
        );
        view.terminate_web_process();
        fired = true;
        /* The reload starts the clock again. */
        page = None;
      }
      gtk::glib::ControlFlow::Continue
    });
  }
}

/// Watch the app's webview for a crashed web process and recover from it.
pub fn watch(window: &tauri::WebviewWindow) {
  #[cfg(target_os = "linux")]
  if let Err(e) = window.with_webview(|platform| linux::attach(&platform.inner())) {
    log::warn!("could not watch the webview for crashes: {e}");
  }
  #[cfg(not(target_os = "linux"))]
  let _ = window;
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn finds_the_game_of_a_game_page_only() {
    assert_eq!(
      game_id_of_url("tauri://localhost/games/crazygames-2048"),
      Some("crazygames-2048".into())
    );
    assert_eq!(
      game_id_of_url("http://127.0.0.1:5173/games/2016%20-%20diamond%20run/?x=1#top"),
      Some("2016 - diamond run".into())
    );
    for url in [
      "tauri://localhost/home",
      "tauri://localhost/games",
      "tauri://localhost/games/",
      "tauri://localhost/games/x/online/index.html",
      "tauri://localhost/games/..%2Fetc",
      "tauri://localhost/games/%zz",
      "",
    ] {
      assert_eq!(game_id_of_url(url), None, "{url:?}");
    }
  }

  fn at(start: Instant, secs: u64) -> Instant {
    start + Duration::from_secs(secs)
  }

  #[test]
  fn reloads_at_most_three_times_a_minute() {
    let start = Instant::now();
    let mut reloads = Reloads::default();
    /* Different pages, so only the per-minute cap applies. */
    let page = |i: u64| format!("tauri://localhost/games/g{i}");
    for i in 0..MAX_RELOADS as u64 {
      assert_eq!(
        decide_reload(&mut reloads, &page(i), at(start, i)),
        Recovery::Reload
      );
    }
    assert_eq!(
      decide_reload(&mut reloads, &page(10), at(start, 10)),
      Recovery::TooMany
    );
    assert_eq!(
      decide_reload(&mut reloads, &page(11), at(start, 59)),
      Recovery::TooMany
    );
    /* The first reload has left the window: one more fits. */
    assert_eq!(
      decide_reload(&mut reloads, &page(12), at(start, 60)),
      Recovery::Reload
    );
    assert_eq!(
      decide_reload(&mut reloads, &page(13), at(start, 60)),
      Recovery::TooMany
    );
  }

  #[test]
  fn a_page_that_crashes_every_few_minutes_is_reloaded_once() {
    /* Issue #59: Home leaked until the OOM killer stopped it, about every 2.5 minutes. */
    let start = Instant::now();
    let mut reloads = Reloads::default();
    let home = "tauri://localhost/home";
    assert_eq!(decide_reload(&mut reloads, home, start), Recovery::Reload);
    assert_eq!(
      decide_reload(
        &mut reloads,
        "tauri://localhost/home?from=crash#top",
        at(start, 150)
      ),
      Recovery::CrashedAgain
    );
    /* Another page still recovers. */
    assert_eq!(
      decide_reload(&mut reloads, "tauri://localhost/games", at(start, 160)),
      Recovery::Reload
    );
    /* And Home does again, long after. */
    assert_eq!(
      decide_reload(&mut reloads, home, at(start, 160 + REPEAT_WINDOW.as_secs())),
      Recovery::Reload
    );
  }

  #[test]
  fn a_crash_is_taken_once_with_its_game() {
    let (crash, _) = note_crash("tauri://localhost/games/g1", "crashed");
    assert_eq!(crash.game_id.as_deref(), Some("g1"));
    assert_eq!(take_webview_crash(), Some(crash));
    assert_eq!(take_webview_crash(), None);
  }

  #[test]
  fn the_stopped_page_escapes_the_game_and_links_home() {
    let crash = WebviewCrash {
      game_id: Some("a<b".into()),
      reason: "crashed".into(),
      url: "tauri://localhost/games/a%3Cb".into(),
      at: 0,
    };
    let page = stopped_page(&crash, Recovery::TooMany);
    assert!(page.contains("a&lt;b"));
    assert!(page.contains("href=\"tauri://localhost/home\""));
    assert!(page.contains("crashed 3 times within 60s"));
    assert!(
      stopped_page(&crash, Recovery::CrashedAgain).contains("crashed again within 10 minutes")
    );
  }
}
