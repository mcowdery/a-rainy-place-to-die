#!/usr/bin/env bash
# Sets up a fresh RunPod pod (Ubuntu, root, network volume mounted at /workspace) to run this repo's
# dev server, shot scripts and benchmarks. Safe to run again. Run it from anywhere:
#   bash <(curl -fsSL https://raw.githubusercontent.com/mcowdery/a-rainy-place-to-die/<branch>/scripts/podSetup.sh)
# or, once the repo is cloned: bash scripts/podSetup.sh
#
# What lives where: the repo, node_modules and the browser download are on the volume (/workspace), so they
# survive a stopped pod. The apt packages (fonts, GL/Vulkan libraries) do not, so this script reinstalls them
# each time (about a minute).
#
# Env: REPO_URL (default: the origin on GitHub), BRANCH (default: the repo's default branch),
#      WORKDIR (default /workspace).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/mcowdery/a-rainy-place-to-die.git}"
WORKDIR="${WORKDIR:-/workspace}"
REPO_DIR="$WORKDIR/a-rainy-place-to-die"

export DEBIAN_FRONTEND=noninteractive
export PLAYWRIGHT_BROWSERS_PATH="$WORKDIR/.playwright"   # on the volume, so it is downloaded once

echo "== apt packages (fonts, GL/Vulkan, tools)"
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  git curl ca-certificates xz-utils rsync fontconfig \
  fonts-noto-cjk fonts-liberation fonts-dejavu-core fonts-ipafont-gothic fonts-noto-color-emoji \
  libvulkan1 vulkan-tools libegl1 libgl1 libglx-mesa0 libgbm1 pciutils >/dev/null

# Make the Windows font names the code asks for resolve to something that has Japanese glyphs.
mkdir -p /etc/fonts/conf.d
cat > /etc/fonts/conf.d/99-rainyplace.conf <<'EOF'
<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <alias binding="same"><family>Consolas</family><prefer><family>DejaVu Sans Mono</family></prefer></alias>
  <alias binding="same"><family>Cascadia Mono</family><prefer><family>DejaVu Sans Mono</family></prefer></alias>
  <alias binding="same"><family>MS Gothic</family><prefer><family>Noto Sans Mono CJK JP</family></prefer></alias>
  <alias binding="same"><family>Yu Gothic</family><prefer><family>Noto Sans CJK JP</family></prefer></alias>
  <alias binding="same"><family>Meiryo</family><prefer><family>Noto Sans CJK JP</family></prefer></alias>
  <alias binding="same"><family>MS Mincho</family><prefer><family>Noto Serif CJK JP</family></prefer></alias>
  <alias binding="same"><family>Yu Mincho</family><prefer><family>Noto Serif CJK JP</family></prefer></alias>
  <alias binding="same"><family>Segoe UI</family><prefer><family>Liberation Sans</family></prefer></alias>
  <alias binding="same"><family>Arial</family><prefer><family>Liberation Sans</family></prefer></alias>
</fontconfig>
EOF
fc-cache -f >/dev/null

echo "== node"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  NODE_DIR="$WORKDIR/node"
  if [ ! -x "$NODE_DIR/bin/node" ]; then
    mkdir -p "$NODE_DIR"
    curl -fsSL https://nodejs.org/dist/latest-v22.x/ -o /tmp/node-index.html
    FILE="$(grep -o 'node-v22[0-9.]*-linux-x64\.tar\.xz' /tmp/node-index.html | head -1)"
    curl -fsSL "https://nodejs.org/dist/latest-v22.x/$FILE" | tar -xJ -C "$NODE_DIR" --strip-components=1
  fi
  export PATH="$NODE_DIR/bin:$PATH"
  echo "export PATH=\"$NODE_DIR/bin:\$PATH\"" > /etc/profile.d/node-workspace.sh
fi
node -v

echo "== repo"
if [ ! -d "$REPO_DIR/.git" ]; then
  git clone "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR"
[ -n "${BRANCH:-}" ] && git checkout "$BRANCH"
git pull --ff-only || echo "(not fast-forwarding: leaving the checkout as it is)"

echo "== npm install"
npm install --no-audit --no-fund

echo "== Chromium (Playwright's build; as root it runs with --no-sandbox, which gpuCheck.mjs adds)"
echo "export PLAYWRIGHT_BROWSERS_PATH=\"$PLAYWRIGHT_BROWSERS_PATH\"" > /etc/profile.d/playwright-workspace.sh
npx playwright-core install --with-deps chromium

echo "== GPU"
nvidia-smi -L || echo "no nvidia-smi: this pod has no GPU"
echo "NVIDIA_DRIVER_CAPABILITIES=${NVIDIA_DRIVER_CAPABILITIES:-<unset>}  (graphics is needed for hardware WebGL)"
ls /usr/share/vulkan/icd.d /etc/vulkan/icd.d 2>/dev/null || echo "no Vulkan ICD files found"

echo
echo "Done. Next: cd $REPO_DIR && node scripts/gpuCheck.mjs"
