"""Round 3, run against the bench's own server (bench_server.py, on the pod): the accent follow-ups and the sound tests.

    python3 scripts/voice/followup.py [accent|sounds|all]

Everything it makes lands in the bench as voices and takes, so the page shows them: nothing here needs its own page.
  accent: more voices designed in Italian (deep, gravelly), a sweep of Chatterbox's two sliders on the two Italian voices
          the user heard an accent from, and Turbo on those two.
  sounds: grunts, sighs, breaths and moans (none of it words) through Fish (free-form [bracket] directions), Turbo (its
          fixed tags) and Chatterbox (no tags: the sounds spelt out as text, which is a long shot).
"""
import json
import sys
import time
import urllib.request

BASE = "http://127.0.0.1:8460"
LINE = "Sit down. We need to talk about what happened last night."
IT = ["bench/voices/dom-accent-it-1", "bench/voices/dom-accent-it-2"]


def post(path, body, timeout=900):
    req = urllib.request.Request(BASE + path, json.dumps(body).encode(), {"Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=timeout).read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def until_started(path, body):
    """The bench starts an engine on first use and says so; ask again until it has."""
    for _ in range(200):
        r = post(path, body)
        if "error" not in r or "is starting" not in r["error"]:
            return r
        time.sleep(6)
    return {"error": "never started"}


def make(model, text, voice, **kw):
    r = until_started("/api/generate", {"model": model, "text": text, "voice": voice, "seed": kw.pop("seed", 1), "takes": 1, **kw})
    t = r["takes"][0] if "takes" in r else None
    print(model, voice.split("/")[-1], (text[:44] + "…") if len(text) > 44 else text, kw.get("opts", ""), f"{t['seconds']}s" if t else r.get("error"), flush=True)
    return t


def accent():
    r = until_started("/api/design", {"name": "dom-it-deep", "language": "Italian", "takes": 8, "seed": 100,
                                       "instruct": "An Italian man in his forties with an extremely deep, gravelly bass voice, rough and smoke-damaged. Slow, weary, quiet."})
    print("designed:", r.get("ids") or r)
    for v in IT:
        for ex in (0.4, 0.7, 1.1):
            for cfg in (0.1, 0.5, 0.9):
                make("chatterbox", LINE, v, opts={"exaggeration": ex, "cfg_weight": cfg, "temperature": 0.8})
    for v in IT:
        make("turbo", LINE, v)
        make("turbo", "[sigh] Sit down. [clear throat] We need to talk about what happened last night.", v)
        make("turbo", "[cough] Monday again. [groan] I counted the bills twice.", v)


FISH_SOUNDS = [
    ("[low grunt] Hold still.", "grunt"),
    ("[grunts with effort] [panting] Get up. We're not done.", "effort"),
    ("[heavy sigh] [exhales slowly] It's over.", "sigh"),
    ("[satisfied sigh] That's better.", "satisfied sigh"),
    ("[long, weary sigh]", "sigh only"),
    ("[sharp inhale through the teeth] [groan] Don't touch that.", "wince"),
    ("[low moan] [breathless] Mmm.", "low moan"),
    ("[soft, breathy moan] [breathing heavily] Ahh... don't stop.", "breathy moan"),
    ("[moaning softly, out of breath] [gasps] Oh... oh.", "moaning, gasp"),
    ("[long, low moan of pleasure]", "moan only"),
    ("[heavy breathing] [quiet moan] [exhales shakily]", "breaths and moan"),
    ("[whispering, breathless] [soft moan] Come here.", "whisper"),
]
TURBO_SOUNDS = [
    "[groan] Hold still.", "[sigh] It's over.", "[gasp] [groan] Don't touch that.", "[sigh] [groan] Mmm.",
    "[groan] [gasp] Ahh... don't stop.", "[groan] [sigh] [gasp]", "[cough] [clear throat] [sigh]",
]
CHATTERBOX_SOUNDS = ["Hhhh... mmm.", "Mmm... ahh... haaah.", "Ugh... hnn. Hold still.", "Haaah... ohh... ohh.", "Hahh. Hahh. Hahh. Ugh."]


def sounds():
    for v in IT:
        for t, _ in FISH_SOUNDS:
            make("fish", t, v, opts={"temperature": 0.9})
    for v in IT:
        for t in TURBO_SOUNDS:
            make("turbo", t, v)
        for t in CHATTERBOX_SOUNDS:
            make("chatterbox", t, v, opts={"exaggeration": 0.8, "cfg_weight": 0.3, "temperature": 0.8})


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("accent", "all"):
        accent()
    if what in ("sounds", "all"):
        sounds()
    print("DONE")
