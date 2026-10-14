#!/usr/bin/env bash
# One of GenIA's own bundled `image` scenes (demo/data/image/<scene>), as its authors run it: a control for our own pictures.
#   bash scripts/genia/pod_demo.sh <scene> [extra hydra overrides...]
set -eo pipefail
G=/workspace/genia
SCENE=$1; shift
export PATH="$G/envs/genia/bin:$PATH" HF_HOME="$G/hf" HF_TOKEN="$(cat $G/.hf_token)" TORCH_HOME="$G/torch"
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
export CUDA_HOME=$G/cuda-12.8 PATH="$G/cuda-12.8/bin:$PATH" LD_LIBRARY_PATH="$G/cuda-12.8/lib64:$LD_LIBRARY_PATH"
cd "$G/GenIA"
python demo/run_demo.py image --scene "$SCENE" "$@"
echo GENIA_RUN_DONE
