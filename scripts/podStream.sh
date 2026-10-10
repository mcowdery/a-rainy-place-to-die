#!/usr/bin/env bash
# Runs on the pod: the game on the GPU in a plain X display, streamed as H.264 encoded by the GPU's own video encoder.
# The successor to podPlay.sh (KasmVNC), which compresses every frame on the CPU: its picture falls apart as the size
# grows and shows boxes around changed regions. Here ffmpeg captures the display and NVENC encodes it, so a larger picture
# costs the GPU's encoder, not the pod's CPUs. See scripts/stream/server.mjs for the pipeline.
#
#   bash scripts/podStream.sh        start (or restart)
#   bash scripts/podStream.sh stop
# Env: PLAY_GEOMETRY (default 1920x1080), STREAM_FPS (60), STREAM_BITRATE (25M), STREAM_PORT (8450).
set -euo pipefail

GEOMETRY="${PLAY_GEOMETRY:-1920x1080}"
W="${GEOMETRY%x*}"; H="${GEOMETRY#*x}"
PORT="${STREAM_PORT:-8450}"
REPO=/workspace/a-rainy-place-to-die
export PLAYWRIGHT_BROWSERS_PATH=/workspace/.playwright
export DEBIAN_FRONTEND=noninteractive
export DISPLAY=:1

stop() {
  pkill -f "scripts/stream/server.mjs" 2>/dev/null || true
  pkill -x ffmpeg 2>/dev/null || true
  pkill -f "user-data-dir=/tmp/play-profile" 2>/dev/null || true
  pkill -f "vite --port 5173" 2>/dev/null || true
  pkill -x openbox 2>/dev/null || true
  pkill -x Xvfb 2>/dev/null || true
  rm -f /tmp/.X1-lock /tmp/.X11-unix/X1
}
if [ "${1:-}" = stop ]; then stop; echo "stopped"; exit 0; fi

echo "== packages (apt ones are lost with the container disk; the rest live on the volume)"
command -v Xvfb >/dev/null && command -v openbox >/dev/null && command -v ffmpeg >/dev/null || {
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends xvfb openbox x11-utils ffmpeg >/dev/null
}
[ -d /workspace/play-deps/node_modules/ws ] || npm install --prefix /workspace/play-deps ws --no-audit --no-fund >/dev/null 2>&1
[ -d /workspace/pydeps/Xlib ] || pip install -q --target /workspace/pydeps python-xlib >/dev/null 2>&1
echo '{}' > /workspace/play-deps/package.json 2>/dev/null || true

CHROME="$(ls "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1)"
[ -x "$CHROME" ] || { echo "no Playwright Chromium under $PLAYWRIGHT_BROWSERS_PATH: run podSetup.sh first"; exit 1; }
ffmpeg -hide_banner -encoders > /tmp/ffmpeg-encoders.txt 2>/dev/null || true   # not piped to grep -q: it closes the pipe early and pipefail calls that a failure
grep -q h264_nvenc /tmp/ffmpeg-encoders.txt || { echo "this ffmpeg has no h264_nvenc"; exit 1; }

stop
rm -rf /tmp/play-profile

setsid nohup Xvfb "$DISPLAY" -screen 0 "${W}x${H}x24" -nolisten tcp > /tmp/xvfb.log 2>&1 < /dev/null &
for _ in $(seq 1 20); do [ -e /tmp/.X11-unix/X1 ] && break; sleep 0.2; done
setsid nohup openbox > /tmp/openbox.log 2>&1 < /dev/null &
(cd "$REPO" && setsid nohup npx vite --port 5173 --host 127.0.0.1 > /tmp/vite-play.log 2>&1 < /dev/null &)
for _ in $(seq 1 20); do curl -fs -o /dev/null http://127.0.0.1:5173/ && break; sleep 1; done
setsid nohup "$CHROME" --no-sandbox --user-data-dir=/tmp/play-profile --no-first-run --disable-infobars \
  --use-angle=vulkan --enable-features=Vulkan --disable-vulkan-surface --ignore-gpu-blocklist --enable-gpu-rasterization \
  --remote-debugging-port=9222 --remote-allow-origins=* --window-position=0,0 --window-size="$W,$H" \
  --kiosk http://127.0.0.1:5173/ > /tmp/chrome-play.log 2>&1 < /dev/null &
STREAM_W="$W" STREAM_H="$H" STREAM_PORT="$PORT" setsid nohup node "$REPO/scripts/stream/server.mjs" > /tmp/stream-server.log 2>&1 < /dev/null &
sleep 3
echo "== running:"
pgrep -x Xvfb >/dev/null && echo "  Xvfb ${W}x${H}"; pgrep -f "scripts/stream/server.mjs" >/dev/null && echo "  stream server"; pgrep -f "vite --port 5173" >/dev/null && echo "  dev server"
tail -2 /tmp/stream-server.log
echo "Ready: tunnel port $PORT, open http://localhost:$PORT/"
