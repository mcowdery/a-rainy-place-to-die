#!/usr/bin/env bash
# Sets up a RunPod pod (Ubuntu, root, network volume mounted at /workspace) to run this repo's dev server, shot
# scripts and benchmarks. Idempotent. `node scripts/pod.mjs start` runs it with --boot at every start.
#
#   bash scripts/podSetup.sh          first time on a volume: everything below
#   bash scripts/podSetup.sh --boot   after every stop/start: only what the container disk lost (apt packages,
#                                     fonts, PATH) and the idle-stop watchdog. A pod's container disk is wiped
#                                     when it stops; /workspace (the repo, node, node_modules, the browser,
#                                     Blender) is not.
#
# Env: REPO_URL (default: the origin on GitHub), BRANCH, WORKDIR (default /workspace), BLENDER_VERSION,
#      IDLE_MIN / MAX_HOURS (the watchdog, see podIdleStop.sh), NO_WATCHDOG=1.
set -euo pipefail

BOOT=0; [ "${1:-}" = "--boot" ] && BOOT=1
REPO_URL="${REPO_URL:-https://github.com/mcowdery/a-rainy-place-to-die.git}"
WORKDIR="${WORKDIR:-/workspace}"
REPO_DIR="$WORKDIR/a-rainy-place-to-die"
NODE_DIR="$WORKDIR/node"
BLENDER_DIR="$WORKDIR/blender"

export DEBIAN_FRONTEND=noninteractive
export PLAYWRIGHT_BROWSERS_PATH="$WORKDIR/.playwright"   # on the volume, so it is downloaded once

echo "== apt packages (fonts, GL/Vulkan, tools)"
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  git curl ca-certificates xz-utils rsync fontconfig \
  fonts-noto-cjk fonts-liberation fonts-dejavu-core fonts-ipafont-gothic fonts-noto-color-emoji \
  libvulkan1 vulkan-tools libegl1 libgl1 libglx-mesa0 libgbm1 pciutils \
  libxkbcommon0 libxi6 libxxf86vm1 libxfixes3 libxrender1 libsm6 libxext6 >/dev/null

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
if ! "$NODE_DIR/bin/node" -v >/dev/null 2>&1; then
  rm -rf "$NODE_DIR"; mkdir -p "$NODE_DIR"
  curl -fsSL https://nodejs.org/dist/latest-v22.x/ -o /tmp/node-index.html
  FILE="$(grep -o 'node-v22[0-9.]*-linux-x64\.tar\.xz' /tmp/node-index.html | head -1)"
  curl -fsSL "https://nodejs.org/dist/latest-v22.x/$FILE" | tar -xJ --no-same-owner -C "$NODE_DIR" --strip-components=1
fi
export PATH="$NODE_DIR/bin:$BLENDER_DIR:$PATH"
cat > /etc/profile.d/workspace.sh <<EOF
export PATH="$NODE_DIR/bin:$BLENDER_DIR:\$PATH"
export PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH"
export BLENDER="$BLENDER_DIR/blender"
export NVIDIA_DRIVER_CAPABILITIES=all
EOF
# ssh sessions that don't read /etc/profile.d (VS Code's, a bare `ssh host cmd`) still find node
grep -q workspace.sh /root/.bashrc 2>/dev/null || echo '. /etc/profile.d/workspace.sh' >> /root/.bashrc
ln -sf "$NODE_DIR"/bin/node "$NODE_DIR"/bin/npm "$NODE_DIR"/bin/npx /usr/local/bin/   # `ssh host cmd` has no login shell
[ -x "$BLENDER_DIR/blender" ] && ln -sf "$BLENDER_DIR/blender" /usr/local/bin/blender
node -v

# Blender's per-user folder (its settings, the MPFB extension and MPFB's data) lives on the volume: the version
# folder is a link to it. It was filled once from this machine's %APPDATA%\Blender Foundation\Blender\5.2
# (config, extensions\blender_org\mpfb, mpfb).
mkdir -p /root/.config/blender "$WORKDIR/blender-user"
rm -rf /root/.config/blender/5.2; ln -sfn "$WORKDIR/blender-user" /root/.config/blender/5.2

if [ "$BOOT" = 0 ]; then
  echo "== repo"
  if [ ! -d "$REPO_DIR/.git" ]; then git clone "$REPO_URL" "$REPO_DIR"; fi
  cd "$REPO_DIR"
  [ -n "${BRANCH:-}" ] && git checkout "$BRANCH"
  git pull --ff-only || echo "(not fast-forwarding: leaving the checkout as it is)"

  echo "== npm install"
  npm install --no-audit --no-fund

  echo "== Chromium (Playwright's build; as root it runs with --no-sandbox, which launchBrowser.mjs adds)"
  npx playwright-core install --with-deps chromium
elif [ -d "$REPO_DIR/node_modules/playwright-core" ]; then
  echo "== Chromium's system libraries (apt, lost with the container disk; the browser itself is on the volume)"
  (cd "$REPO_DIR" && npx playwright-core install-deps chromium >/dev/null)
fi

echo "== GPU"
nvidia-smi -L || echo "no nvidia-smi: this pod has no GPU"
ls /etc/vulkan/icd.d 2>/dev/null || echo "no Vulkan ICD files found"

if [ -z "${NO_WATCHDOG:-}" ] && [ -f "$REPO_DIR/scripts/podIdleStop.sh" ]; then
  echo "== idle-stop watchdog"
  pkill -f podIdleStop.sh 2>/dev/null || true
  sed -i 's/\r$//' "$REPO_DIR"/scripts/*.sh
  nohup bash "$REPO_DIR/scripts/podIdleStop.sh" >/dev/null 2>&1 &
  sleep 1; tail -1 /var/log/podIdleStop.log
fi

echo
echo "Done. Next: cd $REPO_DIR && node scripts/gpuCheck.mjs"
