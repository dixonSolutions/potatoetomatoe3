//! In-app APK self-update for Android.
//!
//! Replaces the previous "hand the URL to the browser" flow. That flow was a dead end
//! twice over: the Tauri Android WebView registers no `DownloadListener`, so an in-page
//! `<a download>` click was silently dropped; and even once handed to a browser it left
//! the user in a download manager, hunting for the file.
//!
//! Here the release asset is streamed straight to the app's cache directory with progress
//! events, then handed to the system package installer.
//!
//! **The install is not silent, and cannot be.** Android only permits a normal app to
//! *launch* the installer; the confirmation dialog is enforced by the OS and requires the
//! `REQUEST_INSTALL_PACKAGES` permission plus the user's one-time "install unknown apps"
//! grant for this app. A genuinely unattended install needs device-owner/MDM privileges
//! that a sideloaded game launcher does not have.

use futures_util::StreamExt;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

/// Only release assets of this repo are ever downloaded or installed.
const APP_UPDATE_REPO: &str = "dixonSolutions/potatoetomatoe3";

pub const PROGRESS_EVENT: &str = "apk-update://progress";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
  /// `cached` | `downloading` | `needs-permission` | `installing` | `done` | `error`
  pub phase: String,
  pub received: u64,
  /// 0 when the server sends no Content-Length.
  pub total: u64,
  pub message: Option<String>,
}

impl UpdateProgress {
  fn downloading(received: u64, total: u64) -> Self {
    Self { phase: "downloading".into(), received, total, message: None }
  }
  fn simple(phase: &str, message: Option<String>) -> Self {
    Self { phase: phase.into(), received: 0, total: 0, message }
  }
}

/// Reject anything that is not an `.apk` release asset of this repo.
///
/// This URL becomes an `ACTION_VIEW` on a package-archive MIME type, so a loose check
/// here is the difference between self-update and arbitrary-APK install.
fn is_trusted_apk_url(url: &str) -> bool {
  url.starts_with("https://github.com/")
    && url.contains(APP_UPDATE_REPO)
    && url.ends_with(".apk")
    && !url.contains("..")
}

fn emit(app: &AppHandle, payload: UpdateProgress) {
  let _ = app.emit(PROGRESS_EVENT, payload);
}

/// Where the APK lands. Must be a path the manifest's FileProvider can hand out — the
/// generated `file_paths.xml` exposes `cache-path`, so the app cache dir is the one
/// location that works without editing the provider config.
fn apk_target_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_cache_dir()
    .map_err(|e| format!("no cache dir: {e}"))?;
  std::fs::create_dir_all(&dir).map_err(|e| format!("could not create {dir:?}: {e}"))?;
  /* Never trust the remote name for a path segment. */
  let safe = file_name
    .rsplit('/')
    .next()
    .unwrap_or("update.apk")
    .replace(['/', '\\', '\0'], "");
  Ok(dir.join(if safe.ends_with(".apk") { safe } else { "update.apk".into() }))
}

/// Stream the release APK to disk, emitting progress as it goes, then launch the installer.
///
/// Runs to completion in the background; the frontend follows `PROGRESS_EVENT` and only
/// needs to render a toast.
#[tauri::command]
pub async fn download_and_install_apk(
  app: AppHandle,
  url: String,
  file_name: String,
) -> Result<String, String> {
  if !is_trusted_apk_url(&url) {
    return Err("refusing to download an untrusted APK URL".into());
  }
  let target = apk_target_path(&app, &file_name)?;

  emit(&app, UpdateProgress::downloading(0, 0));

  /*
   * Reuse an APK already sitting in the cache from a previous run.
   *
   * Without this the updater re-pulled the whole 188 MB asset on every launch: the check
   * only compares versions, and a locally built APK reports 0.0.1 forever, so "newer
   * release exists" stays true no matter how many times the file has been fetched.
   *
   * Existence is the whole test. The target name carries the version, GitHub release
   * assets are immutable, and the download only renames `.part` onto this path after the
   * final byte — so a file here is by construction the complete asset for this version.
   * An earlier attempt gated reuse on a HEAD content-length match, which made the fast
   * path depend on a second network round trip that can fail independently of the file
   * being perfectly valid.
   */
  if std::fs::metadata(&target).is_ok_and(|m| m.len() > 0) {
    let size = std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
    emit(&app, UpdateProgress::simple("cached", None));
    emit(&app, UpdateProgress::downloading(size, size));
    return finish_install(&app, target);
  }
  prune_stale_apks(&app, &target);

  let response = reqwest::get(&url)
    .await
    .map_err(|e| format!("download failed: {e}"))?;
  if !response.status().is_success() {
    return Err(format!("download failed: HTTP {}", response.status()));
  }
  let total = response.content_length().unwrap_or(0);

  /*
   * Write to a temp file and rename on success. A half-written .apk that keeps the final
   * name would be offered to the installer on the next run and fail to parse.
   */
  let partial = target.with_extension("apk.part");
  let mut file = tokio::fs::File::create(&partial)
    .await
    .map_err(|e| format!("could not open {partial:?}: {e}"))?;

  let mut received: u64 = 0;
  let mut last_emit = 0u64;
  let mut stream = response.bytes_stream();
  while let Some(chunk) = stream.next().await {
    let chunk = chunk.map_err(|e| format!("download interrupted: {e}"))?;
    file
      .write_all(&chunk)
      .await
      .map_err(|e| format!("write failed: {e}"))?;
    received += chunk.len() as u64;
    /* One event per MiB — a per-chunk emit floods the webview for a 188 MB asset. */
    if received - last_emit >= 1024 * 1024 {
      last_emit = received;
      emit(&app, UpdateProgress::downloading(received, total));
    }
  }
  file.flush().await.map_err(|e| format!("flush failed: {e}"))?;
  drop(file);
  tokio::fs::rename(&partial, &target)
    .await
    .map_err(|e| format!("could not finalise {target:?}: {e}"))?;
  emit(&app, UpdateProgress::downloading(received, total.max(received)));

  finish_install(&app, target)
}

