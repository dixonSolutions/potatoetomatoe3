//! Offline copies and per-game saves, served from disk without the Node puller.
//!
//! The puller used to be the only way to read what it had written: every offline launch,
//! every "is this downloaded?" badge and every save went through its HTTP API, so the app
//! had to keep a Node process alive just to open files in its own data folder. Now:
//!
//! - the `ptoffline` URI scheme serves a mirror (`ptoffline://localhost/<id>/<path>`) from
//!   the app data games dir, falling back to the bundled catalog, with the same HTML fixes
//!   the puller applied (vaulted `_external/` URLs, the Unity patches, the bridge first in
//!   `<head>`);
//! - commands report offline status, delete a copy, and read and write the per-game save
//!   profile, in the exact on-disk layout `puller/src/browser-data.ts` uses, so saves made
//!   while the puller ran are still there.
//!
//! Downloading still needs the puller (Playwright capture); it is started on demand.

// The scheme is registered on desktop only; mobile builds keep the commands and nothing else.
#![cfg_attr(mobile, allow(dead_code))]

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

use serde::Serialize;
use tauri::http::{header, Response, StatusCode};

use crate::game_frames::is_catalog_id;

pub const SCHEME: &str = "ptoffline";

/// The puller's `MIN_OFFLINE_INDEX_BYTES`: a smaller entry file is a failed capture.
const MIN_ENTRY_BYTES: u64 = 64;
const MANIFEST: &str = "offline-manifest.json";
/// The puller's partial-download marker inside `offline/`.
const DOWNLOAD_CACHE: &str = ".download-cache.json";
const UNITY_INJECT_SOURCE: &str = include_str!("../../static/unity/inject.js");

/// Where offline copies live: what the user downloaded, then what shipped with the app.
#[derive(Clone)]
pub struct GameRoots {
  pub data: PathBuf,
  pub catalog: PathBuf,
}

impl GameRoots {
  fn offline_dirs(&self, id: &str) -> Vec<PathBuf> {
    let mut dirs = vec![self.data.join(id).join("offline")];
    let bundled = self.catalog.join(id).join("offline");
    if bundled != dirs[0] {
      dirs.push(bundled);
    }
    dirs
  }
}

/// `rel` under `root`, refusing anything that could climb out of it.
fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
  let rel = Path::new(rel);
  if rel.components().any(|c| !matches!(c, Component::Normal(_))) {
    return None;
  }
  Some(root.join(rel))
}

fn is_valid_entry(root: &Path, rel: &str) -> bool {
  safe_join(root, rel)
    .and_then(|p| std::fs::metadata(p).ok())
    .is_some_and(|m| m.is_file() && m.len() >= MIN_ENTRY_BYTES)
}

fn read_manifest(root: &Path) -> Option<serde_json::Value> {
  let raw = std::fs::read_to_string(root.join(MANIFEST)).ok()?;
  serde_json::from_str(&raw).ok()
}

/// The playable entry HTML under one `offline/` dir: the manifest's, else `index.html`.
fn entry_in(root: &Path) -> Option<String> {
  if let Some(entry) = read_manifest(root)
    .as_ref()
    .and_then(|m| m.get("entry"))
    .and_then(|e| e.as_str())
    .map(|e| e.trim().trim_start_matches("./").to_string())
  {
    if !entry.is_empty() && is_valid_entry(root, &entry) {
      return Some(entry);
    }
  }
  is_valid_entry(root, "index.html").then(|| "index.html".to_string())
}

/// The complete mirror for a game, if there is one: its `offline/` dir and entry file.
pub fn resolve_mirror(roots: &GameRoots, id: &str) -> Option<(PathBuf, String)> {
  roots
    .offline_dirs(id)
    .into_iter()
    .find_map(|dir| entry_in(&dir).map(|entry| (dir, entry)))
}

fn thumbnail_in(root: &Path) -> Option<String> {
  if let Some(thumb) = read_manifest(root)
    .as_ref()
    .and_then(|m| m.get("thumbnail"))
    .and_then(|t| t.as_str())
  {
    if safe_join(root, thumb).is_some_and(|p| p.is_file()) {
      return Some(thumb.to_string());
    }
  }
  ["jpg", "jpeg", "png", "webp", "gif"]
    .iter()
    .map(|ext| format!("assets/thumbnail.{ext}"))
    .find(|rel| root.join(rel).is_file())
}

fn count_files(dir: &Path) -> usize {
  let Ok(entries) = std::fs::read_dir(dir) else {
    return 0;
  };
  entries
    .flatten()
    .map(|entry| match entry.file_type() {
      Ok(t) if t.is_dir() => count_files(&entry.path()),
      Ok(t) if t.is_file() && entry.file_name() != DOWNLOAD_CACHE => 1,
      _ => 0,
    })
    .sum()
}

/// Same shape as the puller's `GameStatus`, so the frontend reads either.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineStatus {
  pub online: bool,
  pub offline: bool,
  pub downloading: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub partial_cache: Option<bool>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub cache_file_count: Option<usize>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub offline_thumbnail: Option<String>,
}

pub fn status(roots: &GameRoots, id: &str) -> OfflineStatus {
  let mirror = resolve_mirror(roots, id);
  let offline = mirror.is_some();
  let user_dir = roots.data.join(id).join("offline");
  let partial = !offline && user_dir.is_dir() && count_files(&user_dir) > 0;
  OfflineStatus {
    online: true,
    offline,
    downloading: false,
    partial_cache: partial.then_some(true),
    cache_file_count: partial.then(|| count_files(&user_dir)),
    offline_thumbnail: mirror.and_then(|(dir, _)| thumbnail_in(&dir)),
  }
}

