//! Offline downloads in the desktop app, done by the app itself.
//!
//! The Node puller used to capture a game by driving a headless browser; it was heavy and
//! is gone. This downloads a game's files over plain HTTP instead:
//!
//! 1. Start from the game's own document: its catalog `onlineEmbedUrl` / `remotePlayUrl`,
//!    the catalog's `online/embed.html` (Drive U 7, resolved against `embedBaseUrl`), or —
//!    for games whose files ship in the catalog — the catalog's `online/` folder itself.
//! 2. Read every document, script, stylesheet and JSON file it fetches for the URLs of the
//!    files the game loads (tag `src`/`href`, CSS `url()`, quoted paths with a known asset
//!    extension) and fetch those too. Plain links (`<a href>`) are never followed, so a
//!    portal's other pages are not pulled in.
//! 3. Store each file under `offline.part/_external/<host>/<path>` — the layout
//!    `offline_games.rs` already serves, which rewrites the absolute URLs to the local copy.
//! 4. Write `offline-manifest.json` (entry, title, description, cover) and swap the
//!    finished folder in as `offline/`. Until then the game is not offline; a cancelled
//!    download keeps `offline.part/` so the next attempt only fetches what is missing.
//!
//! Every fetch goes through the relay's rules: public addresses only, redirects checked,
//! ad and analytics hosts skipped, and hard caps on file count and size.

#![cfg_attr(mobile, allow(dead_code))]

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use futures_util::future::join_all;
use serde::Serialize;
use tokio::io::AsyncWriteExt;

use crate::game_frames::is_catalog_id;
use crate::offline_games::GameRoots;

/// Folder the download is built in; swapped in as `offline/` when complete.
pub const PART_DIR: &str = "offline.part";
const MANIFEST: &str = "offline-manifest.json";
const USER_AGENT: &str =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const MAX_FILES: usize = 6000;
const MAX_TOTAL_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 768 * 1024 * 1024;
/// Text larger than this is stored but not read for more URLs.
const MAX_SCAN_BYTES: usize = 24 * 1024 * 1024;
const PARALLEL: usize = 6;

/// Hosts whose files a game never needs to run: ads, analytics, tracking.
const SKIP_HOSTS: &[&str] = &[
  "doubleclick.net",
  "googlesyndication.com",
  "googletagmanager.com",
  "google-analytics.com",
  "googletagservices.com",
  "adservice.google.com",
  "imasdk.googleapis.com",
  "pagead2.googlesyndication.com",
  "facebook.net",
  "facebook.com",
  "connect.facebook.net",
  "amazon-adsystem.com",
  "adnxs.com",
  "criteo.com",
  "taboola.com",
  "outbrain.com",
  "hotjar.com",
  "clarity.ms",
  "scorecardresearch.com",
  "quantserve.com",
  "moatads.com",
  "adsafeprotected.com",
  "rubiconproject.com",
  "pubmatic.com",
  "openx.net",
  "applovin.com",
  "unityads.unity3d.com",
  "cdn.unityads.unity3d.com",
  "gameanalytics.com",
  "sentry.io",
  "newrelic.com",
  "nr-data.net",
  "fundingchoicesmessages.google.com",
];

/// Extensions a quoted string must end in to count as a file the game loads.
const ASSET_EXTENSIONS: &[&str] = &[
  "js", "mjs", "css", "json", "wasm", "data", "unityweb", "br", "gz", "png", "jpg", "jpeg",
  "gif", "webp", "avif", "svg", "ico", "bmp", "mp3", "ogg", "oga", "wav", "m4a", "aac", "opus",
  "mp4", "webm", "ttf", "otf", "woff", "woff2", "eot", "atlas", "fnt", "xml", "txt", "bin",
  "mem", "glb", "gltf", "obj", "pck", "symbols", "zip", "swf", "ktx", "ktx2", "basis", "csv",
  "tsv", "plist", "skel", "tmx", "tsx", "frag", "vert", "glsl", "hdr", "exr", "dds", "map",
];

/* ------------------------------------------------------------------------------------
 * Progress and cancellation, per game
 * ---------------------------------------------------------------------------------- */

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
  /// `pending` | `running` | `done` | `error` | `cancelled` (the frontend's states).
  pub state: &'static str,
  pub progress: u8,
  pub message: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub error: Option<String>,
}

struct Job {
  cancel: Arc<AtomicBool>,
  discard: Arc<AtomicBool>,
}