/// Drop APKs for other versions so the cache does not accumulate ~188 MB per release.
fn prune_stale_apks(app: &AppHandle, keep: &Path) {
  let Ok(dir) = app.path().app_cache_dir() else { return };
  let Ok(entries) = std::fs::read_dir(dir) else { return };
  for entry in entries.flatten() {
    let path = entry.path();
    if path == keep {
      continue;
    }
    let is_apk = path
      .extension()
      .is_some_and(|e| e.eq_ignore_ascii_case("apk") || e.eq_ignore_ascii_case("part"));
    if is_apk {
      let _ = std::fs::remove_file(&path);
    }
  }
}

/// Gate on the install permission, then hand the file to the package installer.
fn finish_install(app: &AppHandle, target: PathBuf) -> Result<String, String> {
  /*
   * Declaring REQUEST_INSTALL_PACKAGES is not enough on Android 8+: without the per-app
   * "install unknown apps" grant the installer activity opens and closes instantly, which
   * looks exactly like the update doing nothing. Report it instead.
   */
  if !can_install().unwrap_or(false) {
    emit(
      app,
      UpdateProgress::simple("needs-permission", Some("Allow installing apps to finish".into())),
    );
    return Ok(target.to_string_lossy().to_string());
  }

  emit(app, UpdateProgress::simple("installing", None));
  launch_installer(&target)?;
  emit(app, UpdateProgress::simple("done", None));
  Ok(target.to_string_lossy().to_string())
}

/// Run `f` with a JNI env attached and MainActivity in hand.
///
/// Shared with `disguise.rs`, which needs the same hop for `setTaskDescription`.
#[cfg(target_os = "android")]
pub(crate) fn with_activity<T>(
  f: impl FnOnce(&mut jni::JNIEnv, &jni::objects::JObject) -> Result<T, String>,
) -> Result<T, String> {
  use jni::objects::JObject;
  let ctx = ndk_context::android_context();
  let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.map_err(|e| format!("no JavaVM: {e}"))?;
  let mut env = vm
    .attach_current_thread()
    .map_err(|e| format!("could not attach JNI thread: {e}"))?;
  let activity = unsafe { JObject::from_raw(ctx.context().cast()) };
  f(&mut env, &activity)
}

#[cfg(target_os = "android")]
fn launch_installer(path: &Path) -> Result<(), String> {
  use jni::objects::JValue;
  let path = path.to_string_lossy().to_string();
  with_activity(|env, activity| {
    let jpath = env
      .new_string(&path)
      .map_err(|e| format!("bad path string: {e}"))?;
    env
      .call_method(
        activity,
        "installApk",
        "(Ljava/lang/String;)V",
        &[JValue::Object(&jpath)],
      )
      .map_err(|e| format!("installApk failed: {e}"))?;
    Ok(())
  })
}

#[cfg(target_os = "android")]
fn can_install() -> Result<bool, String> {
  with_activity(|env, activity| {
    env
      .call_method(activity, "canInstallPackages", "()Z", &[])
      .and_then(|v| v.z())
      .map_err(|e| format!("canInstallPackages failed: {e}"))
  })
}

#[cfg(target_os = "android")]
fn open_install_settings() -> Result<(), String> {
  with_activity(|env, activity| {
    env
      .call_method(activity, "openInstallPermissionSettings", "()V", &[])
      .map(|_| ())
      .map_err(|e| format!("openInstallPermissionSettings failed: {e}"))
  })
}

#[cfg(not(target_os = "android"))]
fn launch_installer(_path: &Path) -> Result<(), String> {
  Err("APK install is Android-only".into())
}

#[cfg(not(target_os = "android"))]
fn can_install() -> Result<bool, String> {
  Ok(false)
}

#[cfg(not(target_os = "android"))]
fn open_install_settings() -> Result<(), String> {
  Err("APK install is Android-only".into())
}

/// True when the OS will let us hand over an APK without bouncing the user.
#[tauri::command]
pub fn can_install_apk() -> Result<bool, String> {
  can_install()
}

/// Deep-link to this app's "install unknown apps" toggle.
#[tauri::command]
pub fn open_install_permission_settings() -> Result<(), String> {
  open_install_settings()
}

#[cfg(test)]
mod tests {
  use super::is_trusted_apk_url;

  #[test]
  fn accepts_only_this_repo_release_apks() {
    assert!(is_trusted_apk_url(
      "https://github.com/dixonSolutions/potatoetomatoe3/releases/download/release-75/potato-tomato-0.0.75.apk"
    ));
    /* Right repo, wrong type — this URL ends up as ACTION_VIEW on a package archive. */
    assert!(!is_trusted_apk_url(
      "https://github.com/dixonSolutions/potatoetomatoe3/releases/download/release-75/notes.txt"
    ));
    assert!(!is_trusted_apk_url("https://evil.example/potato-tomato.apk"));
    assert!(!is_trusted_apk_url(
      "http://github.com/dixonSolutions/potatoetomatoe3/x.apk"
    ));
  }
}
