//! In-process relay for the games a plain iframe cannot play, as the `ptrelay` URI scheme.
//!
//! Most catalog games play straight from their own host (see `game_frames.rs` for how the
//! bridge gets into them). A few hosts cannot be framed that way at all:
//!
//! - `prod.addictinggames.com` serves Flash `.swf` files with `X-Frame-Options: SAMEORIGIN`,
//!   and without CORS headers, so neither a frame nor Ruffle's `fetch` can reach them;
//! - any host that refuses to be framed (`X-Frame-Options`, CSP `frame-ancestors`) or labels
//!   its HTML with the wrong content type.
//!
//! This relays only the top document of such a game: it fetches the catalog game's own
//! embed URL (never a URL from the request, so a game frame cannot turn it into a fetch
//! proxy), drops the response headers that forbid framing, serves the HTML as HTML with a
//! `<base href>` pointing back at the origin and the bridge first in `<head>`, and lets
//! every subresource load straight from the origin. Flash titles get a small page that
//! runs them in Ruffle, with the `.swf` bytes relayed alongside.
//!
//! The Node puller did the same by proxying and rewriting every asset of the game, which
//! is what made it slow. Fetches here go through reqwest with the OS trust store, so a
//! network whose filter re-signs TLS with its own root CA still works.
//!
//! It also serves Drive U 7 games' own document, the catalog's `online/embed.html`
//! (`…/game/<id>/local`), so that third-party HTML runs on the relay's origin and not, as
//! an app-made `blob:` would, on the app's.
//!
//! What it serves is never readable from another origin (no CORS headers: Ruffle reads the
//! `.swf` from the relay's own origin), and a redirect from the game's host is followed only
//! to the open web over http(s) — never to this machine or the local network.

// Registered as a scheme on desktop only.
#![cfg_attr(mobile, allow(dead_code))]

use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Duration;

use tauri::http::{header, Response, StatusCode};

use crate::game_frames::is_catalog_id;

pub const SCHEME: &str = "ptrelay";

/// Pinned Ruffle release on jsDelivr (served with `Access-Control-Allow-Origin: *`).
const RUFFLE_SCRIPT: &str = "https://cdn.jsdelivr.net/npm/@ruffle-rs/ruffle@0.6.0/ruffle.js";
/// What the webview itself claims to be; some hosts serve other markup to unknown agents.
const USER_AGENT: &str =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
/// A top document or a Flash file; anything bigger is not a game page.
const MAX_BODY_BYTES: usize = 96 * 1024 * 1024;
/// Redirects followed from the catalog URL before giving up.
const MAX_REDIRECTS: usize = 8;

fn client() -> &'static reqwest::Client {
  static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
  CLIENT.get_or_init(|| {
    reqwest::Client::builder()
      .user_agent(USER_AGENT)
      .connect_timeout(Duration::from_secs(15))
      .timeout(Duration::from_secs(90))
      // Followed by hand in `fetch`, where each hop is checked (`check_redirect`).
      .redirect(reqwest::redirect::Policy::none())
      .build()
      .expect("relay HTTP client")
  })
}

