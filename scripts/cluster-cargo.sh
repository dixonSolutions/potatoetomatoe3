#!/usr/bin/env bash
# Run cargo for src-tauri inside a container that has the Tauri/WebKitGTK build deps, for
# build hosts without them (the Debian cluster worker). The image (Debian's own rustc and
# cargo plus the system libraries) is built once and reused; ~/.cargo is mounted in so the
# crate registry cache is shared with the host.
#
#   scripts/cluster-cargo.sh test offline_
#   scripts/cluster-cargo.sh build --release
#
# Target dir: $PT3_CARGO_TARGET (default ~/cluster-work/cache/pt3-target).
set -euo pipefail

IMAGE=localhost/pt3-tauri-deps:2
ROOT=$(cd "$(dirname "$0")/.." && pwd)
TARGET=${PT3_CARGO_TARGET:-$HOME/cluster-work/cache/pt3-target}
mkdir -p "$TARGET"

if ! podman image exists "$IMAGE"; then
	podman build -t "$IMAGE" -f - "$ROOT/scripts" <<'EOF'
FROM docker.io/library/debian:forky
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      build-essential pkg-config curl ca-certificates file libssl-dev cargo rustc \
      libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
      libsoup-3.0-dev libjavascriptcoregtk-4.1-dev libxdo-dev \
    && rm -rf /var/lib/apt/lists/*
EOF
fi

exec podman run --rm --userns=keep-id \
	-v "$ROOT:/work" -v "$TARGET:/target" \
	-v "$HOME/.cargo:/cargo-home" -e CARGO_HOME=/cargo-home -e CARGO_TARGET_DIR=/target \
	-w /work/src-tauri "$IMAGE" cargo "$@"
