#!/bin/sh
# Rigs one model and makes its contact sheet: scripts/animals/rigsheet.sh <rig name> <abs out dir> [export <abs out.glb>]
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
N="$1"; D="$2"; shift 2
"$B" -b -P "$(dirname "$0")/rig.py" -- "$N" "$D" preview "$@" 2>&1 | grep -iE "error|Traceback|File \"|exported"
python -I "$(dirname "$0")/sheet.py" "$D" "$N"
