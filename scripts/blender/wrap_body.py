"""A clean template body wrapped onto a generated shape: topology transfer, so the figure has the template's mesh, UVs, rig
(and, later, face and fingers), and only the shape is hers.

  blender -b --python scripts/blender/wrap_body.py -- <template.glb> <rigged.glb> <target.glb> <out.glb> [--keep-pose]

  template.glb  an MPFB base with the game_engine rig (scripts/blender/mpfb_base.py --proxy none --hair none)
  rigged.glb    the generated figure after rig_figure.py: only its skeleton is read (her joints, in her pose)
  target.glb    the generated body (project_picture.py's output): the shape to wrap onto
  out.glb       the wrapped template body, posed as the target is

Stages (each prints what it did):
 1. POSE: the template's armature is posed to her skeleton, each bone turned (parents first) so its head-to-tail
    direction matches the same-named bone of hers. Limb lengths still differ; the wrap takes up the rest.
 2. FIT: scaled and moved so the template's feet and crown match the target's.
 3. WRAP: Shrinkwrap (nearest surface point) onto the target's skin, region by region, from coarse to fine.
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

args = [a for a in sys.argv[sys.argv.index('--') + 1 :] if not a.startswith('--')]
template_file, rigged_file, target_file, out = (os.path.abspath(a) for a in args[:4])
KEEP_POSE = '--keep-pose' in sys.argv

bpy.ops.wm.read_factory_settings(use_empty=True)


def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


template = load(template_file)
t_rig = next(o for o in template if o.type == 'ARMATURE')
t_meshes = [o for o in template if o.type == 'MESH']
body = max(t_meshes, key=lambda o: len(o.data.vertices))
print('TEMPLATE', [o.name for o in t_meshes], 'bones', len(t_rig.data.bones))

figure = load(rigged_file)
f_rig = next(o for o in figure if o.type == 'ARMATURE')
print('RIGGED bones', len(f_rig.data.bones))

# 1. POSE -------------------------------------------------------------------------------------------------------------
# Her bones in world space: name -> (head, tail).
goal = {b.name: (f_rig.matrix_world @ b.head_local, f_rig.matrix_world @ b.tail_local) for b in f_rig.data.bones}
bpy.context.view_layer.objects.active = t_rig
bpy.ops.object.mode_set(mode='POSE')
order = []


def walk(bone):
    order.append(bone.name)
    for c in bone.children:
        walk(c)


for b in t_rig.data.bones:
    if b.parent is None:
        walk(b)
turned = 0
if not KEEP_POSE:
    for name in order:
        if name not in goal or name in ('Root',):
            continue
        pb = t_rig.pose.bones[name]
        bpy.context.view_layer.update()
        head = t_rig.matrix_world @ pb.head
        tail = t_rig.matrix_world @ pb.tail
        want = goal[name][1] - goal[name][0]
        have = tail - head
        if want.length < 1e-5 or have.length < 1e-5:
            continue
        rot = have.normalized().rotation_difference(want.normalized())
        if rot.angle < math.radians(0.5):
            continue
        r = rot.to_matrix().to_4x4()
        # Turn about the bone's head, in armature space.
        h = pb.head.copy()
        about = Matrix.Translation(h) @ (t_rig.matrix_world.to_3x3().inverted().to_4x4() @ r @ t_rig.matrix_world.to_3x3().to_4x4()) @ Matrix.Translation(-h)
        pb.matrix = about @ pb.matrix
        turned += 1
bpy.ops.object.mode_set(mode='OBJECT')
bpy.context.view_layer.update()
print(f'POSE {turned} bones turned to match the target skeleton')

bpy.context.view_layer.update()
neck_z_template = (t_rig.matrix_world @ t_rig.pose.bones['neck_01'].head).z
# Bake the pose into the meshes.
for o in t_meshes:
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        if m.type == 'ARMATURE':
            bpy.ops.object.select_all(action='DESELECT')
            o.select_set(True)
            bpy.ops.object.modifier_apply(modifier=m.name)
print('POSE baked into', [o.name for o in t_meshes])
# The meshes leave the armature (they are parented to it): its own scaling and shift, below, would move them a second time.
for o in t_meshes:
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
# The importer splits the body's vertices along every UV seam; the wrap's smoothing and its projection along each vertex's
# own normal would then move the two halves of a seam differently and open it (pale lines down the spine, across the shoulders,
# down the sides of the legs). Weld them (the UVs and the weights are kept: they belong to the corners and the groups).
bm = bmesh.new()
bm.from_mesh(body.data)
n0 = len(bm.verts)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bm.to_mesh(body.data)
bm.free()
print(f'WELD {n0} -> {len(body.data.vertices)} vertices on the body')
# The template's own skeleton stays the rig (its weights are made for it): posed as the mesh was, then that pose made its rest.
bpy.context.view_layer.objects.active = t_rig
bpy.ops.object.select_all(action='DESELECT')
t_rig.select_set(True)
bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode='OBJECT')
posed_template = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in t_rig.data.bones}

# Only the body is wrapped; the eyes, brows and lashes are fitted with the same scale and shift (the head isn't wrapped), and MPFB's
# helper sphere is dropped.
for o in list(t_meshes):
    if o.name.startswith('Icosphere'):
        t_meshes.remove(o)
        bpy.data.objects.remove(o)
parts = [o for o in t_meshes if o is not body]
for o in parts:
    o.hide_set(True)

# 2. FIT --------------------------------------------------------------------------------------------------------------
target = load(target_file)
t_obj = next(o for o in target if o.type == 'MESH')
for o in target:
    if o is not t_obj:
        bpy.data.objects.remove(o)


def skin_only(ob, z_neck, limit=0.3):
    """The target without its hair: faces whose paint is dark are dropped (the hair shell would draw the head onto it),
    except in the middle of the face, in front, where the brows, eyes and lashes are dark and are the face."""
    mesh = ob.data
    node = next(n for n in mesh.materials[0].node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].links[0].from_node
    while node.type != 'TEX_IMAGE':
        node = next(i.links[0].from_node for i in node.inputs if i.links)
    w, h = node.image.size
    px = np.array(node.image.pixels[:], np.float32).reshape(h, w, 4)[:, :, :3]
    bm = bmesh.new()
    bm.from_mesh(mesh)
    uv = bm.loops.layers.uv.active
    head = [v.co for v in bm.verts if v.co.z > z_neck]
    xs = np.array([c.x for c in head])
    ys = np.array([c.y for c in head])
    cx, half = float(np.median(xs)), float(np.percentile(np.abs(xs - np.median(xs)), 90))
    y_mid = float(np.percentile(ys, 40))  # the front is -y
    drop = []
    for f in bm.faces:
        u = sum(l[uv].uv.x for l in f.loops) / len(f.loops)
        v = sum(l[uv].uv.y for l in f.loops) / len(f.loops)
        c = px[min(h - 1, max(0, int(v % 1 * h))), min(w - 1, max(0, int(u % 1 * w)))]
        if c.max() < limit:
            mid = f.calc_center_median()
            in_face = mid.z > z_neck and abs(mid.x - cx) < 0.55 * half and mid.y < y_mid
            if not in_face:
                drop.append(f)
    bmesh.ops.delete(bm, geom=drop, context='FACES')
    bm.to_mesh(mesh)
    bm.free()
    return len(drop)




def box(ob):
    pts = np.array([ob.matrix_world @ v.co for v in ob.data.vertices])
    return pts.min(axis=0), pts.max(axis=0)


bpy.context.view_layer.update()
lo_t, hi_t = box(t_obj)
lo_b, hi_b = box(body)
print('BOX target', lo_t.round(3), hi_t.round(3), ' template', lo_b.round(3), hi_b.round(3))
# (Fit by the feet and the width of the arms' span, not the height: the target has hair.)
scale = (hi_t[0] - lo_t[0]) / (hi_b[0] - lo_b[0])
body.scale = (scale, scale, scale)
bpy.context.view_layer.objects.active = body
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
lo_b, hi_b = box(body)
shift = Vector(((lo_t[0] + hi_t[0]) / 2 - (lo_b[0] + hi_b[0]) / 2, (lo_t[1] + hi_t[1]) / 2 - (lo_b[1] + hi_b[1]) / 2, lo_t[2] - lo_b[2]))
body.location = shift
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
for o in parts:
    o.hide_set(False)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    o.scale = (scale, scale, scale)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.location = shift
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
# The template's skeleton goes into the target's frame the same way; her landmark skeleton has done its work (the pose).
for o in figure:
    bpy.data.objects.remove(o)
bpy.context.view_layer.objects.active = t_rig
bpy.ops.object.select_all(action='DESELECT')
t_rig.select_set(True)
t_rig.scale = (scale, scale, scale)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
t_rig.location = shift
bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
z_neck = neck_z_template * scale + shift.z
print(f'FIT scale {scale:.3f}, neck at {z_neck:.3f}')
print('TARGET hair faces dropped', skin_only(t_obj, z_neck))

# 3. WRAP -------------------------------------------------------------------------------------------------------------
def wrapped(ob, mode, smooth_iter):
    """The coordinates the body would have under a Shrinkwrap onto the target (the body itself is left alone)."""
    dup = ob.copy()
    dup.data = ob.data.copy()
    bpy.context.collection.objects.link(dup)
    bpy.context.view_layer.objects.active = dup
    sw = dup.modifiers.new('wrap', 'SHRINKWRAP')
    sw.target = t_obj
    if mode == 'nearest':
        sw.wrap_method = 'NEAREST_SURFACEPOINT'
    else:
        sw.wrap_method = 'PROJECT'
        sw.use_negative_direction = True
        sw.use_positive_direction = True
        sw.project_limit = 0.06
        sw.cull_face = 'OFF'
    bpy.ops.object.select_all(action='DESELECT')
    dup.select_set(True)
    bpy.ops.object.modifier_apply(modifier='wrap')
    if smooth_iter:
        sm = dup.modifiers.new('smooth', 'SMOOTH')
        sm.factor = 0.5
        sm.iterations = smooth_iter
        bpy.ops.object.modifier_apply(modifier='smooth')
    co = np.empty(len(dup.data.vertices) * 3, np.float32)
    dup.data.vertices.foreach_get('co', co)
    bpy.data.objects.remove(dup)
    return co.reshape(-1, 3).astype(np.float64)


def coords(ob):
    co = np.empty(len(ob.data.vertices) * 3, np.float32)
    ob.data.vertices.foreach_get('co', co)
    return co.reshape(-1, 3).astype(np.float64)


def put(ob, co):
    ob.data.vertices.foreach_set('co', co.astype(np.float32).ravel())
    ob.data.update()


def head_weight(co, dist):
    """1 below the neck's base; fading to 0 within HEAD_BLEND above it: the head keeps the template's own shape (a clean face,
    eye sockets, lips: wrapping them onto a generated face full of holes only tears them), and its likeness is the picture's."""
    return np.clip((z_neck + HEAD_BLEND - co[:, 2]) / HEAD_BLEND, 0, 1)


