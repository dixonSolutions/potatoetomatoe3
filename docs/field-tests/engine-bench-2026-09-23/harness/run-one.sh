#!/usr/bin/env bash
# One bench run in the private compositor (see compositor.sh).
#
#   run-one.sh <tauri|wk|chrome> <label> [--q "<bench query>"] [ENV=VAL ...] [-- engine args...]
#
#   tauri   the dev app binary built with the perf-bench config ($BENCH_DIR/potato-tomato-perfbench)
#   wk      a bare WebKitGTK window (wk.py) with the same settings wry applies
#   chrome  Chromium in an --app window with a fresh profile ($CHROME, default: Playwright's)
#
# The label and query reach the page through the collector (POST /tag), so the Tauri binary
# never needs rebuilding for a new variant. Waits for the collector to save a report, then
# kills the whole process group.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
BENCH_DIR=${BENCH_DIR:-${XDG_RUNTIME_DIR:-/tmp}/pt-engine-bench}
RESULTS=${RESULTS:-$BENCH_DIR/results}
COLLECTOR=${COLLECTOR:-http://127.0.0.1:18800}
VITE=${VITE:-http://127.0.0.1:5180}
CHROME=${CHROME:-$HOME/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome}
TIMEOUT=${TIMEOUT:-1500}
kind=$1; label=$2; shift 2
query=""
envs=()
while [ $# -gt 0 ]; do
  case "$1" in
    --q) query="$2"; shift 2 ;;
    --) shift; break ;;
    *=*) envs+=("$1"); shift ;;
    *) break ;;
  esac
done
extra=("$@")
mkdir -p "$BENCH_DIR/logs" "$RESULTS"

printf "%s\n%s" "$label" "$query" | curl -s -X POST --data-binary @- "$COLLECTOR/tag" >/dev/null
marker=$(mktemp "$BENCH_DIR/logs/start-marker.XXXXXX")
log=$BENCH_DIR/logs/$kind-$label-$(date +%s).log
export DBUS_SESSION_BUS_ADDRESS="$(cat "$BENCH_DIR/compositor.bus")"
export WAYLAND_DISPLAY=${PTBENCH_DISPLAY:-ptbench-bench} GDK_BACKEND=wayland XDG_SESSION_TYPE=wayland
unset DISPLAY
shield() {
  gdbus call --session --dest org.gnome.Shell.ScreenShield --object-path /org/gnome/ScreenSaver \
    --method org.gnome.ScreenSaver.GetActive 2>&1 | tr -d '(),\n'
}
echo "[run] $kind/$label start $(date +%T) load=$(cut -d' ' -f1-3 /proc/loadavg) shield=$(shield) env=${envs[*]:-} args=${extra[*]:-} query=$query"

URL="$VITE/dev/perf-bench?variant=collector&auto=1&collector=$COLLECTOR"
prof=""
case "$kind" in
  tauri)
    # Its own identifier (com.potatotomato.games.perfbench): wiping it is a cold start.
    rm -rf "$HOME/.local/share/com.potatotomato.games.perfbench" "$HOME/.cache/com.potatotomato.games.perfbench"
    env "${envs[@]}" POTATO_TOMATO_NO_TRAY=1 POTATO_TOMATO_NO_CLOSE_TO_TRAY=1 \
      setsid "$BENCH_DIR/potato-tomato-perfbench" "${extra[@]}" > "$log" 2>&1 &
    ;;
  wk)
    env "${envs[@]}" setsid /usr/bin/python3 "$HERE/wk.py" "${extra[@]}" "$URL&engine=webkitgtk-bare" > "$log" 2>&1 &
    ;;
  chrome)
    prof=$(mktemp -d "$BENCH_DIR/chrome-profile.XXXXXX")
    env "${envs[@]}" setsid "$CHROME" --user-data-dir="$prof" --no-first-run --no-default-browser-check \
      --password-store=basic --ozone-platform=wayland --window-size=1440,900 "${extra[@]}" \
      --app="$URL&engine=chromium" > "$log" 2>&1 &
    ;;
esac
pid=$!
sleep 1
pgid=$(ps -o pgid= -p $pid | tr -d ' ')
for i in $(seq 1 "$TIMEOUT"); do
  [ -n "$(find "$RESULTS" -maxdepth 1 -name '*.json' -newer "$marker" -print -quit)" ] && break
  if ! kill -0 $pid 2>/dev/null; then echo "[run] $kind/$label exited early"; break; fi
  sleep 1
done
newest=$(find "$RESULTS" -maxdepth 1 -name '*.json' -newer "$marker" -print -quit)
rm -f "$marker"
echo "[run] $kind/$label end $(date +%T) after ${i}s load=$(cut -d' ' -f1-3 /proc/loadavg) shield=$(shield) -> $(basename "${newest:-none}")"
sleep 1
[ -n "$pgid" ] && kill -- -"$pgid" 2>/dev/null
sleep 2
[ -n "$pgid" ] && kill -9 -- -"$pgid" 2>/dev/null
[ -n "$prof" ] && rm -rf "$prof"
true
