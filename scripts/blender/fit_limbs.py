"""A generated body with its hands and feet replaced by ones generated from close-up pictures of them (a trial: where the cuts fall, how the sizes match).

  blender -b --python scripts/blender/fit_limbs.py -- <body.glb> <hand.glb> <foot.glb> <out.glb> [--wrist-x 0.335] [--ankle-z -0.36] [--foot-length 0.145] [--foot-is-left 0|1] [--head head.glb]

body.glb    the figure's shape from the Pixal3D worker, a T-pose seen from the front (+y up in the glb, the pictured side +z)
hand.glb    a right hand and forearm from a close-up, palm to the camera, fingers to the picture's left, thumb up
foot.glb    a foot and shin from a close-up from the side, toes to the picture's right: a RIGHT foot unless --foot-is-left 1 (it went on as a left one first and the user saw the feet were on backwards: from above the longest toe lay on the outside of both)
head.glb    (with --head) a bald head and shoulders from a close-up, face to the camera: set on at the neck, scaled by its neck against the body's
out.glb     the body cut at the wrists and ankles, with the new hands and feet cut at the same planes and set on, in the body's own
            frame: one file for project_picture.py, whose grid joins pieces that meet without overlapping (a ray through a nested
            pair of surfaces would count the shell between them as outside, so the pieces are cut, not overlapped)
Each part is turned to the figure's pose (palm down, thumb forward; toes forward, turned as the body's own foot is), scaled to the
body's cross-section at the cut (the hand), or to a foot length of --foot-length of the figure's height (the foot, which a
cross-section at the shin would size by a tapering), and its cut face centred on the body's. Prints what it measured.
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np

args = [a for a in sys.argv[sys.argv.index('--') + 1 :] if not a.startswith('--')]
body_file, hand_file, foot_file, out = (os.path.abspath(a) for a in args[:4])
opt = lambda k, d: float(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d  # noqa: E731
WRIST_X, ANKLE_Z, FOOT_LEN = opt('--wrist-x', 0.335), opt('--ankle-z', -0.36), opt('--foot-length', 0.145)
FOOT_IS_LEFT = opt('--foot-is-left', 0) > 0
bpy.ops.wm.read_factory_settings(use_empty=True)


def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    ob = max((o for o in bpy.data.objects if o not in before and o.type == 'MESH'), key=lambda o: len(o.data.vertices))
    for o in list(bpy.data.objects):
        if o not in before and o is not ob:
            bpy.data.objects.remove(o)
    ob.parent = None
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


def verts(ob):
    a = np.empty(len(ob.data.vertices) * 3, np.float64)
    ob.data.vertices.foreach_get('co', a)
    return a.reshape(-1, 3)


def put(ob, p, mirror_x=False):
    ob.data.vertices.foreach_set('co', p.astype(np.float32).ravel())
    ob.data.update()
    if mirror_x:  # x -> -x turns every face inside out
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
        bm.to_mesh(ob.data)
        bm.free()
        ob.data.update()


def duplicate(ob, name):
    c = ob.copy()
    c.data = ob.data.copy()
    c.name = name
    bpy.context.scene.collection.objects.link(c)
    return c


def cut(ob, co, no, remove):
    """Remove the side of the plane `remove` ('positive' or 'negative' along no)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-6, plane_co=co, plane_no=no, clear_outer=remove == 'positive', clear_inner=remove == 'negative')
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def slab(p, axis, value, half=0.006):
    s = p[np.abs(p[:, axis] - value) < half]
    return s


def section(p, axis, value, half=0.006, within=None, mean=False):
    """(centre of the two other axes, their extents) of the slab of points at p[:, axis] == value."""
    s = slab(p, axis, value, half)
    if within is not None:
        s = s[within(s)]
    others = [a for a in range(3) if a != axis]
    lo, hi = s[:, others].min(axis=0), s[:, others].max(axis=0)
    return np.insert(s[:, others].mean(axis=0) if mean else (lo + hi) / 2, axis, value), hi - lo


