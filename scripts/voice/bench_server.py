"""The voice bench: a page for trying Mack's voice by hand (bench.html), and this, the server behind it.

    python3 scripts/voice/bench_server.py [port]         on the GPU pod; scripts/voice/bench.mjs starts it and tunnels to it

Standard library only. It serves the page, keeps the voices and the takes (debug-shots/voice/bench/), and passes each
request to an engine worker (bench_engine.py, one a model family, each in a venv of its own, started when first asked
for). Fish Audio S2 and the voice designer don't fit the card together: starting one stops the other.

In a line's text, |0.8| is a cut: the two sides are generated separately and joined with 0.8 s of silence.
"""
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
VOICE = ROOT / "debug-shots" / "voice"
DATA = VOICE / "bench"
WORK = Path(os.environ.get("VOICE_WORK", "/root/voice"))   # the pod's own disk: venvs, weights, logs
LOGS = WORK / "logs"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8460
REF_TEXT = json.loads((HERE / "lines.json").read_text(encoding="utf8"))["ref_text"]
# What a designed voice reads, by the language it is designed in. A voice designed in its speaker's own language and
# then cloned to speak English is one way to an accent (the description alone often loses it).
SAMPLES = {
    "English": REF_TEXT,
    "Italian": "Pioveva da tre giorni. Quel tipo di pioggia che non lava via niente. Ho acceso una sigaretta, ho guardato il neon colare nel tombino, e ho aspettato un telefono che non avrebbe squillato.",
    "Japanese": "三日間、雨が降り続いていた。何も洗い流してくれない、そういう雨だ。煙草に火をつけ、ネオンが側溝に滲んでいくのを眺めながら、鳴るはずのない電話を待った。",
    "Spanish": "Llevaba tres días lloviendo. Esa clase de lluvia que no limpia nada. Encendí un cigarrillo, vi cómo el neón se desangraba en la alcantarilla, y esperé un teléfono que no iba a sonar.",
    "French": "Il pleuvait depuis trois jours. Le genre de pluie qui ne lave rien. J'ai allumé une cigarette, regardé le néon couler dans le caniveau, et attendu un téléphone qui ne sonnerait pas.",
    "German": "Es regnete seit drei Tagen. Die Art Regen, die nichts sauber wäscht. Ich zündete mir eine Zigarette an, sah zu, wie das Neonlicht in den Rinnstein lief, und wartete auf ein Telefon, das nicht klingeln würde.",
    "Russian": "", "Portuguese": "", "Korean": "", "Chinese": "",
}
# Weights that are fetched when first asked for, and the room each needs: the pod's disk (30 GB) holds Fish and
# Chatterbox with about 2 GB over, so these only fit when the bench's cache is on a volume with space.
LAZY = {"turbo": ("models--ResembleAI--chatterbox-turbo", 4.5), "design": ("models--Qwen--Qwen3-TTS-12Hz-1.7B-VoiceDesign", 5.0)}


def room(what):
    folder, need = LAZY[what]
    if (WORK / "hf" / "hub" / folder).exists():
        return
    free = shutil.disk_usage(WORK).free / 1e9
    if free < need:
        label = "Chatterbox-Turbo" if what == "turbo" else "The voice designer"
        raise RuntimeError(f"{label} isn't installed and there is no room for it on the pod's disk ({free:.1f} GB free, it needs {need:g}). "
                           "Fish and Chatterbox take the space; it comes back when the pod's storage volume has room.")


for d in (DATA / "takes", DATA / "voices", LOGS):
    d.mkdir(parents=True, exist_ok=True)

# model -> the worker that serves it
MODELS = {"fish": "fish", "chatterbox": "chatterbox", "turbo": "chatterbox"}
WORKERS = {"fish": 8471, "chatterbox": 8472, "design": 8473}
EXCLUSIVE = {"fish": "design", "design": "fish"}  # 15 GB and 7 GB beside Chatterbox's 7 on a 24 GB card
procs = {}
lock = threading.Lock()         # starting and stopping workers
gpu = threading.Lock()          # one generation at a time
takes_lock = threading.Lock()
TAKES = DATA / "takes.json"


def worker_state(name):
    p = procs.get(name)
    if not p or p.poll() is not None:
        return "failed" if p and p.returncode else "off"
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{WORKERS[name]}/ping", timeout=2).read()
        return "ready"
    except Exception:
        return "starting"


def stop(name):
    p = procs.pop(name, None)
    if p and p.poll() is None:
        p.terminate()
        try:
            p.wait(20)
        except subprocess.TimeoutExpired:
            p.kill()


