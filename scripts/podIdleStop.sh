#!/usr/bin/env bash
# Stops this RunPod pod when it has been idle for a while, so a forgotten pod doesn't bill all night.
# Runs on the pod (podSetup.sh starts it at every boot). It stops the pod through RunPod's API with the
# pod's own id and key, which every pod has in its first process's environment.
#
# Idle = for IDLE_MIN minutes in a row: the GPU under GPU_BUSY_PCT %, this container's own CPU use under
# CPU_BUSY_CORES cores, and none of the heavy tools (blender, chromium, ffmpeg) running.
# CPU is read from the container's cgroup, never /proc/loadavg: inside a pod loadavg is the whole host's,
# other customers included (5,000+ processes against this container's dozen), so it never reads idle.
# An open SSH or VS Code window does NOT count as busy, on purpose: a window left open is how a pod gets
# forgotten. Typing in an editor for 45 minutes with nothing running is the case that gets cut off; save first.
# Hard cap: the pod is stopped MAX_HOURS after it booted whatever it is doing (0 = no cap).
#
#   IDLE_MIN=45 GPU_BUSY_PCT=5 CPU_BUSY_CORES=0.5 MAX_HOURS=12 bash scripts/podIdleStop.sh
#   touch /workspace/.keep-awake      pauses the watchdog until the file is removed (a long job you walk away from)
#   DRY_RUN=1 ...                     logs what it would do and never stops anything
#   Log: /var/log/podIdleStop.log: a line every 15 minutes with what it sees and why the pod counts as busy or idle
#   (and /workspace/podIdleStop.log keeps the last stop reason across boots)
IDLE_MIN="${IDLE_MIN:-45}"
GPU_BUSY_PCT="${GPU_BUSY_PCT:-5}"
CPU_BUSY_CORES="${CPU_BUSY_CORES:-0.5}"
MAX_HOURS="${MAX_HOURS:-12}"
TOOLS='blender|chrome|chromium|headless_shell|ffmpeg'   # not node or python: an editor's server and Jupyter always run

pid1() { tr '\0' '\n' < /proc/1/environ | sed -n "s/^$1=//p"; }
POD_ID="${RUNPOD_POD_ID:-$(pid1 RUNPOD_POD_ID)}"
API_KEY="${RUNPOD_API_KEY:-$(pid1 RUNPOD_API_KEY)}"
LOG=/var/log/podIdleStop.log

log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG" >/dev/null; }

# Microseconds of CPU this container has used so far (cgroup v2, then v1); empty if neither is readable.
cpu_usec() {
  if [ -r /sys/fs/cgroup/cpu.stat ]; then awk '/^usage_usec/{print $2}' /sys/fs/cgroup/cpu.stat
  elif [ -r /sys/fs/cgroup/cpuacct/cpuacct.usage ]; then echo $(( $(cat /sys/fs/cgroup/cpuacct/cpuacct.usage) / 1000 ))
  fi
}

stop_pod() {
  log "STOP: $1"
  echo "$(date -u +%FT%TZ) stopped: $1" >> /workspace/podIdleStop.log
  sync
  [ -n "${DRY_RUN:-}" ] && { log "(dry run: not stopping)"; return; }
  curl -fsS -X POST -H "Authorization: Bearer $API_KEY" "https://rest.runpod.io/v1/pods/$POD_ID/stop" >>"$LOG" 2>&1 \
    || { runpodctl config --apiKey "$API_KEY" >/dev/null 2>&1; runpodctl stop pod "$POD_ID" >>"$LOG" 2>&1; }
}

if [ -z "$POD_ID" ] || [ -z "$API_KEY" ]; then log "no pod id or key found: the watchdog cannot stop this pod, exiting"; exit 1; fi
prev_usec=$(cpu_usec); prev_at=$(date +%s)
[ -z "$prev_usec" ] && log "warning: no cgroup CPU counter here, so CPU use is not part of the idle test (GPU and tools only)"
log "watchdog started for $POD_ID: idle ${IDLE_MIN} min, GPU < ${GPU_BUSY_PCT}%, CPU < ${CPU_BUSY_CORES} cores, cap ${MAX_HOURS} h"

BOOT=$(date +%s); idle=0; tick=0
while sleep 60; do
  if [ "$MAX_HOURS" != 0 ] && [ $(( $(date +%s) - BOOT )) -ge $(( MAX_HOURS * 3600 )) ]; then stop_pod "reached the ${MAX_HOURS} h cap"; exit 0; fi
  if [ -e /workspace/.keep-awake ]; then idle=0; continue; fi

  gpu=$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null | sort -n | tail -1 | tr -dc 0-9)
  tools=$(ps -eo comm= | grep -E -c "^($TOOLS)") || tools=0
  now=$(date +%s); usec=$(cpu_usec); cores=0
  if [ -n "$usec" ] && [ -n "$prev_usec" ] && [ "$now" -gt "$prev_at" ]; then
    cores=$(awk -v a="$prev_usec" -v b="$usec" -v dt=$((now - prev_at)) 'BEGIN{printf "%.2f", (b - a) / (dt * 1000000)}')
  fi
  prev_usec=$usec; prev_at=$now

  busy=""
  [ "${gpu:-0}" -ge "$GPU_BUSY_PCT" ] && busy="gpu ${gpu}%"
  awk -v c="$cores" -v t="$CPU_BUSY_CORES" 'BEGIN{exit !(c>=t)}' && busy="$busy cpu ${cores} cores"
  [ "$tools" -gt 0 ] && busy="$busy tools $tools"

  if [ -n "$busy" ]; then idle=0; else idle=$((idle + 1)); fi
  tick=$((tick + 1))
  [ $((tick % 15)) = 0 ] && log "status: gpu ${gpu:-?}%, cpu ${cores} cores, tools ${tools}; ${busy:+busy:${busy}; }idle ${idle} min"
  if [ "$idle" -ge "$IDLE_MIN" ]; then stop_pod "idle ${IDLE_MIN} min"; exit 0; fi
done
