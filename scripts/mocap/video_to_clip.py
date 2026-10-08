"""
A video of one person, as an animation clip for the cast: motion capture from an ordinary camera.

It finds the body in each frame with Google's MediaPipe Pose Landmarker (the framework and the model are both under the
Apache License 2.0: the model's card, "BlazePose GHUM 3D", says so; so what it makes is ours to use), turns the 33
points it gives into the turn of each bone, and writes a clip in the shape the animation library's files have
(assets/anims/, scripts/anims/cmu.mjs), so models/characterAnims.ts fits it to any character.

Run it with the Python that has MediaPipe (a virtual environment beside this repo, ../mocap-tools: `python -m venv
.venv`, then `pip install mediapipe opencv-python numpy`, and the model saved as models/pose_landmarker_heavy.task
from storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/; MOCAP_TOOLS says
where if it's elsewhere):

  ../mocap-tools/.venv/Scripts/python.exe scripts/mocap/video_to_clip.py <video> [name]
      [--from s] [--to s]   the part of the video to use (seconds)
      [--loop]              close the end onto the start (for a cycle: a walk, an idle)
      [--smooth s]          how much the points are smoothed, as a time (0.07 s; more hides jitter and softens snaps)
      [--hands]             take the hands' turn from their own points (noisy; they go with the forearm otherwise)
      [--out dir]           where the clip goes (debug-shots/mocap/, git-ignored)

It writes <out>/<name>.glb with one clip, <name>, and prints how well the body was seen. To look at it on a character:
/anims.html?extra=/debug-shots/mocap/<name>.glb (the clip is added to the page's list), or
`node debug-shots/animsheet.mjs <dir> <character> <name> 8 debug-shots/mocap/<name>.glb` for a sheet of stills. A take
worth keeping is moved into assets/anims/ by the user's say-so, like any other design.

Filming, for a take that works: one person, all of them in frame the whole time, head included, within about 4 m; the
camera still, level, at about chest height; plain clothes that aren't the background's colour; facing the camera or
at a three-quarter angle (side on, the far arm and leg are hidden and guessed). What it gets wrong: depth is the
weak axis (a limb coming straight at the camera is foreshortened, and its length is put back by rule, not seen);
the hips don't travel (the figure stays over one spot: its height comes from whichever foot is lower); the fingers
aren't seen; and it isn't a studio's capture (compare assets/anims/cmu_*.glb): good for a gesture or a pose, a rough
draft of a walk.
"""
import argparse
import json
import math
import os
import struct
import sys

import cv2
import mediapipe as mp
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
TOOLS = os.environ.get("MOCAP_TOOLS", os.path.join(os.path.dirname(ROOT), "mocap-tools"))
MODEL = os.path.join(TOOLS, "models", "pose_landmarker_heavy.task")
RATE = 30

# The model's points (its own numbering).
NOSE, L_EAR, R_EAR = 0, 7, 8
L_SH, R_SH, L_EL, R_EL, L_WR, R_WR = 11, 12, 13, 14, 15, 16
L_PINKY, R_PINKY, L_INDEX, R_INDEX = 17, 18, 19, 20
L_HIP, R_HIP, L_KNEE, R_KNEE, L_ANK, R_ANK = 23, 24, 25, 26, 27, 28
L_HEEL, R_HEEL, L_TOE, R_TOE = 29, 30, 31, 32

X = np.array([1.0, 0.0, 0.0])
Y = np.array([0.0, 1.0, 0.0])
Z = np.array([0.0, 0.0, 1.0])


def unit(v):
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-9)


def frame(along, side):
    """A bone's axes as a rotation: y along it, x to the given side of it (made square to y), z the third."""
    y = unit(along)
    x = unit(side - (side * y).sum(-1, keepdims=True) * y)
    z = np.cross(x, y)
    return np.stack([x, y, z], axis=-1)


def arc(a, b):
    """The rotation (matrices) that takes unit vectors a to b the short way."""
    v = np.cross(a, b)
    c = (a * b).sum(-1)
    k = np.zeros(a.shape[:-1] + (3, 3))
    k[..., 0, 1], k[..., 0, 2], k[..., 1, 0] = -v[..., 2], v[..., 1], v[..., 2]
    k[..., 1, 2], k[..., 2, 0], k[..., 2, 1] = -v[..., 0], -v[..., 1], v[..., 0]
    return np.eye(3) + k + k @ k / np.maximum(1 + c, 1e-6)[..., None, None]


