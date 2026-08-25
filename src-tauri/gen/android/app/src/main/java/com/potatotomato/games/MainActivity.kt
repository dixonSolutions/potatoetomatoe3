package com.potatotomato.games

import android.os.Bundle
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
