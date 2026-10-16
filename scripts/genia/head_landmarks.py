"""Where a generated head's nose and eyes are, in the head's own mesh: for scripts/blender/head_on_body.py.

  python scripts/genia/head_landmarks.py <head.glb> <the Pixal3D job's camera.json> <its cutout.png> [--out landmarks.json]

Why: a head's nose can't be found from its shape alone. The front-most point is the nose on a level head, but on a
head tilted down, or with a lock of hair hanging over the forehead, it is the brow or the hair (Mack's second head,
2026-10-14: found 0.27 of its height too high, and the head came out a third too small on the body). So MediaPipe's
pose model (Apache 2.0, the environment of ../mocap-tools, as scripts/props/figure_landmarks.py uses) finds the nose
and the two eyes in the front picture the head was made from, and each pixel is cast into the mesh through that
picture's exact camera (Pixal3D builds the mesh in it: camera.json's `view_cv` and `intrinsics`; `project_picture.py`'s
head keeps the same frame). Writes {"nose", "eye_l", "eye_r"} as glTF points (y up, the face towards +z), the
subject's own left and right, and the pixel each came from.
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np
import trimesh

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
TOOLS = os.environ.get('MOCAP_TOOLS', os.path.join(os.path.dirname(ROOT), 'mocap-tools'))
PY = os.path.join(TOOLS, '.venv', 'Scripts' if os.name == 'nt' else 'bin', 'python.exe' if os.name == 'nt' else 'python')
MODEL = os.path.join(TOOLS, 'models', 'pose_landmarker_heavy.task')

FIND = r'''
import json, sys, numpy as np, mediapipe as mp
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGBA'); w, h = im.size
rgb = Image.new('RGB', im.size, (128, 128, 128)); rgb.paste(im, mask=im.getchannel('A'))
opts = mp.tasks.vision.PoseLandmarkerOptions(base_options=mp.tasks.BaseOptions(model_asset_path=sys.argv[2]), running_mode=mp.tasks.vision.RunningMode.IMAGE)
with mp.tasks.vision.PoseLandmarker.create_from_options(opts) as det:
    r = det.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(rgb)))
if not r.pose_landmarks: print(json.dumps(None)); sys.exit()
p = r.pose_landmarks[0]
# MediaPipe's left_eye (2) is the subject's left; nose 0, right_eye 5.
print(json.dumps({k: [p[i].x * w, p[i].y * h, p[i].visibility] for k, i in (('nose', 0), ('eye_l', 2), ('eye_r', 5))}))
'''

ap = argparse.ArgumentParser()
ap.add_argument('head')
ap.add_argument('camera')
ap.add_argument('cutout')
ap.add_argument('--out')
a = ap.parse_args()

found = json.loads(subprocess.run([PY, '-c', FIND, a.cutout, MODEL], capture_output=True, text=True, check=True).stdout.strip().splitlines()[-1])
if not found:
    sys.exit('MediaPipe found no one in ' + a.cutout)
cam = json.load(open(a.camera))
K = np.array(cam['intrinsics'], dtype=float)
view = np.array(cam['view_cv'], dtype=float)  # glTF point -> OpenCV camera
cam_pos = -np.linalg.solve(view[:3, :3], view[:3, 3])
mesh = trimesh.load(a.head, force='mesh', process=False)
T = np.asarray(mesh.vertices)[np.asarray(mesh.faces)]


def cast(u, v):
    """The first point of the mesh along the camera's ray through pixel (u, v) (Moller-Trumbore, every triangle)."""
    d_cam = np.linalg.solve(K, np.array([u, v, 1.0]))
    d = view[:3, :3].T @ d_cam
    d /= np.linalg.norm(d)
    e1, e2 = T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]
    pv = np.cross(d, e2)
    det = (e1 * pv).sum(1)
    ok = np.abs(det) > 1e-12
    inv = np.where(ok, 1.0 / np.where(ok, det, 1), 0)
    tv = cam_pos - T[:, 0]
    bu = (tv * pv).sum(1) * inv
    qv = np.cross(tv, e1)
    bv = (qv @ d) * inv
    t = (e2 * qv).sum(1) * inv
    hit = ok & (bu >= 0) & (bv >= 0) & (bu + bv <= 1) & (t > 0)
    if not hit.any():
        return None
    return (cam_pos + d * t[hit].min()).tolist()


out = {}
for k, (u, v, vis) in found.items():
    p = cast(u, v)
    out[k] = p
    out[k + '_pixel'] = [round(u, 1), round(v, 1), round(vis, 3)]
    print(f'{k}: pixel {u:.0f},{v:.0f} (seen {vis:.2f}) -> {None if p is None else np.round(p, 4).tolist()}')
if None in (out['nose'], out['eye_l'], out['eye_r']):
    sys.exit('a landmark missed the mesh')
print(f"eyes {np.linalg.norm(np.subtract(out['eye_l'], out['eye_r'])):.4f} apart; nose {out['nose'][1] - (out['eye_l'][1] + out['eye_r'][1]) / 2:+.4f} below the eyes")
dst = a.out or os.path.join(os.path.dirname(os.path.abspath(a.head)), 'landmarks.json')
json.dump(out, open(dst, 'w'), indent=1)
print('wrote', dst)
