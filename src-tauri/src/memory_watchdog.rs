//! A memory limit for WebKit's web process (Linux), issue #62.
//!
//! WebKit's own memory-pressure handler only frees caches unless it is given a kill
//! threshold, and `MemoryPressureSettings` can only be passed to a `WebKitWebContext` when
//! it is constructed, which wry does without them. So the app watches the process itself:
//! every [`POLL`], it adds up the resident and swapped memory of the WebKitWebProcess
//! descendants of this process, and past the limit it terminates the web process. The
//! existing crash handler (`webview_crash.rs`) then reports `exceeded-memory-limit`,
//! reloads the page once, and shows its "stopped" page if the same page runs away again.
//!
//! Swap is counted on purpose. The leak in #59 grew the web process by ~220 MB/s on the
//! Surface, and most of it went straight to swap: 6.5 GB resident and 56 GB swapped when
//! systemd-oomd finally killed it, with the desktop unusable long before that.
//!
//! The limit is 40 % of RAM, kept between [`MIN_LIMIT`] and [`MAX_LIMIT`], which leaves room
//! for the largest Unity WebGL heaps the catalog runs (2 GB) on top of the app page.
//! `POTATO_TOMATO_WEB_MEMORY_LIMIT_MB=<n>` sets it for one launch, `=0` turns the watchdog off.

#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

use std::time::Duration;

pub const POLL: Duration = Duration::from_secs(2);
/// Polls between full rescans of `/proc` for web processes, while the known ones are alive.
const RESCAN_EVERY: u32 = 15;
const MIB: u64 = 1024 * 1024;
pub const MIN_LIMIT: u64 = 2560 * MIB;
pub const MAX_LIMIT: u64 = 6144 * MIB;
const LIMIT_ENV: &str = "POTATO_TOMATO_WEB_MEMORY_LIMIT_MB";
/// `comm` of WebKit's web process, as the kernel truncates it to 15 bytes.
const WEB_PROCESS_COMM: &str = "WebKitWebProces";

/// A `kB` field of `/proc/<pid>/status` or `/proc/meminfo`, in bytes.
fn kb_field(text: &str, key: &str) -> Option<u64> {
  text.lines().find_map(|line| {
    let kb = line.strip_prefix(key)?.trim().strip_suffix("kB")?.trim();
    kb.parse::<u64>().ok().map(|kb| kb * 1024)
  })
}

/// Resident plus swapped bytes, from the text of `/proc/<pid>/status`.
pub fn footprint_of_status(status: &str) -> Option<u64> {
  let rss = kb_field(status, "VmRSS:")?;
  Some(rss + kb_field(status, "VmSwap:").unwrap_or(0))
}

/// 40 % of RAM, within [`MIN_LIMIT`, `MAX_LIMIT`].
pub fn default_limit(mem_total: Option<u64>) -> u64 {
  mem_total.map_or(MIN_LIMIT, |total| (total / 5 * 2).clamp(MIN_LIMIT, MAX_LIMIT))
}

/// The limit for this launch, or `None` when the watchdog is off.
pub fn limit(env: Option<&str>, mem_total: Option<u64>) -> Option<u64> {
  match env.map(str::trim) {
    Some("0") => None,
    Some(raw) => Some(
      raw
        .parse::<u64>()
        .ok()
        .filter(|mb| *mb > 0)
        .map_or_else(|| default_limit(mem_total), |mb| mb * MIB),
    ),
    None => Some(default_limit(mem_total)),
  }
}

/// `(pid, ppid, comm)` from the text of `/proc/<pid>/stat`. `comm` may hold spaces and
/// parentheses, so the fields after it are found from the last `)`.
pub fn parse_stat(stat: &str) -> Option<(u32, u32, &str)> {
  let open = stat.find('(')?;
  let close = stat.rfind(')')?;
  let pid = stat[..open].trim().parse().ok()?;
  let comm = stat.get(open + 1..close)?;
  let mut rest = stat.get(close + 1..)?.split_whitespace();
  let _state = rest.next()?;
  let ppid = rest.next()?.parse().ok()?;
  Some((pid, ppid, comm))
}

/// Web processes among the descendants of `root`, given every process's `(pid, ppid, comm)`.
/// Descendants, not children: outside Flatpak WebKit may start its web process under its
/// own bubblewrap.
pub fn web_processes(root: u32, procs: &[(u32, u32, String)]) -> Vec<u32> {
  let mut tree = vec![root];
  let mut found = Vec::new();
  let mut i = 0;
  while i < tree.len() {
    let parent = tree[i];
    for (pid, ppid, comm) in procs {
      if *ppid == parent && !tree.contains(pid) {
        tree.push(*pid);
        if comm == WEB_PROCESS_COMM {
          found.push(*pid);
        }
      }
    }
    i += 1;
  }
  found
}

#[cfg(target_os = "linux")]
mod linux {
  use super::*;
  use webkit2gtk::WebViewExt;

