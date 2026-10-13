#!/usr/bin/env bash
# Voice comparison, round 2 (r2.py, round2.json): one engine in its own venv, removed afterwards.
#   bash scripts/voice/r2.sh voices
#   bash scripts/voice/r2.sh fish|chatterbox|turbo --voice gravel-deep-1 [--only pauses]
# VOICE_KEEP=1 leaves the venv and weights for the next run (chatterbox and turbo share one). Fish needs a 24 GB card.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="${VOICE_WORK:-/root/voice}"
engine="$1"; shift
mkdir -p "$work"
export UV_NO_CACHE=1 UV_PYTHON_INSTALL_DIR="$work/python" HF_HOME="$work/hf" HF_HUB_DISABLE_XET=1
export VOICE_OUT="${VOICE_OUT:-$(cd "$here/../.." && pwd)/debug-shots/voice}"
export PATH="$work/bin:$PATH"
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="$work/bin" UV_NO_MODIFY_PATH=1 sh
command -v ffmpeg >/dev/null || (apt-get update -qq && apt-get install -y -qq ffmpeg >/dev/null)

if [ "$engine" = fish ]; then
  dpkg -s portaudio19-dev >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq portaudio19-dev libsox-dev >/dev/null)
  repo="$work/fish-speech"
  trap 'if [ "${VOICE_KEEP:-0}" != 1 ]; then rm -rf "$repo" "$HF_HOME"; fi; df -h "$work" | tail -1' EXIT
  [ -d "$repo" ] || git clone --depth 1 https://github.com/fishaudio/fish-speech "$repo"
  cd "$repo"
  uv sync --python 3.12 --extra "${FISH_CUDA:-cu126}"
  [ -f checkpoints/s2-pro/codec.pth ] || uv run hf download fishaudio/s2-pro --local-dir checkpoints/s2-pro
  PYTHONPATH="$repo" uv run python "$here/r2.py" fish "$@"
  exit
fi

case "$engine" in
  voices) env=qwen; py=3.12; pkgs="qwen-tts soundfile" ;;
  # the commit Trame's speech worker pins: it has the Turbo model too. setuptools: its watermarker imports pkg_resources.
  chatterbox|turbo) env=chatterbox; py=3.11; pkgs="chatterbox-tts@git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2 setuptools<81 soundfile" ;;
  *) echo "unknown engine $engine" >&2; exit 2 ;;
esac
venv="$work/venv-$env"
trap 'if [ "${VOICE_KEEP:-0}" != 1 ]; then rm -rf "$venv" "$HF_HOME"; fi; df -h "$work" | tail -1' EXIT
if [ ! -x "$venv/bin/python" ]; then
  uv venv --python "$py" "$venv"
  uv pip install --python "$venv/bin/python" $pkgs
fi
"$venv/bin/python" "$here/r2.py" "$engine" "$@"
