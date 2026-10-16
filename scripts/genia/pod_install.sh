#!/usr/bin/env bash
# Installs Meta's GenIA (github.com/facebookresearch/GenIA, CC BY-NC 4.0; SAM 3D Objects underneath, gated on
# Hugging Face) on the dev pod, all under /workspace/genia so it survives the pod stopping: Miniconda, the CUDA 12.8
# toolkit (install.sh wants a LOCAL toolkit matching torch 2.7.1+cu128, never conda's), the repo, its weights.
#
#   node scripts/pod.mjs run -- bash scripts/genia/pod_install.sh      (about 30-60 minutes the first time)
#
# The Hugging Face read token (the SAM 3D Objects licence accepted on its account) is read from
# /workspace/genia/.hf_token, written there once by hand; it is never in this file or the checkout.
set -euo pipefail
G=/workspace/genia
mkdir -p "$G" && cd "$G"
[ -s "$G/.hf_token" ] || { echo "no $G/.hf_token"; exit 2; }

if [ ! -x "$G/conda/bin/conda" ]; then
  wget -q https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh -O mc.sh
  bash mc.sh -b -p "$G/conda" && rm mc.sh
fi

if [ ! -x "$G/cuda-12.8/bin/nvcc" ]; then
  wget -q https://developer.download.nvidia.com/compute/cuda/12.8.0/local_installers/cuda_12.8.0_570.86.10_linux.run -O cuda.run
  sh cuda.run --silent --toolkit --toolkitpath="$G/cuda-12.8" --no-man-page --override && rm cuda.run
fi

[ -d "$G/GenIA/.git" ] || git clone https://github.com/facebookresearch/GenIA "$G/GenIA"
cd "$G/GenIA"
export PATH="$G/conda/bin:$PATH"
export GENIA_CUDA_ROOT="$G" GENIA_CUDA_VERSION=12.8 GENIA_TORCH_CUDA_ARCH_LIST=8.9 MAX_JOBS=8
export CONDA_PKGS_DIRS="$G/pkgs" PIP_CACHE_DIR="$G/pipcache" TMPDIR="$G/tmp"
mkdir -p "$TMPDIR"
conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main >/dev/null 2>&1 || true
conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/r >/dev/null 2>&1 || true
# conda envs live under the volume too
conda config --add envs_dirs "$G/envs"
if ! conda env list | grep -q "^genia "; then
  bash install.sh
fi
eval "$(conda shell.bash hook)"
conda activate genia
export HF_TOKEN="$(cat "$G/.hf_token")" HF_HOME="$G/hf"
python -m genia.core.download_weights
echo GENIA_INSTALLED
