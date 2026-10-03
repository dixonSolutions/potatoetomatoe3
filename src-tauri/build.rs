fn main() {
  full_speed_module::build();
  tauri_build::build()
}

/// The GIO module behind "Full frame rate in power saver" (`gio/full-speed-power-monitor.c`,
/// loaded by WebKit's web process; see `src/power_profile.rs`).
///
/// Built here, against the same GLib the app builds against, and embedded in the binary,
/// so no package format has to ship or locate a second file: the app writes it to its cache
/// directory at startup. Linux targets only. A build that cannot compile it (no C compiler,
/// no gio-2.0 development files, a cross toolchain without a sysroot) embeds an empty file
/// and warns; the app then runs without it, exactly as before the module existed.
mod full_speed_module {
  use std::path::{Path, PathBuf};
  use std::process::Command;

  const SOURCE: &str = "gio/full-speed-power-monitor.c";
  /// GIO only loads modules named `lib*.so` from a `GIO_EXTRA_MODULES` directory.
  const FILE_NAME: &str = "libpotato-full-speed.so";

  pub fn build() {
    println!("cargo:rerun-if-changed={SOURCE}");
    println!("cargo:rerun-if-env-changed=POTATO_TOMATO_SKIP_FULL_SPEED_MODULE");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("linux") {
      return;
    }
    let out = PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR")).join(FILE_NAME);
    let result = if std::env::var_os("POTATO_TOMATO_SKIP_FULL_SPEED_MODULE").is_some() {
      Err("POTATO_TOMATO_SKIP_FULL_SPEED_MODULE is set".to_string())
    } else {
      compile(&out)
    };
    if let Err(why) = result {
      println!(
        "cargo:warning=full-speed GIO module not built ({why}); the app will keep WebKit's \
         30 fps power-saver behaviour"
      );
      std::fs::write(&out, []).expect("write empty module placeholder");
    }
  }

  fn compile(out: &Path) -> Result<(), String> {
    let gio = pkg_config::Config::new()
      .cargo_metadata(false)
      .env_metadata(true)
      .probe("gio-2.0")
      .map_err(|e| format!("pkg-config gio-2.0: {e}"))?;
    let compiler = cc::Build::new()
      .pic(true)
      .opt_level(2)
      .debug(false)
      .cargo_metadata(false)
      .try_get_compiler()
      .map_err(|e| format!("no C compiler: {e}"))?;
    let mut cmd: Command = compiler.to_command();
    cmd.args(["-shared", "-fPIC", "-O2", "-Wall", "-s"]);
    cmd.arg(format!("-Wl,-soname,{FILE_NAME}"));
    cmd.arg("-o").arg(out).arg(SOURCE);
    for dir in &gio.include_paths {
      cmd.arg("-I").arg(dir);
    }
    for (name, value) in &gio.defines {
      match value {
        Some(value) => cmd.arg(format!("-D{name}={value}")),
        None => cmd.arg(format!("-D{name}")),
      };
    }
    for dir in &gio.link_paths {
      cmd.arg("-L").arg(dir);
    }
    for lib in &gio.libs {
      cmd.arg(format!("-l{lib}"));
    }
    let output = cmd
      .output()
      .map_err(|e| format!("could not run {:?}: {e}", compiler.path()))?;
    if !output.status.success() {
      return Err(format!(
        "{:?} failed: {}",
        compiler.path(),
        String::from_utf8_lossy(&output.stderr).trim()
      ));
    }
    Ok(())
  }
}
