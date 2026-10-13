#!/usr/bin/env bash
# Voice comparison: Higgs TTS 3 (bosonai/higgs-tts-3-4b, the Boson Higgs TTS 3 Research and Non-Commercial License).
# It runs as a server (sglang-omni) answering /v1/audio/speech; this starts one, asks for each line and stops it.
#   bash scripts/voice/higgs.sh [voice]       needs a 24 GB card
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="${VOICE_WORK:-/root/voice}"
out="${VOICE_OUT:-$here/../../debug-shots/voice}"; out="$(mkdir -p "$out" && cd "$out" && pwd)"
voice="${1:-gravel}"
port="${HIGGS_PORT:-8377}"
mkdir -p "$work" "$out/higgs"
export UV_NO_CACHE=1 UV_PYTHON_INSTALL_DIR="$work/python" HF_HOME="$work/hf" HF_HUB_DISABLE_XET=1
export PATH="$work/bin:$PATH"
command -v uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="$work/bin" UV_NO_MODIFY_PATH=1 sh

repo="$work/sglang-omni"
[ -d "$repo" ] || git clone --depth 1 https://github.com/sgl-project/sglang-omni "$repo"
cd "$repo"
[ -x .venv/bin/python ] || uv venv .venv -p 3.12
uv pip install --python .venv/bin/python -e . requests ninja   # ninja: the server compiles a kernel at its first start
# The attention kernels ready built: without them the server compiles them at its first request, which needs an
# nvcc as new as its PyTorch's CUDA (13.0), and the pod's is 12.4.
uv pip install --python .venv/bin/python "flashinfer-jit-cache==${FLASHINFER:-0.6.18}" --index-url "https://flashinfer.ai/whl/${HIGGS_CUDA:-cu130}"
export PATH="$repo/.venv/bin:$PATH"

# One request at a time is all this needs: by default the server compiles and captures graphs for batches up to 64,
# over ten minutes of it, and gives up on itself at 600 s.
.venv/bin/sgl-omni serve --model-path bosonai/higgs-tts-3-4b --port "$port"   --tts_engine.engine.max_running_requests 2 --tts_engine.engine.cuda_graph_max_bs 2 --tts_engine.engine.torch_compile_max_bs 1 > "$work/higgs-server.log" 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT
.venv/bin/python - "$here/lines.json" "$out" "$voice" "$port" "$server" <<'PY'
import json, os, sys, time
import requests

spec_path, out, voice, port, server = sys.argv[1:6]
s = json.load(open(spec_path, encoding="utf8"))
url = f"http://127.0.0.1:{port}/v1/audio/speech"
for i in range(240):  # the weights download on the first start
    try:
        os.kill(int(server), 0)
    except OSError:
        sys.exit("the server stopped: see higgs-server.log")
    try:
        if requests.get(f"http://127.0.0.1:{port}/health", timeout=3).status_code < 500: break
    except requests.RequestException:
        time.sleep(5)
else:
    sys.exit("the server never answered")
n = {l["id"]: i + 1 for i, l in enumerate(s["lines"])}
jobs = [(f"{n[l['id']]:02d}-{l['id']}", l["text"]) for l in s["lines"]]
jobs += [(f"{n[l['id']]:02d}-{l['id']}-tags", l["text"]) for l in s["tagged"]["higgs"]]
ref = [{"audio_path": f"{out}/voices/{voice}.wav", "text": s["ref_text"]}]
for name, text in jobs:
    r = requests.post(url, json={"input": text, "references": ref, "temperature": 0.8, "top_k": 50, "max_new_tokens": 1024}, timeout=600)
    r.raise_for_status()
    open(f"{out}/higgs/{name}.wav", "wb").write(r.content)
    print("higgs", name, flush=True)
PY
kill $server 2>/dev/null || true
if [ "${VOICE_KEEP:-0}" != 1 ]; then rm -rf "$repo" "$HF_HOME"; fi
df -h "$work" | tail -1
