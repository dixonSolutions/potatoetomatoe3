# WebKitGTK leaks ~0.5 GB/s under `backdrop-filter` in scrolling rows — 2026-10-16

Issue #59: on the user's Surface (Fedora 43, Flatpak commit `a07f8f2c…`, release 0.0.90)
WebKitWebProcess reached 10 GB about 2.5 minutes after launch and was OOM-killed; on the
next launch the desktop froze within a minute and the machine had to be restarted.

## Answer first

- **The trigger is CSS, not the app's scripts.** Home has two horizontally scrolling
  carousels whose cards each carry a favourite button with `backdrop-blur-sm`. WebKitGTK's
  DMA-BUF renderer leaks without end on that: the web process's `ThreadedCompositor`
  thread runs at 100 % CPU and resident memory grows **~400–500 MB/s** on this machine
  (24 cores; the Surface managed ~70 MB/s), until the OOM killer stops it. The page's main
  thread is idle the whole time.
- **It is a WebKitGTK bug.** The published web build leaks the same way in a bare
  `WebKit2.WebView` (`webview.py`) with nothing of Tauri, and a static page with two
  scrolling rows of blurred buttons (`repro-two-scrollers.html`) reproduces it on its own.
  One such row (`control-one-scroller.html`) does not.
- **Fix: never give WebKitGTK a backdrop filter.** `app.html` marks `<html>` with
  `data-no-backdrop-filter` before the first paint on WebKitGTK/WPE, and `app.css` turns
  every backdrop filter off under it. It must be off from the first frame: removing the
  filter after the leak has started does not stop it.
- **And stop reloading into it.** The crash handler reloaded Home after each OOM kill.
  Its cap (three reloads a minute) never trips on a crash every 2.5 minutes, so the app
  re-entered the leak indefinitely. The same page is now reloaded at most once in ten
  minutes.

## Setup

Headless GNOME compositor (`mutter --headless --wayland --virtual-monitor 1920x1080`), so
nothing reaches the user's screen. The installed Flatpak from the release bundle (same
commit as the issue), GNOME 50 runtime of 2026-10-03. A watchdog killed any
WebKitWebProcess past 4 GB: the first unguarded run took the web process to 52 GB in
under two minutes before the kernel OOM-killed it (`flatpak run` leaves any cgroup it is
started in, so `systemd-run -p MemoryMax=` does not contain it).

## Measurements (WebKitWebProcess RSS growth)

| Run                                                                       | Growth              |
| ------------------------------------------------------------------------- | ------------------- |
| Release 0.0.90, `/home`, idle                                             | 464 MB/s            |
| Release 0.0.89, `/home`, idle                                             | 387 MB/s            |
| 0.0.90 with the power-saver GIO module off (`POTATO_TOMATO_FULL_SPEED=0`) | still leaks         |
| 0.0.90, `WEBKIT_DISABLE_DMABUF_RENDERER=1`                                | 0                   |
| 0.0.90, `WEBKIT_DISABLE_COMPOSITING_MODE=1`                               | 0                   |
| 0.0.90, `WEBKIT_SKIA_ENABLE_CPU_RENDERING=1`                              | 463 MB/s            |
| 0.0.90, `LIBGL_ALWAYS_SOFTWARE=1`                                         | 267 MB/s            |
| Bare view, static "hello" page                                            | 0                   |
| Bare view, published `/home`                                              | ~400 MB/s           |
| Bare view, `/home`, user CSS: no `backdrop-filter` (from the start)       | 0                   |
| Bare view, `/home`, user CSS: no `filter`, or no `box-shadow`             | leaks               |
| Bare view, `/home`, blur off on `button` only (nav keeps its blur)        | 0                   |
| Bare view, `/home`, blur off on `nav` only (buttons keep it)              | leaks               |
| Bare view, `/home`, carousels made non-scrolling (`overflow: visible`)    | 0                   |
| Bare view, `/home`, no images / no scroll-snap / no transitions           | leaks               |
| `repro-two-scrollers.html`                                                | ~420 MB/s           |
| `control-one-scroller.html`                                               | 0                   |
| Fixed build, `/home` and `/games`                                         | 0 (flat for 90 s)   |
| Fixed build, attribute blocked by a document-start script (control)       | past 3.5 GB in 12 s |

In the app, `document.body.style.display = 'none'` and removing the blur live did not stop
a leak already under way, and the inspector could not pause the page: no script was
running. Per-thread CPU (`/proc/<pid>/task/*/stat`) put all of it on `ThreadedCompositor`.

## Not the cause

The power-saver GIO module (leaks with it off, and its crash guard turned it off after
these OOM kills — switch it back on in Settings), the in-frame storage bridge (no game was
open), and the app's Rust side (no timers or scripts that repeat).

## Reproduce

```bash
mutter --headless --wayland --no-x11 --virtual-monitor 1920x1080 --wayland-display=pt-test &
URL=file://$PWD/repro-two-scrollers.html ./measure.sh two-scrollers
URL=file://$PWD/control-one-scroller.html ./measure.sh one-scroller
```

Run a memory watchdog alongside: the leaking page needs a few seconds per gigabyte.