def quat(m):
    """Rotation matrices as quaternions (x, y, z, w), each on the same side as the one before."""
    out = np.zeros(m.shape[:-2] + (4,))
    for i in np.ndindex(m.shape[:-2]):
        r = m[i]
        t = np.trace(r)
        if t > 0:
            s = math.sqrt(t + 1) * 2
            q = [(r[2, 1] - r[1, 2]) / s, (r[0, 2] - r[2, 0]) / s, (r[1, 0] - r[0, 1]) / s, s / 4]
        elif r[0, 0] > r[1, 1] and r[0, 0] > r[2, 2]:
            s = math.sqrt(1 + r[0, 0] - r[1, 1] - r[2, 2]) * 2
            q = [s / 4, (r[0, 1] + r[1, 0]) / s, (r[0, 2] + r[2, 0]) / s, (r[2, 1] - r[1, 2]) / s]
        elif r[1, 1] > r[2, 2]:
            s = math.sqrt(1 + r[1, 1] - r[0, 0] - r[2, 2]) * 2
            q = [(r[0, 1] + r[1, 0]) / s, s / 4, (r[1, 2] + r[2, 1]) / s, (r[0, 2] - r[2, 0]) / s]
        else:
            s = math.sqrt(1 + r[2, 2] - r[0, 0] - r[1, 1]) * 2
            q = [(r[0, 2] + r[2, 0]) / s, (r[1, 2] + r[2, 1]) / s, s / 4, (r[1, 0] - r[0, 1]) / s]
        out[i] = q
    for f in range(1, len(out)):
        if (out[f] * out[f - 1]).sum() < 0:
            out[f] = -out[f]
    return out


def tidy(m):
    """The nearest true rotations to some matrices that have drifted from being one (after blending or smoothing)."""
    u, _, vt = np.linalg.svd(m)
    d = np.sign(np.linalg.det(u @ vt))
    u[..., :, 2] *= d[..., None]
    return u @ vt


def blur(a, sigma):
    """Smooths along the first axis (time) with a Gaussian of `sigma` frames, the ends held."""
    if sigma <= 0:
        return a
    r = max(1, int(sigma * 3))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    pad = np.concatenate([np.repeat(a[:1], r, 0), a, np.repeat(a[-1:], r, 0)])
    return np.stack([np.tensordot(k, pad[i : i + 2 * r + 1], axes=(0, 0)) for i in range(len(a))])


def track(video, start, end):
    """The body's points through the video: times, points (frame, 33, 3) in metres about the hips, and how sure each is."""
    if not os.path.exists(MODEL):
        sys.exit(f"no model at {MODEL}: see this script's header")
    opts = mp.tasks.vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(model_asset_path=MODEL),
        running_mode=mp.tasks.vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.4,
        min_pose_presence_confidence=0.4,
        min_tracking_confidence=0.4,
    )
    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    times, points, sure, where = [], [], [], []
    seen = 0
    with mp.tasks.vision.PoseLandmarker.create_from_options(opts) as finder:
        i = 0
        while True:
            ok, bgr = cap.read()
            if not ok:
                break
            t = i / fps
            i += 1
            if t < start or (end is not None and t > end):
                continue
            # A small picture finds less: the model looks at a 256 px crop of the body.
            h, w = bgr.shape[:2]
            if h < 480:
                bgr = cv2.resize(bgr, (int(w * 480 / h), 480), interpolation=cv2.INTER_CUBIC)
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
            found = finder.detect_for_video(image, int(t * 1000))
            seen += 1
            if not found.pose_world_landmarks:
                continue
            lm = found.pose_world_landmarks[0]
            # Its axes are the picture's: x to the picture's right, y down, z away from the camera. Ours: y up, and z
            # towards the camera, so someone facing it faces +z with their left at +x.
            times.append(t)
            points.append([[p.x, -p.y, -p.z] for p in lm])
            sure.append([p.visibility for p in lm])
            # Where across the picture the hips are (0 its left edge, 1 its right), for the angle they're seen from.
            flat = found.pose_landmarks[0]
            where.append((flat[L_HIP].x + flat[R_HIP].x) / 2)
    cap.release()
    return np.array(times), np.array(points), np.array(sure), np.array(where), seen, fps


