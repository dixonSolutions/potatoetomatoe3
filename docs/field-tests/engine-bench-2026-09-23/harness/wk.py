#!/usr/bin/python3
"""Bare WebKitGTK (webkit2gtk-4.1, GTK3) window for the engine bench.

Mirrors what wry sets on Tauri's webview (webgl, webaudio, page cache, developer extras),
then applies the variant under test:

  --policy always|never|ondemand     WebKitSettings:hardware-acceleration-policy
  --setting name=value               any WebKitSettings property (bool/int/str)
  --feature Identifier=true|false    WebKitFeature toggles (2.42+)
  --dpr-cap X                        user script in sub-frames: devicePixelRatio = min(X, real)
  --zoom Z                           webkit_web_view_set_zoom_level
  --dump-gpu FILE                    load webkit://gpu, write its text to FILE, quit
  --size WxH                         window size (default 1440x900)
"""
import argparse
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("url", nargs="?")
ap.add_argument("--policy")
ap.add_argument("--setting", action="append", default=[])
ap.add_argument("--feature", action="append", default=[])
ap.add_argument("--dpr-cap", type=float)
ap.add_argument("--zoom", type=float)
ap.add_argument("--dump-gpu")
ap.add_argument("--size", default="1440x900")
ap.add_argument("--click-at", help="X,Y in view coordinates: a real (GDK) click there")
ap.add_argument("--click-after", type=float, default=6.0)
ap.add_argument("--key", help="GDK key name (F24, Shift_L…): a synthetic GDK key press+release")
ap.add_argument("--key-after", type=float, default=6.0)
ap.add_argument(
    "--key-via",
    default="view",
    choices=("view", "main"),
    help="view: gtk_widget_event on the WebKitWebView; main: gtk_main_do_event (window path)",
)
a = ap.parse_args()

ctx = WebKit2.WebContext.new_ephemeral()
view = WebKit2.WebView.new_with_context(ctx)
s = view.get_settings()
s.set_enable_webgl(True)
s.set_enable_webaudio(True)
s.set_enable_page_cache(True)
s.set_enable_developer_extras(True)
if a.policy:
    s.set_hardware_acceleration_policy(
        {
            "always": WebKit2.HardwareAccelerationPolicy.ALWAYS,
            "never": WebKit2.HardwareAccelerationPolicy.NEVER,
            "ondemand": WebKit2.HardwareAccelerationPolicy.ON_DEMAND,
        }[a.policy]
    )
for kv in a.setting:
    k, v = kv.split("=", 1)
    cur = s.get_property(k)
    if isinstance(cur, bool):
        v = v.lower() in ("1", "true", "yes")
    elif isinstance(cur, int):
        v = int(v)
    s.set_property(k, v)
if a.feature:
    feats = WebKit2.Settings.get_all_features()
    byid = {feats.get(i).get_identifier(): feats.get(i) for i in range(feats.get_length())}
    for kv in a.feature:
        k, v = kv.split("=", 1)
        s.set_feature_enabled(byid[k], v.lower() in ("1", "true", "yes"))
if a.dpr_cap:
    js = (
        "(function(){if(window===top)return;var real=window.devicePixelRatio;"
        "var cap=Math.min(%s,real);Object.defineProperty(window,'devicePixelRatio',"
        "{get:function(){return cap;},configurable:true});})();" % a.dpr_cap
    )
    view.get_user_content_manager().add_script(
        WebKit2.UserScript.new(
            js,
            WebKit2.UserContentInjectedFrames.ALL_FRAMES,
            WebKit2.UserScriptInjectionTime.START,
            None,
            None,
        )
    )
if a.zoom:
    view.set_zoom_level(a.zoom)

print(
    "wk: policy=%s webgl=%s canvas-accel=%s"
    % (
        s.get_hardware_acceleration_policy().value_nick,
        s.get_enable_webgl(),
        s.get_property("enable-2d-canvas-acceleration"),
    ),
    flush=True,
)

w = Gtk.Window()
wd, ht = (int(x) for x in a.size.split("x"))
w.set_default_size(wd, ht)
w.set_title("wk-bench")
w.add(view)
w.connect("destroy", Gtk.main_quit)
w.show_all()

if a.dump_gpu:

    def on_load(v, ev):
        if ev != WebKit2.LoadEvent.FINISHED:
            return

        def done(v2, res):
            try:
                val = v2.evaluate_javascript_finish(res)
                text = val.to_string()
            except Exception as e:  # noqa: BLE001
                text = "ERR %s" % e
            with open(a.dump_gpu, "w") as f:
                f.write(text)
            Gtk.main_quit()

        GLib.timeout_add(
            1500,
            lambda: v.evaluate_javascript("document.body.innerText", -1, None, None, None, done)
            and False,
        )

    view.connect("load-changed", on_load)
    view.load_uri("webkit://gpu")
else:
    view.load_uri(a.url)

if a.click_at:
    gi.require_version("Gdk", "3.0")
    from gi.repository import Gdk  # noqa: E402

    cx, cy = (float(v) for v in a.click_at.split(","))

    def click():
        win = view.get_window()
        ptr = Gdk.Display.get_default().get_default_seat().get_pointer()
        for etype in (
            Gdk.EventType.MOTION_NOTIFY,
            Gdk.EventType.BUTTON_PRESS,
            Gdk.EventType.BUTTON_RELEASE,
        ):
            ev = Gdk.Event.new(etype)
            body = ev.motion if etype == Gdk.EventType.MOTION_NOTIFY else ev.button
            body.window = win
            body.send_event = 0
            body.time = Gtk.get_current_event_time() or 1
            body.x = cx
            body.y = cy
            if etype != Gdk.EventType.MOTION_NOTIFY:
                body.button = 1
            ev.set_device(ptr)
            view.event(ev)
        print("wk: clicked at %s,%s" % (cx, cy), flush=True)
        return False

    GLib.timeout_add(int(a.click_after * 1000), click)

if a.key:
    gi.require_version("Gdk", "3.0")
    from gi.repository import Gdk  # noqa: E402

    def key():
        keyval = Gdk.keyval_from_name(a.key)
        keymap = Gdk.Keymap.get_for_display(Gdk.Display.get_default())
        ok, entries = keymap.get_entries_for_keyval(keyval)
        hw = entries[0].keycode if ok and entries else 0
        kbd = Gdk.Display.get_default().get_default_seat().get_keyboard()
        for etype in (Gdk.EventType.KEY_PRESS, Gdk.EventType.KEY_RELEASE):
            ev = Gdk.Event.new(etype)
            ev.key.window = view.get_window()
            ev.key.send_event = 0
            ev.key.time = Gtk.get_current_event_time() or 1
            ev.key.state = 0
            ev.key.keyval = keyval
            ev.key.hardware_keycode = hw
            ev.key.group = 0
            ev.key.is_modifier = 1 if a.key.startswith(("Shift", "Control", "Alt", "Super")) else 0
            ev.set_device(kbd)
            if a.key_via == "view":
                view.event(ev)
            else:
                Gtk.main_do_event(ev)
        print("wk: key %s (keyval %#x, hw %d) via %s" % (a.key, keyval, hw, a.key_via), flush=True)
        return False

    GLib.timeout_add(int(a.key_after * 1000), key)
Gtk.main()
sys.exit(0)
