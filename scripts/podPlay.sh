#!/usr/bin/env bash
# Runs on the pod: starts a browser-streamed desktop with the game in a GPU-accelerated Chromium window.
# `node scripts/pod.mjs play` runs this and opens the SSH tunnel to it.
#
# What it is: KasmVNC (a virtual X desktop with a web client built in) listening on 127.0.0.1:8444 only, so the way
# in is an SSH tunnel, never an open port; openbox as the window manager; the game's dev server on 127.0.0.1:5173;
# and Playwright's Chromium, in an app window, on the NVIDIA GPU through ANGLE and Vulkan, loading it.
# Everything but KasmVNC itself is what the shot scripts already use, so the same GPU path.
#
#   bash scripts/podPlay.sh            start (or restart) the desktop
#   bash scripts/podPlay.sh stop       stop it
# Env: PLAY_GEOMETRY (default 1920x800), PLAY_URL (default http://127.0.0.1:5173/), PLAY_PORT (default 8444).
set -euo pipefail

# The desktop is a fixed size and the page scales it to the window (it does not follow the window: its default,
# "remote resizing", renders at the browser's CSS pixels, which on a 150%-scaled monitor is a third of the real
# pixels, and the game came out soft). The size is a trade: KasmVNC encodes on the CPU, so more pixels, fewer frames.
# Measured with one viewer on an A5000 pod, the game's own frame rate: 1280x720 60, 1600x900 50-55, 1920x1080 about 37.
# The default, 1920x800 (1.5 M pixels, the shape of a 21:9 monitor), sits between the last two; PLAY_GEOMETRY=1600x900
# for a 16:9 screen, 1280x720 for the smoothest, 1920x1080 when sharpness matters more than motion.
GEOMETRY="${PLAY_GEOMETRY:-1920x800}"
QMIN="${PLAY_QMIN:-7}"; QMAX="${PLAY_QMAX:-8}"; LOSSLESS="${PLAY_LOSSLESS:-10}"; VQ="${PLAY_VIDEO_Q:--1}"
PORT="${PLAY_PORT:-8444}"
URL="${PLAY_URL:-http://127.0.0.1:5173/}"
REPO=/workspace/a-rainy-place-to-die
export PLAYWRIGHT_BROWSERS_PATH=/workspace/.playwright
export DEBIAN_FRONTEND=noninteractive
export HOME="${HOME:-/root}"

stop() {
  pkill -f play-watch.sh 2>/dev/null || true
  vncserver -kill :1 >/dev/null 2>&1 || true
  pkill -f "/usr/bin/perl /usr/bin/vncserver" 2>/dev/null || true
  pkill -x Xvnc 2>/dev/null || true
  pkill -f "vite --port 5173" 2>/dev/null || true
  rm -f /tmp/.X1-lock /tmp/.X11-unix/X1
}
if [ "${1:-}" = stop ]; then stop; echo "stopped"; exit 0; fi

echo "== KasmVNC and the window manager (apt packages are lost with the container disk, so this runs again after a stop)"
if ! command -v vncserver >/dev/null; then
  apt-get update -qq
  apt-get install -y -qq --no-install-recommends openbox dbus-x11 x11-utils x11-xserver-utils xterm ssl-cert >/dev/null
  curl -fsSL -o /tmp/kasmvnc.deb https://github.com/kasmtech/KasmVNC/releases/download/v1.5.0/kasmvncserver_jammy_1.5.0_amd64.deb
  apt-get install -y -qq /tmp/kasmvnc.deb >/dev/null
fi

command -v xprintidle >/dev/null || apt-get install -y -qq xprintidle >/dev/null

CHROME="$(ls "$PLAYWRIGHT_BROWSERS_PATH"/chromium-*/chrome-linux*/chrome 2>/dev/null | head -1)"
[ -x "$CHROME" ] || { echo "no Playwright Chromium under $PLAYWRIGHT_BROWSERS_PATH: run podSetup.sh first"; exit 1; }

stop
rm -rf /tmp/play-profile
mkdir -p "$HOME/.vnc"
cat > "$HOME/.vnc/kasmvnc.yaml" <<EOF
network:
  interface: 127.0.0.1
  websocket_port: $PORT
  ssl:
    require_ssl: false
