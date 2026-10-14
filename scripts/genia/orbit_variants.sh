#!/usr/bin/env bash
# Pixal3D multi-view variants of one DiffPortrait360 orbit, baked and hole-checked, for the user to pick from.
#   bash scripts/genia/orbit_variants.sh <name> <orbit dir> "<tag:resolution:seed> ..."      e.g. "s0:1024:0 s1:1024:1"
# Nothing is fitted to a body. Results: debug-shots/props/<name>/<tag>/head.glb (15,000 triangles, one 2048 texture) and a
# printout of each one's open edges and pieces (the baked 40k head of the first Mack had 129 open edges; torn: 12,906).
set -e
NAME=$1; ORBIT=$2; SPECS=${3:-"s0:1024:0 s1:1024:1 s2:1024:2"}
cd "$(dirname "$0")/../.."
export PATH="/c/Program Files/nodejs:$PATH"
IN=debug-shots/figures_in/$NAME; OUT=debug-shots/props/$NAME; mkdir -p $IN $OUT
python - "$ORBIT" "$IN" <<'P'
import sys
from PIL import Image
orbit, out = sys.argv[1:3]
for i in range(0, 32, 4):
    im = Image.open(f'{orbit}/frames/{i:03d}.png').convert('RGB').resize((1024, 1024), Image.LANCZOS)
    im.save(f'{out}/f{i:02d}.png'); im.save(f'{out}/f{i:02d}.jpg', quality=93)
P
V=""; for a in "45.0:04" "89.9:08" "134.9:12" "179.9:16" "224.9:20" "269.8:24" "314.8:28"; do V="$V --view ${a%%:*}:$IN/f${a##*:}.jpg"; done
FOV=$(python -c "import json,math; print(round(math.radians(json.load(open('$ORBIT/cameras.json'))['fov_deg']),4))")
for spec in $SPECS; do
  IFS=: read tag res seed <<< "$spec"; JOB=${NAME}_$tag
  [ -f debug-shots/image_to_3d/$JOB/$JOB.glb ] || node scripts/props/mesh_endpoint.mjs $IN/f00.jpg --engine pixal3d --name $JOB --fov $FOV --resolution $res --seed $seed $V 2>&1 | grep -E "triangles|outline|COMPLETED|rror|failed"
done
for i in $(seq 1 60); do node scripts/pod.mjs run --wait --no-pull -- true >/dev/null 2>&1 && ssh -o ConnectTimeout=20 rainy-pod true 2>/dev/null && break; sleep 60; done
R=/workspace/heads/$NAME; ssh rainy-pod "mkdir -p $R/masks"; scp -q $IN/f*.png rainy-pod:$R/; scp -q $ORBIT/masks/*.png rainy-pod:$R/masks/
for spec in $SPECS; do
  IFS=: read tag res seed <<< "$spec"; JOB=${NAME}_$tag; J=debug-shots/image_to_3d/$JOB
  [ -f $J/$JOB.glb ] || { echo "no $JOB"; continue; }
  ssh rainy-pod "mkdir -p $R/$tag" && scp -q $J/$JOB.glb $J/camera.json $J/cutout.png rainy-pod:$R/$tag/
  ssh rainy-pod "cd /workspace/a-rainy-place-to-die && B=\$(command -v blender || ls -d /workspace/blender/*/blender 2>/dev/null | head -1 || ls /workspace/blender/blender) && \
    cp $R/f*.png $R/$tag/ && /workspace/genia/envs/genia/bin/python scripts/genia/orbit_reframe.py $R/$tag $R/masks && \
    \$B -b --python scripts/blender/orient_faces.py -- $R/$tag/$JOB.glb $R/$tag/oriented.glb >/dev/null 2>&1 && \
    \$B -b --python scripts/blender/project_picture.py -- $R/$tag/oriented.glb $R/$tag/camera.json $R/$tag/cutout.png $R/$tag/head.glb --tris 15000 --voxel 0.003 --tex 2048 --close 1 --exact-views 1 \
      --view 45:$R/$tag/v04.png --view 89.9:$R/$tag/v08.png --view 134.9:$R/$tag/v12.png --view 179.9:$R/$tag/v16.png --view 224.9:$R/$tag/v20.png --view 269.8:$R/$tag/v24.png --view 314.8:$R/$tag/v28.png 2>&1 | grep -E 'TEXELS|rror'"
  mkdir -p $OUT/$tag && scp -q rainy-pod:$R/$tag/head.glb $OUT/$tag/head.glb
  python - $OUT/$tag/head.glb $tag <<'P'
import sys, trimesh, numpy as np
m = trimesh.load(sys.argv[1], force='mesh', process=False); w = trimesh.Trimesh(m.vertices, m.faces, process=True)
u, c = np.unique(w.edges_sorted, axis=0, return_counts=True)
print(f'{sys.argv[2]}: {len(m.faces)} triangles, {(c == 1).sum()} open edges, {len(w.split(only_watertight=False))} pieces')
P
done
echo VARIANTS_DONE $OUT
