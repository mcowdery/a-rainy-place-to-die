"""
Generates a batch of music for the radio on this machine with ACE-Step 1.5 (MIT; https://github.com/ace-step/ACE-Step-1.5),
for review. Nothing here goes on the air by itself: takes land in assets/radio_pending/<batch>/ (git-ignored) with a
manifest.json and an index.html to listen to them (/assets/radio_pending/<batch>/ on the dev server), and only the
ones the user approves are moved into a station (scripts/radio/approve.mjs).

Run it with ACE-Step's own Python (its checkout beside this repo, or ACE_STEP_ROOT):

  ../ACE-Step-1.5/.venv/Scripts/python.exe scripts/radio/generate.py scripts/radio/briefs/<batch>.json
      [--only id,id]   only these items
      [--takes N]      takes of each (different seeds), over the brief's own
      [--no-lm]        the DiT alone (faster, less VRAM; the songwriter model plans structure otherwise)
      [--force]        generate takes that are already there again (they're skipped otherwise, so a run that
                       was cut short carries on where it stopped)
      [--dry-run]      print what would be generated

A brief:

  { "batch": "citypop-01",
    "defaults": { "duration": 180, "takes": 2, "steps": 8 },
    "items": [ { "id": "wangan_midnight",          # [a-z0-9_]+: the file's name
                 "station": "bay",                  # where it would go if approved
                 "title": "Wangan Midnight", "artist": "…",   # proposed; settled on approval
                 "caption": "…",                    # style, instruments, mood, voice (no tempo or key here)
                 "lyrics": "[Instrumental]",        # or lyrics with [Verse] / [Chorus] tags
                 "language": "ja", "bpm": 112, "key": "F# minor", "duration": 200, "seed": 1234 } ] }

Prompts describe a style in plain words; they never name a real artist, band or song.
"""

import argparse
import html
import json
import os
import shutil
import subprocess
import sys
import time

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ACE = os.environ.get("ACE_STEP_ROOT") or os.path.abspath(os.path.join(REPO, "..", "ACE-Step-1.5"))
DIT = "acestep-v15-turbo"
# The generator holds on to 3-4 GB more memory with every take (a dozen takes in one process ate 50 GB and the
# machine crawled), so each few takes get a process of their own.
PER_PROCESS = 4
LM = "acestep-5Hz-lm-0.6B"


def review_page(batch, entries):
    rows = []
    for e in entries:
        lyrics = "" if e["lyrics"].strip() == "[Instrumental]" else f"<details><summary>lyrics</summary><pre>{html.escape(e['lyrics'])}</pre></details>"
        rows.append(
            f"<section><h2>{html.escape(e['title'])} <small>{html.escape(e['file'])} · {html.escape(e['station'])} · {e['seconds']:.0f} s · seed {e['seed']}</small></h2>"
            f"<audio controls preload='none' src='{html.escape(e['file'])}'></audio><p>{html.escape(e['caption'])}</p>{lyrics}</section>"
        )
    return (
        "<!doctype html><meta charset='utf-8'><title>Radio: " + html.escape(batch) + "</title>"
        "<style>body{font:15px system-ui;background:#101014;color:#e4e2ee;max-width:860px;margin:24px auto;padding:0 16px}"
        "h2{font-size:17px;margin:26px 0 6px}small{font-weight:normal;opacity:.6;font-size:12px}audio{width:100%}"
        "p{opacity:.75;font-size:13px}pre{white-space:pre-wrap;font-size:13px;opacity:.85}</style>"
        f"<h1>{html.escape(batch)}</h1><p>Generated with ACE-Step 1.5 ({DIT}). Tell Claude which files to keep.</p>" + "".join(rows)
    )


