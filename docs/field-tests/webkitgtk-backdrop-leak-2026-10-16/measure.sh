#!/bin/bash
# measure.sh <label> — load $URL in a bare WebKitGTK 4.1 view (webview.py) inside the
# installed Flatpak's sandbox, so it is the GNOME runtime's WebKit, and print how fast the
# web process grows. Optional env: CSS (user style sheet), JS0 (document-start script),
# JS (run 500 ms after load).
#
# Needs a Wayland display named pt-test, e.g. a headless compositor:
#   mutter --headless --wayland --no-x11 --virtual-monitor 1920x1080 --wayland-display=pt-test
# A leaking page grows ~0.5 GB/s and Flatpak moves the app out of any cgroup you start it
# in, so run a watchdog that kills WebKitWebProcess past a few GB while measuring.
dir=$(cd "$(dirname "$0")" && pwd)
URL=${URL:-https://dixonsolutions.github.io/potatoetomatoe3/home}
env -u DISPLAY WAYLAND_DISPLAY=pt-test GDK_BACKEND=wayland URL="$URL" CSS="$CSS" JS="$JS" JS0="$JS0" LIFE=16 \
	flatpak run --user --filesystem="$dir" --command=python3 com.potatotomato.games "$dir/webview.py" \
	>"$dir/webview.log" 2>&1 &
sleep 9
p=$(pgrep -x WebKitWebProces | head -1)
[ -z "$p" ] && {
	echo "$1: no web process"
	tail -3 "$dir/webview.log"
	exit 1
}
a=$(awk '/VmRSS/{print int($2/1024)}' "/proc/$p/status")
sleep 3
b=$(awk '/VmRSS/{print int($2/1024)}' "/proc/$p/status" 2>/dev/null || echo "$a")
printf '%-45s %5s -> %5s MB in 3s (%s MB/s)\n' "$1" "$a" "$b" "$(((b - a) / 3))"
sleep 5
