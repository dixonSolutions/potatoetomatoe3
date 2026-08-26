package com.potatotomato.games

import android.app.ActivityManager
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.util.Base64
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

  /**
   * Mirror the privacy disguise onto the task's identity in the recents switcher.
   *
   * The label and icon on the recents card come from `ActivityManager.TaskDescription`,
   * not from the manifest, so both can be swapped at runtime with no relaunch, no
   * `<activity-alias>` and no `setComponentEnabledSetting`. That matters: the recents card
   * is the one place an Android user is shown this app's identity without opening it, and
   * it was still reading "Potato Tomato" while the WebView's own title claimed Google Docs.
   *
   * The launcher icon is deliberately left alone — swapping it needs the alias route,
   * which kills the running task and breaks home-screen shortcuts.
   *
   * Called over JNI from `disguise.rs`. The icon arrives as a base64 PNG the WebView
   * rasterised from the same asset file the tab favicon uses, so there is no second set of
   * disguise icons to keep in step.
   */
  @Suppress("DEPRECATION")
  fun setTaskDisguise(label: String, iconPngBase64: String) {
    val bitmap = try {
      val bytes = Base64.decode(iconPngBase64, Base64.DEFAULT)
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    } catch (e: Exception) {
      null
    }
    runOnUiThread {
      try {
        setTaskDescription(
          if (bitmap != null) {
            ActivityManager.TaskDescription(label, bitmap)
          } else {
            /* Label alone is the half that matters; an icon-less card is still not "Potato Tomato". */
            ActivityManager.TaskDescription(label)
          }
        )
      } catch (e: Exception) {
        /* OEM skins reject unusual bitmap sizes here; a failed disguise must not crash the app. */
      }
    }
  }

  /**
   * Hand the recents card back its manifest identity.
   *
   * Label and icon come from the package manager rather than from the caller: the
   * WebView's idea of the app's name ("Potato Tomato Games") is not the manifest's
   * ("Potato Tomato"), and echoing that back would quietly relabel the recents card.
   */
  @Suppress("DEPRECATION")
  fun clearTaskDisguise() {
    val label = try {
      packageManager.getApplicationLabel(applicationInfo).toString()
    } catch (e: Exception) {
      return
    }
    runOnUiThread {
      try {
        /* The res-id constructor avoids rasterising an adaptive launcher icon by hand. */
        setTaskDescription(ActivityManager.TaskDescription(label, applicationInfo.icon))
      } catch (e: Exception) {
        /* Nothing to restore beyond what the manifest already declares. */
      }
    }
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