HEAD_BLEND = 0.05
start = coords(body)
above = start[:, 2] > z_neck
# Pass 1: onto the nearest surface (takes the limbs' lengths and the trunk's volume up).
first = wrapped(body, 'nearest', 2)
# The head is wrapped only where the target is near: a vertex far from any skin (the skull, under hair) keeps the template's shape.
move = first - start
dist = np.linalg.norm(move, axis=1)
near_a, near_b = 0.015, 0.045  # target units (about 3 to 9 cm at life size)
w = head_weight(start, dist)
put(body, start + move * w[:, None])
print(f'WRAP pass 1: {int((above & (w < 1)).sum())} head vertices left partly or wholly as the template has them')
# Pass 2: along the normals, both ways (settles the bust and the hips where nearest-point pulled them to the wrong side).
second = wrapped(body, 'project', 1)
cur = coords(body)
dist2 = np.linalg.norm(second - cur, axis=1)
w2 = head_weight(cur, dist2)
put(body, cur + (second - cur) * w2[:, None])
print('WRAP pass 2 done')
# A last smoothing over the head's seam with the rest.
bpy.context.view_layer.objects.active = body
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
sm = body.modifiers.new('smooth', 'SMOOTH')
sm.factor = 0.4
sm.iterations = 2
bpy.ops.object.modifier_apply(modifier='smooth')