def match(q, axis, value, target, centre, length, axes=(0, 1)):
    """Scale a piece's cross-section at the cut to the body's (a ridge shows where they differ), the correction fading to nothing `length` away from the cut."""
    others = [a for a in range(3) if a != axis]
    _, have = section(q, axis, value, half=0.004)
    f = np.clip(1 - np.abs(q[:, axis] - value) / length, 0, 1)
    f = f * f * (3 - 2 * f)
    for k, a in enumerate(others):
        if k not in axes:
            continue
        q[:, a] = centre[k] + (q[:, a] - centre[k]) * (1 + (target[k] / have[k] - 1) * f)
    return q


body = load(body_file)
bp = verts(body)
floor = float(bp[:, 2].min())
height = float(bp[:, 2].max() - floor)
print(f'BODY {len(bp)} points, {height:.3f} tall, floor z {floor:.3f}')

# ---- what the body has at its cuts
arm_ok = lambda s: s[:, 2] > 0.1  # noqa: E731
wrist, wrist_ext, ankle, ankle_ext, toes = {}, {}, {}, {}, {}
for sign in (-1, 1):
    wrist[sign], wrist_ext[sign] = section(bp, 0, sign * WRIST_X, within=arm_ok)
    leg = lambda s, sg=sign: (s[:, 0] * sg > 0.02)  # noqa: E731
    ankle[sign], ankle_ext[sign] = section(bp, 2, ANKLE_Z, within=leg)
    foot_pts = bp[(bp[:, 2] < floor + 0.04) & (bp[:, 0] * sign > 0.02)]
    xy = foot_pts[:, :2] - foot_pts[:, :2].mean(axis=0)
    w, v = np.linalg.eigh(np.cov(xy.T))
    d = v[:, np.argmax(w)]
    if d[1] > 0:
        d = -d  # toes toward the viewer (-y)
    toes[sign] = math.atan2(d[0], -d[1])  # radians the toes lie turned from straight forward, + toward +x
    print(f'SIDE {sign:+d}: wrist at {np.round(wrist[sign], 3)} ({np.round(wrist_ext[sign], 3)}), ankle at {np.round(ankle[sign], 3)} ({np.round(ankle_ext[sign], 3)}), toes turned {math.degrees(toes[sign]):.0f} deg')

hand = load(hand_file)
foot = load(foot_file)

# ---- the hand: palm down, thumb forward, scaled by its wrist
hp = verts(hand)
hp = np.stack([hp[:, 0], -hp[:, 2], hp[:, 1]], axis=1)  # a quarter turn about x
xs = np.arange(0.1, 0.42, 0.01)
area = []
for x in xs:
    _, e = section(hp, 0, x, half=0.005)
    area.append(e[0] * e[1])
hx = float(xs[int(np.argmin(area))])
hc, he = section(hp, 0, hx, half=0.005)
scale_hand = math.sqrt((wrist_ext[-1][0] * wrist_ext[-1][1] + wrist_ext[1][0] * wrist_ext[1][1]) / 2 / (he[0] * he[1]))
print(f'HAND wrist at x {hx:.3f} ({np.round(he, 3)}), scaled {scale_hand:.3f}')
hp = (hp - hc) * scale_hand  # the right hand: wrist at the origin, fingers to -x
hand_left = duplicate(hand, 'hand_l')
for ob, sign in ((hand, -1), (hand_left, 1)):
    q = hp.copy()
    if sign > 0:
        q[:, 0] = -q[:, 0]
    q = q + wrist[sign]
    q = match(q, 0, sign * WRIST_X, wrist_ext[sign], wrist[sign][1:], 0.04)
    put(ob, q, mirror_x=sign > 0)
    cut(ob, (sign * WRIST_X, 0, 0), (sign, 0, 0), 'negative')

