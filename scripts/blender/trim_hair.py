"""A generated figure's hair ends trimmed: the torn lower part of the hair shell cut away along a clean, gently curved line.

  blender -b --python scripts/blender/trim_hair.py -- <body.glb or rigged.glb> <out.glb> [--cut 0.70] [--sides 0.02] [--probe]

The hair of a generated body is a thin shell whose lower end is torn into tatters (holes, strands, skin showing through). Hair faces
(dark paint, below the shoulders and above the hips) lower than the cut line are removed: the line is `--cut` (a fraction of the
figure's height) in the middle of the back and `--sides` higher at the edges, so the ends hang in a soft curve. `--probe` prints how
the hair is spread over height and writes nothing.
"""
import os
import sys

import bmesh
import bpy
import numpy as np

args = [a for a in sys.argv[sys.argv.index('--') + 1 :] if not a.startswith('--')]
src = os.path.abspath(args[0])
out = os.path.abspath(args[1]) if len(args) > 1 else None
opt = lambda k, d: float(sys.argv[sys.argv.index(k) + 1]) if k in sys.argv else d  # noqa: E731
CUT, SIDES = opt('--cut', 0.70), opt('--sides', 0.02)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
ob = max((o for o in bpy.context.scene.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
mesh = ob.data
node = next(n for n in mesh.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].links[0].from_node
while node.type != 'TEX_IMAGE':
    node = next(i.links[0].from_node for i in node.inputs if i.links)
w, h = node.image.size
px = np.array(node.image.pixels[:], np.float32).reshape(h, w, 4)[:, :, :3]
bm = bmesh.new()
bm.from_mesh(mesh)
uv = bm.loops.layers.uv.active
zs = np.array([(ob.matrix_world @ v.co).z for v in bm.verts])
xs = np.array([(ob.matrix_world @ v.co).x for v in bm.verts])
z0, z1 = zs.min(), zs.max()
H = z1 - z0
info = []
shade = {}
for f in bm.faces:
    u = sum(l[uv].uv.x for l in f.loops) / len(f.loops)
    v = sum(l[uv].uv.y for l in f.loops) / len(f.loops)
    c = px[min(h - 1, max(0, int(v % 1 * h))), min(w - 1, max(0, int(u % 1 * w)))]
    m = ob.matrix_world @ f.calc_center_median()
    shade[f.index] = float(c.max())
    info.append((f, c.max() < 0.3, (m.z - z0) / H, m.x / H, c.max()))
dark = [(f, z, x) for f, d, z, x, _ in info if d and 0.55 < z < 0.80]
print('HAIR faces', len(dark), 'of', len(bm.faces))
for lo in np.arange(0.55, 0.80, 0.025):
    n = sum(1 for _, z, _ in dark if lo <= z < lo + 0.025)
    print(f'  z {lo:.3f}-{lo + 0.025:.3f}: {n}')
if '--probe' in sys.argv or out is None:
    sys.exit(0)
line = lambda x: CUT + SIDES * min(1.0, abs(x) / 0.06) ** 2  # noqa: E731
# (Below the line the hair's lighter, brownish fringe goes too: the tatters' edges are not as dark as the shell.)
drop = [f for f, d, z, x, mx in info if 0.55 < z < 0.80 and z < line(x) and (d or mx < 0.45)]
bmesh.ops.delete(bm, geom=drop, context='FACES')
# And what the cut left floating: small loose pieces below the shoulders (specks of torn hair, a dozen faces each).
bm.faces.ensure_lookup_table()
seen, small = set(), []
for f0 in bm.faces:
    if f0.index in seen:
        continue
    comp, stack = [], [f0]
    seen.add(f0.index)
    while stack:
        f = stack.pop()
        comp.append(f)
        for e in f.edges:
            for g in e.link_faces:
                if g.index not in seen:
                    seen.add(g.index)
                    stack.append(g)
    zc = float(np.mean([(ob.matrix_world @ f.calc_center_median()).z for f in comp[:20]]))
    if len(comp) < 400 and z0 + 0.60 * H < zc < z0 + 0.80 * H and np.mean([shade[f.index] for f in comp]) < 0.55:
        small += comp
bmesh.ops.delete(bm, geom=small, context='FACES')
print(f'LOOSE {len(small)} faces of small floating pieces removed')
bm.to_mesh(mesh)
bm.free()
print(f'TRIM {len(drop)} faces below the cut ({CUT} of the height, {SIDES} higher at the sides) removed')
bpy.ops.object.select_all(action='DESELECT')
ob.select_set(True)
rig = next((o for o in bpy.context.scene.objects if o.type == 'ARMATURE'), None)  # (a rigged figure keeps its skeleton and weights: the trim only removes faces)
if rig:
    rig.select_set(True)
bpy.context.view_layer.objects.active = rig or ob
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_image_format='JPEG')
print('WROTE', out)