bpy.data.objects.remove(t_obj)
f_rig = t_rig
# The skeleton follows the skin: each joint moves by how far the wrap moved the skin round it (the mean of its own bone's
# vertices and its parent's, weighted by their skin weights), so the joints stay where the template's weights expect them.
final = coords(body)
print('BOXES start', start.min(axis=0).round(3), start.max(axis=0).round(3), 'final', final.min(axis=0).round(3), final.max(axis=0).round(3), 'target', lo_t.round(3), hi_t.round(3))
print('MOVED by height band:', [(round(a, 2), round(float(np.linalg.norm(moved_[(start[:, 2] >= a) & (start[:, 2] < a + 0.2)], axis=1).mean()), 3)) for moved_ in [final - start] for a in np.arange(-0.45, 0.4, 0.2)])
moved = final - start
gw = {}
for v in body.data.vertices:
    for g in v.groups:
        gw.setdefault(body.vertex_groups[g.group].name, []).append((v.index, g.weight))


def shift_of(name):
    items = gw.get(name)
    if not items:
        return None
    idx = np.array([i for i, _ in items])
    w = np.array([x for _, x in items])
    return (moved[idx] * w[:, None]).sum(axis=0) / max(w.sum(), 1e-9)


bpy.context.view_layer.objects.active = f_rig
bpy.ops.object.mode_set(mode='EDIT')
eb = f_rig.data.edit_bones
heads = {}
for e in eb:
    own = shift_of(e.name)
    par = shift_of(e.parent.name) if e.parent else None
    parts_ = [d for d in (own, par) if d is not None]
    heads[e.name] = Vector(np.mean(parts_, axis=0)) if parts_ else Vector((0, 0, 0))
