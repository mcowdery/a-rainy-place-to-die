"""A painted colour texture moved onto another run's mesh of the same figure (hand painting survives a new generation).

  blender -b --python scripts/blender/transfer_texture.py -- <source.glb> <dest.glb> <out.png> [--keep-above 0.85]

source.glb  the body that was painted on (its UVs and colour texture)
dest.glb    the new body: another run of the same figure, so the same shape to a few millimetres, but another unwrap
out.png     the destination's texture: each texel takes the colour of the nearest point of the source's surface; above
            --keep-above (a fraction of the height, 0.85: the head) the destination's own colour is kept, since that is
            what the new run changed. `apply_texture.py <dest.glb> <out.png> <new.glb>` puts it on the mesh.
Both meshes must be in the same frame (the figure's own camera frame, as project_picture.py writes them).
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils.bvhtree import BVHTree

args = [a for a in sys.argv[sys.argv.index('--') + 1 :] if not a.startswith('--')]
src_file, dst_file, out = (os.path.abspath(a) for a in args[:3])
KEEP = float(sys.argv[sys.argv.index('--keep-above') + 1]) if '--keep-above' in sys.argv else 0.85
bpy.ops.wm.read_factory_settings(use_empty=True)


def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    ob = max((o for o in bpy.data.objects if o not in before and o.type == 'MESH'), key=lambda o: len(o.data.vertices))
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return ob


def colour_image(ob):
    node = next(n for n in ob.data.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].links[0].from_node
    while node.type != 'TEX_IMAGE':
        node = next(i.links[0].from_node for i in node.inputs if i.links)
    img = node.image
    w, h = img.size
    return np.array(img.pixels[:], np.float32).reshape(h, w, 4)[:, :, :3].copy()


def tris_of(ob):
    m = ob.data
    n = len(m.loops)
    uv = np.empty(n * 2, np.float32)
    m.uv_layers.active.data.foreach_get('uv', uv)
    vi = np.empty(n, np.int32)
    m.loops.foreach_get('vertex_index', vi)
    pts = np.empty(len(m.vertices) * 3, np.float32)
    m.vertices.foreach_get('co', pts)
    assert len(m.loops) == 3 * len(m.polygons), 'triangulated meshes only'
    return pts.reshape(-1, 3), vi.reshape(-1, 3), uv.reshape(-1, 3, 2)


src, dst = load(src_file), load(dst_file)
src_px = colour_image(src)
dst_px = colour_image(dst)
SH, SW = src_px.shape[:2]
DH, DW = dst_px.shape[:2]
TEX = DW
sp, svi, suv = tris_of(src)
dp, dvi, duv = tris_of(dst)
tri = dp[dvi]

# Where each destination texel lies on the destination's surface (as project_picture.py does it).
position = np.zeros((TEX, TEX, 3), np.float32)
covered = np.zeros((TEX, TEX), bool)
for k in range(len(tri)):
    c = duv[k] * TEX
    x0, x1 = int(max(0, math.floor(c[:, 0].min()))), int(min(TEX - 1, math.ceil(c[:, 0].max())))
    y0, y1 = int(max(0, math.floor(c[:, 1].min()))), int(min(TEX - 1, math.ceil(c[:, 1].max())))
    if x1 < x0 or y1 < y0:
        continue
    gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    d = (c[1, 1] - c[2, 1]) * (c[0, 0] - c[2, 0]) + (c[2, 0] - c[1, 0]) * (c[0, 1] - c[2, 1])
    if abs(d) < 1e-12:
        continue
    a = ((c[1, 1] - c[2, 1]) * (gx - c[2, 0]) + (c[2, 0] - c[1, 0]) * (gy - c[2, 1])) / d
    b = ((c[2, 1] - c[0, 1]) * (gx - c[2, 0]) + (c[0, 0] - c[2, 0]) * (gy - c[2, 1])) / d
    g = 1 - a - b
    inside = (a >= -0.04) & (b >= -0.04) & (g >= -0.04)
    if not inside.any():
        continue
    ys, xs = np.nonzero(inside)
    position[ys + y0, xs + x0] = a[ys, xs, None] * tri[k, 0] + b[ys, xs, None] * tri[k, 1] + g[ys, xs, None] * tri[k, 2]
    covered[ys + y0, xs + x0] = True
print(f'TEXELS {int(covered.sum())} of {TEX * TEX} on the destination')

ys, xs = np.nonzero(covered)
P = position[ys, xs]
height_lo, height_hi = float(dp[:, 2].min()), float(dp[:, 2].max())
keep_own = P[:, 2] > height_lo + KEEP * (height_hi - height_lo)

bvh = BVHTree.FromObject(src, bpy.context.evaluated_depsgraph_get())
idx = np.full(len(P), -1, np.int64)
loc = np.zeros((len(P), 3), np.float64)
far = 0.0
for i in np.nonzero(~keep_own)[0]:
    hit = bvh.find_nearest(P[i])
    if hit[0] is None:
        continue
    loc[i] = hit[0]
    idx[i] = hit[2]
    far = max(far, hit[3])
print(f'NEAREST done: the furthest texel is {far:.4f} from the source surface')

# The source colour at each nearest point: barycentric on its triangle, through the source's UVs.
use = idx >= 0
a_, b_, c_ = sp[svi[idx[use], 0]], sp[svi[idx[use], 1]], sp[svi[idx[use], 2]]
v0, v1, v2 = b_ - a_, c_ - a_, loc[use] - a_
d00, d01, d11 = (v0 * v0).sum(1), (v0 * v1).sum(1), (v1 * v1).sum(1)
d20, d21 = (v2 * v0).sum(1), (v2 * v1).sum(1)
den = np.maximum(d00 * d11 - d01 * d01, 1e-18)
wb = (d11 * d20 - d01 * d21) / den
wc = (d00 * d21 - d01 * d20) / den
wa = 1 - wb - wc
uvs = wa[:, None] * suv[idx[use], 0] + wb[:, None] * suv[idx[use], 1] + wc[:, None] * suv[idx[use], 2]
px = np.clip((uvs[:, 0] % 1) * SW - 0.5, 0, SW - 1.001)
py = np.clip((uvs[:, 1] % 1) * SH - 0.5, 0, SH - 1.001)
x0, y0 = np.floor(px).astype(int), np.floor(py).astype(int)
fx, fy = (px - x0)[:, None], (py - y0)[:, None]
col = (src_px[y0, x0] * (1 - fx) * (1 - fy) + src_px[y0, x0 + 1] * fx * (1 - fy) + src_px[y0 + 1, x0] * (1 - fx) * fy + src_px[y0 + 1, x0 + 1] * fx * fy)

result = dst_px.copy()
rows, cols = ys[use], xs[use]
result[rows, cols] = col
print(f'TRANSFER {int(use.sum())} texels from the source, {int(keep_own.sum())} kept (the head)')

# The seams' margins: a few texels beyond the surface take the colour beside them, so a map filtered at a distance doesn't show the old ones.
mask = covered.copy()
for _ in range(6):
    grown = mask.copy()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        sh = np.roll(np.roll(mask, dy, 0), dx, 1)
        cs = np.roll(np.roll(result, dy, 0), dx, 1)
        take = sh & ~grown
        result[take] = cs[take]
        grown |= sh
    mask = grown
img = bpy.data.images.new('transferred', TEX, TEX, alpha=False)
img.pixels.foreach_set(np.concatenate([np.clip(result, 0, 1), np.ones((TEX, TEX, 1), np.float32)], axis=2).ravel())
img.filepath_raw = out
img.file_format = 'PNG'
img.save()
print('WROTE', out)