# ---- the foot: toes forward, turned as the body's own, sole on the body's floor, scaled to a foot length
fp = verts(foot)
fp = np.stack([fp[:, 1], -fp[:, 0], fp[:, 2]], axis=1)  # a quarter turn about z: toes (+x) to -y
length = float(fp[:, 1].max() - fp[:, 1].min())
scale_foot = FOOT_LEN * height / length
fp = fp * scale_foot
fp[:, 2] -= fp[:, 2].min()
fp[:, 2] += floor
# A foot pictured stepping has its heel up: bend it level at the ankle (the shin above stays as it is, the bend fading out to nothing at the cut).
rear = fp[fp[:, 1] > fp[:, 1].min() + 0.75 * (fp[:, 1].max() - fp[:, 1].min())]
front = fp[fp[:, 1] < fp[:, 1].min() + 0.25 * (fp[:, 1].max() - fp[:, 1].min())]
slope = (rear[:, 2].min() - front[:, 2].min()) / max(1e-6, rear[:, 1].mean() - front[:, 1].mean())
phi = -math.atan(slope) * (0 if '--no-level' in sys.argv else 1)
z_lo, z_hi = floor + 0.4 * (ANKLE_Z - floor), ANKLE_Z
t = np.clip((z_hi - fp[:, 2]) / (z_hi - z_lo), 0, 1)
w = t * t * (3 - 2 * t)
pivot_y, pivot_z = float(np.median(fp[np.abs(fp[:, 2] - ANKLE_Z) < 0.004, 1])), z_lo
ang = phi * w
dy, dz = fp[:, 1] - pivot_y, fp[:, 2] - pivot_z
fp[:, 1] = pivot_y + dy * np.cos(ang) - dz * np.sin(ang)
fp[:, 2] = pivot_z + dy * np.sin(ang) + dz * np.cos(ang)
fp[:, 2] += floor - fp[:, 2].min()
print(f'FOOT sole pitched {math.degrees(-phi):.0f} deg (heel up): bent level at the ankle')
fc, fe = section(fp, 2, ANKLE_Z, half=0.004)
print(f'FOOT length {length:.3f} scaled {scale_foot:.3f} to {FOOT_LEN * height:.3f}; its shin at the cut is {np.round(fe, 3)} (the body\'s {np.round(ankle_ext[1], 3)})')
fp = np.stack([fp[:, 0] - fc[0], fp[:, 1] - fc[1], fp[:, 2]], axis=1)  # the cut's centre on the axis
foot_other = duplicate(foot, 'foot_r')
w_bend = np.clip((ANKLE_Z - fp[:, 2]) / (ANKLE_Z - z_lo), 0, 1)
w_bend = w_bend * w_bend * (3 - 2 * w_bend)


def turn(v, axis, ang):
    """Rodrigues: the points v turned about the unit `axis` by `ang` (a number or one angle a point)."""
    ang = np.broadcast_to(np.asarray(ang, float), (len(v),))[:, None]
    c, s = np.cos(ang), np.sin(ang)
    return v * c + np.cross(axis, v) * s + axis * (v @ axis)[:, None] * (1 - c)


mirrored = lambda sign: (sign < 0) == FOOT_IS_LEFT  # noqa: E731  (a right foot goes on as it is at -x: the figure's right, the picture's left)
for ob, sign in ((foot, 1), (foot_other, -1)):
    q = fp.copy()
    if mirrored(sign):
        q[:, 0] = -q[:, 0]
    # turn the foot about the shin's axis by how far the body's toes are turned (mirrored for the other foot)
    ang = toes[sign]
    c, s = math.cos(ang), math.sin(ang)
    x, y = q[:, 0].copy(), q[:, 1].copy()
    q[:, 0], q[:, 1] = x * c + y * s, -x * s + y * c
    # the body's shin leans (the legs are apart): lean the piece's shin to it, and bend the foot back level below the ankle
    leg = lambda p, sg=sign: (p[:, 0] * sg > 0.02)  # noqa: E731
    lo_c = section(bp, 2, ANKLE_Z + 0.02, within=leg)[0]
    hi_c = section(bp, 2, ANKLE_Z + 0.07, within=leg)[0]
    d = hi_c - lo_c
    d /= np.linalg.norm(d)
    axis = np.cross([0, 0, 1], d)
    lean = math.atan2(np.linalg.norm(axis), d[2])
    if lean > 1e-4 and '--no-lean' not in sys.argv:
        axis /= np.linalg.norm(axis)
        c0 = np.array([0, 0, ANKLE_Z])
        q = c0 + turn(q - c0, axis, lean)
        pivot = c0 + turn((np.array([0, 0, z_lo]) - c0)[None], axis, lean)[0]
        q = pivot + turn(q - pivot, axis, -lean * w_bend)
        print(f'FOOT {sign:+d}: shin leaned {math.degrees(lean):.0f} deg to the body shin')
    q[:, 2] += floor - q[:, 2].min()
    cc, _ = section(q, 2, ANKLE_Z, half=0.004)
    q[:, 0] += ankle[sign][0] - cc[0]
    q[:, 1] += ankle[sign][1] - cc[1]
    q = match(q, 2, ANKLE_Z, ankle_ext[sign], ankle[sign][:2], 0.05)
    put(ob, q, mirror_x=mirrored(sign))
    cut(ob, (0, 0, ANKLE_Z), (0, 0, 1), 'positive')

