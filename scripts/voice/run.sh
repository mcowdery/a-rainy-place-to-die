#!/usr/bin/env bash
# Voice comparison, one model: makes its venv, runs gen.py in it, then removes the venv and the weights.
#   bash scripts/voice/run.sh design|qwen|chatterbox|f5 [--voice gravel]
# Everything but the clips lives under $VOICE_WORK (default /root/voice: a pod's container disk, wiped at each stop,
# so nothing is left on the shared volume). One model at a time: a venv and its weights are 10-20 GB.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="${VOICE_WORK:-/root/voice}"
model="$1"; shift
mkdir -p "$work"
export UV_NO_CACHE=1 UV_PYTHON_INSTALL_DIR="$work/python" HF_HOME="$work/hf" HF_HUB_DISABLE_XET=1
export PATH="$work/bin:$PATH"
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="$work/bin" UV_NO_MODIFY_PATH=1 sh
command -v ffmpeg >/dev/null || (apt-get update -qq && apt-get install -y -qq ffmpeg sox libsox-dev >/dev/null)

case "$model" in
  design|qwen) env=qwen; py=3.12; pkgs="qwen-tts soundfile" ;;
  chatterbox)  env=chatterbox; py=3.11; pkgs="chatterbox-tts setuptools<81" ;;
  f5)          env=f5; py=3.11; pkgs="f5-tts" ;;
  *) echo "unknown model $model" >&2; exit 2 ;;
esac
venv="$work/venv-$env"
rm -rf "$work/uv-cache"
# The designed voices and the Qwen clone share a venv: VOICE_KEEP=1 keeps it between the two.
trap 'if [ "${VOICE_KEEP:-0}" != 1 ]; then rm -rf "$venv" "$HF_HOME"; fi; df -h "$work" | tail -1' EXIT
if [ ! -x "$venv/bin/python" ]; then
  uv venv --python "$py" "$venv"
  uv pip install --python "$venv/bin/python" $pkgs
fi
"$venv/bin/python" "$here/gen.py" "$model" "$@"