fn progress_map() -> &'static Mutex<HashMap<String, Progress>> {
  static MAP: OnceLock<Mutex<HashMap<String, Progress>>> = OnceLock::new();
  MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn jobs() -> &'static Mutex<HashMap<String, Job>> {
  static MAP: OnceLock<Mutex<HashMap<String, Job>>> = OnceLock::new();
  MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn set_progress(id: &str, state: &'static str, progress: u8, message: String, error: Option<String>) {
  if let Ok(mut map) = progress_map().lock() {
    map.insert(
      id.to_string(),
      Progress {
        state,
        progress,
        message,
        error,
      },
    );
  }
}

pub fn progress(id: &str) -> Option<Progress> {
  progress_map().lock().ok()?.get(id).cloned()
}

/// A download for `id` is running now.
pub fn is_running(id: &str) -> bool {
  jobs().lock().map(|j| j.contains_key(id)).unwrap_or(false)
}

/* ------------------------------------------------------------------------------------
 * URL discovery (pure, unit-tested)
 * ---------------------------------------------------------------------------------- */

fn regex(slot: &'static OnceLock<regex::Regex>, pattern: &str) -> &'static regex::Regex {
  slot.get_or_init(|| regex::Regex::new(pattern).expect("static regex"))
}

fn has_asset_extension(path: &str) -> bool {
  let path = path.split(['?', '#']).next().unwrap_or(path);
  let Some(file) = path.rsplit('/').next() else {
    return false;
  };
  let Some((_, ext)) = file.rsplit_once('.') else {
    return false;
  };
  let ext = ext.to_ascii_lowercase();
  ASSET_EXTENSIONS.contains(&ext.as_str())
}

/// A string that could be a URL, not code or a template fragment.
fn plausible_ref(raw: &str) -> bool {
  !raw.is_empty()
    && raw.len() < 512
    && !raw.starts_with("data:")
    && !raw.starts_with("blob:")
    && !raw.starts_with("javascript:")
    && !raw.starts_with('#')
    && !raw.contains(['{', '}', '<', '>', '\\', '\n', ' ', '+', '`', '$', '*'])
}

/// Where a found reference came from: it decides what it resolves against.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RefKind {
  /// A tag attribute in a document: the document's URL.
  Tag,
  /// A frame's document: fetched and read like the entry.
  Frame,
  /// CSS `url()`: the stylesheet's own URL.
  Css,
  /// A quoted path in a script or JSON: the page that runs it.
  Quoted,
}

