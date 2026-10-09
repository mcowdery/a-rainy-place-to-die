"""Turn each triangle of a shape-only mesh to face outward by asking the mesh (run in Blender):
  blender -b --python reorient4.py -- in.glb out.glb
A triangle on the outside of a solid figure has nothing behind its front (its outward ray crosses an even number of
surfaces) and the solid behind its back (the inward ray an odd number). One that has the reverse is turned over. The
answers are then smoothed by what a triangle's neighbours say, since a thin surface (a lock of hair) can fool one ray."""
import sys

import bmesh
import bpy
from mathutils.bvhtree import BVHTree

src, dst = sys.argv[sys.argv.index('--') + 1 :][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
ob = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
bpy.context.view_layer.objects.active = ob
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bm = bmesh.new()
bm.from_mesh(ob.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-6)
bm.faces.ensure_lookup_table()
bm.normal_update()
tree = BVHTree.FromBMesh(bm)
size = max(max(v.co[i] for v in bm.verts) - min(v.co[i] for v in bm.verts) for i in range(3))


def crossings(o, d):
    n = 0
    while n < 12:
        loc, _, _, _ = tree.ray_cast(o, d)
        if loc is None:
            return n
        n += 1
        o = loc + d * 1e-5 * size
    return n


vote = []
for f in bm.faces:
    n, c = f.normal, f.calc_center_median()
    out_odd = crossings(c + n * 1e-4 * size, n) % 2
    in_odd = crossings(c - n * 1e-4 * size, -n) % 2
    # +1 turned the right way, -1 the wrong way, 0 can't say
    vote.append(1 if (out_odd == 0 and in_odd == 1) else -1 if (out_odd == 1 and in_odd == 0) else 0)
# Smooth over neighbours (two passes): a face takes the sign of the sum of its own and its neighbours' votes.
for _ in range(2):
    nxt = []
    for f in bm.faces:
        total = vote[f.index] * 2
        for e in f.edges:
            for g in e.link_faces:
                if g is not f:
                    total += vote[g.index]
        nxt.append(1 if total > 0 else -1 if total < 0 else vote[f.index])
    vote = nxt
flip = [f for f in bm.faces if vote[f.index] < 0]
bmesh.ops.reverse_faces(bm, faces=flip)
print(f'ORIENT {len(flip)} of {len(bm.faces)} faces turned over; {sum(1 for v in vote if v == 0)} undecided')
bm.to_mesh(ob.data)
bm.free()
bpy.ops.object.select_all(action='DESELECT')
ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', use_selection=True, export_image_format='NONE', export_materials='NONE')
print('WROTE', dst)
