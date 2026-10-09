"""Blemishes of a figure smoothed away, region by region (the lumps a voxel grid leaves, the ring where a head or a hand was set on, eyelids and
brows that are scraps of shell, the picture's necklace as a bump, the speckle at a heel).

  blender -b --python scripts/blender/smooth_regions.py -- <in.glb> <out.glb> [--only neck,eye_l,...]
  project_picture.py ... --smooth 1      (the better way: on the high-resolution solid, before it is reduced and unwrapped)

Each region below is a box (the figure's own units, 0.894 tall, as Blender reads the .glb: +z up, the front at -y) with a soft edge and a number of
Laplacian passes: the points move towards the average of their neighbours, by their weight in the region. Copies of a point (a .glb splits its
vertices at the UV seams) are found by position and move together, so a seam doesn't open. Done on a finished 60k-triangle figure it leaves
jagged patches in a face (too few points in a region); done on the solid before the reduction it doesn't. The boxes are this figure's
(tp_bald, set up by fit_limbs.py): another figure's want looking at first (`debug-shots/part_view.mjs`).
"""
import os
import sys

import bpy
import numpy as np


# name: (x range, y range, z range, soft edge, passes, step)
REGIONS = {
    'body': ((-0.32, 0.32), (-1, 1), (-0.37, 0.30), 0.02, 4, 0.5),  # torso, arms to the wrists, legs to the ankles: the voxel lumps
    'neck': ((-0.075, 0.075), (-1, 1), (0.298, 0.328), 0.008, 120, 0.6),  # the ring where the head was set on
    'eye_l': ((0.008, 0.05), (-1, 0.005), (0.368, 0.41), 0.006, 50, 0.6),  # lids, lashes, brows: scraps of shell (a box each, the bridge of the nose between them kept)
    'eye_r': ((-0.05, -0.008), (-1, 0.005), (0.368, 0.41), 0.006, 50, 0.6),
    'glabella': ((-0.014, 0.014), (-1, 0.005), (0.392, 0.425), 0.005, 40, 0.6),  # the scrap of brow left between the two boxes
    'pendant': ((-0.035, 0.035), (-1, 0.0), (0.262, 0.298), 0.01, 80, 0.6),  # the picture's necklace
    'heel_l': ((0.10, 0.22), (0.035, 1), (-0.46, -0.385), 0.01, 20, 0.6),  # the speckle at the back of the heel
    'heel_r': ((-0.22, -0.10), (0.035, 1), (-0.46, -0.385), 0.01, 20, 0.6),
}


def weight(pos, box):
    (x0, x1), (y0, y1), (z0, z1), edge = box[:4]
    w = np.ones(len(pos))
    for k, (lo, hi) in enumerate(((x0, x1), (y0, y1), (z0, z1))):
        if hi - lo > 100:
            continue
        t = np.minimum(pos[:, k] - lo, hi - pos[:, k]) / edge
        w *= np.clip(t, 0, 1)
    return w


def smooth_points(P, edges, regions=REGIONS, only=None, log=print):
    """The points P (n, 3) moved by each region's passes. `edges` (e, 2): any mesh's edges; points at the same place (the copies a UV seam
    makes) are one point here and move together."""
    key = np.round(P / 1e-6).astype(np.int64)
    _, weld, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel()
    m = len(weld)
    e = inv[np.asarray(edges)]
    e = e[e[:, 0] != e[:, 1]]
    pair = np.unique(np.concatenate([e, e[:, ::-1]]), axis=0)
    deg = np.bincount(pair[:, 0], minlength=m).astype(float)
    W = P[weld]
    for name, box in regions.items():
        if only and name not in only:
            continue
        w = weight(W, box)
        inside = w > 0
        if not inside.any():
            log(f'REGION {name}: nothing in it')
            continue
        before = W.copy()
        for _ in range(box[4]):
            total = np.zeros_like(W)
            np.add.at(total, pair[:, 0], W[pair[:, 1]])
            avg = total / np.maximum(deg, 1)[:, None]
            W = W + (avg - W) * (box[5] * w)[:, None]
        moved = np.linalg.norm(W - before, axis=1)
        log(f'REGION {name}: {int(inside.sum())} points, {box[4]} passes, the largest move {moved.max():.4f}, the mean {moved[inside].mean():.4f}')
    return W[inv]


if __name__ == '__main__':
    args = [a for a in sys.argv[sys.argv.index('--') + 1 :] if not a.startswith('--')]
    src, out = (os.path.abspath(a) for a in args[:2])
    ONLY = sys.argv[sys.argv.index('--only') + 1].split(',') if '--only' in sys.argv else None
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=src)
    ob = max((o for o in bpy.context.scene.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
    mesh = ob.data
    P = np.empty(len(mesh.vertices) * 3, np.float64)
    mesh.vertices.foreach_get('co', P)
    ed = np.empty(len(mesh.edges) * 2, np.int64)
    mesh.edges.foreach_get('vertices', ed)
    P2 = smooth_points(P.reshape(-1, 3), ed.reshape(-1, 2), only=ONLY)
    mesh.vertices.foreach_set('co', P2.astype(np.float32).ravel())
    mesh.update()
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_image_format='JPEG')
    print('WROTE', out)
