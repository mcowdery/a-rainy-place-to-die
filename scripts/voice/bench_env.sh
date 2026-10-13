#!/usr/bin/env bash
# The voice bench: makes one engine's venv if it isn't there, then runs its worker (bench_engine.py) in it.
#   bash scripts/voice/bench_env.sh fish|chatterbox|design <port>
# The venvs and the smaller models' weights go on the pod's own disk ($VOICE_WORK, 30 GB, wiped at each stop). Fish's
# 11 GB go in $VOICE_CACHE, which the bench puts on the volume: kept across stops, and without them the pod's disk
# has room for Turbo and the voice designer. Nothing else goes on the volume: it is shared with every other job on the
# pod, and when it filled (at 60 GB, 2026-10-13; 100 GB since) everything writing to it failed.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="${VOICE_WORK:-/root/voice}"
cache="${VOICE_CACHE:-$work/cache}"
engine="$1"; port="$2"
mkdir -p "$work" "$cache"
export UV_NO_CACHE=1 UV_PYTHON_INSTALL_DIR="$work/python" HF_HOME="$work/hf" HF_HUB_DISABLE_XET=1
export PATH="$work/bin:$PATH"
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="$work/bin" UV_NO_MODIFY_PATH=1 sh

# Fish and the voice designer (Qwen3-TTS) share Fish's venv: the pod's disk hasn't room for a third, and qwen-tts adds
# four small packages to it and moves transformers one patch release (4.56.1 -> 4.57.3), which Fish runs on as well.
if [ "$engine" = fish ] || [ "$engine" = design ]; then
  repo="$work/fish-speech"
  [ -d "$repo" ] || git clone --depth 1 https://github.com/fishaudio/fish-speech "$repo"
  cd "$repo"
  [ -x .venv/bin/python ] || uv sync --python 3.12 --extra "${FISH_CUDA:-cu126}"
  .venv/bin/python -c "import qwen_tts" 2>/dev/null || uv pip install --python .venv/bin/python qwen-tts
  if [ "$engine" = design ]; then   # its weights (4.5 GB) stay on the pod's own disk: on the volume they filled its quota
    exec .venv/bin/python "$here/bench_engine.py" design "$port"
  fi
  mkdir -p "$cache/s2-pro" checkpoints
  ln -sfn "$cache/s2-pro" checkpoints/s2-pro
  [ -f checkpoints/s2-pro/codec.pth ] || .venv/bin/hf download fishaudio/s2-pro --local-dir "$cache/s2-pro"
  PYTHONPATH="$repo" exec .venv/bin/python "$here/bench_engine.py" fish "$port"
fi

# the commit Trame's speech worker pins: it has the Turbo model too. setuptools: its watermarker imports pkg_resources.
[ "$engine" = chatterbox ] || { echo "unknown engine $engine" >&2; exit 2; }
venv="$work/venv-chatterbox"
if [ ! -x "$venv/bin/python" ]; then
  uv venv --python 3.11 "$venv"
  uv pip install --python "$venv/bin/python" "chatterbox-tts@git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2" "setuptools<81" soundfile
fi
exec "$venv/bin/python" "$here/bench_engine.py" chatterbox "$port"
