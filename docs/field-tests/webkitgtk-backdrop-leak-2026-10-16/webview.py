import gi, sys, os
gi.require_version('Gtk', '3.0'); gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, WebKit2, GLib
w = Gtk.Window(); w.set_default_size(1280, 720)
ucm = WebKit2.UserContentManager()
css = os.environ.get('CSS')
if css:
    ucm.add_style_sheet(WebKit2.UserStyleSheet(css, WebKit2.UserContentInjectedFrames.ALL_FRAMES, WebKit2.UserStyleLevel.USER, None, None))
js0 = os.environ.get('JS0')
if js0:
    ucm.add_script(WebKit2.UserScript(js0, WebKit2.UserContentInjectedFrames.ALL_FRAMES, WebKit2.UserScriptInjectionTime.START, None, None))
v = WebKit2.WebView(user_content_manager=ucm); w.add(v)
js = os.environ.get('JS')
def later():
    if js: v.evaluate_javascript(js, -1, None, None, None, None, None)
    return False
def on_load(view, ev):
    if ev == WebKit2.LoadEvent.FINISHED: GLib.timeout_add(int(os.environ.get('JSDELAY', '500')), later)
v.connect('load-changed', on_load)
v.load_uri(os.environ['URL'])
w.connect('destroy', Gtk.main_quit); w.show_all()
GLib.timeout_add_seconds(int(os.environ.get('LIFE', '16')), Gtk.main_quit)
Gtk.main()