def solve(P, hands):
    """Each bone's turn from the rest pose (arms out, legs straight down, facing +z), frame by frame, from the points."""
    n = len(P)
    hipL, hipR, shL, shR = P[:, L_HIP], P[:, R_HIP], P[:, L_SH], P[:, R_SH]
    pelvis_at = (hipL + hipR) / 2
    neck_at = (shL + shR) / 2
    up = neck_at - pelvis_at
    W = {}
    W["pelvis"] = frame(up, hipL - hipR)
    W["spine_03"] = frame(up, shL - shR)
    # The head: its left from the ears, its front from the nose (which sits a little below the ears' line: the same
    # is allowed for at rest), its up square to both.
    ears = (P[:, L_EAR] + P[:, R_EAR]) / 2
    left = P[:, L_EAR] - P[:, R_EAR]
    rest_front = unit(np.array([0.0, -0.03, 0.10]))
    head = frame(np.cross(P[:, NOSE] - ears, left), left)
    W["head"] = head @ frame(np.cross(rest_front, X), X).T
    # (The face is a few points close together, and which way it's tipped is the least sure thing there is: the
    # head's turn is kept only as how it differs from its own middle against the chest, so on the whole it looks
    # where the chest faces, and a nod or a look aside is still a nod or a look aside.)
    against = np.swapaxes(W["spine_03"], -1, -2) @ W["head"]
    W["head"] = W["spine_03"] @ against @ tidy(against.mean(axis=0)).T
    for a, b, name, k in [("pelvis", "spine_03", "spine_01", 1 / 3), ("pelvis", "spine_03", "spine_02", 2 / 3), ("spine_03", "head", "neck_01", 0.5)]:
        W[name] = tidy(W[a] * (1 - k) + W[b] * k)

    def limb(name, mid, end, root, parent, rest_along, rest_hinge, a, b, c):
        """An upper and a lower bone with a hinge between (shoulder-elbow-wrist, hip-knee-ankle)."""
        upper = unit(P[:, b] - P[:, a])
        lower = unit(P[:, c] - P[:, b])
        # The hinge's axis is square to both bones while the joint is bent. Near straight it can't be seen, and is
        # taken as where the rest pose's would be with the upper bone swung the short way to where it points.
        bent = np.cross(upper, lower)
        angle = np.arcsin(np.clip(np.linalg.norm(bent, axis=-1), 0, 1))
        w = np.clip((angle - math.radians(10)) / math.radians(20), 0, 1)[:, None]
        base = W[parent]
        guess = np.einsum("fij,fj->fi", arc(np.einsum("fij,j->fi", base, rest_along), upper) @ base, np.broadcast_to(rest_hinge, upper.shape))
        hinge = unit(w * unit(bent) + (1 - w) * guess)
        rest = frame(rest_along, rest_hinge).T
        W[name] = frame(upper, hinge) @ rest
        W[mid] = frame(lower, hinge) @ rest
        return hinge

    for s, sign, hip, knee, ank, heel, toe, sh, el, wr, pinky, index in [("l", 1, L_HIP, L_KNEE, L_ANK, L_HEEL, L_TOE, L_SH, L_EL, L_WR, L_PINKY, L_INDEX), ("r", -1, R_HIP, R_KNEE, R_ANK, R_HEEL, R_TOE, R_SH, R_EL, R_WR, R_PINKY, R_INDEX)]:
        # (At rest the arm lies along x and bends forward, the leg hangs down and bends back.)
        limb(f"upperarm_{s}", f"lowerarm_{s}", None, None, "spine_03", sign * X, -sign * Y, sh, el, wr)
        limb(f"thigh_{s}", f"calf_{s}", None, None, "pelvis", -Y, X, hip, knee, ank)
        W[f"clavicle_{s}"] = W["spine_03"]
        # The foot from heel to toe, its up from the ankle above them.
        W[f"foot_{s}"] = frame(P[:, toe] - P[:, heel], np.cross(P[:, ank] - P[:, heel], P[:, toe] - P[:, heel]) * -1) @ frame(Z, X).T
        W[f"ball_{s}"] = W[f"foot_{s}"]
        if hands:
            knuckles = (P[:, pinky] + P[:, index]) / 2
            W[f"hand_{s}"] = frame(knuckles - P[:, wr], np.cross(knuckles - P[:, wr], P[:, index] - P[:, pinky])) @ frame(sign * X, np.cross(sign * X, Z)).T
        else:
            W[f"hand_{s}"] = W[f"lowerarm_{s}"]
    return W


