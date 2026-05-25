#!/usr/bin/env bash

echo "🔧 Installing Tauri development dependencies in distrobox..."
echo ""

# Install all required packages
sudo dnf install -y \
    gcc \
    gcc-c++ \
    make \
    cmake \
    pkg-config \
    openssl-devel \
    webkit2gtk4.1-devel \
    libappindicator-gtk3-devel \
    librsvg2-devel \
    patchelf \
    glib2-devel \
    gtk3-devel \
    cairo-devel \
    pango-devel \
    atk-devel \
    gdk-pixbuf2-devel

echo ""
echo "✅ All dependencies installed!"
echo ""
echo "Now you can run: pnpm tauri:dev"