# ---- the body, cut
for sign in (-1, 1):
    cut(body, (sign * WRIST_X, 0, 0), (sign, 0, 0), 'positive')
cut(body, (0, 0, ANKLE_Z), (0, 0, 1), 'negative')

pieces = [body, hand, hand_left, foot, foot_other]

if '--head' in sys.argv:
    # ---- the head: where the neck is narrowest, on the body and on the piece; scaled by those, set on, cut there
    head = load(os.path.abspath(sys.argv[sys.argv.index('--head') + 1]))
    hd = verts(head)
    top_b = float(bp[:, 2].max())

    def narrowest(p, lo, hi, within, step=0.005, half=0.006):
        best = None
        for z in np.arange(lo, hi, step):
            sl = slab(p, 2, z, half)
            sl = sl[within(sl)]
            if len(sl) < 20:
                continue
            e = np.ptp(sl[:, :2], axis=0)
            if best is None or e[0] * e[1] < best[0]:
                best = (e[0] * e[1], z)
        return best[1]

    # (The neck's narrowest point can't be found by measuring: on the body the chin is in the slab, on the piece the chin lies right
    # on the neck. They are given: a cut a little below each chin, and the piece's size from the head's, 0.19 = the mean of its height
    # (crown to chin against the body's, 0.171) and its width (ear to ear, 0.21), which is what a neck of 0.055 wide asks for too.)
    neck_b = opt('--neck-body', 0.323)
    neck_p = opt('--neck-piece', -0.223)
    k = opt('--head-scale', 0.19)
    nb = slab(bp, 2, neck_b, 0.006)
    nb = nb[np.abs(nb[:, 0]) < 0.07]
    cb = np.array([nb[:, 0].mean(), nb[:, 1].mean()])
    eb = np.ptp(nb[:, :2], axis=0)
    back_b = float(nb[:, 1].max())  # (the nape: the front of the neck is mixed up with the chin)
    npc = slab(hd, 2, neck_p, 0.01)
    hd = (hd - [npc[:, 0].mean(), 0, neck_p]) * k
    ns = slab(hd, 2, 0.0, 0.006)
    ns = ns[np.abs(ns[:, 0]) < 0.04]
    hd = hd + [cb[0], back_b - float(ns[:, 1].max()), neck_b]
    print(f'HEAD neck cut at z {neck_b:.3f} on the body ({np.round(eb, 3)} wide, nape at y {back_b:.3f}), {neck_p:.3f} on the piece (scaled by {k:.3f}); head then {float(hd[:, 2].max()) - neck_b:.3f} from cut to crown (the body has {top_b - neck_b:.3f})')
    hd = match(hd, 2, neck_b, eb, cb, 0.03, axes=(0,))
    put(head, hd)
    cut(head, (0, 0, neck_b), (0, 0, 1), 'negative')
    cut(body, (0, 0, neck_b), (0, 0, 1), 'positive')
    pieces.append(head)

bpy.ops.object.select_all(action='DESELECT')
for o in pieces:
    o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True)
print('WROTE', out)
