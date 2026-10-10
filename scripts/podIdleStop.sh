#!/usr/bin/env bash
# Stops this RunPod pod when it has been idle for a while, so a forgotten pod doesn't bill all night.
# Runs on the pod (podSetup.sh starts it at every boot). It stops the pod through RunPod's API with the
# pod's own id and key, which every pod has in its first process's environment.
#
# Idle = for IDLE_MIN minutes in a row: the GPU under GPU_BUSY_PCT %, the 1-minute load average under
# LOAD_BUSY, and none of the heavy tools (blender, chromium, ffmpeg) running. Node work (vite, tests, tsc) shows as load.
# An open SSH or VS Code window does NOT count as busy, on purpose: a window left open is how a pod gets
# forgotten. Typing in an editor for 45 minutes with nothing running is the case that gets cut off; save first.
# Hard cap: the pod is stopped MAX_HOURS after it booted whatever it is doing (0 = no cap).
#
#   IDLE_MIN=45 GPU_BUSY_PCT=5 LOAD_BUSY=1.0 MAX_HOURS=12 bash scripts/podIdleStop.sh
#   touch /workspace/.keep-awake      pauses the watchdog until the file is removed (a long job you walk away from)
#   DRY_RUN=1 ...                     logs what it would do and never stops anything
#   Log: /var/log/podIdleStop.log (and /workspace/podIdleStop.log keeps the last stop reason across boots)
IDLE_MIN="${IDLE_MIN:-45}"
GPU_BUSY_PCT="${GPU_BUSY_PCT:-5}"
LOAD_BUSY="${LOAD_BUSY:-1.0}"
MAX_HOURS="${MAX_HOURS:-12}"
TOOLS='blender|chrome|chromium|headless_shell|ffmpeg'   # not node or python: an editor's server and Jupyter always run

pid1() { tr '\0' '\n' < /proc/1/environ | sed -n "s/^$1=//p"; }
POD_ID="${RUNPOD_POD_ID:-$(pid1 RUNPOD_POD_ID)}"
API_KEY="${RUNPOD_API_KEY:-$(pid1 RUNPOD_API_KEY)}"
LOG=/var/log/podIdleStop.log

log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG" >/dev/null; }

stop_pod() {
  log "STOP: $1"
  echo "$(date -u +%FT%TZ) stopped: $1" >> /workspace/podIdleStop.log
  sync
  [ -n "${DRY_RUN:-}" ] && { log "(dry run: not stopping)"; return; }
  curl -fsS -X POST -H "Authorization: Bearer $API_KEY" "https://rest.runpod.io/v1/pods/$POD_ID/stop" >>"$LOG" 2>&1 \
    || { runpodctl config --apiKey "$API_KEY" >/dev/null 2>&1; runpodctl stop pod "$POD_ID" >>"$LOG" 2>&1; }
}

if [ -z "$POD_ID" ] || [ -z "$API_KEY" ]; then log "no pod id or key found: the watchdog cannot stop this pod, exiting"; exit 1; fi
log "watchdog started for $POD_ID: idle ${IDLE_MIN} min, GPU < ${GPU_BUSY_PCT}%, load < ${LOAD_BUSY}, cap ${MAX_HOURS} h"

BOOT=$(date +%s); idle=0
while sleep 60; do
  if [ "$MAX_HOURS" != 0 ] && [ $(( $(date +%s) - BOOT )) -ge $(( MAX_HOURS * 3600 )) ]; then stop_pod "reached the ${MAX_HOURS} h cap"; exit 0; fi
  if [ -e /workspace/.keep-awake ]; then idle=0; continue; fi

  gpu=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | sort -n | tail -1 | tr -dc 0-9)
  load=$(cut -d' ' -f1 /proc/loadavg)
  tools=$(ps -eo comm= | grep -E -c "^($TOOLS)") || tools=0
  busy=""
  [ "${gpu:-0}" -ge "$GPU_BUSY_PCT" ] && busy="gpu ${gpu}%"
  awk -v l="$load" -v t="$LOAD_BUSY" 'BEGIN{exit !(l>=t)}' && busy="$busy load $load"
  [ "$tools" -gt 0 ] && busy="$busy tools $tools"

  if [ -n "$busy" ]; then idle=0; else idle=$((idle + 1)); fi
  [ $((idle % 10)) = 0 ] && [ "$idle" -gt 0 ] && log "idle $idle min (gpu ${gpu:-?}%, load $load)"
  if [ "$idle" -ge "$IDLE_MIN" ]; then stop_pod "idle ${IDLE_MIN} min"; exit 0; fi
done