/// No `Access-Control-Allow-Origin`: what the relay fetched is for the relay's own pages
/// (the game, and Ruffle reading its `.swf`), never for another origin to read.
fn respond(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
  Response::builder()
    .status(status)
    .header(header::CONTENT_TYPE, content_type)
    .header(header::CACHE_CONTROL, "no-store")
    .body(body)
    .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn error(status: StatusCode, message: &str) -> Response<Vec<u8>> {
  respond(
    status,
    "text/plain; charset=utf-8",
    message.as_bytes().to_vec(),
  )
}

/// The first of `keys` in the game's catalog metadata that holds an http(s) URL.
fn metadata_url(catalog: &Path, id: &str, keys: &[&str]) -> Option<reqwest::Url> {
  let raw = std::fs::read_to_string(catalog.join(id).join("online").join("metadata.json")).ok()?;
  let meta: serde_json::Value = serde_json::from_str(&raw).ok()?;
  let url = keys
    .iter()
    .filter_map(|key| meta.get(*key).and_then(|v| v.as_str()))
    .map(str::trim)
    .find(|s| !s.is_empty())?;
  let parsed = reqwest::Url::parse(url).ok()?;
  matches!(parsed.scheme(), "https" | "http").then_some(parsed)
}

/// The game's own online URL from its catalog metadata.
fn embed_url(catalog: &Path, id: &str) -> Option<reqwest::Url> {
  metadata_url(catalog, id, &["onlineEmbedUrl", "remotePlayUrl"])
}

/// Is `ip` somewhere on the open internet — not this machine, the local network, or a
/// range that is never routed there?
pub(crate) fn is_public_ip(ip: IpAddr) -> bool {
  match ip {
    IpAddr::V4(v4) => {
      let [a, b, ..] = v4.octets();
      !(v4.is_loopback()
        || v4.is_private()
        || v4.is_link_local()
        || v4.is_unspecified()
        || v4.is_broadcast()
        || v4.is_multicast()
        || v4.is_documentation()
        || a == 0
        // Carrier-grade NAT (100.64.0.0/10), benchmarking (198.18.0.0/15), reserved (240/4).
        || (a == 100 && (b & 0xc0) == 64)
        || (a == 198 && (b & 0xfe) == 18)
        || a >= 240)
    }
    IpAddr::V6(v6) => {
      if let Some(v4) = v6.to_ipv4_mapped() {
        return is_public_ip(IpAddr::V4(v4));
      }
      let [s0, s1, ..] = v6.segments();
      !(v6.is_loopback()
        || v6.is_unspecified()
        || v6.is_multicast()
        // Unique local (fc00::/7), link-local (fe80::/10), old site-local (fec0::/10).
        || (s0 & 0xfe00) == 0xfc00
        || (s0 & 0xffc0) == 0xfe80
        || (s0 & 0xffc0) == 0xfec0
        // Documentation (2001:db8::/32).
        || (s0 == 0x2001 && s1 == 0x0db8))
    }
  }
}

/// Why a redirect may not go to `url`, judged from the URL alone: anything but http(s), a
/// host that is this machine (`localhost`, `*.localhost`), or an address off the open
/// internet.
pub(crate) fn refuse_redirect_target(url: &reqwest::Url) -> Option<String> {
  if !matches!(url.scheme(), "http" | "https") {
    return Some(format!("redirect to {url} refused: not http(s)"));
  }
  let Some(host) = url.host_str() else {
    return Some(format!("redirect to {url} refused: no host"));
  };
  let host = host.trim_start_matches('[').trim_end_matches(']');
  if let Ok(ip) = host.parse::<IpAddr>() {
    return (!is_public_ip(ip)).then(|| format!("redirect to {url} refused: {ip} is not public"));
  }
  let name = host.trim_end_matches('.').to_ascii_lowercase();
  (name == "localhost" || name.ends_with(".localhost"))
    .then(|| format!("redirect to {url} refused: {name} is this machine"))
}

/// Why a redirect's `host` may not be reached, given the addresses it resolved to; `None`
/// when every one of them is public.
pub(crate) fn refuse_resolved(host: &str, addrs: &[IpAddr]) -> Option<String> {
  if addrs.is_empty() {
    return Some(format!("{host} resolves to nothing"));
  }
  addrs
    .iter()
    .find(|ip| !is_public_ip(**ip))
    .map(|ip| format!("{host} resolves to {ip}, which is not public"))
}

/// A redirect the relay may follow. Beyond the URL, the host's name is resolved and every
/// address it has must be public: a name pointing into the local network is refused as the
/// address itself would be. (The connection resolves the name again, so this narrows the
/// window for a name that changes its answer rather than closing it.)
async fn check_redirect(url: &reqwest::Url) -> Result<(), String> {
  if let Some(why) = refuse_redirect_target(url) {
    return Err(why);
  }
  let host = url.host_str().unwrap_or_default();
  if host.starts_with('[') || host.parse::<IpAddr>().is_ok() {
    return Ok(());
  }
  let port = url.port_or_known_default().unwrap_or(443);
  let addrs: Vec<IpAddr> = tokio::net::lookup_host((host, port))
    .await
    .map_err(|e| format!("redirect to {url} refused: cannot resolve {host}: {e}"))?
    .map(|addr| addr.ip())
    .collect();
  match refuse_resolved(host, &addrs) {
    Some(why) => Err(format!("redirect to {url} refused: {why}")),
    None => Ok(()),
  }
}

fn is_flash(url: &reqwest::Url, content_type: &str) -> bool {
  content_type.starts_with("application/x-shockwave-flash")
    || url.path().to_ascii_lowercase().ends_with(".swf")
}

/// HTML served under another label (jsDelivr sends `text/plain` for `.html`).
fn looks_like_html(body: &[u8]) -> bool {
  let head = String::from_utf8_lossy(&body[..body.len().min(2048)]).to_ascii_lowercase();
  let head = head.trim_start_matches('\u{feff}').trim_start();
  head.starts_with("<!doctype html")
    || head.starts_with("<html")
    || head.starts_with("<head")
    || head.starts_with("<script")
    || head.contains("<body")
}

/// The bridge as an inline script, with the game id it cannot read from a relay URL.
pub fn inline_bridge(id: &str) -> String {
  let source = crate::game_frames::BRIDGE_SOURCE.replace("</script", "<\\/script");
  let id_json = serde_json::to_string(id).unwrap_or_else(|_| "\"\"".into());
  format!("<script>window.__ptGameId={id_json};{source}</script>")
}

/// Tell the app this document ran — the launch watchdog treats silence as a blank frame.
fn hello(id: &str) -> String {
  let id_json = serde_json::to_string(id).unwrap_or_else(|_| "\"\"".into());
  format!(
    "<script>try{{window.top.postMessage({{type:'potato-tomato-game-frame',role:'relay',gameId:{id_json},href:location.href}},'*')}}catch(e){{}}</script>"
  )
}

fn escape_attr(value: &str) -> String {
  value
    .replace('&', "&amp;")
    .replace('"', "&quot;")
    .replace('<', "&lt;")
    .replace('>', "&gt;")
}

/// Where relative URLs in the page resolve: the page's own `<base>` if it has one
/// (resolved against where the page really came from), else the page URL itself.
fn base_href(html: &str, page_url: &reqwest::Url) -> String {
  static BASE: OnceLock<regex::Regex> = OnceLock::new();
  let re = BASE.get_or_init(|| {
    regex::Regex::new(r#"(?is)<base\b[^>]*\bhref\s*=\s*["']?([^"'\s>]+)"#).expect("base regex")
  });
  re.captures(html)
    .and_then(|c| c.get(1))
    .and_then(|m| page_url.join(m.as_str()).ok())
    .unwrap_or_else(|| page_url.clone())
    .to_string()
}

/// Put `tags` first inside `<head>` (or as early as the document allows).
pub fn insert_first_in_head(html: &str, tags: &str) -> String {
  static HEAD: OnceLock<regex::Regex> = OnceLock::new();
  static HTML: OnceLock<regex::Regex> = OnceLock::new();
  let head = HEAD.get_or_init(|| regex::Regex::new(r"(?i)<head(\s[^>]*)?>").expect("head regex"));
  let html_tag =
    HTML.get_or_init(|| regex::Regex::new(r"(?i)<html(\s[^>]*)?>").expect("html regex"));
  for re in [head, html_tag] {
    if let Some(m) = re.find(html) {
      let mut out = String::with_capacity(html.len() + tags.len());
      out.push_str(&html[..m.end()]);
      out.push_str(tags);
      out.push_str(&html[m.end()..]);
      return out;
    }
  }
  format!("{tags}{html}")
}

/// Bridge tags a page already carries (a dev server or a capture wrote them). They load
/// `/game-storage-bridge.child.js` from the page's own origin — a relay or an offline copy,
/// which has no such file — and the bridge goes in inline anyway.
pub fn strip_bridge_tags(html: &str) -> String {
  static TAG: OnceLock<regex::Regex> = OnceLock::new();
  TAG
    .get_or_init(|| {
      regex::Regex::new(
        r"(?is)<script\b[^>]*game-storage-bridge\.child\.js[^>]*>\s*</script\s*>",
      )
      .expect("bridge tag regex")
    })
    .replace_all(html, "")
    .into_owned()
}

/// A relayed HTML page: origin-relative URLs keep resolving to the origin.
pub fn relay_html(html: &str, page_url: &reqwest::Url, id: &str) -> String {
  let html = strip_bridge_tags(html);
  let html = html.as_str();
  let base = format!(
    "<base href=\"{}\">",
    escape_attr(&base_href(html, page_url))
  );
  insert_first_in_head(
    html,
    &format!(
      "<meta charset=\"utf-8\">{base}{}{}",
      hello(id),
      inline_bridge(id)
    ),
  )
}

/// A Flash title in Ruffle, reading the `.swf` through this relay.
pub fn ruffle_page(id: &str, swf_url: &reqwest::Url) -> String {
  /* Catalog ids may hold a space (`2016 - diamond run`); nothing else needs escaping. */
  let swf = format!("{SCHEME}://localhost/game/{}/swf", id.replace(' ', "%20"));
  let base = swf_url.join(".").map(|u| u.to_string()).unwrap_or_default();
  let config = serde_json::json!({
    "autoplay": "on",
    "unmuteOverlay": "hidden",
    "splashScreen": false,
    "letterbox": "on",
    "contextMenu": "off",
    "warnOnUnsupportedContent": false,
    "showSwfDownload": false,
    "base": base,
  });
  let swf_json = serde_json::to_string(&swf).unwrap_or_default();
  format!(
    r#"<!doctype html><html><head><meta charset="utf-8">{hello}{bridge}
<style>html,body{{margin:0;width:100%;height:100%;overflow:hidden;background:#000}}ruffle-player{{display:block;width:100%;height:100%}}</style>
<script>window.RufflePlayer=window.RufflePlayer||{{}};window.RufflePlayer.config={config};</script>
<script src="{RUFFLE_SCRIPT}"></script></head><body>
<script>(function(){{var player=window.RufflePlayer.newest().createPlayer();document.body.appendChild(player);player.load({{url:{swf_json}}});}})();</script>
</body></html>"#,
    hello = hello(id),
    bridge = inline_bridge(id),
  )
}

/// Fetch `url`, following its redirects only where `check_redirect` allows.
async fn fetch(url: reqwest::Url) -> Result<(reqwest::Url, String, Vec<u8>), String> {
  let mut current = url.clone();
  let mut hops = 0;
  let response = loop {
    let response = client()
      .get(current.clone())
      .send()
      .await
      .map_err(|e| format!("{current}: {e}"))?;
    let location = response
      .status()
      .is_redirection()
      .then(|| response.headers().get(header::LOCATION))
      .flatten()
      .and_then(|v| v.to_str().ok())
      .map(str::to_string);
    let Some(location) = location else {
      break response;
    };
    hops += 1;
    if hops > MAX_REDIRECTS {
      return Err(format!("{url}: more than {MAX_REDIRECTS} redirects"));
    }
    let next = current
      .join(&location)
      .map_err(|e| format!("{current}: redirect to {location:?}: {e}"))?;
    check_redirect(&next).await?;
    current = next;
  };
  if !response.status().is_success() {
    return Err(format!("{url}: HTTP {}", response.status()));
  }
  let final_url = response.url().clone();
  let content_type = response
    .headers()
    .get(header::CONTENT_TYPE)
    .and_then(|v| v.to_str().ok())
    .unwrap_or("")
    .to_ascii_lowercase();
  if response.content_length().unwrap_or(0) as usize > MAX_BODY_BYTES {
    return Err(format!("{url}: too large"));
  }
  let body = response.bytes().await.map_err(|e| format!("{url}: {e}"))?;
  if body.len() > MAX_BODY_BYTES {
    return Err(format!("{url}: too large"));
  }
  Ok((final_url, content_type, body.to_vec()))
}

async fn game_page(catalog: &Path, id: &str) -> Response<Vec<u8>> {
  let Some(url) = embed_url(catalog, id) else {
    return error(StatusCode::NOT_FOUND, "no online URL for this game");
  };
  if is_flash(&url, "") {
    return respond(
      StatusCode::OK,
      "text/html; charset=utf-8",
      ruffle_page(id, &url).into_bytes(),
    );
  }
  match fetch(url).await {
    Ok((final_url, content_type, body)) => {
      if is_flash(&final_url, &content_type) {
        return respond(
          StatusCode::OK,
          "text/html; charset=utf-8",
          ruffle_page(id, &final_url).into_bytes(),
        );
      }
      if content_type.starts_with("text/html")
        || content_type.starts_with("application/xhtml")
        || looks_like_html(&body)
      {
        let html = String::from_utf8_lossy(&body);
        return respond(
          StatusCode::OK,
          "text/html; charset=utf-8",
          relay_html(&html, &final_url, id).into_bytes(),
        );
      }
      let content_type = if content_type.is_empty() {
        "application/octet-stream".to_string()
      } else {
        content_type
      };
      respond(StatusCode::OK, &content_type, body)
    }
    Err(e) => {
      log::warn!("relay: {e}");
      error(StatusCode::BAD_GATEWAY, &e)
    }
  }
}

/// A Drive U 7 game: the catalog's own `online/embed.html` (the document inside the Google
/// Sites gadget), its relative URLs resolving where the gadget's did.
async fn game_local(catalog: &Path, id: &str) -> Response<Vec<u8>> {
  let path = catalog.join(id).join("online").join("embed.html");
  let bytes = match tokio::fs::read(&path).await {
    Ok(bytes) if bytes.len() <= MAX_BODY_BYTES => bytes,
    Ok(_) => return error(StatusCode::PAYLOAD_TOO_LARGE, "embed.html is too large"),
    Err(_) => return error(StatusCode::NOT_FOUND, "no local embed for this game"),
  };
  let Some(base) =
    metadata_url(catalog, id, &["embedBaseUrl"]).or_else(|| embed_url(catalog, id))
  else {
    return error(StatusCode::NOT_FOUND, "no base URL for this game's embed");
  };
  let html = String::from_utf8_lossy(&bytes);
  respond(
    StatusCode::OK,
    "text/html; charset=utf-8",
    relay_html(&html, &base, id).into_bytes(),
  )
}

async fn game_swf(catalog: &Path, id: &str) -> Response<Vec<u8>> {
  let Some(url) = embed_url(catalog, id) else {
    return error(StatusCode::NOT_FOUND, "no online URL for this game");
  };
  match fetch(url).await {
    Ok((_, _, body)) => respond(StatusCode::OK, "application/x-shockwave-flash", body),
    Err(e) => {
      log::warn!("relay: {e}");
      error(StatusCode::BAD_GATEWAY, &e)
    }
  }
}

/// Decode `%XX` escapes in a request path; anything malformed is kept as it is.
pub(crate) fn percent_decode(input: &str) -> String {
  let bytes = input.as_bytes();
  let mut out = Vec::with_capacity(bytes.len());
  let mut i = 0;
  while i < bytes.len() {
    if bytes[i] == b'%' && i + 3 <= bytes.len() {
      if let Some(v) = std::str::from_utf8(&bytes[i + 1..i + 3])
        .ok()
        .and_then(|hex| u8::from_str_radix(hex, 16).ok())
      {
        out.push(v);
        i += 3;
        continue;
      }
    }
    out.push(bytes[i]);
    i += 1;
  }
  String::from_utf8_lossy(&out).into_owned()
}

/// `ptrelay://localhost/game/<id>` (the page), `…/game/<id>/swf` (a Flash file) and
/// `…/game/<id>/local` (the catalog's own `embed.html`).
pub async fn handle(catalog: PathBuf, path: String) -> Response<Vec<u8>> {
  let path = percent_decode(&path);
  let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
  match parts.as_slice() {
    ["game", id] if is_catalog_id(id) => game_page(&catalog, id).await,
    ["game", id, "swf"] if is_catalog_id(id) => game_swf(&catalog, id).await,
    ["game", id, "local"] if is_catalog_id(id) => game_local(&catalog, id).await,
    _ => error(StatusCode::NOT_FOUND, "not a relay URL"),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn percent_decoding_keeps_odd_input_intact() {
    assert_eq!(percent_decode("a%20b"), "a b");
    assert_eq!(percent_decode("100%"), "100%");
    assert_eq!(percent_decode("%zz"), "%zz");
  }

  #[test]
  fn relayed_html_keeps_resolving_against_the_origin() {
    let page = reqwest::Url::parse("https://cdn.example.com/gh/u/r@1/index.html").unwrap();
    let out = relay_html(
      "<!doctype html><html><head><title>x</title></head></html>",
      &page,
      "g-1",
    );
    let head_at = out.find("<head>").unwrap();
    let base_at = out
      .find("<base href=\"https://cdn.example.com/gh/u/r@1/index.html\">")
      .unwrap();
    let bridge_at = out.find("window.__ptGameId=\"g-1\"").unwrap();
    let title_at = out.find("<title>").unwrap();
    assert!(head_at < base_at && base_at < bridge_at && bridge_at < title_at);
  }

  #[test]
  fn an_existing_base_is_honoured_not_overridden() {
    let page = reqwest::Url::parse("https://host.example/game/play.html").unwrap();
    let out = relay_html("<head><base href=\"assets/\"></head>", &page, "g");
    assert!(out.contains("<base href=\"https://host.example/game/assets/\">"));
  }

  #[test]
  fn documents_without_a_head_still_get_the_bridge_first() {
    let page = reqwest::Url::parse("https://h.example/").unwrap();
    assert!(
      relay_html("<html><body>hi</body></html>", &page, "g").starts_with("<html><meta charset")
    );
    assert!(relay_html("<p>bare</p>", &page, "g").starts_with("<meta charset"));
  }

  #[test]
  fn the_inline_bridge_cannot_close_its_own_script_tag() {
    let tag = inline_bridge("g");
    assert_eq!(tag.matches("</script>").count(), 1);
    assert!(tag.ends_with("</script>"));
  }

  #[test]
  fn sniffs_html_served_as_text() {
    assert!(looks_like_html(b"\n  <!DOCTYPE html><html>"));
    assert!(looks_like_html(b"<html lang=en>"));
    assert!(!looks_like_html(b"{\"json\":true}"));
  }

  #[test]
  fn flash_is_recognised_by_type_or_extension() {
    let swf = reqwest::Url::parse("https://prod.example/files/game_0.SWF").unwrap();
    let page = reqwest::Url::parse("https://prod.example/play").unwrap();
    assert!(is_flash(&swf, ""));
    assert!(is_flash(&page, "application/x-shockwave-flash"));
    assert!(!is_flash(&page, "text/html"));
  }

  #[test]
  fn relayed_pages_are_not_readable_from_other_origins() {
    let res = respond(StatusCode::OK, "text/html", b"x".to_vec());
    assert!(res
      .headers()
      .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
      .is_none());
    let res = error(StatusCode::NOT_FOUND, "no");
    assert!(res
      .headers()
      .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
      .is_none());
  }

  #[test]
  fn redirects_stay_on_the_open_web() {
    let refused = [
      "file:///etc/passwd",
      "ftp://files.example.com/x",
      "data:text/html,hi",
      "http://localhost/",
      "http://LOCALHOST./admin",
      "http://router.localhost/",
      "http://127.0.0.1:8080/",
      "http://127.8.9.10/",
      "http://0.0.0.0/",
      "http://10.1.2.3/",
      "http://172.16.0.1/",
      "http://172.31.255.255/",
      "http://192.168.1.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://100.64.0.1/",
      "http://198.18.0.1/",
      "http://224.0.0.1/",
      "http://255.255.255.255/",
      "http://[::1]/",
      "http://[::]/",
      "http://[fe80::1]/",
      "http://[fd12:3456::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:192.168.0.1]/",
      "http://[2001:db8::1]/",
    ];
    for raw in refused {
      let url = reqwest::Url::parse(raw).unwrap();
      assert!(refuse_redirect_target(&url).is_some(), "{raw} should be refused");
    }
    let allowed = [
      "https://cdn.jsdelivr.net/gh/u/r@1/index.html",
      "http://prod.addictinggames.com/files/game.swf",
      "https://8.8.8.8/",
      "https://172.32.0.1/",
      "https://[2606:4700:4700::1111]/",
      "https://localhost.example.com/",
    ];
    for raw in allowed {
      let url = reqwest::Url::parse(raw).unwrap();
      assert!(refuse_redirect_target(&url).is_none(), "{raw} should be allowed");
    }
  }

  #[test]
  fn a_name_that_resolves_into_the_local_network_is_refused() {
    let public: IpAddr = "93.184.215.14".parse().unwrap();
    let private: IpAddr = "192.168.0.10".parse().unwrap();
    let loopback: IpAddr = "::1".parse().unwrap();
    assert!(refuse_resolved("cdn.example", &[public]).is_none());
    assert!(refuse_resolved("rebind.example", &[public, private]).is_some());
    assert!(refuse_resolved("rebind.example", &[loopback]).is_some());
    assert!(refuse_resolved("nothing.example", &[]).is_some());
    /* The whole check, through a real lookup: `localhost` never gets as far as DNS. */
    let url = reqwest::Url::parse("http://localhost:9/").unwrap();
    assert!(tauri::async_runtime::block_on(check_redirect(&url)).is_err());
  }

  /// A host answering every request with a redirect to `location`.
  fn redirecting_host(location: &'static str) -> reqwest::Url {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    std::thread::spawn(move || {
      for stream in listener.incoming().take(4) {
        let Ok(mut stream) = stream else { continue };
        let mut buf = [0u8; 2048];
        let _ = stream.read(&mut buf);
        let _ = write!(
          stream,
          "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
      }
    });
    reqwest::Url::parse(&format!("http://127.0.0.1:{port}/game.html")).unwrap()
  }

  #[test]
  fn a_redirect_into_the_local_network_is_not_followed() {
    for location in [
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost:1/admin",
      "file:///etc/passwd",
    ] {
      let start = redirecting_host(location);
      let result = tauri::async_runtime::block_on(fetch(start));
      let err = result.expect_err(location);
      assert!(err.contains("refused"), "{location}: {err}");
    }
  }

  #[test]
  fn relayed_html_drops_a_bridge_tag_it_already_carries() {
    let page = reqwest::Url::parse("https://h.example/g/").unwrap();
    let out = relay_html(
      "<html><head><script src=\"/game-storage-bridge.child.js\" data-pt-game=\"g\"></script></head></html>",
      &page,
      "g",
    );
    assert!(!out.contains("game-storage-bridge.child.js"));
    assert_eq!(out.matches("window.__ptGameId=").count(), 1);
  }

  #[test]
  fn serves_the_catalog_embed_from_its_own_base() {
    let catalog = std::env::temp_dir().join(format!("pt-relay-local-{}", std::process::id()));
    let online = catalog.join("drive-game").join("online");
    std::fs::create_dir_all(&online).unwrap();
    std::fs::write(
      online.join("metadata.json"),
      r#"{"onlineEmbedUrl":"https://sites.google.com/view/x/drive-game","embedBaseUrl":"https://cdn.jsdelivr.net/gh/o/r@main/a/"}"#,
    )
    .unwrap();
    std::fs::write(
      online.join("embed.html"),
      "<html><head><title>t</title></head><body><script src=\"game.js\"></script></body></html>",
    )
    .unwrap();
    let res = tauri::async_runtime::block_on(handle(
      catalog.clone(),
      "/game/drive-game/local".to_string(),
    ));
    assert_eq!(res.status(), StatusCode::OK);
    let body = String::from_utf8(res.body().clone()).unwrap();
    assert!(body.contains("<base href=\"https://cdn.jsdelivr.net/gh/o/r@main/a/\">"));
    assert!(body.contains("window.__ptGameId=\"drive-game\""));
    assert!(body.find("__ptGameId").unwrap() < body.find("game.js").unwrap());
    let missing = tauri::async_runtime::block_on(handle(
      catalog.clone(),
      "/game/no-such-game/local".to_string(),
    ));
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    let _ = std::fs::remove_dir_all(&catalog);
  }

  #[test]
  fn only_catalog_ids_reach_the_network() {
    let catalog = std::env::temp_dir().join(format!("pt-relay-test-{}", std::process::id()));
    for path in [
      "/game/..%2Fetc",
      "/game/a%2Fb",
      "/other/x",
      "/game/",
      "/game/unknown-id",
    ] {
      let res = tauri::async_runtime::block_on(handle(catalog.clone(), path.to_string()));
      assert_eq!(res.status(), StatusCode::NOT_FOUND, "{path}");
    }
  }
}