def ensure(name, swap=True):
    """Starts a worker if it isn't up. Fish and the designer take each other's place on the card: with `swap` the one
    in the way is stopped first, once it has finished what it is generating; never while it is still loading (two
    requests waiting on one each would otherwise stop each other's for ever)."""
    with lock:
        if worker_state(name) in ("ready", "starting"):
            return
        other = EXCLUSIVE.get(name)
        if other and worker_state(other) != "off" and other in procs and procs[other].poll() is None:
            if not swap:
                return
            if worker_state(other) == "starting":
                raise RuntimeError(f"{other} is still loading and {name} can't load beside it: wait for {other} to be ready, then ask again")
            with gpu:
                stop(other)
        log = open(LOGS / f"{name}.log", "a")
        log.write(f"\n==== start {time.strftime('%H:%M:%S')} ====\n")
        log.flush()
        procs[name] = subprocess.Popen(["bash", str(HERE / "bench_env.sh"), name, str(WORKERS[name])], stdout=log, stderr=subprocess.STDOUT, cwd=ROOT)


def log_tail(name, n=3):
    try:
        lines = [l for l in (LOGS / f"{name}.log").read_text(errors="replace")[-20000:].splitlines() if l.strip() and not l.startswith(" + ")]
        return [l[-160:] for l in lines[-n:]]
    except OSError:
        return []


def call(name, path, body, timeout=900):
    req = urllib.request.Request(f"http://127.0.0.1:{WORKERS[name]}{path}", json.dumps(body).encode(), {"Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=timeout).read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(json.loads(e.read()).get("error", str(e)))


def voices():
    out = []
    for label, folder in (("yours", DATA / "voices"), ("round 2", VOICE / "r2" / "voices"), ("round 1", VOICE / "voices")):
        for f in sorted(folder.glob("*.wav")):
            if ".shift" in f.name:
                continue
            note = f.with_suffix(".txt")
            out.append({"id": f"{folder.relative_to(VOICE).as_posix()}/{f.stem}", "name": f.stem, "group": label,
                        "url": "/files/" + f.relative_to(VOICE).as_posix(),
                        "text": note.read_text(encoding="utf8").strip() if note.exists() else (REF_TEXT if folder != DATA / "voices" else "")})
    return out


def voice_file(vid, shift):
    """The clip a voice id names, lowered or raised by `shift` semitones (kept beside it) when asked."""
    src = (VOICE / f"{vid}.wav").resolve()
    if VOICE.resolve() not in src.parents or not src.exists():
        raise RuntimeError(f"no such voice: {vid}")
    if not shift:
        return src
    out = src.with_name(f"{src.stem}.shift{shift:+g}.wav")
    if not out.exists():
        r = 2 ** (shift / 12)
        sr = int(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "stream=sample_rate", "-of", "csv=p=0", str(src)]).split()[0])
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-af", f"asetrate={sr * r:.0f},aresample={sr},atempo={1 / r:.5f}", str(out)], check=True)
    return out


def pieces(text, sentence_gap):
    """The text cut at its |seconds| marks; with none and a sentence gap set, cut after every sentence instead."""
    parts = re.split(r"\|\s*(\d+(?:\.\d+)?)\s*\|", text)
    if len(parts) == 1 and sentence_gap:
        out = []
        for s in re.split(r"(?<=[.!?…])\s+(?=[\[\(\"'A-Z])", text.strip()):
            out += [s, float(sentence_gap)]
        return out[:-1]
    out = []
    for i, p in enumerate(parts):
        if i % 2:
            out.append(float(p))
        elif p.strip():
            out.append(p.strip())
    return out


def load_takes():
    try:
        return json.loads(TAKES.read_text(encoding="utf8"))
    except (OSError, ValueError):
        return []


def save_takes(t):
    TAKES.write_text(json.dumps(t, indent=1), encoding="utf8")