/// Every game with a mirror or a partial download on disk. One directory listing per root
/// and one `stat` per entry — the catalog tree is never walked.
pub fn statuses_on_disk(roots: &GameRoots) -> HashMap<String, OfflineStatus> {
  let mut ids = std::collections::BTreeSet::new();
  for root in [&roots.data, &roots.catalog] {
    let Ok(entries) = std::fs::read_dir(root) else {
      continue;
    };
    for entry in entries.flatten() {
      let name = entry.file_name().to_string_lossy().to_string();
      if is_catalog_id(&name) && entry.path().join("offline").is_dir() {
        ids.insert(name);
      }
    }
  }
  ids
    .into_iter()
    .map(|id| (id.clone(), status(roots, &id)))
    .filter(|(_, s)| s.offline || s.partial_cache == Some(true))
    .collect()
}

/// Remove the user's copy. The bundled catalog copy, if any, is read-only and stays.
pub fn delete_copy(roots: &GameRoots, id: &str) -> Result<(), String> {
  if !is_catalog_id(id) {
    return Err(format!("not a catalog game id: {id:?}"));
  }
  let dir = roots.data.join(id).join("offline");
  if dir.exists() {
    std::fs::remove_dir_all(&dir).map_err(|e| format!("{}: {e}", dir.display()))?;
  }
  Ok(())
}

/* ------------------------------------------------------------------------------------
 * Serving
 * ---------------------------------------------------------------------------------- */

/// Content types as the puller served them (`puller/src/server.ts` `mimeFor`), plus the
/// few a game also asks for.
pub fn mime_for(path: &Path) -> &'static str {
  let name = path
    .file_name()
    .map(|n| n.to_string_lossy().to_ascii_lowercase())
    .unwrap_or_default();
  /* Legacy Unity names its framework JS `*.wasm.framework.unityweb`. */
  if name.contains(".framework.unityweb") || name.ends_with(".framework.js") {
    return "application/javascript";
  }
  match path
    .extension()
    .map(|e| e.to_string_lossy().to_ascii_lowercase())
    .as_deref()
  {
    Some("html" | "htm") => "text/html; charset=utf-8",
    Some("js" | "mjs") => "application/javascript",
    Some("css") => "text/css",
    Some("json") => "application/json",
    Some("png") => "image/png",
    Some("jpg" | "jpeg") => "image/jpeg",
    Some("gif") => "image/gif",
    Some("webp") => "image/webp",
    Some("svg") => "image/svg+xml",
    Some("ico") => "image/x-icon",
    Some("wasm") => "application/wasm",
    Some("mp3") => "audio/mpeg",
    Some("ogg") => "audio/ogg",
    Some("wav") => "audio/wav",
    Some("m4a") => "audio/mp4",
    Some("mp4") => "video/mp4",
    Some("webm") => "video/webm",
    Some("woff") => "font/woff",
    Some("woff2") => "font/woff2",
    Some("ttf") => "font/ttf",
    Some("txt") => "text/plain; charset=utf-8",
    Some("xml") => "application/xml",
    Some("swf") => "application/x-shockwave-flash",
    _ => "application/octet-stream",
  }
}