/// URL references in `text`, a file of the given kind (`html`, `css`, or script/JSON).
pub fn find_refs(text: &str, kind: &str) -> Vec<(String, RefKind)> {
  static TAG_SRC: OnceLock<regex::Regex> = OnceLock::new();
  static LINK_HREF: OnceLock<regex::Regex> = OnceLock::new();
  static FRAME_SRC: OnceLock<regex::Regex> = OnceLock::new();
  static CSS_URL: OnceLock<regex::Regex> = OnceLock::new();
  static CSS_IMPORT: OnceLock<regex::Regex> = OnceLock::new();
  static QUOTED: OnceLock<regex::Regex> = OnceLock::new();
  let mut out = Vec::new();
  let mut push = |raw: &str, kind: RefKind| {
    let raw = raw.trim();
    if plausible_ref(raw) {
      out.push((raw.to_string(), kind));
    }
  };
  if kind == "html" {
    let tag = regex(
      &TAG_SRC,
      r#"(?is)<(?:script|img|source|audio|video|embed|track|input|object)\b[^>]*?\s(?:src|data|poster|data-src)\s*=\s*["']([^"']+)["']"#,
    );
    for c in tag.captures_iter(text) {
      push(&c[1], RefKind::Tag);
    }
    let link = regex(&LINK_HREF, r#"(?is)<link\b[^>]*?\shref\s*=\s*["']([^"']+)["']"#);
    for c in link.captures_iter(text) {
      push(&c[1], RefKind::Tag);
    }
    let frame = regex(&FRAME_SRC, r#"(?is)<i?frame\b[^>]*?\ssrc\s*=\s*["']([^"']+)["']"#);
    for c in frame.captures_iter(text) {
      push(&c[1], RefKind::Frame);
    }
  }
  if kind == "html" || kind == "css" {
    let url = regex(&CSS_URL, r#"(?i)url\(\s*["']?([^"')]+)["']?\s*\)"#);
    for c in url.captures_iter(text) {
      push(&c[1], if kind == "css" { RefKind::Css } else { RefKind::Tag });
    }
    let import = regex(&CSS_IMPORT, r#"(?i)@import\s+["']([^"']+)["']"#);
    for c in import.captures_iter(text) {
      push(&c[1], if kind == "css" { RefKind::Css } else { RefKind::Tag });
    }
  }
  if kind != "css" {
    let quoted = regex(&QUOTED, r#"["']([^"'\s]{1,400}?)["']"#);
    for c in quoted.captures_iter(text) {
      if has_asset_extension(&c[1]) {
        push(&c[1], RefKind::Quoted);
      }
    }
  }
  out
}

fn host_skipped(host: &str) -> bool {
  let host = host.to_ascii_lowercase();
  SKIP_HOSTS
    .iter()
    .any(|skip| host == *skip || host.ends_with(&format!(".{skip}")))
}

/// Where a fetched URL is stored under the download folder: `_external/<host>/<path>`.
pub fn vault_path(url: &reqwest::Url) -> Option<String> {
  let host = url.host_str()?;
  let mut rel = format!("_external/{host}");
  let mut parts: Vec<&str> = url.path().split('/').filter(|p| !p.is_empty()).collect();
  if parts.iter().any(|p| *p == "." || *p == "..") {
    return None;
  }
  if url.path().ends_with('/') || parts.is_empty() {
    parts.push("index.html");
  }
  for part in parts {
    rel.push('/');
    rel.push_str(&crate::relay::percent_decode(part).replace(['\\', '\0'], "_"));
  }
  Some(rel)
}

fn text_kind(url: &reqwest::Url, content_type: &str) -> Option<&'static str> {
  let path = url.path().to_ascii_lowercase();
  if content_type.contains("html") || path.ends_with(".html") || path.ends_with(".htm") {
    Some("html")
  } else if content_type.contains("css") || path.ends_with(".css") {
    Some("css")
  } else if content_type.contains("javascript")
    || content_type.contains("json")
    || path.ends_with(".js")
    || path.ends_with(".mjs")
    || path.ends_with(".json")
  {
    Some("script")
  } else {
    None
  }
}

/* ------------------------------------------------------------------------------------
 * The download
 * ---------------------------------------------------------------------------------- */

fn client() -> &'static reqwest::Client {
  static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
  CLIENT.get_or_init(|| {
    reqwest::Client::builder()
      .user_agent(USER_AGENT)
      .connect_timeout(Duration::from_secs(20))
      .read_timeout(Duration::from_secs(60))
      .redirect(reqwest::redirect::Policy::custom(|attempt| {
        if attempt.previous().len() > 8 {
          attempt.error("too many redirects")
        } else if crate::relay::refuse_redirect_target(attempt.url()).is_some() {
          attempt.stop()
        } else {
          attempt.follow()
        }
      }))
      .dns_resolver(Arc::new(crate::relay::PublicOnlyResolver))
      .build()
      .expect("download HTTP client")
  })
}

/// Where the download starts.
#[derive(Debug)]
enum Start {
  /// Fetch this URL; it is the game's document.
  Remote(reqwest::Url),
  /// Use this local document as if it had been served from `base`.
  LocalDocument { html: String, base: reqwest::Url },
  /// The catalog's `online/` folder holds the whole game: copy it.
  CatalogCopy(PathBuf),
}

fn catalog_meta(catalog: &Path, id: &str) -> serde_json::Value {
  std::fs::read_to_string(catalog.join(id).join("online").join("metadata.json"))
    .ok()
    .and_then(|raw| serde_json::from_str(&raw).ok())
    .unwrap_or(serde_json::Value::Null)
}

fn meta_str<'a>(meta: &'a serde_json::Value, keys: &[&str]) -> Option<&'a str> {
  keys
    .iter()
    .filter_map(|k| meta.get(*k).and_then(|v| v.as_str()))
    .map(str::trim)
    .find(|s| !s.is_empty())
}

fn meta_url(meta: &serde_json::Value, keys: &[&str]) -> Option<reqwest::Url> {
  let url = reqwest::Url::parse(meta_str(meta, keys)?).ok()?;
  matches!(url.scheme(), "https" | "http").then_some(url)
}

fn start_for(catalog: &Path, id: &str, meta: &serde_json::Value) -> Result<Start, String> {
  let online = catalog.join(id).join("online");
  let embed = online.join("embed.html");
  if embed.is_file() {
    if let Some(base) = meta_url(meta, &["embedBaseUrl"]) {
      let html = std::fs::read_to_string(&embed).map_err(|e| e.to_string())?;
      return Ok(Start::LocalDocument {
        html,
        base: base.join("index.html").unwrap_or(base),
      });
    }
  }
  if let Some(url) = meta_url(meta, &["onlineEmbedUrl", "remotePlayUrl"]) {
    return Ok(Start::Remote(url));
  }
  if online.join("index.html").is_file() {
    return Ok(Start::CatalogCopy(online));
  }
  Err("This game has nothing to download.".into())
}

struct Crawl {
  id: String,
  part: PathBuf,
  cancel: Arc<AtomicBool>,
  files: usize,
  bytes: u64,
}

impl Crawl {
  fn cancelled(&self) -> bool {
    self.cancel.load(Ordering::Relaxed)
  }

  fn report(&self, queued: usize) {
    let total = self.files + queued;
    let pct = if total == 0 {
      2
    } else {
      (2 + self.files * 93 / total).min(95)
    };
    set_progress(
      &self.id,
      "running",
      pct as u8,
      format!("{} files · {}", self.files, human_bytes(self.bytes)),
      None,
    );
  }
}

fn human_bytes(bytes: u64) -> String {
  const MB: f64 = 1024.0 * 1024.0;
  if bytes as f64 >= MB * 1024.0 {
    format!("{:.1} GB", bytes as f64 / (MB * 1024.0))
  } else if bytes as f64 >= MB {
    format!("{:.0} MB", bytes as f64 / MB)
  } else {
    format!("{} KB", bytes / 1024)
  }
}

/// One fetched file: where it ended up and, for text, its contents to read for more URLs.
struct Fetched {
  final_url: reqwest::Url,
  rel: String,
  bytes: u64,
  text: Option<(String, &'static str)>,
}

async fn fetch_to(
  url: reqwest::Url,
  part: PathBuf,
  cancel: Arc<AtomicBool>,
) -> Result<Option<Fetched>, String> {
  let Some(rel) = vault_path(&url) else {
    return Ok(None);
  };
  let dest = part.join(&rel);
  /* Resume: a file from an earlier attempt is kept (and re-read if it is text). */
  if let Ok(meta) = tokio::fs::metadata(&dest).await {
    if meta.is_file() {
      let kind = text_kind(&url, "");
      let text = match kind {
        Some(kind) if (meta.len() as usize) <= MAX_SCAN_BYTES => tokio::fs::read(&dest)
          .await
          .ok()
          .map(|b| (String::from_utf8_lossy(&b).into_owned(), kind)),
        _ => None,
      };
      return Ok(Some(Fetched {
        final_url: url,
        rel,
        bytes: 0,
        text,
      }));
    }
  }
  let mut response = match client().get(url.clone()).send().await {
    Ok(r) => r,
    Err(e) => return Err(format!("{url}: {e}")),
  };
  if !response.status().is_success() {
    return Ok(None);
  }
  if response.content_length().unwrap_or(0) > MAX_FILE_BYTES {
    return Ok(None);
  }
  let final_url = response.url().clone();
  let content_type = response
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|v| v.to_str().ok())
    .unwrap_or("")
    .to_ascii_lowercase();
  /* A redirect may land elsewhere; store under the requested URL, which is what refers to it. */
  let kind = text_kind(&url, &content_type).or_else(|| text_kind(&final_url, &content_type));
  if let Some(parent) = dest.parent() {
    tokio::fs::create_dir_all(parent)
      .await
      .map_err(|e| format!("{}: {e}", parent.display()))?;
  }
  let tmp = dest.with_extension("pt-partial");
  let mut file = tokio::fs::File::create(&tmp)
    .await
    .map_err(|e| format!("{}: {e}", tmp.display()))?;
  let mut written: u64 = 0;
  let mut keep: Vec<u8> = Vec::new();
  loop {
    if cancel.load(Ordering::Relaxed) {
      drop(file);
      let _ = tokio::fs::remove_file(&tmp).await;
      return Ok(None);
    }
    let chunk = match response.chunk().await {
      Ok(Some(chunk)) => chunk,
      Ok(None) => break,
      Err(e) => {
        drop(file);
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(format!("{url}: {e}"));
      }
    };
    written += chunk.len() as u64;
    if written > MAX_FILE_BYTES {
      drop(file);
      let _ = tokio::fs::remove_file(&tmp).await;
      return Ok(None);
    }
    if kind.is_some() && keep.len() <= MAX_SCAN_BYTES {
      keep.extend_from_slice(&chunk);
    }
    file
      .write_all(&chunk)
      .await
      .map_err(|e| format!("{}: {e}", tmp.display()))?;
  }
  file.flush().await.map_err(|e| e.to_string())?;
  drop(file);
  tokio::fs::rename(&tmp, &dest)
    .await
    .map_err(|e| format!("{}: {e}", dest.display()))?;
  let text = kind
    .filter(|_| keep.len() <= MAX_SCAN_BYTES)
    .map(|kind| (String::from_utf8_lossy(&keep).into_owned(), kind));
  Ok(Some(Fetched {
    final_url,
    rel,
    bytes: written,
    text,
  }))
}

/// Queue item: the URL, the page it belongs to (quoted paths resolve against it), and
/// whether it is a document to read.
struct Item {
  url: reqwest::Url,
  page: reqwest::Url,
}

fn enqueue_refs(
  text: &str,
  kind: &str,
  file_url: &reqwest::Url,
  page: &reqwest::Url,
  seen: &mut HashSet<String>,
  queue: &mut VecDeque<Item>,
) {
  for (raw, ref_kind) in find_refs(text, kind) {
    let base = match ref_kind {
      RefKind::Tag | RefKind::Frame => file_url,
      RefKind::Css => file_url,
      RefKind::Quoted => page,
    };
    let Ok(mut url) = base.join(&raw) else {
      continue;
    };
    if !matches!(url.scheme(), "http" | "https") {
      continue;
    }
    if url.host_str().is_none_or(host_skipped) {
      continue;
    }
    url.set_fragment(None);
    /* A frame is a page of its own: what it loads resolves against it. */
    let item_page = if ref_kind == RefKind::Frame || kind == "html" && ref_kind == RefKind::Tag && url.path().ends_with(".html") {
      url.clone()
    } else {
      page.clone()
    };
    let key = vault_path(&url).unwrap_or_else(|| url.to_string());
    if seen.insert(key) {
      queue.push_back(Item {
        url,
        page: item_page,
      });
    }
  }
}

/// Fetch everything the game loads, starting from its document. Returns the entry file's
/// path under the download folder.
async fn crawl(crawl: &mut Crawl, start: Start) -> Result<String, String> {
  let mut queue: VecDeque<Item> = VecDeque::new();
  let mut seen: HashSet<String> = HashSet::new();

  let entry = match start {
    Start::CatalogCopy(dir) => {
      copy_catalog(crawl, &dir).await?;
      return Ok("index.html".to_string());
    }
    Start::LocalDocument { html, base } => {
      let rel = vault_path(&base).ok_or("bad embed base URL")?;
      let dest = crawl.part.join(&rel);
      if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
          .await
          .map_err(|e| e.to_string())?;
      }
      tokio::fs::write(&dest, html.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
      seen.insert(rel.clone());
      crawl.files += 1;
      crawl.bytes += html.len() as u64;
      enqueue_refs(&html, "html", &base, &base, &mut seen, &mut queue);
      rel
    }
    Start::Remote(url) => {
      if crate::relay::refuse_redirect_target(&url).is_some() {
        return Err("This game's address is not on the open web.".into());
      }
      let fetched = fetch_to(url.clone(), crawl.part.clone(), crawl.cancel.clone())
        .await?
        .ok_or("The game's page could not be fetched.")?;
      seen.insert(fetched.rel.clone());
      crawl.files += 1;
      crawl.bytes += fetched.bytes;
      if let Some((text, kind)) = &fetched.text {
        let page = fetched.final_url.clone();
        enqueue_refs(text, kind, &fetched.final_url, &page, &mut seen, &mut queue);
      }
      fetched.rel
    }
  };

  while !queue.is_empty() {
    if crawl.cancelled() {
      return Err("cancelled".into());
    }
    if crawl.files >= MAX_FILES || crawl.bytes >= MAX_TOTAL_BYTES {
      log::warn!("download {}: stopped at the size cap", crawl.id);
      break;
    }
    let batch: Vec<Item> = (0..PARALLEL).filter_map(|_| queue.pop_front()).collect();
    let results = join_all(batch.into_iter().map(|item| {
      let part = crawl.part.clone();
      let cancel = crawl.cancel.clone();
      async move {
        let result = fetch_to(item.url.clone(), part, cancel).await;
        (item, result)
      }
    }))
    .await;
    for (item, result) in results {
      match result {
        Ok(Some(fetched)) => {
          crawl.files += 1;
          crawl.bytes += fetched.bytes;
          if let Some((text, kind)) = &fetched.text {
            enqueue_refs(text, kind, &fetched.final_url, &item.page, &mut seen, &mut queue);
          }
        }
        Ok(None) => {}
        Err(e) => log::debug!("download {}: {e}", crawl.id),
      }
    }
    crawl.report(queue.len());
  }
  Ok(entry)
}

/// A game whose files ship in the catalog: copy its `online/` folder (bounded).
async fn copy_catalog(crawl: &mut Crawl, dir: &Path) -> Result<(), String> {
  let mut stack = vec![PathBuf::new()];
  while let Some(rel) = stack.pop() {
    if crawl.cancelled() {
      return Err("cancelled".into());
    }
    let mut entries = tokio::fs::read_dir(dir.join(&rel))
      .await
      .map_err(|e| e.to_string())?;
    while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
      let child = rel.join(entry.file_name());
      let kind = entry.file_type().await.map_err(|e| e.to_string())?;
      if kind.is_dir() {
        stack.push(child);
      } else if kind.is_file() {
        if crawl.files >= MAX_FILES {
          return Err("This game has too many files to download.".into());
        }
        let dest = crawl.part.join(&child);
        if let Some(parent) = dest.parent() {
          tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
        }
        let n = tokio::fs::copy(entry.path(), &dest)
          .await
          .map_err(|e| e.to_string())?;
        crawl.files += 1;
        crawl.bytes += n;
      }
    }
    crawl.report(stack.len());
  }
  Ok(())
}