new_heads = {e.name: e.head + heads[e.name] for e in eb}
new_tails = {}
for e in eb:
    kids = [c for c in e.children if c.use_connect or (c.head - e.tail).length < 1e-4]
    new_tails[e.name] = (new_heads[kids[0].name] if kids else e.tail + heads[e.name])
for e in eb:
    e.use_connect = False
for e in eb:
    e.head = new_heads[e.name]
    e.tail = new_tails[e.name]
bpy.ops.object.mode_set(mode='OBJECT')
for n_, h_ in sorted(heads.items(), key=lambda kv: -kv[1].length)[:8]:
    print(f'  SHIFT {n_} {h_.length:.4f} own={None if shift_of(n_) is None else np.linalg.norm(shift_of(n_)).round(4)}')
print(f'MOVED surface: mean {np.linalg.norm(moved, axis=1).mean():.4f}, max {np.linalg.norm(moved, axis=1).max():.4f}')
print(f'RIG joints moved with the skin: mean {np.mean([h.length for h in heads.values()]):.4f}, largest {max(h.length for h in heads.values()):.4f}')
groups = [g.name for g in body.vertex_groups]
print(f'RIG {len(groups)} vertex groups on the body')
for o in [body] + parts:
    bpy.context.view_layer.objects.active = o
    for m in list(o.modifiers):
        o.modifiers.remove(m)
    mod = o.modifiers.new('Armature', 'ARMATURE')
    mod.object = f_rig
    o.parent = f_rig
bpy.ops.object.select_all(action='DESELECT')
for o in [f_rig, body] + parts:
    o.select_set(True)
bpy.context.view_layer.objects.active = f_rig
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_image_format='JPEG')
print('WROTE', out)
