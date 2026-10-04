"""
Puts an approved generated track on the air: encodes a take from assets/radio_pending/<batch>/ as Opus into
assets/radio/<station>/, with a provenance .json beside it (prompt, lyrics, seed, model), lists it in
content/radio/stations.yaml, credits it in assets/radio/CREDITS.md and re-indexes the lengths. Only for takes
the user has listened to and approved.

Run with ACE-Step's Python (it has soundfile, which writes Ogg Opus):

  ../ACE-Step-1.5/.venv/Scripts/python.exe scripts/radio/approve.py <batch> <file.flac> --artist "<name>"
      [--title "<title>"] [--station <id>] [--as <file name without .ogg>]
"""

import argparse
import json
import os
import re
import subprocess
import sys

import numpy as np
import soundfile as sf

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
STATIONS = os.path.join(REPO, "content", "radio", "stations.yaml")
CREDITS = os.path.join(REPO, "assets", "radio", "CREDITS.md")
HEADING = "## Generated music"
# The level the tracks are brought to (dBFS peak), and the quiet at either end that's trimmed off.
PEAK = 10 ** (-1.0 / 20)
SILENCE = 10 ** (-55 / 20)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("batch")
    ap.add_argument("file")
    ap.add_argument("--artist", required=True)
    ap.add_argument("--title")
    ap.add_argument("--station")
    ap.add_argument("--as", dest="name")
    args = ap.parse_args()

    pending = os.path.join(REPO, "assets", "radio_pending", args.batch)
    with open(os.path.join(pending, "manifest.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    entry = next((e for e in manifest["entries"] if e["file"] == args.file), None)
    if not entry:
        sys.exit(f"{args.file} isn't in {args.batch}'s manifest")
    station = args.station or entry["station"]
    title = args.title or entry["title"]
    name = args.name or entry["id"]
    if not re.fullmatch(r"[a-z0-9_]+", name):
        sys.exit("the file name must match [a-z0-9_]+")
    with open(STATIONS, encoding="utf-8", newline="") as f:
        text = f.read()
    block = re.search(rf"^  - id: {re.escape(station)}\r?\n(?:(?!  - id: ).*\r?\n?)*", text, re.M)
    if not block:
        sys.exit(f"no station '{station}' in stations.yaml")
    if f"file: {name}.ogg" in block.group(0):
        sys.exit(f"{station} already has {name}.ogg")

    audio, rate = sf.read(os.path.join(pending, args.file), dtype="float32", always_2d=True)
    loud = np.flatnonzero(np.abs(audio).max(axis=1) > SILENCE)
    if not len(loud):
        sys.exit("the take is silent")
    audio = audio[max(0, loud[0] - rate // 20) : loud[-1] + rate // 2]
    audio *= PEAK / np.abs(audio).max()
    out_dir = os.path.join(REPO, "assets", "radio", station)
    os.makedirs(out_dir, exist_ok=True)
    sf.write(os.path.join(out_dir, f"{name}.ogg"), audio, rate, format="OGG", subtype="OPUS")
    with open(os.path.join(out_dir, f"{name}.json"), "w", encoding="utf-8") as f:
        json.dump({**entry, "title": title, "artist": args.artist, "station": station, "batch": args.batch, "model": manifest.get("model")}, f, ensure_ascii=False, indent=2)

    nl = "\r\n" if "\r\n" in text else "\n"
    line = f"      - {{ file: {name}.ogg, title: {json.dumps(title, ensure_ascii=False)}, artist: {json.dumps(args.artist, ensure_ascii=False)} }}{nl}"
    body = block.group(0)
    body = body if body.endswith("\n") else body + nl
    with open(STATIONS, "w", encoding="utf-8", newline="") as f:
        f.write(text[: block.start()] + body + line + text[block.end() :])

    with open(CREDITS, encoding="utf-8") as f:
        credits = f.read()
    if HEADING not in credits:
        credits = credits.rstrip("\n") + (
            f"\n\n{HEADING}\n\nMade for this game on the developer's machine with ACE-Step 1.5 (MIT, https://github.com/ace-step/ACE-Step-1.5) from\n"
            "prompts and original lyrics written for it; the artist names are invented. Each file's prompt, lyrics and seed\n"
            "are in the .json beside it.\n\n"
        )
    credits = credits.rstrip("\n")
    credits += ("\n" if credits.splitlines()[-1].startswith("- ") else "\n\n") + f"- `{station}/{name}.ogg`: {title} · {args.artist}\n"
    with open(CREDITS, "w", encoding="utf-8") as f:
        f.write(credits)

    print(f"{station}/{name}.ogg: {len(audio) / rate:.0f} s · {title} · {args.artist}")
    subprocess.run(["node", os.path.join(REPO, "scripts", "radio", "index.mjs")], check=False, shell=os.name == "nt")


if __name__ == "__main__":
    main()
