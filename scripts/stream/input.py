"""Runs on the pod: turns the browser's mouse and keyboard messages into X input (XTest), one JSON object per line on stdin.

  {"t":"mr","dx":3,"dy":-2}               relative mouse move (what a pointer-locked game needs)
  {"t":"ma","x":960,"y":540}              absolute mouse move, in desktop pixels
  {"t":"b","b":1,"d":true}                button 1 (left) 2 (middle) 3 (right) down or up
  {"t":"w","dy":120}                      wheel: buttons 4 (up) / 5 (down)
  {"t":"k","k":"w","d":true}              key by X keysym name ("w", "Shift_L", "space", "Return", "F5") down or up
"""
import json
import os
import sys

sys.path.insert(0, "/workspace/pydeps")
from Xlib import X, XK, display  # noqa: E402
from Xlib.ext import xtest  # noqa: E402

d = display.Display(os.environ.get("DISPLAY", ":1"))
root = d.screen().root
keycodes = {}


def keycode(name):
    if name not in keycodes:
        keycodes[name] = d.keysym_to_keycode(XK.string_to_keysym(name))
    return keycodes[name]


for line in sys.stdin:
    try:
        m = json.loads(line)
        t = m.get("t")
        if t == "mr":
            xtest.fake_input(d, X.MotionNotify, 1, x=int(m["dx"]), y=int(m["dy"]))
        elif t == "ma":
            xtest.fake_input(d, X.MotionNotify, 0, root=root, x=int(m["x"]), y=int(m["y"]))
        elif t == "b":
            xtest.fake_input(d, X.ButtonPress if m["d"] else X.ButtonRelease, int(m["b"]))
        elif t == "w":
            button = 5 if m["dy"] > 0 else 4
            xtest.fake_input(d, X.ButtonPress, button)
            xtest.fake_input(d, X.ButtonRelease, button)
        elif t == "k":
            code = keycode(m["k"])
            if code:
                xtest.fake_input(d, X.KeyPress if m["d"] else X.KeyRelease, code)
        d.sync()
    except Exception as e:  # one bad message must not end the session
        print("input.py:", e, file=sys.stderr, flush=True)
