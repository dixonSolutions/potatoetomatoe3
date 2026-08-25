import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

/**
 * Release signing. Without this the release variant produces
 * `app-universal-release-unsigned.apk`, which Android refuses to install
 * (INSTALL_PARSE_FAILED_NO_CERTIFICATES) — the published APK never launched.
 *
 * `key.properties` is gitignored; CI writes it from repository secrets.
 * See docs/release.md for generating the keystore.
 */
val keystoreProperties = Properties().apply {
    val propFile = rootProject.file("key.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}
val hasReleaseKeystore = keystoreProperties.getProperty("storeFile") != null

android {
    compileSdk = 36
    namespace = "com.potatotomato.games"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.potatotomato.games"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                /*
                 * Local/unconfigured builds stay installable for testing. CI must not ship
                 * a debug-signed APK — release-android.yml fails if the release keystore
                 * secrets are missing.
                 */
                logger.warn("key.properties not found — signing release with the debug key (NOT publishable)")
                signingConfigs.getByName("debug")
            }
            /*
             * R8 is off: the app is ~600 MB of game assets, so shrinking a few hundred KB of
             * Kotlin buys nothing, while `proguardFiles(fileTree(...))` is resolved at
             * configuration time — before tauri-build writes `proguard-tauri.pro` — so a
             * clean checkout would strip Tauri's JNI/reflection entry points and crash on
             * launch. Re-enable only with explicit keep rules committed to proguard-rules.pro.
             */
            isMinifyEnabled = false
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")