/// Save the cover next to the copy: a catalog file, or fetched once.
async fn save_cover(part: &Path, catalog: &Path, id: &str, meta: &serde_json::Value) -> Option<String> {
  let thumb = meta_str(meta, &["thumbnail", "banner", "image"])?;
  let ext_of = |s: &str| {
    let s = s.split(['?', '#']).next().unwrap_or(s);
    s.rsplit_once('.')
      .map(|(_, e)| e.to_ascii_lowercase())
      .filter(|e| ["jpg", "jpeg", "png", "webp", "gif", "avif"].contains(&e.as_str()))
      .unwrap_or_else(|| "jpg".to_string())
  };
  let bytes = if thumb.starts_with("http://") || thumb.starts_with("https://") {
    let url = reqwest::Url::parse(thumb).ok()?;
    if crate::relay::refuse_redirect_target(&url).is_some() {
      return None;
    }
    let response = client().get(url).send().await.ok()?;
    if !response.status().is_success() {
      return None;
    }
    let body = response.bytes().await.ok()?;
    (body.len() < 16 * 1024 * 1024).then(|| body.to_vec())?
  } else {
    let rel = thumb.trim_start_matches("./").trim_start_matches('/');
    let rel = rel.strip_prefix(&format!("games/{id}/")).unwrap_or(rel);
    let candidates = [catalog.join(id).join(rel), catalog.join(id).join("online").join(rel)];
    let mut found = None;
    for path in candidates {
      if path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        continue;
      }
      if let Ok(bytes) = tokio::fs::read(&path).await {
        found = Some(bytes);
        break;
      }
    }
    found?
  };
  let rel = format!("assets/thumbnail.{}", ext_of(thumb));
  let dest = part.join(&rel);
  tokio::fs::create_dir_all(dest.parent()?).await.ok()?;
  tokio::fs::write(&dest, bytes).await.ok()?;
  Some(rel)
}

