#!/usr/bin/env bash
# Fetches GenIA's weights (static scenes only: no ActionMesh, 17 GB the volume can't spare) on the pod.
set -eo pipefail
G=/workspace/genia
export PATH="$G/envs/genia/bin:$PATH" HF_HOME="$G/hf" HF_TOKEN="$(cat $G/.hf_token)" TORCH_HOME="$G/torch" CONDA_PKGS_DIRS="$G/pkgs"
cd "$G/GenIA"
python -m genia.core.download_weights --no-actionmesh
echo GENIA_WEIGHTS_DONE