fn regex(slot: &'static OnceLock<regex::Regex>, pattern: &str) -> &'static regex::Regex {
  slot.get_or_init(|| regex::Regex::new(pattern).expect("static regex"))
}

/// Absolute URLs the capture vaulted under `_external/<host>/…` point at the local copy.
pub fn rewrite_vaulted_urls(html: &str, mirror_root: &Path) -> String {
  static URL: OnceLock<regex::Regex> = OnceLock::new();
  regex(&URL, r#"https?://[^\s"'<>\\]+"#)
    .replace_all(html, |caps: &regex::Captures| {
      let absolute = &caps[0];
      let Ok(parsed) = reqwest::Url::parse(absolute) else {
        return absolute.to_string();
      };
      let Some(host) = parsed.host_str() else {
        return absolute.to_string();
      };
      let parts: Vec<&str> = parsed.path().split('/').filter(|p| !p.is_empty()).collect();
      let mut local = mirror_root.join("_external").join(host);
      for part in &parts {
        local.push(part);
      }
      if !local.exists() {
        return absolute.to_string();
      }
      let mut rel = format!("_external/{host}");
      for part in &parts {
        rel.push('/');
        rel.push_str(part);
      }
      if let Some(query) = parsed.query() {
        rel.push('?');
        rel.push_str(query);
      }
      if let Some(fragment) = parsed.fragment() {
        rel.push('#');
        rel.push_str(fragment);
      }
      rel
    })
    .into_owned()
}

/// `puller/src/unity/crazygames-unwrap.ts` `isCrazyGamesShellHtml`.
fn is_crazygames_shell(html: &str) -> bool {
  static MODULE: OnceLock<regex::Regex> = OnceLock::new();
  static LOADER: OnceLock<regex::Regex> = OnceLock::new();
  static SHELL: OnceLock<regex::Regex> = OnceLock::new();
  (regex(&MODULE, r#"(?i)"moduleJsonUrl"\s*:\s*"https?://"#).is_match(html)
    && regex(&LOADER, r#"(?i)"unityLoaderUrl"\s*:\s*"https?://"#).is_match(html))
    || regex(
      &SHELL,
      r"(?i)Crazygames\.load\s*\(|useLocalGF\s*=|gfBuildPath\s*=",
    )
    .is_match(html)
}

/// `puller/src/unity/inject-html.ts` `isUnityGameHtml`.
fn is_unity_game_html(html: &str) -> bool {
  static OPENFL: OnceLock<regex::Regex> = OnceLock::new();
  static UNITY: OnceLock<regex::Regex> = OnceLock::new();
  if regex(
    &OPENFL,
    r#"(?i)lime\.embed\s*\(|id=["']openfl-content["']|openfl-content"#,
  )
  .is_match(html)
  {
    return false;
  }
  if is_crazygames_shell(html) {
    return false;
  }
  regex(
    &UNITY,
    r"(?i)UnityLoader|createUnityInstance|master-loader\.js|unityWebglLoaderUrl|Build/.*\.json",
  )
  .is_match(html)
}

/// `puller/src/unity/inject-html.ts` `stripUnityPortalBloat`.
fn strip_unity_portal_bloat(html: &str) -> String {
  static BLOAT: OnceLock<regex::Regex> = OnceLock::new();
  static SRC_SCRIPT: OnceLock<regex::Regex> = OnceLock::new();
  static INLINE_SCRIPT: OnceLock<regex::Regex> = OnceLock::new();
  static LINK: OnceLock<regex::Regex> = OnceLock::new();
  static BLOAT_LINK: OnceLock<regex::Regex> = OnceLock::new();
  static UNITY_BOOT: OnceLock<regex::Regex> = OnceLock::new();
  static COVERS: OnceLock<regex::Regex> = OnceLock::new();
  let bloat = regex(
    &BLOAT,
    r"(?i)poki-sdk|master-loader|y8-afp|y8\.sdk|id\.net|idnet|gameapi|adsbygoogle|googlesyndication|cloak\.js|main\.min\.js|cdn-cgi|cloudflare|adinLoader|adinplay|getAdinDomain|doubleclick|pagead",
  );
  let boot = regex(&UNITY_BOOT, r"createUnityInstance|UnityLoader");
  let out = regex(
    &SRC_SCRIPT,
    r#"(?i)<script\b[^>]*\bsrc=["'][^"']*["'][^>]*>\s*</script>"#,
  )
  .replace_all(html, |c: &regex::Captures| {
    if bloat.is_match(&c[0]) {
      String::new()
    } else {
      c[0].to_string()
    }
  });
  let out = regex(&INLINE_SCRIPT, r"(?is)<script\b[^>]*>.*?</script>").replace_all(
    &out,
    |c: &regex::Captures| {
      if bloat.is_match(&c[0]) && !boot.is_match(&c[0]) {
        String::new()
      } else {
        c[0].to_string()
      }
    },
  );
  let bloat_link = regex(&BLOAT_LINK, r"(?i)poki|y8|id\.net|doubleclick|cloak|adin");
  let out = regex(&LINK, r"(?i)<link\b[^>]*>").replace_all(&out, |c: &regex::Captures| {
    if bloat_link.is_match(&c[0]) {
      String::new()
    } else {
      c[0].to_string()
    }
  });
  regex(
    &COVERS,
    r#"(?is)<div\b[^>]*\bid=["'](?:play-cover|loading-cover)["'][^>]*>.*?</div>"#,
  )
  .replace_all(&out, "")
  .into_owned()
}

/// The HTML an offline entry is served as: what the puller did before serving it.
pub fn offline_html(html: &str, mirror_root: &Path, id: &str) -> String {
  let mut out = rewrite_vaulted_urls(html, mirror_root);
  if is_unity_game_html(&out) && !out.contains("__ptUnityInjectInstalled") {
    out = strip_unity_portal_bloat(&out);
    out =
      crate::relay::insert_first_in_head(&out, &format!("<script>{UNITY_INJECT_SOURCE}</script>"));
  }
  if out.contains("game-storage-bridge.child.js") {
    return out;
  }
  crate::relay::insert_first_in_head(&out, &crate::relay::inline_bridge(id))
}

fn respond(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
  Response::builder()
    .status(status)
    .header(header::CONTENT_TYPE, content_type)
    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
    .header(header::CACHE_CONTROL, "no-cache")
    .body(body)
    .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// `ptoffline://localhost/<id>/<path under offline/>`; an empty path is the entry file.
pub async fn handle(roots: GameRoots, path: String) -> Response<Vec<u8>> {
  let decoded = crate::relay::percent_decode(&path);
  let trimmed = decoded.trim_start_matches('/');
  let (id, rel) = trimmed.split_once('/').unwrap_or((trimmed, ""));
  if !is_catalog_id(id) {
    return respond(
      StatusCode::NOT_FOUND,
      "text/plain",
      b"not an offline game URL".to_vec(),
    );
  }
  let Some((mirror_root, entry)) = resolve_mirror(&roots, id) else {
    return respond(
      StatusCode::NOT_FOUND,
      "text/plain",
      b"no offline copy".to_vec(),
    );
  };
  let rel = if rel.is_empty() || rel.ends_with('/') {
    format!(
      "{rel}{}",
      if rel.is_empty() {
        entry.as_str()
      } else {
        "index.html"
      }
    )
  } else {
    rel.to_string()
  };
  /* A file may be in either copy — a partial user copy over a bundled one, say. */
  let file = roots
    .offline_dirs(id)
    .into_iter()
    .filter_map(|dir| safe_join(&dir, &rel).map(|p| (dir, p)))
    .find(|(_, p)| p.is_file());
  let Some((root, file)) = file else {
    return respond(
      StatusCode::NOT_FOUND,
      "text/plain",
      b"not in the offline copy".to_vec(),
    );
  };
  let bytes = match tokio::fs::read(&file).await {
    Ok(bytes) => bytes,
    Err(e) => {
      return respond(
        StatusCode::INTERNAL_SERVER_ERROR,
        "text/plain",
        e.to_string().into_bytes(),
      )
    }
  };
  let mime = mime_for(&file);
  if mime.starts_with("text/html") {
    let html = String::from_utf8_lossy(&bytes);
    let base = if root == mirror_root {
      &mirror_root
    } else {
      &root
    };
    return respond(
      StatusCode::OK,
      mime,
      offline_html(&html, base, id).into_bytes(),
    );
  }
  respond(StatusCode::OK, mime, bytes)
}

/* ------------------------------------------------------------------------------------
 * Per-game save profile (`puller/src/browser-data.ts` on-disk layout)
 * ---------------------------------------------------------------------------------- */

const PROFILE_META: &str = "meta.json";
const PROFILE_LOCAL: &str = "profile/Default/localStorage.json";
const PROFILE_SESSION: &str = "profile/Default/sessionStorage.json";
const PROFILE_COOKIES: &str = "profile/Default/cookies.json";
const PROFILE_IDB: &str = "profile/Default/indexeddb";
/// Beside `data/`: the saves a write is replacing, for the moment of the swap.
const PROFILE_PREVIOUS: &str = "data.previous";
/// Beside `data/`: a profile being written, before it is swapped in.
const PROFILE_WRITING: &str = "data.writing-";

/// Profile reads, writes and deletes, one at a time: a read never sees a write half swapped.
static PROFILE_IO: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn profile_io() -> std::sync::MutexGuard<'static, ()> {
  PROFILE_IO.lock().unwrap_or_else(|e| e.into_inner())
}

fn profile_dir(roots: &GameRoots, id: &str) -> Result<PathBuf, String> {
  if !is_catalog_id(id) {
    return Err(format!("not a catalog game id: {id:?}"));
  }
  Ok(roots.data.join(id).join("data"))
}

/// A profile file: `Ok(None)` when it does not exist, `Err` when it exists but could not be
/// read or does not parse. The two must not be confused — a profile read that swallowed an
/// error came back as "no saves", and the next write replaced the real ones.
fn read_json(path: &Path) -> Result<Option<serde_json::Value>, String> {
  let text = match std::fs::read_to_string(path) {
    Ok(text) => text,
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
    Err(e) => return Err(format!("{}: {e}", path.display())),
  };
  serde_json::from_str(&text)
    .map(Some)
    .map_err(|e| format!("{}: {e}", path.display()))
}

fn write_json_atomic(path: &Path, value: &serde_json::Value) -> Result<(), String> {
  if let Some(dir) = path.parent() {
    std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
  }
  let tmp = path.with_extension("json.tmp");
  let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
  std::fs::write(&tmp, text).map_err(|e| format!("{}: {e}", tmp.display()))?;
  std::fs::rename(&tmp, path).map_err(|e| format!("{}: {e}", path.display()))
}

/// The game's saved profile, `Ok(None)` when it has none, and `Err` when any part of it is
/// there but cannot be read: the frontend then holds the game's pushes rather than writing
/// one session's data over files it could not see.
pub fn read_profile(roots: &GameRoots, id: &str) -> Result<Option<serde_json::Value>, String> {
  let _io = profile_io();
  let dir = profile_dir(roots, id)?;
  let dir = if dir.exists() {
    dir
  } else {
    /* A write that stopped between its two renames left the saves here. */
    let previous = dir.with_file_name(PROFILE_PREVIOUS);
    if !previous.exists() {
      return Ok(None);
    }
    previous
  };
  let result = read_profile_dir(&dir);
  if let Err(why) = &result {
    log::warn!("could not read the saves of {id}: {why}");
  }
  result
}

fn read_profile_dir(dir: &Path) -> Result<Option<serde_json::Value>, String> {
  let meta = read_json(&dir.join(PROFILE_META))?;
  let local = read_json(&dir.join(PROFILE_LOCAL))?.unwrap_or_else(|| serde_json::json!({}));
  let session = read_json(&dir.join(PROFILE_SESSION))?.unwrap_or_else(|| serde_json::json!({}));
  let cookies = read_json(&dir.join(PROFILE_COOKIES))?.unwrap_or_else(|| serde_json::json!([]));
  if !local.is_object() || !session.is_object() || !cookies.is_array() {
    return Err(format!("{}: profile files hold the wrong kind of JSON", dir.display()));
  }
  let mut databases = Vec::new();
  let idb_root = dir.join(PROFILE_IDB);
  let entries = match std::fs::read_dir(&idb_root) {
    Ok(entries) => Some(entries),
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
    Err(e) => return Err(format!("{}: {e}", idb_root.display())),
  };
  if let Some(entries) = entries {
    let mut dirs = Vec::new();
    for entry in entries {
      let entry = entry.map_err(|e| format!("{}: {e}", idb_root.display()))?;
      if entry.path().is_dir() {
        dirs.push(entry);
      }
    }
    dirs.sort_by_key(|e| e.file_name());
    for entry in dirs {
      let db_meta = read_json(&entry.path().join("meta.json"))?.unwrap_or_default();
      let records = read_json(&entry.path().join("records.json"))?
        .filter(|r| r.is_array())
        .unwrap_or_else(|| serde_json::json!([]));
      databases.push(serde_json::json!({
        "name": db_meta.get("name").cloned().unwrap_or_else(|| entry.file_name().to_string_lossy().into()),
        "version": db_meta.get("version").cloned().unwrap_or(1.into()),
        "objectStores": db_meta.get("objectStores").cloned().unwrap_or_else(|| serde_json::json!([])),
        "records": records,
      }));
    }
  }
  let updated_at = meta
    .as_ref()
    .and_then(|m| m.get("updatedAt"))
    .and_then(|v| v.as_f64())
    .unwrap_or(0.0);
  let empty = updated_at <= 0.0
    && local.as_object().map_or(true, |o| o.is_empty())
    && session.as_object().map_or(true, |o| o.is_empty())
    && cookies.as_array().map_or(true, |a| a.is_empty())
    && databases.is_empty();
  if empty {
    return Ok(None);
  }
  Ok(Some(serde_json::json!({
    "schemaVersion": meta.as_ref().and_then(|m| m.get("schemaVersion")).cloned().unwrap_or(1.into()),
    "updatedAt": updated_at,
    "profile": { "Default": {
      "localStorage": local,
      "sessionStorage": session,
      "cookies": cookies,
      "indexedDB": databases,
    }},
  })))
}

/// A database's directory: its name made safe for a path, and a hash of the name so two
/// names that come out the same (`/idbfs` and `_idbfs`) keep a directory each.
fn database_dir_name(name: &str) -> String {
  let safe: String = name
    .chars()
    .take(64)
    .map(|c| {
      if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
        c
      } else {
        '_'
      }
    })
    .collect();
  let safe = safe.trim_start_matches('.');
  let safe = if safe.is_empty() { "_" } else { safe };
  /* FNV-1a: stable across builds and platforms, unlike the std hasher. */
  let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
  for byte in name.as_bytes() {
    hash ^= u64::from(*byte);
    hash = hash.wrapping_mul(0x0100_0000_01b3);
  }
  format!("{safe}-{hash:016x}")
}

/// Write the game's saves: all of the profile, or none of it.
///
/// The files are written into a directory of their own beside `data/`, which then takes
/// its place with two renames. A write that fails, or a process that dies, part way leaves
/// the saves that were there before — the old in-place write could leave half a profile,
/// localStorage from one push and databases from the one before.
pub fn write_profile(
  roots: &GameRoots,
  id: &str,
  profile: &serde_json::Value,
) -> Result<(), String> {
  let _io = profile_io();
  let dir = profile_dir(roots, id)?;
  let default = profile
    .get("profile")
    .and_then(|p| p.get("Default"))
    .ok_or("not a game browser profile")?;
  let local = default
    .get("localStorage")
    .filter(|v| v.is_object())
    .ok_or("localStorage missing")?;
  let session = default
    .get("sessionStorage")
    .filter(|v| v.is_object())
    .ok_or("sessionStorage missing")?;
  let cookies = default
    .get("cookies")
    .filter(|v| v.is_array())
    .ok_or("cookies missing")?;
  let databases = default
    .get("indexedDB")
    .and_then(|v| v.as_array())
    .ok_or("indexedDB missing")?;
  let now = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap_or_default();
  let game_dir = dir.parent().ok_or("profile directory has no parent")?;
  std::fs::create_dir_all(game_dir).map_err(|e| format!("{}: {e}", game_dir.display()))?;
  clear_abandoned_writes(game_dir);
  let staging = game_dir.join(format!(
    "{PROFILE_WRITING}{}-{}",
    std::process::id(),
    now.as_nanos()
  ));
  let written = write_profile_tree(
    &staging,
    now.as_millis() as u64,
    [local, session, cookies],
    databases,
  )
  .and_then(|()| swap_in(&staging, &dir));
  if written.is_err() {
    let _ = std::fs::remove_dir_all(&staging);
  }
  written
}

/// Directories left by writes that never finished (the app was killed mid-write).
fn clear_abandoned_writes(game_dir: &Path) {
  let Ok(entries) = std::fs::read_dir(game_dir) else {
    return;
  };
  for entry in entries.flatten() {
    if entry.file_name().to_string_lossy().starts_with(PROFILE_WRITING) {
      let _ = std::fs::remove_dir_all(entry.path());
    }
  }
}

/// Put the fully written `staging` where `dir` is. `dir` steps aside first and is removed
/// last, so there is always one complete profile on disk: before the swap `dir`, between
/// the renames `data.previous` (which reads fall back to), and after it the new one.
fn swap_in(staging: &Path, dir: &Path) -> Result<(), String> {
  let previous = dir.with_file_name(PROFILE_PREVIOUS);
  if dir.exists() {
    /* A leftover from a swap that stopped half way; `dir` is the newer of the two. */
    if previous.exists() {
      std::fs::remove_dir_all(&previous).map_err(|e| format!("{}: {e}", previous.display()))?;
    }
    std::fs::rename(dir, &previous).map_err(|e| format!("{}: {e}", dir.display()))?;
  }
  if let Err(e) = std::fs::rename(staging, dir) {
    if previous.exists() && !dir.exists() {
      let _ = std::fs::rename(&previous, dir);
    }
    return Err(format!("{}: {e}", dir.display()));
  }
  if previous.exists() {
    let _ = std::fs::remove_dir_all(&previous);
  }
  Ok(())
}

fn write_profile_tree(
  root: &Path,
  updated_at: u64,
  [local, session, cookies]: [&serde_json::Value; 3],
  databases: &[serde_json::Value],
) -> Result<(), String> {
  write_json_atomic(&root.join(PROFILE_LOCAL), local)?;
  write_json_atomic(&root.join(PROFILE_SESSION), session)?;
  write_json_atomic(&root.join(PROFILE_COOKIES), cookies)?;
  let idb_root = root.join(PROFILE_IDB);
  for db in databases {
    let name = db.get("name").and_then(|n| n.as_str()).unwrap_or("db");
    let db_dir = idb_root.join(database_dir_name(name));
    write_json_atomic(
      &db_dir.join("meta.json"),
      &serde_json::json!({
        "name": name,
        "version": db.get("version").cloned().unwrap_or(1.into()),
        "objectStores": db.get("objectStores").cloned().unwrap_or_else(|| serde_json::json!([])),
      }),
    )?;
    write_json_atomic(
      &db_dir.join("records.json"),
      db.get("records")
        .filter(|r| r.is_array())
        .unwrap_or(&serde_json::json!([])),
    )?;
  }
  /* Last: a profile directory with its meta file is a complete one. */
  write_json_atomic(
    &root.join(PROFILE_META),
    &serde_json::json!({ "schemaVersion": 1, "updatedAt": updated_at }),
  )
}

pub fn delete_profile(roots: &GameRoots, id: &str) -> Result<(), String> {
  let _io = profile_io();
  let dir = profile_dir(roots, id)?;
  for path in [dir.with_file_name(PROFILE_PREVIOUS), dir.clone()] {
    if path.exists() {
      std::fs::remove_dir_all(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    }
  }
  if let Some(game_dir) = dir.parent() {
    clear_abandoned_writes(game_dir);
  }
  Ok(())
}

/* ------------------------------------------------------------------------------------
 * Commands
 * ---------------------------------------------------------------------------------- */

fn roots(app: &tauri::AppHandle) -> GameRoots {
  crate::game_roots(app)
}

/// Offline status for `ids`, or for every game with a copy on disk when `ids` is absent.
#[tauri::command]
pub async fn offline_statuses(
  app: tauri::AppHandle,
  ids: Option<Vec<String>>,
) -> Result<HashMap<String, OfflineStatus>, String> {
  let roots = roots(&app);
  tauri::async_runtime::spawn_blocking(move || match ids {
    Some(ids) => ids
      .into_iter()
      .filter(|id| is_catalog_id(id))
      .map(|id| {
        let s = status(&roots, &id);
        (id, s)
      })
      .collect(),
    None => statuses_on_disk(&roots),
  })
  .await
  .map_err(|e| e.to_string())
}

/// Entry HTML of the game's complete offline copy, relative to its `offline/` dir.
#[tauri::command]
pub async fn offline_entry(app: tauri::AppHandle, id: String) -> Option<String> {
  if !is_catalog_id(&id) {
    return None;
  }
  let roots = roots(&app);
  tauri::async_runtime::spawn_blocking(move || resolve_mirror(&roots, &id).map(|(_, entry)| entry))
    .await
    .ok()
    .flatten()
}

#[tauri::command]
pub async fn offline_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
  let roots = roots(&app);
  tauri::async_runtime::spawn_blocking(move || delete_copy(&roots, &id))
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn game_profile_read(
  app: tauri::AppHandle,
  id: String,
) -> Result<Option<serde_json::Value>, String> {
  let roots = roots(&app);
  tauri::async_runtime::spawn_blocking(move || read_profile(&roots, &id))
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn game_profile_write(
  app: tauri::AppHandle,
  id: String,
  profile: serde_json::Value,
) -> Result<(), String> {
  let roots = roots(&app);
  tauri::async_runtime::spawn_blocking(move || write_profile(&roots, &id, &profile))
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn game_profile_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
  let roots = roots(&app);
  tauri::async_runtime::spawn_blocking(move || delete_profile(&roots, &id))
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_roots(name: &str) -> GameRoots {
    let base = std::env::temp_dir().join(format!("pt-offline-test-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    std::fs::create_dir_all(base.join("data")).unwrap();
    std::fs::create_dir_all(base.join("catalog")).unwrap();
    GameRoots {
      data: base.join("data"),
      catalog: base.join("catalog"),
    }
  }

  fn write(path: &Path, body: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, body).unwrap();
  }

  const PAGE: &str =
    "<!doctype html><html><head><title>game</title></head><body><canvas></canvas></body></html>";

  #[test]
  fn resolves_the_manifest_entry_before_index_html_and_user_copy_before_bundled() {
    let roots = temp_roots("entry");
    write(&roots.catalog.join("g/offline/index.html"), PAGE);
    assert_eq!(resolve_mirror(&roots, "g").unwrap().1, "index.html");
    write(&roots.data.join("g/offline/play.html"), PAGE);
    write(
      &roots.data.join("g/offline/offline-manifest.json"),
      r#"{"entry":"play.html"}"#,
    );
    let (dir, entry) = resolve_mirror(&roots, "g").unwrap();
    assert_eq!(entry, "play.html");
    assert_eq!(dir, roots.data.join("g/offline"));
  }

  #[test]
  fn a_tiny_entry_is_a_failed_capture_not_a_mirror() {
    let roots = temp_roots("tiny");
    write(&roots.data.join("g/offline/index.html"), "<html></html>");
    assert!(resolve_mirror(&roots, "g").is_none());
    let s = status(&roots, "g");
    assert!(!s.offline);
    assert_eq!(s.partial_cache, Some(true));
  }

  #[test]
  fn statuses_list_only_games_with_something_on_disk() {
    let roots = temp_roots("list");
    write(&roots.data.join("a/offline/index.html"), PAGE);
    write(&roots.data.join("a/offline/assets/thumbnail.png"), "png");
    std::fs::create_dir_all(roots.data.join("b/online")).unwrap();
    std::fs::create_dir_all(roots.data.join("_private/offline")).unwrap();
    let all = statuses_on_disk(&roots);
    assert_eq!(all.len(), 1);
    assert_eq!(
      all["a"].offline_thumbnail.as_deref(),
      Some("assets/thumbnail.png")
    );
  }

  #[test]
  fn refuses_paths_that_leave_the_copy() {
    let root = Path::new("/x/offline");
    assert!(safe_join(root, "../../etc/passwd").is_none());
    assert!(safe_join(root, "/etc/passwd").is_none());
    assert!(safe_join(root, "a/./b").is_some());
    assert!(!is_catalog_id("../g"));
    assert!(!is_catalog_id("g/h"));
  }

  fn profile_with(save: &str, databases: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
      "schemaVersion": 1, "updatedAt": 5,
      "profile": { "Default": {
        "localStorage": { "https://h": { "save": save } },
        "sessionStorage": {},
        "cookies": [],
        "indexedDB": databases
      }}
    })
  }

  #[test]
  fn databases_whose_names_look_alike_keep_a_directory_each() {
    let roots = temp_roots("profile-names");
    let databases = serde_json::json!([
      { "name": "/idbfs", "version": 21, "objectStores": ["FILE_DATA"], "records": [{ "storeName": "FILE_DATA", "key": "a", "value": "1" }] },
      { "name": "_idbfs", "version": 1, "objectStores": ["s"], "records": [{ "storeName": "s", "key": "b", "value": "2" }] }
    ]);
    assert_ne!(database_dir_name("/idbfs"), database_dir_name("_idbfs"));
    write_profile(&roots, "g", &profile_with("1", databases)).unwrap();
    let back = read_profile(&roots, "g").unwrap().unwrap();
    let mut names: Vec<String> = back["profile"]["Default"]["indexedDB"]
      .as_array()
      .unwrap()
      .iter()
      .map(|db| db["name"].as_str().unwrap().to_string())
      .collect();
    names.sort();
    assert_eq!(names, ["/idbfs", "_idbfs"]);
    /* A name made only of what a path cannot hold still gets a usable directory. */
    assert!(database_dir_name("..").starts_with('_'));
    assert!(!database_dir_name("../../x").contains('/'));
  }

  #[test]
  fn a_write_that_fails_leaves_the_saves_that_were_there() {
    let roots = temp_roots("profile-atomic");
    let no_databases = serde_json::json!([]);
    write_profile(&roots, "g", &profile_with("1", no_databases.clone())).unwrap();
    /* Not a profile at all: refused before anything on disk changes. */
    assert!(write_profile(&roots, "g", &serde_json::json!({ "profile": {} })).is_err());
    let back = read_profile(&roots, "g").unwrap().unwrap();
    assert_eq!(back["profile"]["Default"]["localStorage"]["https://h"]["save"], "1");
    /* The disk refuses the new files: the old profile is still whole. */
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let game_dir = roots.data.join("g");
      std::fs::set_permissions(&game_dir, std::fs::Permissions::from_mode(0o555)).unwrap();
      let refused = write_profile(&roots, "g", &profile_with("2", no_databases.clone()));
      std::fs::set_permissions(&game_dir, std::fs::Permissions::from_mode(0o755)).unwrap();
      /* Root ignores the permission; the check only means something when it applied. */
      if refused.is_err() {
        let back = read_profile(&roots, "g").unwrap().unwrap();
        assert_eq!(back["profile"]["Default"]["localStorage"]["https://h"]["save"], "1");
      }
    }
    write_profile(&roots, "g", &profile_with("3", no_databases)).unwrap();
    let back = read_profile(&roots, "g").unwrap().unwrap();
    assert_eq!(back["profile"]["Default"]["localStorage"]["https://h"]["save"], "3");
    /* Nothing is left beside the profile: no staging copy, no previous one. */
    let mut left: Vec<String> = std::fs::read_dir(roots.data.join("g"))
      .unwrap()
      .flatten()
      .map(|e| e.file_name().to_string_lossy().into_owned())
      .collect();
    left.sort();
    assert_eq!(left, ["data"]);
  }

  #[test]
  fn a_write_cut_off_between_its_renames_still_reads_back() {
    let roots = temp_roots("profile-swap");
    write_profile(&roots, "g", &profile_with("7", serde_json::json!([]))).unwrap();
    let data = roots.data.join("g/data");
    /* The app died after moving the old profile aside, before the new one took its place. */
    std::fs::rename(&data, roots.data.join("g").join(PROFILE_PREVIOUS)).unwrap();
    std::fs::create_dir_all(roots.data.join("g").join(format!("{PROFILE_WRITING}1-2/profile")))
      .unwrap();
    let back = read_profile(&roots, "g").unwrap().unwrap();
    assert_eq!(back["profile"]["Default"]["localStorage"]["https://h"]["save"], "7");
    /* The next write cleans up after it. */
    write_profile(&roots, "g", &profile_with("8", serde_json::json!([]))).unwrap();
    let back = read_profile(&roots, "g").unwrap().unwrap();
    assert_eq!(back["profile"]["Default"]["localStorage"]["https://h"]["save"], "8");
    let left: Vec<String> = std::fs::read_dir(roots.data.join("g"))
      .unwrap()
      .flatten()
      .map(|e| e.file_name().to_string_lossy().into_owned())
      .collect();
    assert_eq!(left, ["data"]);
    delete_profile(&roots, "g").unwrap();
    assert!(read_profile(&roots, "g").unwrap().is_none());
  }

  #[test]
  fn entry_html_gets_the_bridge_and_vaulted_urls() {
    let roots = temp_roots("html");
    let mirror = roots.data.join("g/offline");
    write(&mirror.join("_external/cdn.example.com/lib/x.js"), "1");
    let html = "<html><head></head><body><script src=\"https://cdn.example.com/lib/x.js?v=2\"></script></body></html>";
    let out = offline_html(html, &mirror, "g");
    assert!(out.contains("src=\"_external/cdn.example.com/lib/x.js?v=2\""));
    assert!(out.contains("window.__ptGameId=\"g\""));
    assert!(out.find("__ptGameId").unwrap() < out.find("<body>").unwrap());
  }

  #[test]
  fn unity_pages_get_the_unity_patches_but_crazygames_shells_do_not() {
    let root = Path::new("/nonexistent");
    let unity = "<html><head><script src=\"https://x/poki-sdk.js\"></script></head><body><script>createUnityInstance(c)</script></body></html>";
    let out = offline_html(unity, root, "g");
    assert!(out.contains("Injected into Unity WebGL shells"));
    assert!(!out.contains("https://x/poki-sdk.js"));
    let shell = "<html><head></head><body><script>Crazygames.load(o)</script><script>createUnityInstance()</script></body></html>";
    assert!(!offline_html(shell, root, "g").contains("Injected into Unity WebGL shells"));
  }

  #[test]
  fn profiles_round_trip_in_the_puller_layout() {
    let roots = temp_roots("profile");
    assert!(read_profile(&roots, "g").unwrap().is_none());
    let profile = serde_json::json!({
      "schemaVersion": 1, "updatedAt": 5,
      "profile": { "Default": {
        "localStorage": { "https://h": { "save": "1" } },
        "sessionStorage": {},
        "cookies": [{ "name": "c", "value": "v" }],
        "indexedDB": [{ "name": "/idbfs", "version": 21, "objectStores": ["FILE_DATA"], "records": [{ "storeName": "FILE_DATA", "key": "k", "value": "v" }] }]
      }}
    });
    write_profile(&roots, "g", &profile).unwrap();
    assert!(roots
      .data
      .join("g/data/profile/Default/localStorage.json")
      .is_file());
    assert!(roots
      .data
      .join("g/data/profile/Default/indexeddb")
      .join(database_dir_name("/idbfs"))
      .join("records.json")
      .is_file());
    let back = read_profile(&roots, "g").unwrap().unwrap();
    assert_eq!(
      back["profile"]["Default"]["localStorage"]["https://h"]["save"],
      "1"
    );
    assert_eq!(back["profile"]["Default"]["indexedDB"][0]["name"], "/idbfs");
    assert_eq!(back["profile"]["Default"]["indexedDB"][0]["version"], 21);
    assert!(back["updatedAt"].as_f64().unwrap() > 5.0);
    delete_profile(&roots, "g").unwrap();
    assert!(read_profile(&roots, "g").unwrap().is_none());
  }

  #[test]
  fn a_profile_that_cannot_be_read_is_an_error_not_no_saves() {
    let roots = temp_roots("profile-unreadable");
    let data = roots.data.join("g/data");
    /* Files that are simply absent are no saves. */
    std::fs::create_dir_all(&data).unwrap();
    assert!(read_profile(&roots, "g").unwrap().is_none());

    write(&data.join("meta.json"), r#"{"schemaVersion":1,"updatedAt":7}"#);
    write(&data.join(PROFILE_LOCAL), r#"{"https://h":{"save":"#);
    assert!(read_profile(&roots, "g").is_err(), "truncated localStorage.json");

    write(&data.join(PROFILE_LOCAL), r#"["not", "an", "object"]"#);
    assert!(read_profile(&roots, "g").is_err(), "localStorage.json of the wrong kind");

    write(&data.join(PROFILE_LOCAL), r#"{"https://h":{"save":"3"}}"#);
    write(&data.join("profile/Default/indexeddb/_idbfs/meta.json"), r#"{"name":"/idbfs""#);
    assert!(read_profile(&roots, "g").is_err(), "corrupt database meta");

    std::fs::remove_file(data.join("profile/Default/indexeddb/_idbfs/meta.json")).unwrap();
    /* A path that cannot be read as a file (here a directory) is an I/O error. */
    std::fs::create_dir_all(data.join(PROFILE_COOKIES)).unwrap();
    assert!(read_profile(&roots, "g").is_err(), "unreadable cookies.json");

    std::fs::remove_dir(data.join(PROFILE_COOKIES)).unwrap();
    let back = read_profile(&roots, "g").unwrap().unwrap();
    assert_eq!(back["profile"]["Default"]["localStorage"]["https://h"]["save"], "3");
    assert_eq!(back["profile"]["Default"]["cookies"], serde_json::json!([]));
  }
}