async fn run(roots: GameRoots, id: String, cancel: Arc<AtomicBool>) -> Result<(), String> {
  let game_dir = roots.data.join(&id);
  let part = game_dir.join(PART_DIR);
  tokio::fs::create_dir_all(&part)
    .await
    .map_err(|e| format!("{}: {e}", part.display()))?;
  let meta = catalog_meta(&roots.catalog, &id);
  let start = start_for(&roots.catalog, &id, &meta)?;
  let mut state = Crawl {
    id: id.clone(),
    part: part.clone(),
    cancel: cancel.clone(),
    files: 0,
    bytes: 0,
  };
  state.report(1);
  let entry = crawl(&mut state, start).await?;
  if cancel.load(Ordering::Relaxed) {
    return Err("cancelled".into());
  }
  set_progress(&id, "running", 97, "Saving cover…".into(), None);
  let thumbnail = save_cover(&part, &roots.catalog, &id, &meta).await;
  let manifest = serde_json::json!({
    "version": 2,
    "entry": entry,
    "title": meta_str(&meta, &["name", "title"]),
    "description": meta_str(&meta, &["description"]),
    "author": meta_str(&meta, &["author", "developer"]),
    "thumbnail": thumbnail,
    "sourceUrl": meta_str(&meta, &["onlineEmbedUrl", "remotePlayUrl", "embedBaseUrl"]),
    "files": state.files,
    "bytes": state.bytes,
    "downloadedAt": std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|d| d.as_millis() as u64)
      .unwrap_or(0),
  });
  tokio::fs::write(
    part.join(MANIFEST),
    serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
  )
  .await
  .map_err(|e| e.to_string())?;
  /* Swap in: the old copy (if any) goes only once the new one is complete. */
  let done = game_dir.join("offline");
  let old = game_dir.join("offline.old");
  let _ = tokio::fs::remove_dir_all(&old).await;
  if tokio::fs::metadata(&done).await.is_ok() {
    tokio::fs::rename(&done, &old)
      .await
      .map_err(|e| e.to_string())?;
  }
  tokio::fs::rename(&part, &done)
    .await
    .map_err(|e| e.to_string())?;
  let _ = tokio::fs::remove_dir_all(&old).await;
  set_progress(
    &id,
    "done",
    100,
    format!("Downloaded · {}", human_bytes(state.bytes)),
    None,
  );
  Ok(())
}

