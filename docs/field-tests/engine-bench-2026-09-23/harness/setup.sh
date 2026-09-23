#!/usr/bin/env bash
# Build what the matrices need: the two shims and the Tauri dev binary with the bench config.
# Start the compositor (compositor.sh), Vite on :5180 and the collector on :18800 first:
#
#   PUBLIC_OFFLINE_DEPLOYMENT=local-app npx vite dev --port 5180 --host 127.0.0.1
#   PERF_BENCH_PORT=18800 node scripts/perf-bench-collector.mjs "$BENCH_DIR/results"
#
# Then: matrix.sh matrices/main.txt 3 "delay=8000&sample=10000&settle=4000&taps=40"
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../../.." && pwd)
BENCH_DIR=${BENCH_DIR:-${XDG_RUNTIME_DIR:-/tmp}/pt-engine-bench}
mkdir -p "$BENCH_DIR/shim" "$BENCH_DIR/giomodule" "$BENCH_DIR/logs" "$BENCH_DIR/results"

# LD_PRELOAD shim: GIO says "power saver off" (bench only).
gcc -shared -fPIC -O2 -o "$BENCH_DIR/shim/no-power-saver.so" "$HERE/shim/no-power-saver.c"
# The shippable form of the same thing: a GIO module, picked with
# GIO_EXTRA_MODULES=$BENCH_DIR/giomodule GIO_USE_POWER_PROFILE_MONITOR=full-speed.
gcc -shared -fPIC -O2 -Wall $(pkg-config --cflags gio-2.0) \
  -o "$BENCH_DIR/giomodule/libpt-fullspeed.so" "$HERE/shim/full-speed-power-monitor.c" \
  $(pkg-config --libs gio-2.0)

# Tauri dev binary whose dev URL is the bench page, pointed at the :18800 collector.
cat > "$BENCH_DIR/tauri.local.json" <<'EOF'
{
	"identifier": "com.potatotomato.games.perfbench",
	"build": {
		"devUrl": "http://127.0.0.1:5180/dev/perf-bench?engine=tauri-webkitgtk&variant=collector&auto=1&collector=http://127.0.0.1:18800",
		"beforeDevCommand": ""
	},
	"app": { "windows": [{ "title": "Perf Bench (dev)", "width": 1440, "height": 900 }] }
}
EOF
(cd "$REPO/src-tauri" && TAURI_CONFIG="$(cat "$BENCH_DIR/tauri.local.json")" cargo build)
cp "$REPO/src-tauri/target/debug/potato-tomato" "$BENCH_DIR/potato-tomato-perfbench"
echo "ready: $BENCH_DIR"