  fn scan() -> Vec<u32> {
    let mut procs = Vec::new();
    if let Ok(entries) = std::fs::read_dir("/proc") {
      for entry in entries.flatten() {
        let name = entry.file_name();
        if !name.to_str().is_some_and(|n| n.bytes().all(|b| b.is_ascii_digit())) {
          continue;
        }
        if let Ok(stat) = std::fs::read_to_string(entry.path().join("stat")) {
          if let Some((pid, ppid, comm)) = parse_stat(&stat) {
            procs.push((pid, ppid, comm.to_string()));
          }
        }
      }
    }
    web_processes(std::process::id(), &procs)
  }

  /// Summed footprint of `pids`, or `None` when one of them is gone.
  fn footprint(pids: &[u32]) -> Option<u64> {
    pids.iter().try_fold(0u64, |sum, pid| {
      let status = std::fs::read_to_string(format!("/proc/{pid}/status")).ok()?;
      Some(sum + footprint_of_status(&status)?)
    })
  }

  pub fn watch(view: webkit2gtk::WebView) {
    let mem_total = std::fs::read_to_string("/proc/meminfo")
      .ok()
      .and_then(|info| kb_field(&info, "MemTotal:"));
    let Some(limit) = limit(std::env::var(LIMIT_ENV).ok().as_deref(), mem_total) else {
      log::info!("web process memory watchdog: off ({LIMIT_ENV}=0)");
      return;
    };
    log::info!("web process memory watchdog: limit {} MB", limit / MIB);
    let mut pids: Vec<u32> = Vec::new();
    let mut polls = 0u32;
    gtk::glib::timeout_add_local(POLL, move || {
      polls = polls.wrapping_add(1);
      let mut used = footprint(&pids);
      if pids.is_empty() || used.is_none() || polls % RESCAN_EVERY == 0 {
        pids = scan();
        used = footprint(&pids);
      }
      let Some(used) = used.filter(|used| *used > limit) else {
        return gtk::glib::ControlFlow::Continue;
      };
      let message = format!(
        "web process uses {} MB (resident + swap), over the {} MB limit; terminating it",
        used / MIB,
        limit / MIB
      );
      log::error!("{message}");
      if !cfg!(debug_assertions) {
        eprintln!("potato-tomato: {message}");
      }
      crate::webview_crash::mark_exceeded_memory_limit();
      view.terminate_web_process();
      /* A new web process starts with the reload: find it afresh. */
      pids.clear();
      gtk::glib::ControlFlow::Continue
    });
  }
}

/// Start watching the memory of the app webview's web process.
pub fn watch(window: &tauri::WebviewWindow) {
  #[cfg(target_os = "linux")]
  if let Err(e) = window.with_webview(|platform| linux::watch(platform.inner())) {
    log::warn!("could not start the web process memory watchdog: {e}");
  }
  #[cfg(not(target_os = "linux"))]
  let _ = window;
}

#[cfg(test)]
mod tests {
  use super::*;

  const GIB: u64 = 1024 * MIB;

  #[test]
  fn counts_resident_and_swapped_memory() {
    let status = "Name:\tWebKitWebProces\nVmRSS:\t 4010124 kB\nVmSwap:\t38223164 kB\n";
    assert_eq!(footprint_of_status(status), Some((4010124 + 38223164) * 1024));
    assert_eq!(footprint_of_status("VmRSS:\t 100 kB\n"), Some(100 * 1024));
    assert_eq!(footprint_of_status("Name:\tzombie\n"), None);
  }

  #[test]
  fn the_default_limit_is_forty_percent_of_ram_within_bounds() {
    assert_eq!(default_limit(Some(16 * GIB)), MAX_LIMIT);
    assert_eq!(default_limit(Some(10 * GIB)), 4 * GIB);
    assert_eq!(default_limit(Some(4 * GIB)), MIN_LIMIT);
    assert_eq!(default_limit(None), MIN_LIMIT);
  }

  #[test]
  fn the_env_sets_or_turns_off_the_limit() {
    assert_eq!(limit(Some("0"), Some(16 * GIB)), None);
    assert_eq!(limit(Some(" 3000 "), Some(16 * GIB)), Some(3000 * MIB));
    assert_eq!(limit(Some("lots"), Some(16 * GIB)), Some(MAX_LIMIT));
    assert_eq!(limit(None, Some(10 * GIB)), Some(4 * GIB));
  }

  #[test]
  fn parses_stat_with_awkward_comm() {
    assert_eq!(
      parse_stat("229087 (WebKitWebProces) S 228914 229087 0"),
      Some((229087, 228914, "WebKitWebProces"))
    );
    assert_eq!(parse_stat("7 (a) b (c)) R 3 7"), Some((7, 3, "a) b (c)")));
    assert_eq!(parse_stat("garbage"), None);
  }

  #[test]
  fn finds_web_processes_among_descendants_only() {
    let procs = vec![
      (10, 1, "potato-tomato".to_string()),
      (11, 10, "WebKitNetworkPr".to_string()),
      (12, 10, "bwrap".to_string()),
      (13, 12, "WebKitWebProces".to_string()),
      (14, 10, "WebKitWebProces".to_string()),
      (20, 1, "WebKitWebProces".to_string()),
    ];
    assert_eq!(web_processes(10, &procs), vec![14, 13]);
  }
}