/// Start downloading `id` in the background. Returns `false` when one is already running.
pub fn start(roots: GameRoots, id: String) -> Result<bool, String> {
  if !is_catalog_id(&id) {
    return Err(format!("not a catalog game id: {id:?}"));
  }
  let cancel = Arc::new(AtomicBool::new(false));
  let discard = Arc::new(AtomicBool::new(false));
  {
    let mut jobs = jobs().lock().map_err(|e| e.to_string())?;
    if jobs.contains_key(&id) {
      return Ok(false);
    }
    jobs.insert(
      id.clone(),
      Job {
        cancel: cancel.clone(),
        discard: discard.clone(),
      },
    );
  }
  set_progress(&id, "pending", 0, "Starting…".into(), None);
  tauri::async_runtime::spawn(async move {
    let result = run(roots.clone(), id.clone(), cancel.clone()).await;
    let part = roots.data.join(&id).join(PART_DIR);
    match result {
      Ok(()) => {}
      Err(_) if cancel.load(Ordering::Relaxed) => {
        if discard.load(Ordering::Relaxed) {
          let _ = tokio::fs::remove_dir_all(&part).await;
          set_progress(&id, "cancelled", 0, "Cancelled".into(), None);
        } else {
          set_progress(&id, "cancelled", 0, "Paused".into(), None);
        }
      }
      Err(e) => {
        log::warn!("download {id} failed: {e}");
        set_progress(&id, "error", 0, "Download failed".into(), Some(e));
      }
    }
    if let Ok(mut jobs) = jobs().lock() {
      jobs.remove(&id);
    }
  });
  Ok(true)
}