def generate(q):
    model = q["model"]
    name = MODELS[model]
    if model in LAZY:
        room(model)
    if worker_state(name) != "ready":
        ensure(name)
        raise RuntimeError(f"{name} is starting: watch its status at the top, then try again")
    voice = next((v for v in voices() if v["id"] == q["voice"]), None)
    if not voice:
        raise RuntimeError("pick a voice")
    if model == "fish" and not voice["text"]:
        raise RuntimeError("Fish needs the words spoken in the voice clip: type them under the voice and save")
    shift = float(q.get("voice_shift") or 0)
    ps = pieces(q["text"], q.get("sentence_gap"))
    if not ps:
        raise RuntimeError("no text")
    made = []
    seed = int(q.get("seed") or 1)
    for n in range(max(1, min(6, int(q.get("takes") or 1)))):
        tid = f"{time.strftime('%m%d-%H%M%S')}-{n}"
        body = {"model": model, "pieces": ps, "voice": {"path": str(voice_file(voice["id"], shift)), "text": voice["text"]},
                "seed": seed + n, "opts": q.get("opts") or {}, "stretch": float(q.get("stretch") or 1),
                "semitones": float(q.get("semitones") or 0), "out": str(DATA / "takes" / f"{tid}.wav")}
        with gpu:
            r = call(name, "/synth", body)
        t = {"id": tid, "url": f"/files/bench/takes/{tid}.wav", "seconds": round(r["seconds"], 2), "took": round(r["took"], 1),
             "q": {**{k: q.get(k) for k in ("model", "text", "voice", "voice_shift", "sentence_gap", "opts", "stretch", "semitones")}, "seed": seed + n}}
        with takes_lock:
            save_takes([t] + load_takes())
        made.append(t)
    return made


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/":
            return self.file(HERE / "bench.html", "text/html; charset=utf-8")
        if path == "/api/state":
            return self.send(200, {"workers": {n: {"state": worker_state(n), "log": log_tail(n)} for n in WORKERS}, "voices": voices(), "takes": load_takes()})
        if path.startswith("/files/"):
            f = (VOICE / path[7:]).resolve()
            if VOICE.resolve() in f.parents and f.is_file():
                return self.file(f, "audio/wav")
        self.send(404, {"error": "not found"})

    def file(self, f, kind):
        data = f.read_bytes()
        start, end = 0, len(data) - 1
        m = re.match(r"bytes=(\d*)-(\d*)", self.headers.get("Range") or "")
        if m and (m.group(1) or m.group(2)):
            start = int(m.group(1)) if m.group(1) else len(data) - int(m.group(2))
            end = int(m.group(2)) if m.group(1) and m.group(2) else end
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
        else:
            self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self.wfile.write(data[start:end + 1])

    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        try:
            if self.path == "/api/voice":  # a recording or a file, any format: kept as a mono wav, with its words beside it
                name = re.sub(r"[^a-z0-9-]+", "-", (self.headers.get("X-Name") or "voice").lower()).strip("-") or "voice"
                tmp = DATA / "voices" / f"{name}.upload"
                tmp.write_bytes(raw)
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(tmp), "-ac", "1", "-ar", "44100", "-t", "30", str(DATA / "voices" / f"{name}.wav")], check=True)
                tmp.unlink()
                return self.send(200, {"id": f"bench/voices/{name}"})
            q = json.loads(raw or b"{}")
            if self.path == "/api/engine":  # the page warming up the engine it shows: never at another's expense
                ensure(q["name"], swap=False)
                return self.send(200, {})
            if self.path == "/api/generate":
                return self.send(200, {"takes": generate(q)})
            if self.path == "/api/voice-text":
                f = (VOICE / f"{q['id']}.txt").resolve()
                if DATA.resolve() not in f.parents:
                    raise RuntimeError("only your own voices' words can be changed")
                f.write_text(q["text"], encoding="utf8")
                return self.send(200, {})
            if self.path == "/api/design":
                if worker_state("design") != "ready":
                    room("design")
                    ensure("design")
                    raise RuntimeError("the voice designer is starting (Fish stops while it runs): watch its status, then try again")
                name = re.sub(r"[^a-z0-9-]+", "-", q["name"].lower()).strip("-") or "designed"
                language = q.get("language") or "English"
                text = (q.get("text") or "").strip() or SAMPLES.get(language)
                if not text:
                    raise RuntimeError(f"type what the voice should say, in {language}: there is no sample text for it")
                made = []
                for n in range(max(1, min(6, int(q.get("takes") or 1)))):
                    f = DATA / "voices" / f"{name}-{int(q.get('seed') or 1) + n}.wav"
                    with gpu:
                        call("design", "/design", {"instruct": q["instruct"], "text": text, "language": language, "seed": int(q.get("seed") or 1) + n, "out": str(f)})
                    f.with_suffix(".txt").write_text(text, encoding="utf8")
                    f.with_suffix(".instruct").write_text(q["instruct"], encoding="utf8")
                    made.append(f"bench/voices/{f.stem}")
                return self.send(200, {"ids": made})
            if self.path == "/api/take":
                with takes_lock:
                    ts = load_takes()
                    if q.get("delete"):
                        ts = [t for t in ts if t["id"] != q["id"]]
                        (DATA / "takes" / f"{q['id']}.wav").unlink(missing_ok=True)
                    for t in ts:
                        if t["id"] == q["id"]:
                            t.update({k: q[k] for k in ("star", "note") if k in q})
                    save_takes(ts)
                return self.send(200, {})
            self.send(404, {"error": "not found"})
        except Exception as e:
            self.send(400, {"error": str(e)[:600]})


if __name__ == "__main__":
    Path("/tmp/voice-bench.pid").write_text(str(os.getpid()))  # bench.mjs stop
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))      # so a kill stops the workers too (the finally below)
    for n in (sys.argv[2:] or ["fish", "chatterbox"]):
        ensure(n)
    print(f"Ready: voice bench on {PORT}", flush=True)
    try:
        ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    finally:
        for n in list(procs):
            stop(n)