PARENT = {"pelvis": None, "spine_01": "pelvis", "spine_02": "spine_01", "spine_03": "spine_02", "neck_01": "spine_03", "head": "neck_01"}
for _s in "lr":
    PARENT.update({f"clavicle_{_s}": "spine_03", f"upperarm_{_s}": f"clavicle_{_s}", f"lowerarm_{_s}": f"upperarm_{_s}", f"hand_{_s}": f"lowerarm_{_s}", f"thigh_{_s}": "pelvis", f"calf_{_s}": f"thigh_{_s}", f"foot_{_s}": f"calf_{_s}", f"ball_{_s}": f"foot_{_s}"})


def write_glb(path, name, rest, W, hips):
    """The clip as a .glb in the library's shape: Root, then the cast's bones at rest, a rotation track each, the pelvis's travel."""
    bones = list(PARENT)
    nodes = [{"name": "Root", "children": [1]}]
    for b in bones:
        p = PARENT[b]
        at = rest[b] - (rest[p] if p else np.zeros(3))
        nodes.append({"name": b, "translation": [float(v) for v in at], "children": [bones.index(c) + 1 for c in bones if PARENT[c] == b]})
    for nd in nodes:
        if not nd["children"]:
            del nd["children"]
    blob = bytearray()
    views, accessors, samplers, channels = [], [], [], []

    def add(arr, kind):
        data = np.ascontiguousarray(arr, dtype="<f4").tobytes()
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)})
        blob.extend(data)
        acc = {"bufferView": len(views) - 1, "componentType": 5126, "count": len(arr), "type": kind}
        if kind == "SCALAR":
            acc["min"], acc["max"] = [float(arr.min())], [float(arr.max())]
        accessors.append(acc)
        return len(accessors) - 1

    n = len(hips)
    times = add(np.arange(n) / RATE, "SCALAR")

    def channel(node, path, values, kind):
        samplers.append({"input": times, "output": add(values, kind), "interpolation": "LINEAR"})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": path}})

    channel(1, "translation", hips, "VEC3")
    for i, b in enumerate(bones):
        p = PARENT[b]
        local = W[b] if p is None else np.swapaxes(W[p], -1, -2) @ W[b]
        channel(i + 1, "rotation", quat(local), "VEC4")
    doc = {
        "asset": {"version": "2.0", "generator": "a-rainy-place-to-die scripts/mocap/video_to_clip.py"},
        "scene": 0,
        "scenes": [{"name": "Scene", "nodes": [0]}],
        "nodes": nodes,
        "animations": [{"name": name, "samplers": samplers, "channels": channels}],
        "buffers": [{"byteLength": len(blob)}],
        "bufferViews": views,
        "accessors": accessors,
    }
    text = json.dumps(doc, separators=(",", ":")).encode()
    text += b" " * (-len(text) % 4)
    blob.extend(b"\0" * (-len(blob) % 4))
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(text) + 8 + len(blob)))
        f.write(struct.pack("<I4s", len(text), b"JSON") + text)
        f.write(struct.pack("<I4s", len(blob), b"BIN\0") + bytes(blob))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("name", nargs="?")
    ap.add_argument("--from", dest="start", type=float, default=0)
    ap.add_argument("--to", dest="end", type=float)
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--smooth", type=float, default=0.07)
    ap.add_argument("--hands", action="store_true")
    ap.add_argument("--fov", type=float, default=60, help="the camera's angle of view across the picture, degrees")
    ap.add_argument("--keep-lean", action="store_true", help="don't level the take by the trunk's middle lean")
    ap.add_argument("--out", default=os.path.join(ROOT, "debug-shots", "mocap"))
    a = ap.parse_args()
    name = a.name or os.path.splitext(os.path.basename(a.video))[0]
    name = "".join(c if c.isalnum() or c == "_" else "_" for c in name)

    times, raw, sure, where, looked, fps = track(a.video, a.start, a.end)
    if len(times) < 8:
        sys.exit(f"the body was found in {len(times)} of {looked} frames: not enough to work with")
    # The longest stretch it was seen in without a gap of more than a fifth of a second.
    cuts = [0] + [i for i in range(1, len(times)) if times[i] - times[i - 1] > 0.2] + [len(times)]
    lo, hi = max(zip(cuts[:-1], cuts[1:]), key=lambda c: c[1] - c[0])
    times, raw, sure, where = times[lo:hi], raw[lo:hi], sure[lo:hi], where[lo:hi]
    # At the library's rate.
    n = int((times[-1] - times[0]) * RATE) + 1
    at = times[0] + np.arange(n) / RATE
    P = np.stack([[np.interp(at, times, raw[:, j, k]) for k in range(3)] for j in range(33)]).transpose(2, 0, 1)
    P = blur(P, a.smooth * RATE)

    def about_y(angle):
        c, s_ = np.cos(angle), np.sin(angle)
        o, i = np.zeros_like(c), np.ones_like(c)
        return np.stack([np.stack([c, o, s_], -1), np.stack([o, i, o], -1), np.stack([-s_, o, c], -1)], -2)

    # The model sees the body as if it were in the middle of the picture: someone off to one side is seen from
    # that much round them, so as they cross the picture they seem to turn. Each frame is turned back by the angle
    # the camera looks at them from.
    bearing = np.arctan((blur(np.interp(at, times, where)[:, None], a.smooth * RATE)[:, 0] - 0.5) * 2 * math.tan(math.radians(a.fov) / 2))
    P = np.einsum("fij,fpj->fpi", about_y(-bearing), P)

    # Levelled: a camera tipped down, or the model's own habit, leans the whole body one way all through. Most
    # takes are of someone upright on the whole, so the middle of the trunk's lean is taken out of everything.
    lean = 0.0
    if not a.keep_lean:
        up = unit(np.median((P[:, L_SH] + P[:, R_SH]) / 2 - (P[:, L_HIP] + P[:, R_HIP]) / 2, axis=0))
        lean = math.degrees(math.acos(min(1, up[1])))
        if lean < 25:
            P = P @ arc(up, Y).T

    # Turned about the vertical so that, on the whole, the hips face +z (whichever way the camera saw them from).
    across = unit((P[:, L_HIP] - P[:, R_HIP]) * [1, 0, 1])
    ahead = np.median(np.cross(across, Y), axis=0)
    yaw = -math.atan2(ahead[0], ahead[2])
    turn = np.array([[math.cos(yaw), 0, math.sin(yaw)], [0, 1, 0], [-math.sin(yaw), 0, math.cos(yaw)]])
    P = P @ turn.T

    # How long each bone is, as the middle of what was seen: a length that changes from frame to frame is the depth
    # being guessed, and is the measure of how far to trust the take.
    def length(i, j):
        d = np.linalg.norm(P[:, i] - P[:, j], axis=-1)
        return float(np.median(d)), float(np.std(d) / max(np.median(d), 1e-6))

    L = {k: length(*v) for k, v in {"thigh": (L_HIP, L_KNEE), "shin": (L_KNEE, L_ANK), "upper": (L_SH, L_EL), "fore": (L_EL, L_WR), "hips": (L_HIP, R_HIP), "shoulders": (L_SH, R_SH)}.items()}
    trunk = float(np.median(np.linalg.norm((P[:, L_SH] + P[:, R_SH]) / 2 - (P[:, L_HIP] + P[:, R_HIP]) / 2, axis=-1)))
    ankle = float(np.median(np.minimum(P[:, L_ANK, 1] - np.minimum(P[:, L_HEEL, 1], P[:, L_TOE, 1]), P[:, R_ANK, 1] - np.minimum(P[:, R_HEEL, 1], P[:, R_TOE, 1]))))
    ankle = min(max(ankle, 0.04), 0.12)
    standing = L["thigh"][0] + L["shin"][0] + ankle

    W = solve(P, a.hands)
    # The hips over one spot, as high as the lower foot puts them (the points are about the hips, with no floor).
    feet = np.minimum.reduce([P[:, i, 1] for i in (L_HEEL, R_HEEL, L_TOE, R_TOE)])
    height = blur(-feet[:, None], a.smooth * RATE * 1.5)[:, 0]
    hips = np.stack([np.zeros(n), height, np.zeros(n)], axis=-1)

    if a.loop:
        # The gap between the end and the start, spread over the clip.
        u = (np.arange(n) / (n - 1))[:, None, None]
        for b in W:
            gap = W[b][0] @ W[b][-1].T
            # (A part of a rotation: its matrix blended towards none and squared up, which is enough for a small one.)
            W[b] = tidy(np.eye(3) * (1 - u) + gap * u) @ W[b]
        hips[:, 1] -= (hips[-1, 1] - hips[0, 1]) * u[:, 0, 0]

    # The skeleton at rest: arms out along x, legs straight down, facing +z, of this person's own lengths.
    rest = {"pelvis": np.array([0, standing, 0.0])}
    for i, b in enumerate(["spine_01", "spine_02", "spine_03"]):
        rest[b] = rest["pelvis"] + Y * trunk * (0.12, 0.4, 0.68)[i]
    rest["neck_01"] = rest["pelvis"] + Y * trunk
    rest["head"] = rest["neck_01"] + Y * 0.1
    for s, sign in (("l", 1), ("r", -1)):
        rest[f"clavicle_{s}"] = rest["neck_01"] + X * sign * 0.02
        rest[f"upperarm_{s}"] = rest["neck_01"] + X * sign * L["shoulders"][0] / 2
        rest[f"lowerarm_{s}"] = rest[f"upperarm_{s}"] + X * sign * L["upper"][0]
        rest[f"hand_{s}"] = rest[f"lowerarm_{s}"] + X * sign * L["fore"][0]
        rest[f"thigh_{s}"] = rest["pelvis"] + X * sign * L["hips"][0] / 2
        rest[f"calf_{s}"] = rest[f"thigh_{s}"] - Y * L["thigh"][0]
        rest[f"foot_{s}"] = rest[f"calf_{s}"] - Y * L["shin"][0]
        rest[f"ball_{s}"] = rest[f"foot_{s}"] + np.array([0, -ankle * 0.8, 0.13])

    os.makedirs(a.out, exist_ok=True)
    path = os.path.join(a.out, f"{name}.glb")
    write_glb(path, name, rest, W, hips)
    wobble = max(v[1] for v in L.values())
    facing = np.degrees(np.arctan2(W["pelvis"][:, 0, 2], W["pelvis"][:, 2, 2]))
    limbs = [L_SH, R_SH, L_EL, R_EL, L_WR, R_WR, L_HIP, R_HIP, L_KNEE, R_KNEE, L_ANK, R_ANK]
    print(path)
    print(f"  {n} frames, {(n - 1) / RATE:.2f} s, from {times[0]:.2f} s of the video ({fps:.0f} frames a second); the body found in {len(raw)} of {looked} frames looked at")
    print(f"  seen: the limbs' points {np.mean(sure[:, limbs]):.2f} sure on the whole, the least sure joint {np.min(np.mean(sure[:, limbs], axis=0)):.2f} (1 is in plain sight)")
    print(f"  levelled by {lean:.0f} degrees{' (left as it is: too much to be the camera)' if lean >= 25 else ''}; the hips face within {np.min(facing):.0f} to {np.max(facing):.0f} degrees of ahead")
    print(f"  the person: legs {L['thigh'][0] + L['shin'][0]:.2f} m, arms {L['upper'][0] + L['fore'][0]:.2f} m; bone lengths vary by up to {wobble * 100:.0f}% (under 6% is a clean take, over 12% the depth is being guessed)")


if __name__ == "__main__":
    main()
