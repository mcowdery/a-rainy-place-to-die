#!/usr/bin/env bash
# Voice comparison: Fish Audio S2 Pro (fishaudio/s2-pro, the Fish Audio Research License: non-commercial use only).
# Its command line is three steps a line: the reference clip to tokens (once), text to tokens, tokens to sound.
#   bash scripts/voice/fish.sh [voice]        needs a 24 GB card
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="${VOICE_WORK:-/root/voice}"
out="${VOICE_OUT:-$here/../../debug-shots/voice}"; out="$(mkdir -p "$out" && cd "$out" && pwd)"
voice="${1:-gravel}"
mkdir -p "$work" "$out/fish"
export UV_NO_CACHE=1 UV_PYTHON_INSTALL_DIR="$work/python" HF_HOME="$work/hf" HF_HUB_DISABLE_XET=1
export PATH="$work/bin:$PATH"
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="$work/bin" UV_NO_MODIFY_PATH=1 sh
apt-get update -qq && apt-get install -y -qq portaudio19-dev libsox-dev ffmpeg >/dev/null

repo="$work/fish-speech"
[ -d "$repo" ] || git clone --depth 1 https://github.com/fishaudio/fish-speech "$repo"
cd "$repo"
uv sync --python 3.12 --extra "${FISH_CUDA:-cu126}"
[ -f checkpoints/s2-pro/codec.pth ] || uv run hf download fishaudio/s2-pro --local-dir checkpoints/s2-pro

uv run python fish_speech/models/dac/inference.py -i "$out/voices/$voice.wav" --checkpoint-path checkpoints/s2-pro/codec.pth
ref_text="$(python3 -c "import json;print(json.load(open('$here/lines.json',encoding='utf8'))['ref_text'])")"

# name<TAB>text, the plain lines and then the tagged ones (their own delivery tags, "-tags" in the name)
python3 - "$here/lines.json" > "$work/fish-lines.tsv" <<'PY'
import json, sys
s = json.load(open(sys.argv[1], encoding="utf8"))
n = {l["id"]: i + 1 for i, l in enumerate(s["lines"])}
for l in s["lines"]: print(f"{n[l['id']]:02d}-{l['id']}\t{l['text']}")
for l in s["tagged"]["fish"]: print(f"{n[l['id']]:02d}-{l['id']}-tags\t{l['text']}")
PY
while IFS=$'\t' read -r name text; do
  rm -rf output
  uv run python fish_speech/models/text2semantic/inference.py --text "$text" --prompt-text "$ref_text" --prompt-tokens fake.npy
  uv run python fish_speech/models/dac/inference.py -i output/codes_0.npy --checkpoint-path checkpoints/s2-pro/codec.pth -o "$out/fish/$name.wav"
  echo "fish $name"
done < "$work/fish-lines.tsv"
if [ "${VOICE_KEEP:-0}" != 1 ]; then rm -rf "$repo" "$HF_HOME"; fi
df -h "$work" | tail -1
