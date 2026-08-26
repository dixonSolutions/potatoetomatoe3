package com.potatotomato.games

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    /*
     * Opt-in WebView inspection for release builds.
     *
     *   adb shell am start -n com.potatotomato.games/.MainActivity --ez webviewDebug true
     *   adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
     *
     * Field problems on Android — games not launching, the shell freezing — were
     * impossible to diagnose from screenshots alone, and a debug build measures the
     * wrong thing because its Rust half is unoptimised. This turns devtools on for the
     * real release binary, and only for a launch that came over ADB with the flag: an
     * ordinary tap on the launcher icon never sets it.
     */
    if (BuildConfig.DEBUG || intent?.getBooleanExtra("webviewDebug", false) == true) {
      WebView.setWebContentsDebuggingEnabled(true)
    }
    super.onCreate(savedInstanceState)
  }

  /**
   * Install the touch-console bridge into every frame, including cross-origin game frames.
   *
   * The app's own JavaScript cannot reach a `games.crazygames.com` document — that is
   * Blink's same-origin policy, identical in Chrome, Safari and any embedded Chromium, and
   * it is why the console reported "blocked" for third-party games. On the web the only
   * way round it is to re-serve the game from our origin through the puller relay.
   *
   * A native embedder is outside that sandbox. `addDocumentStartJavaScript` runs the
   * script at document start in every frame whose origin matches the allowed rules, so on
   * Android the console needs no relay, no sidecar and no proxy hop.
   *
   * `"*"` matches every origin because game frames are third-party by definition and the
   * catalog spans thousands of hosts. The script only listens for our own postMessage type
   * and is inert otherwise.
   */
  /**
   * Hand a downloaded release APK to the system package installer.
   *
   * Called over JNI from `apk_update.rs` once the download finishes. A `file://` URI would
   * throw FileUriExposedException on Android 7+, so the APK is shared through the
   * FileProvider declared in AndroidManifest.xml; `file_paths.xml` exposes `cache-path`,
   * which is where the downloader writes.
   *
   * This only *launches* the installer. Android shows its own confirm dialog and requires
   * the user to have granted this app "install unknown apps"; neither can be bypassed
   * without device-owner privileges.
   */
  /**
   * Whether the user has granted this app "install unknown apps".
   *
   * Holding REQUEST_INSTALL_PACKAGES in the manifest is necessary but not sufficient:
   * Android 8+ also needs a per-app grant. Without it the installer activity opens and
   * closes again immediately, which reads as "the update silently did nothing".
   */
  fun canInstallPackages(): Boolean = packageManager.canRequestPackageInstalls()

  /** Send the user straight to this app's "install unknown apps" toggle. */
  fun openInstallPermissionSettings() {
    val intent = Intent(
      Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
      Uri.parse("package:$packageName")
    ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
    startActivity(intent)
  }

  fun installApk(path: String) {
    val file = java.io.File(path)
    if (!file.exists()) return
    val uri = androidx.core.content.FileProvider.getUriForFile(
      this,
      "$packageName.fileprovider",
      file
    )
    val intent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, "application/vnd.android.package-archive")
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    startActivity(intent)
  }

  override fun onWebViewCreate(webView: WebView) {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
      /* Needs Android WebView 89+; older devices fall back to same-origin-only console. */
      return
    }
    val script = try {
      resources.openRawResource(R.raw.native_touch_bridge).bufferedReader().use { it.readText() }
    } catch (e: Exception) {
      return
    }
    try {
      WebViewCompat.addDocumentStartJavaScript(webView, script, setOf("*"))
    } catch (e: RuntimeException) {
      /* Rejected origin rule or unsupported provider — console degrades, app still runs. */
    }
  }
}
