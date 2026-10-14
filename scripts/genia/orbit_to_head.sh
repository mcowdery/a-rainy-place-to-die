#!/usr/bin/env bash
# A DiffPortrait360 orbit to a head on Mack's body (generated-art.md: Pixal3D's multi-view shape from the orbit,
# coloured through exact cameras, set on the body). Run from this checkout in Git Bash:
#
#   bash scripts/genia/orbit_to_head.sh <name> <orbit dir: frames/NNN.png, masks/NNN.png> [body.glb]
#
#   1. eight frames 45 degrees apart, upscaled to 1024 (debug-shots/figures_in/<name>/f00.png ...)
#   2. Pixal3D's multi-view job on them (the endpoint; debug-shots/image_to_3d/<name>_mv8/)
#   3. on the dev pod: the frames framed as the job framed its front (orbit_reframe.py), the mesh's faces turned
#      (orient_faces.py), the colour laid on through exact cameras (project_picture.py --exact-views 1); here, the
#      head's nose and eyes from its front picture (head_landmarks.py); on the pod, the head set on the body by them
#      (head_on_body.py --landmarks)
#   4. pulled back to debug-shots/props/<name>/: head.glb, rigged.glb, and close views of the neck (neck_views.mjs)
set -e
NAME=$1; ORBIT=$2; BODY=${3:-assets/characters/enemy_trench.glb}
cd "$(dirname "$0")/../.."
export PATH="/c/Program Files/nodejs:$PATH"
IN=debug-shots/figures_in/$NAME; OUT=debug-shots/props/$NAME; JOB=${NAME}_mv8
mkdir -p $IN $OUT
python - "$ORBIT" "$IN" <<'P'
import sys
from PIL import Image
orbit, out = sys.argv[1:3]
for i in range(0, 32, 4):
    im = Image.open(f'{orbit}/frames/{i:03d}.png').convert('RGB').resize((1024, 1024), Image.LANCZOS)
    im.save(f'{out}/f{i:02d}.png'); im.save(f'{out}/f{i:02d}.jpg', quality=93)
print('frames ready')
P
V=""; for a in "45.0:04" "89.9:08" "134.9:12" "179.9:16" "224.9:20" "269.8:24" "314.8:28"; do V="$V --view ${a%%:*}:$IN/f${a##*:}.jpg"; done
# The orbit's field of view, from its cameras.json (a widened crop has a wider one: 16.7 degrees against 13.4).
FOV=$(python -c "import json,math; print(round(math.radians(json.load(open('$ORBIT/cameras.json'))['fov_deg']),4))")
echo "orbit field of view: $FOV rad"
J=debug-shots/image_to_3d/$JOB
# (A job already done is not sent again: delete its folder to redo it.)
[ -f $J/$JOB.glb ] || node scripts/props/mesh_endpoint.mjs $IN/f00.jpg --engine pixal3d --name $JOB --fov $FOV $V
# The dev pod up (it starts itself; RunPod may have no GPU free for a while), and this checkout synced to it.
for i in $(seq 1 60); do
  node scripts/pod.mjs run --wait --no-pull -- true >/dev/null 2>&1 && ssh -o ConnectTimeout=20 rainy-pod true 2>/dev/null && break
  echo "$(date +%H:%M) waiting for the dev pod ($i)"; sleep 60
done
R=/workspace/heads/$NAME
ssh rainy-pod "mkdir -p $R/masks"
scp -q $J/$JOB.glb $J/camera.json $J/cutout.png $IN/f*.png $BODY rainy-pod:$R/
scp -q $ORBIT/masks/*.png rainy-pod:$R/masks/
ssh rainy-pod "cd /workspace/a-rainy-place-to-die && B=\$(command -v blender || ls -d /workspace/blender/*/blender 2>/dev/null | head -1 || ls /workspace/blender/blender) && \
  /workspace/genia/envs/genia/bin/python scripts/genia/orbit_reframe.py $R $R/masks && \
  \$B -b --python scripts/blender/orient_faces.py -- $R/$JOB.glb $R/oriented.glb >/dev/null 2>&1 && \
  \$B -b --python scripts/blender/project_picture.py -- $R/oriented.glb $R/camera.json $R/cutout.png $R/head.glb --tris 40000 --voxel 0.003 --tex 2048 --close 1 --exact-views 1 \
    --view 45:$R/v04.png --view 89.9:$R/v08.png --view 134.9:$R/v12.png --view 179.9:$R/v16.png --view 224.9:$R/v20.png --view 269.8:$R/v24.png --view 314.8:$R/v28.png 2>&1 | grep -E 'TEXELS|rror'"
scp -q rainy-pod:$R/head.glb $OUT/
# The head's nose and eyes, from the front picture it was made from (MediaPipe, here), for the fit on the body.
python scripts/genia/head_landmarks.py $OUT/head.glb $J/camera.json $J/cutout.png --out $OUT/landmarks.json
scp -q $OUT/landmarks.json rainy-pod:$R/
ssh rainy-pod "cd /workspace/a-rainy-place-to-die && B=\$(command -v blender || ls -d /workspace/blender/*/blender 2>/dev/null | head -1 || ls /workspace/blender/blender) &&   \$B -b --python scripts/blender/head_on_body.py -- $R/$(basename $BODY) $R/head.glb $R/rigged.glb --landmarks $R/landmarks.json --pitch-up ${PITCH_UP:-0} --tris 11000 --tex 2048 --normal-tex 1024 2>&1 | grep -E 'BODY head|HEAD|taken off|wrote|rror'"
scp -q rainy-pod:$R/rigged.glb $OUT/
UNLIT=1 SIZE=600 LIT=1 node debug-shots/meshview.mjs $OUT/head_unlit.png $OUT/head.glb | tail -1
SIZE=600 node debug-shots/meshview.mjs $OUT/head_sheet.png $OUT/head.glb | tail -1
mkdir -p $OUT/views && node debug-shots/genia/neck_views.mjs $NAME/rigged.glb $OUT/views/n | tail -1
echo ORBIT_TO_HEAD_DONE $OUT