# The stream is tuned for slow links by default (the web client's own default caps video mode at 960x540 and its
# quality sliders sit in the middle). This path is a tunnel to a pod a few milliseconds away, so ask for the best:
# the server's values rule, and the client's settings can't pull the picture back down to a quarter of 1080p.
desktop:
  resolution:
    width: ${GEOMETRY%x*}
    height: ${GEOMETRY#*x}
  allow_resize: false
runtime_configuration:
  allow_client_to_override_kasm_server_settings: false
encoding:
  max_frame_rate: 60
  rect_encoding_mode:
    min_quality: $QMIN
    max_quality: $QMAX
    consider_lossless_quality: $LOSSLESS
  video_encoding_mode:
    jpeg_quality: $VQ
    webp_quality: $VQ
    max_resolution:
      width: ${GEOMETRY%x*}
      height: ${GEOMETRY#*x}
    scaling_algorithm: progressive_bilinear
EOF
cat > "$HOME/.vnc/xstartup" <<EOF
#!/bin/sh
export PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH
openbox &
cd $REPO
(npx vite --port 5173 --host 127.0.0.1 > /tmp/vite-play.log 2>&1 &)
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do curl -fs -o /dev/null http://127.0.0.1:5173/ && break; sleep 1; done
exec "$CHROME" --no-sandbox --user-data-dir=/tmp/play-profile --no-first-run --disable-infobars \\
  --use-angle=vulkan --enable-features=Vulkan --disable-vulkan-surface --disable-gpu-compositing --ignore-gpu-blocklist --enable-gpu-rasterization \
  --remote-debugging-port=9222 --remote-allow-origins=* --window-position=0,0 --window-size=${GEOMETRY%x*},${GEOMETRY#*x} \\
  --kiosk $URL
EOF
chmod +x "$HOME/.vnc/xstartup"
# Nothing else can reach the port (127.0.0.1 only, behind the SSH tunnel), so the web login is switched off
# (-disableBasicAuth). vncserver still asks whether to create a user with write access: "2" answers no, and
# -select-de manual stops it asking which desktop (our xstartup is the desktop). Neither has a flag of its own.
# Not piped into `tail`: vncserver's perl process lingers, and with `| tail -6` both stayed alive at 100% and 55% CPU
# for hours, slowing everything else on the pod.
printf '2\n' | vncserver :1 -select-de manual -geometry "$GEOMETRY" -depth 24 -disableBasicAuth -xstartup "$HOME/.vnc/xstartup" > /tmp/vncserver.log 2>&1 || true
tail -6 /tmp/vncserver.log

# The game keeps rendering whether or not anyone watches, which would keep the GPU busy and the pod's idle stop from
# ever firing. So the desktop stops itself: with no viewer connected for PLAY_NO_VIEWER_MIN minutes (the browser tab
# is closed or the tunnel is gone), or with no mouse or keyboard input for PLAY_IDLE_MIN minutes (a tab left open).
cat > /tmp/play-watch.sh <<'EOF'
#!/usr/bin/env bash
NOVIEW_MIN="${PLAY_NO_VIEWER_MIN:-10}"; IDLE_MIN="${PLAY_IDLE_MIN:-30}"; PORT="${PLAY_PORT:-8444}"
noview=0
while sleep 60; do
  pgrep -x Xvnc >/dev/null || exit 0
  viewers=$(ss -tn state established "( sport = :$PORT )" | tail -n +2 | wc -l)
  idle_ms=$(DISPLAY=:1 xprintidle 2>/dev/null || echo 0)
  if [ "$viewers" -eq 0 ]; then noview=$((noview + 1)); else noview=0; fi
  if [ "$noview" -ge "$NOVIEW_MIN" ] || [ "$idle_ms" -ge $((IDLE_MIN * 60000)) ]; then
    echo "$(date -u +%FT%TZ) stopping the desktop: viewers=$viewers, no input for $((idle_ms / 60000)) min, no viewer for $noview min" >> /var/log/podPlay.log
    bash /workspace/a-rainy-place-to-die/scripts/podPlay.sh stop
    exit 0
  fi
done
EOF
PLAY_PORT="$PORT" setsid nohup bash /tmp/play-watch.sh >/dev/null 2>&1 < /dev/null &

sleep 3
echo "== listening:"; ss -tlnp | grep -E ":($PORT|5173)\b" || echo "(nothing yet)"
for _ in $(seq 1 25); do pgrep -f "chrome.*--kiosk" >/dev/null && break; sleep 1; done   # the dev server starts first
echo "== chromium:"; pgrep -af "chrome.*--kiosk" | head -1 | cut -c1-110 || echo "(not running)"
echo "Ready: tunnel port $PORT, open http://localhost:$PORT/"
