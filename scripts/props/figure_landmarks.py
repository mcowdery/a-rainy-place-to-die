"""Where a generated figure's joints are, from the picture it was made from: for scripts/blender/rig_figure.py.

  ../mocap-tools/.venv/Scripts/python.exe scripts/props/figure_landmarks.py <a mesh job's cutout.png> [--out joints.json]

The picture is the `cutout.png` a mesh job writes beside its .glb (scripts/props/mesh_endpoint.mjs): the figure as the
generator saw it, cut out, standing square on in an A-pose. MediaPipe's pose model (Apache 2.0, the one
scripts/mocap/video_to_clip.py uses; that script's header says how the environment is made) finds 33 points of the
body in it, and each is written as where it lies in the figure's own box: `u` across (0 the picture's left edge of
the figure, 1 its right) and `v` down (0 the top of the head, 1 the soles). The generator's mesh fills that same box
seen from the front, so the two numbers place a joint on the mesh; its depth is the mesh's own business.
"""
import argparse
import json
import os
import sys

import mediapipe as mp
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
TOOLS = os.environ.get("MOCAP_TOOLS", os.path.join(os.path.dirname(ROOT), "mocap-tools"))
MODEL = os.path.join(TOOLS, "models", "pose_landmarker_heavy.task")

NAMES = [
    "nose", "left_eye_inner", "left_eye", "left_eye_outer", "right_eye_inner", "right_eye", "right_eye_outer",
    "left_ear", "right_ear", "mouth_left", "mouth_right", "left_shoulder", "right_shoulder", "left_elbow",
    "right_elbow", "left_wrist", "right_wrist", "left_pinky", "right_pinky", "left_index", "right_index",
    "left_thumb", "right_thumb", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle",
    "left_heel", "right_heel", "left_foot_index", "right_foot_index",
]  # fmt: skip


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("picture")
    ap.add_argument("--out")
    args = ap.parse_args()
    im = Image.open(args.picture).convert("RGBA")
    alpha = np.asarray(im.getchannel("A")) > 127
    rows, cols = np.where(alpha.any(axis=1))[0], np.where(alpha.any(axis=0))[0]
    if len(rows) == 0 or alpha.mean() > 0.98:
        print("The picture has to be a cut-out (a mesh job's cutout.png): this one has no transparency to find the figure by.")
        return 1
    x0, x1, y0, y1 = cols[0], cols[-1] + 1, rows[0], rows[-1] + 1
    # On mid grey: the pose model was taught on photographs, not on figures floating in nothing.
    flat = Image.new("RGBA", im.size, (128, 128, 128, 255))
    flat.alpha_composite(im)
    pixels = np.ascontiguousarray(np.asarray(flat.convert("RGB")))
    opts = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=MODEL),
        running_mode=mp.tasks.vision.RunningMode.IMAGE,
        num_poses=1,
        min_pose_detection_confidence=0.4,
    )
    with mp.tasks.vision.PoseLandmarker.create_from_options(opts) as finder:
        found = finder.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=pixels))
    if not found.pose_landmarks:
        print("No body found in the picture.")
        return 1
    w, h = im.size
    joints = {}
    for name, p in zip(NAMES, found.pose_landmarks[0]):
        joints[name] = {"u": round((p.x * w - x0) / (x1 - x0), 5), "v": round((p.y * h - y0) / (y1 - y0), 5), "seen": round(float(p.visibility), 3)}
    out = args.out or os.path.join(os.path.dirname(os.path.abspath(args.picture)), "joints.json")
    with open(out, "w", encoding="utf8") as f:
        json.dump({"picture": os.path.abspath(args.picture), "box": [int(x0), int(x1), int(y0), int(y1)], "joints": joints}, f, indent=1)
    weak = [n for n, j in joints.items() if j["seen"] < 0.5 and not n.startswith(("left_eye", "right_eye", "mouth"))]
    print(out)
    print(f"  the figure's box {x0}-{x1} x {y0}-{y1} of {w}x{h}; shoulders at v {joints['left_shoulder']['v']:.3f}, hips {joints['left_hip']['v']:.3f}, knees {joints['left_knee']['v']:.3f}, ankles {joints['left_ankle']['v']:.3f}")
    if weak:
        print(f"  not seen well: {', '.join(weak)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
