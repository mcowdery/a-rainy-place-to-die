"""A rigged figure's chest kept off the arms: the breasts and the ribs follow the spine, not the clavicles and upper arms.

  blender -b --python scripts/blender/fix_chest_weights.py -- <rigged.glb> <out.glb>

rig_figure.py's weights come from a stand-in by nearest surface, so on a generated body the front of the chest takes some 15% of its
weight from the clavicle and upper-arm bones, and when an animation brings the arms down from a T-pose the breasts are dragged out of
shape (the nipple dented, the breast pulled towards the armpit). Here, in the chest between the shoulders (inside 0.6 of the shoulder
joints' distance from the middle, fading out to 0.9, and below the clavicles' height), the weight on the arm bones goes to spine_03.
"""
import os
import sys

import bpy
import numpy as np

src, out = (os.path.abspath(a) for a in sys.argv[sys.argv.index('--') + 1 :][:2])
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
ob = max((o for o in bpy.context.scene.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
bones = rig.data.bones
world = lambda b, p: rig.matrix_world @ getattr(bones[b], p + '_local')  # noqa: E731
shoulder_x = abs(world('upperarm_l', 'head').x)
clav_z = world('clavicle_l', 'head').z
spine_z = world('spine_03', 'head').z
ARM = ('clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r')
groups = {g.name: g for g in ob.vertex_groups}
spine = groups['spine_03']
moved = 0
for v in ob.data.vertices:
    p = ob.matrix_world @ v.co
    ax = abs(p.x)
    f = np.clip((0.9 * shoulder_x - ax) / (0.3 * shoulder_x), 0, 1)  # 1 inside 0.6, 0 at 0.9
    f = f * f * (3 - 2 * f)
    if p.z > clav_z + 0.02:  # (the shoulders' tops keep moving with the clavicles)
        f *= float(np.clip((clav_z + 0.07 - p.z) / 0.05, 0, 1))
    if p.z < spine_z - 0.35:
        f = 0.0
    if f <= 0:
        continue
    take = 0.0
    for g in v.groups:
        if ob.vertex_groups[g.group].name in ARM:
            take += g.weight * f
            g.weight = g.weight * (1 - f)
    if take > 0:
        spine.add([v.index], take + next((g.weight for g in v.groups if g.group == spine.index), 0.0), 'REPLACE')
        moved += 1
print(f'CHEST WEIGHTS: {moved} vertices had arm weight moved to spine_03 (shoulder x {shoulder_x:.3f}, clavicle z {clav_z:.3f})')
bpy.ops.object.select_all(action='DESELECT')
ob.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_image_format='JPEG')
print('WROTE', out)