/// Stop the download of `id`; with `discard`, its partial files go too.
pub fn cancel(roots: &GameRoots, id: &str, discard: bool) {
  let running = jobs().lock().ok().and_then(|jobs| {
    jobs.get(id).map(|job| {
      job.discard.store(discard, Ordering::Relaxed);
      job.cancel.store(true, Ordering::Relaxed);
    })
  });
  if running.is_none() && discard && is_catalog_id(id) {
    let _ = std::fs::remove_dir_all(roots.data.join(id).join(PART_DIR));
    if let Ok(mut map) = progress_map().lock() {
      map.remove(id);
    }
  }
}

/* ------------------------------------------------------------------------------------
 * Commands
 * ---------------------------------------------------------------------------------- */

#[tauri::command]
pub async fn offline_download_start(app: tauri::AppHandle, id: String) -> Result<bool, String> {
  start(crate::game_roots(&app), id)
}

#[tauri::command]
pub async fn offline_download_cancel(
  app: tauri::AppHandle,
  id: String,
  discard: bool,
) -> Result<(), String> {
  cancel(&crate::game_roots(&app), &id, discard);
  Ok(())
}

#[tauri::command]
pub async fn offline_download_progress(id: String) -> Option<Progress> {
  progress(&id)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn url(s: &str) -> reqwest::Url {
    reqwest::Url::parse(s).unwrap()
  }

  #[test]
  fn finds_the_files_a_page_loads_but_not_its_links() {
    let html = r#"<html><head><link rel="stylesheet" href="css/a.css"><script src="/js/game.js"></script></head>
      <body><a href="/other-game.html">x</a><img src='img/logo.png'><iframe src="https://cdn.example/g/index.html"></iframe>
      <script>var cfg = { dataUrl: "Build/game.data.unityweb", name: "hello world" };</script></body></html>"#;
    let refs: Vec<_> = find_refs(html, "html");
    let raws: Vec<&str> = refs.iter().map(|(r, _)| r.as_str()).collect();
    assert!(raws.contains(&"css/a.css"));
    assert!(raws.contains(&"/js/game.js"));
    assert!(raws.contains(&"img/logo.png"));
    assert!(raws.contains(&"Build/game.data.unityweb"));
    assert!(refs.contains(&("https://cdn.example/g/index.html".into(), RefKind::Frame)));
    assert!(!raws.contains(&"/other-game.html"));
    assert!(!raws.contains(&"hello world"));
  }

  #[test]
  fn css_urls_resolve_against_the_stylesheet() {
    let refs = find_refs("body{background:url('../img/bg.png')} @import 'x.css';", "css");
    assert!(refs.contains(&("../img/bg.png".into(), RefKind::Css)));
    assert!(refs.contains(&("x.css".into(), RefKind::Css)));
  }

  #[test]
  fn scripts_give_quoted_asset_paths_only() {
    let refs = find_refs(
      r#"load("sounds/hit.mp3"); el.className = "button big"; fetch('levels/1.json?v=2'); x = a + ".png";"#,
      "script",
    );
    let raws: Vec<&str> = refs.iter().map(|(r, _)| r.as_str()).collect();
    assert_eq!(raws, vec!["sounds/hit.mp3", "levels/1.json?v=2"]);
  }

  #[test]
  fn files_are_stored_in_the_vault_layout_the_server_reads() {
    assert_eq!(
      vault_path(&url("https://h.example/g/a%20b/x.js?v=1")).as_deref(),
      Some("_external/h.example/g/a b/x.js")
    );
    assert_eq!(
      vault_path(&url("https://h.example/g/")).as_deref(),
      Some("_external/h.example/g/index.html")
    );
    assert_eq!(
      vault_path(&url("https://h.example")).as_deref(),
      Some("_external/h.example/index.html")
    );
  }

  #[test]
  fn ad_and_analytics_hosts_are_skipped() {
    assert!(host_skipped("pagead2.googlesyndication.com"));
    assert!(host_skipped("www.googletagmanager.com"));
    assert!(!host_skipped("cdn.jsdelivr.net"));
  }

  #[test]
  fn queued_refs_resolve_and_dedupe() {
    let page = url("https://h.example/games/g/index.html");
    let mut seen = HashSet::new();
    let mut queue = VecDeque::new();
    enqueue_refs(
      r#"<script src="a.js"></script><script src="./a.js"></script><script src="https://www.google-analytics.com/a.js"></script>"#,
      "html",
      &page,
      &page,
      &mut seen,
      &mut queue,
    );
    let urls: Vec<String> = queue.iter().map(|i| i.url.to_string()).collect();
    assert_eq!(urls, vec!["https://h.example/games/g/a.js"]);
  }

  #[test]
  fn start_prefers_the_local_embed_then_the_remote_url_then_the_catalog_copy() {
    let root = std::env::temp_dir().join(format!("pt-dl-start-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let online = root.join("g").join("online");
    std::fs::create_dir_all(&online).unwrap();
    std::fs::write(online.join("index.html"), "<html></html>").unwrap();
    let none = serde_json::Value::Null;
    assert!(matches!(start_for(&root, "g", &none), Ok(Start::CatalogCopy(_))));
    let remote = serde_json::json!({"onlineEmbedUrl": "https://h.example/g/"});
    assert!(matches!(start_for(&root, "g", &remote), Ok(Start::Remote(_))));
    std::fs::write(online.join("embed.html"), "<html></html>").unwrap();
    let drive = serde_json::json!({"onlineEmbedUrl": "https://h.example/g/", "embedBaseUrl": "https://cdn.example/a/"});
    match start_for(&root, "g", &drive) {
      Ok(Start::LocalDocument { base, .. }) => assert_eq!(base.as_str(), "https://cdn.example/a/index.html"),
      other => panic!("{other:?}"),
    }
    let _ = std::fs::remove_dir_all(&root);
  }
}