def lyrics_in_float32(dit):
    """GPUs older than the RTX 30 series run the model in float16, and its lyric encoder overflows that (values past
    65504 in its MLPs: every latent comes out NaN on any song with lyrics; instrumentals are fine). So that one
    small encoder runs in float32, its result handed back in float16."""
    import torch

    enc = dit.model.encoder.lyric_encoder
    inner = enc.forward

    def forward(*args, **kwargs):
        half = next(enc.parameters()).dtype
        if half != torch.float16:
            return inner(*args, **kwargs)

        def cast(v):
            return v.float() if torch.is_tensor(v) and v.dtype == torch.float16 else v

        enc.float()
        try:
            with torch.autocast("cuda", enabled=False):
                out = inner(*[cast(a) for a in args], **{k: cast(v) for k, v in kwargs.items()})
        finally:
            enc.to(half)
        out.last_hidden_state = out.last_hidden_state.to(half)
        return out

    enc.forward = forward


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("brief")
    ap.add_argument("--only", default="")
    ap.add_argument("--takes", type=int, default=0)
    ap.add_argument("--no-lm", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--jobs", default="", help=argparse.SUPPRESS)
    args = ap.parse_args()

    with open(args.brief, encoding="utf-8") as f:
        brief = json.load(f)
    batch = brief["batch"]
    defaults = brief.get("defaults", {})
    only = {s for s in args.only.split(",") if s}
    items = [i for i in brief["items"] if not only or i["id"] in only]
    out = os.path.join(REPO, "assets", "radio_pending", batch)
    jobs = []
    for item in items:
        takes = args.takes or item.get("takes", defaults.get("takes", 1))
        for t in range(takes):
            jobs.append((item, t, int(item.get("seed", 1000)) + t * 7919))
    if not args.force:
        jobs = [(item, t, seed) for item, t, seed in jobs if not os.path.exists(os.path.join(out, f"{item['id']}_{t + 1}.flac"))]
    if args.jobs:
        mine = set(args.jobs.split(","))
        jobs = [j for j in jobs if f"{j[0]['id']}_{j[1] + 1}" in mine]
    else:
        for item, t, seed in jobs:
            print(f"{item['id']}_{t + 1}: {item.get('duration', defaults.get('duration', 180))} s · seed {seed} · {item['caption'][:90]}")
        if args.dry_run or not jobs:
            return
        names = [f"{item['id']}_{t + 1}" for item, t, _ in jobs]
        # The model fills the GPU: wait for the shots and benchmarks now running, and hold new ones back (scripts/gpu_lock.py).
        sys.path.insert(0, os.path.join(REPO, "scripts"))
        import gpu_lock
        gpu_lock.exclusive(f"radio generate {batch}")
        for i in range(0, len(names), PER_PROCESS):
            subprocess.run([sys.executable, os.path.abspath(__file__), *sys.argv[1:], "--force", "--jobs", ",".join(names[i : i + PER_PROCESS])], check=False)
        print(f"Listen: {os.path.join(out, 'index.html')}")
        return

    if not os.path.isdir(os.path.join(ACE, "acestep")):
        sys.exit(f"ACE-Step 1.5 isn't at {ACE} (set ACE_STEP_ROOT)")
    sys.path.insert(0, ACE)
    os.chdir(ACE)
    from acestep.handler import AceStepHandler
    from acestep.inference import GenerationConfig, GenerationParams, generate_music
    from acestep.llm_inference import LLMHandler

    os.makedirs(out, exist_ok=True)
    manifest_path = os.path.join(out, "manifest.json")
    manifest = {"batch": batch, "model": DIT, "entries": []}
    if os.path.exists(manifest_path):
        with open(manifest_path, encoding="utf-8") as f:
            manifest = json.load(f)

    t0 = time.time()
    dit = AceStepHandler()
    # (Everything is moved off the GPU when it isn't working: with the game or Studio open there is little VRAM to
    # spare, and running out of it makes a one-minute take crawl for hours.)
    msg, ok = dit.initialize_service(project_root=ACE, config_path=DIT, device="auto", offload_to_cpu=True, offload_dit_to_cpu=True)
    if not ok:
        sys.exit(f"DiT: {msg}")
    lyrics_in_float32(dit)
    print(f"DiT loaded in {time.time() - t0:.0f} s")
    llm = LLMHandler()
    use_lm = not args.no_lm
    if use_lm:
        t0 = time.time()
        msg, ok = llm.initialize(checkpoint_dir=os.path.join(ACE, "checkpoints"), lm_model_path=LM, backend="pt", device="auto", offload_to_cpu=True)
        if not ok:
            print(f"LM not loaded ({msg}): the DiT alone")
            use_lm = False
        else:
            print(f"LM loaded in {time.time() - t0:.0f} s")

    for item, t, seed in jobs:
        name = f"{item['id']}_{t + 1}"
        lyrics = item.get("lyrics", "[Instrumental]")
        params = GenerationParams(
            task_type="text2music",
            caption=item["caption"],
            lyrics=lyrics,
            instrumental=lyrics.strip() == "[Instrumental]",
            vocal_language=item.get("language", "unknown"),
            bpm=item.get("bpm"),
            keyscale=item.get("key", ""),
            timesignature=str(item.get("timesignature", "4")),
            duration=float(item.get("duration", defaults.get("duration", 180))),
            inference_steps=int(item.get("steps", defaults.get("steps", 8))),
            shift=3.0,
            seed=seed,
            thinking=use_lm,
            # The caption is ours to keep: the songwriter plans the structure, it doesn't rewrite the style.
            use_cot_caption=False,
            use_cot_language=False,
        )
        config = GenerationConfig(batch_size=1, use_random_seed=False, seeds=[seed], audio_format="flac")
        t0 = time.time()
        result = generate_music(dit, llm, params=params, config=config, save_dir=out)
        took = time.time() - t0
        if not result.success or not result.audios:
            print(f"{name}: FAILED after {took:.0f} s: {result.error or result.status_message}")
            continue
        audio = result.audios[0]
        file = f"{name}.flac"
        shutil.move(audio["path"], os.path.join(out, file))
        seconds = audio["tensor"].shape[-1] / audio["sample_rate"]
        entry = {
            "file": file, "id": item["id"], "take": t + 1, "station": item.get("station", ""), "title": item.get("title", item["id"]), "artist": item.get("artist", ""),
            "caption": item["caption"], "lyrics": lyrics, "language": item.get("language", ""), "bpm": item.get("bpm"), "key": item.get("key", ""),
            "seconds": round(seconds, 2), "seed": seed, "steps": params.inference_steps, "lm": LM if use_lm else None, "generated": time.strftime("%Y-%m-%d %H:%M"), "took": round(took),
        }
        manifest["entries"] = [e for e in manifest["entries"] if e["file"] != file] + [entry]
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        with open(os.path.join(out, "index.html"), "w", encoding="utf-8") as f:
            f.write(review_page(batch, manifest["entries"]))
        print(f"{name}: {seconds:.0f} s of music in {took:.0f} s", flush=True)


if __name__ == "__main__":
    main()
