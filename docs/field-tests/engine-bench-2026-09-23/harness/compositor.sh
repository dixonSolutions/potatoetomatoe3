#!/usr/bin/env bash
# Private headless GNOME Shell for the engine bench (GPU-composited, nothing can cover it).
#
#   BENCH_DIR=<dir> PTBENCH_MONITOR=1920x1080@60 compositor.sh      (runs in the foreground)
#
# Two things made an earlier shell stop sending frame callbacks, which throttles Chromium to
# 0 fps (WebKitGTK paces rAF on its own timer and keeps going):
#   - the shell shared the user's settings and activated its screen shield when the real
#     desktop went idle, and
#   - with no XDG_SESSION_ID it asks logind for the user's display session and follows its
#     lock state, so it shielded again the moment the real desktop locked.
# Hence its own XDG_CONFIG_HOME (screensaver off, same fractional-scaling mode as the real
# desktop) and a session id logind does not know.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
BENCH_DIR=${BENCH_DIR:-${XDG_RUNTIME_DIR:-/tmp}/pt-engine-bench}
mkdir -p "$BENCH_DIR/xdg-config"
if [ "${1:-}" != "--inner" ]; then
  export XDG_CONFIG_HOME="$BENCH_DIR/xdg-config" BENCH_DIR
  exec dbus-run-session -- "$HERE/compositor.sh" --inner
fi
echo "$DBUS_SESSION_BUS_ADDRESS" > "$BENCH_DIR/compositor.bus"
unset DISPLAY
export XDG_SESSION_ID=ptbench-none
gsettings set org.gnome.desktop.screensaver idle-activation-enabled false
gsettings set org.gnome.desktop.screensaver lock-enabled false
gsettings set org.gnome.desktop.session idle-delay 0
gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
gsettings set org.gnome.mutter experimental-features "['scale-monitor-framebuffer', 'xwayland-native-scaling']"
exec gnome-shell --headless --wayland --no-x11 --mode=user \
  --virtual-monitor "${PTBENCH_MONITOR:-1920x1080@60}" --wayland-display="${PTBENCH_DISPLAY:-ptbench-bench}"
