"""The painted body on the wrapped, rigged template: the last step of the wrap route (wrap_body.py, then project_picture.py --surface).

  blender -b --python scripts/blender/assemble_figure.py -- <wrapped_rigged.glb> <painted.glb> <out.glb> [--height 1.65] [--template template.glb]

wrapped_rigged.glb  wrap_body.py's output: her skeleton, the template body with its skin weights, eyes, brows and lashes
painted.glb         project_picture.py --surface's output: the same body, with her picture on its UVs (the glTF export splits
                    vertices again, so the weights are carried over by position)
template.glb        (with --template) the MPFB base the body was wrapped from: the figure is turned back from the T-pose it was wrapped and
                    painted in to the template's own A-pose, which its skin weights were made for (arms 90 degrees down from a T-pose
                    pull the armpit into a web); the texture isn't touched
out.glb             the figure as the game's characters are: +y up, metres, facing +z, feet at y 0, four weights a vertex
"""
import os
import sys

import math

import bpy
import numpy as np
from mathutils import Matrix, Vector, kdtree

args = [a for a in sys.argv[sys.argv.index('--') + 1 :] if not a.startswith('--')]
rigged_file, painted_file, out = (os.path.abspath(a) for a in args[:3])
HEIGHT = float(sys.argv[sys.argv.index('--height') + 1]) if '--height' in sys.argv else 1.65

bpy.ops.wm.read_factory_settings(use_empty=True)


def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


rigged = load(rigged_file)
rig = next(o for o in rigged if o.type == 'ARMATURE')
meshes = [o for o in rigged if o.type == 'MESH']
body = max(meshes, key=lambda o: len(o.data.vertices))
parts = [o for o in meshes if o is not body]
painted_objs = load(painted_file)
paint = max((o for o in painted_objs if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
for o in painted_objs:
    if o is not paint:
        bpy.data.objects.remove(o)

# Weights by position: each vertex of the painted body takes those of the nearest vertex of the template body.
for o in (body, paint):
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    o.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
tree = kdtree.KDTree(len(body.data.vertices))
for v in body.data.vertices:
    tree.insert(body.matrix_world @ v.co, v.index)
tree.balance()
names = {g.index: g.name for g in body.vertex_groups}
for n in names.values():
    paint.vertex_groups.new(name=n)
worst = 0.0
for v in paint.data.vertices:
    _, i, d = tree.find(paint.matrix_world @ v.co)
    worst = max(worst, d)
    for g in body.data.vertices[i].groups:
        paint.vertex_groups[names[g.group]].add([v.index], g.weight, 'REPLACE')
print(f'WEIGHTS carried over to {len(paint.data.vertices)} vertices; furthest nearest vertex {worst:.5f}')
bpy.data.objects.remove(body)

# To metres, feet on the ground, centred.
everything = [rig, paint] + parts
box_min = np.min([[*(o.matrix_world @ v.co)] for o in [paint] for v in o.data.vertices], axis=0)
box_max = np.max([[*(o.matrix_world @ v.co)] for o in [paint] for v in o.data.vertices], axis=0)
# (The skin's own height includes the scalp and no hair: the head's top is the crown.)
k = HEIGHT / (box_max[2] - box_min[2])
for o in everything:
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    o.parent = None
    o.scale = (k, k, k)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.location = Vector((-(box_min[0] + box_max[0]) / 2 * k, -(box_min[1] + box_max[1]) / 2 * k, -box_min[2] * k))
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
for o in [paint] + parts:
    for m in list(o.modifiers):
        o.modifiers.remove(m)
    mod = o.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig
    o.parent = rig
if '--template' in sys.argv:
    # Back to the template's pose: each bone, parents first, turned so it points as the template's own does, then the mesh is
    # deformed by that pose and the pose made the rest.
    template_file = os.path.abspath(sys.argv[sys.argv.index('--template') + 1])
    tmpl = load(template_file)
    t_rig = next(o for o in tmpl if o.type == 'ARMATURE')
    goal = {b.name: (t_rig.matrix_world @ b.tail_local) - (t_rig.matrix_world @ b.head_local) for b in t_rig.data.bones}
    for o in tmpl:
        if o is not t_rig:
            bpy.data.objects.remove(o)
    bpy.data.objects.remove(t_rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='POSE')
    order = []

    def walk(bone):
        order.append(bone.name)
        for c in bone.children:
            walk(c)

    for b in rig.data.bones:
        if b.parent is None:
            walk(b)
    turned = 0
    for name in order:
        if name not in goal or name == 'Root':
            continue
        pb = rig.pose.bones[name]
        bpy.context.view_layer.update()
        have = (rig.matrix_world @ pb.tail) - (rig.matrix_world @ pb.head)
        want = goal[name]
        if want.length < 1e-5 or have.length < 1e-5:
            continue
        rot = have.normalized().rotation_difference(want.normalized())
        if rot.angle < math.radians(0.5):
            continue
        r = rot.to_matrix().to_4x4()
        h = pb.head.copy()
        w3 = rig.matrix_world.to_3x3().to_4x4()
        pb.matrix = Matrix.Translation(h) @ (w3.inverted() @ r @ w3) @ Matrix.Translation(-h) @ pb.matrix
        turned += 1
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.context.view_layer.update()
    for o in [paint] + parts:
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        for m in list(o.modifiers):
            if m.type == 'ARMATURE':
                bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.select_all(action='SELECT')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in [paint] + parts:
        mod = o.modifiers.new('Armature', 'ARMATURE')
        mod.object = rig
    print(f'REPOSE {turned} bones turned back to the template pose')

bpy.ops.object.select_all(action='DESELECT')
for o in everything:
    o.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_image_format='JPEG')
print('WROTE', out, f'scale {k:.3f}')
