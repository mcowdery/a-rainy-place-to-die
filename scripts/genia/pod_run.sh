#!/usr/bin/env bash
# One picture -> GenIA on the pod:  [PREP_ARGS='--size 518 --cut-below 0.78'] bash scripts/genia/pod_run.sh <picture> <name> [extra hydra overrides...]
# Results land in /workspace/genia/GenIA/results/.../<name>/<timestamp>/final/ (pulled by hand: see report).
set -eo pipefail
G=/workspace/genia
PIC=$(readlink -f "$1"); NAME=$2; shift 2
export PATH="$G/envs/genia/bin:$PATH" HF_HOME="$G/hf" HF_TOKEN="$(cat $G/.hf_token)" TORCH_HOME="$G/torch"
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
export CUDA_HOME=$G/cuda-12.8 PATH="$G/cuda-12.8/bin:$PATH" LD_LIBRARY_PATH="$G/cuda-12.8/lib64:$LD_LIBRARY_PATH"
cd "$G/GenIA"
python /workspace/a-rainy-place-to-die/scripts/genia/prep_scene.py "$PIC" "$NAME" --genia "$G/GenIA" $PREP_ARGS
python demo/run_demo.py image --scene "$NAME" "$@"
echo GENIA_RUN_DONE
