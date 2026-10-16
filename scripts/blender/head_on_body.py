"""A generated head set on a cast body: the body's own head taken off above the collar, the new head put in its place
at the body's scale, given the body's skin weights, and exported with the body's skeleton as one figure.

  "<blender.exe>" -b --python scripts/blender/head_on_body.py -- <body.glb> <head.glb> <out.glb>
        [--cut 1.545] [--overlap 0.03] [--head-weight 0.4] [--landmarks landmarks.json] [--pitch-up 0] [--tris 13000] [--tex 2048] [--normal-tex 1024] [--drop glasses,haircut,eyes,brows,lashes] [--save-blend fit.blend | --from-blend fit.blend]

body.glb  a cast model as scripts/blender/build_character.py exports it (the `game_engine` rig, +y up, metres,
          facing +z, its skin mesh called `base`, the eyes `high-poly`, the brows `eyebrow*`, the lashes `eyelashes*`,
          the hair `<name>.haircut*`), e.g. assets/characters/enemy_trench.glb
head.glb  a head made apart (scripts/blender/project_picture.py on a Pixal3D shape: +y up, facing +z, about a unit
          tall, one mesh, one textured material), e.g. debug-shots/props/mack_px/head2.glb

How it is placed, with nothing found by hand: the two noses are put on each other (the front-most point of each head,
in the body's own head region for the body), and the new head is scaled so that its width at the nose's height (cheek
to cheek, ears included) is the body's there. It prints both heads' measures so a bad fit shows. Then, above `--cut`
(metres above the floor: the top of the shirt collar on Mack) the body's skin is deleted and its eyes, brows, lashes,
hair and glasses are taken off (`--drop`); the new head is cut `--overlap` below that, so its neck goes down inside the
collar and the two skins overlap there instead of leaving a gap. The new head takes its bone weights from the body's
whole skin as it was before the cut (Data Transfer, nearest face, interpolated), so it bends at the neck as the body's
did, and is parented to the same skeleton.

Fitting by hand: `--save-blend fit.blend` stops after the placement and saves a Blender file with the body (rest pose)
and the new head as one object, `HEAD (move me)`, uncut and unweighted, at the automatic fit. Move, turn and scale that
object in Blender (G, R, S; on the object, not in Edit Mode) until it sits right on the neck, and save the file. Then
`--from-blend fit.blend` (with the same <body.glb> <head.glb> <out.glb>, which it reads only for their names) takes the head
as you left it and does the rest: the cut at the collar, the body's head taken off, the weights, the export.
"""
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
body_file, head_file, out_file = (os.path.abspath(a) for a in args[:3])
opt = {args[i][2:]: args[i + 1] for i in range(3, len(args) - 1, 2)}
CUT = float(opt.get('cut', 1.545))
OVERLAP = float(opt.get('overlap', 0.03))
DROP = set(opt.get('drop', 'glasses,haircut,eyes,brows,lashes').split(','))
# `--landmarks <json>` (scripts/genia/head_landmarks.py: the head's nose and eyes found in its front picture): scale by
# the distance between the eyes, the body's MakeHuman eyes against these, and put nose on nose. Without it, the
# front-most point is taken for the nose and the width there for the scale, which a head tilted down or a lock of
# hair over the brow throws off.
LANDMARKS = json.load(open(os.path.abspath(opt['landmarks']))) if 'landmarks' in opt else None
FROM_BLEND = os.path.abspath(opt['from-blend']) if 'from-blend' in opt else None
HEAD_NAME = 'HEAD (move me)'

if FROM_BLEND:
    bpy.ops.wm.open_mainfile(filepath=FROM_BLEND)
else:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


if FROM_BLEND:
    body_objs = [o for o in bpy.data.objects if o.name not in (HEAD_NAME, 'weights_source')]
else:
    body_objs = load(body_file)
arm = next(o for o in body_objs if o.type == 'ARMATURE')
meshes = [o for o in body_objs if o.type == 'MESH']
skin = next(o for o in meshes if o.data.name == 'base' or o.name == 'base')
print('BODY meshes:', [(o.name, o.data.name, len(o.data.vertices)) for o in meshes])


def world_verts(o):
    """The mesh's vertices where they stand (the armature at rest), as an array."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = o.evaluated_get(dg)
    m = ev.to_mesh()
    co = np.array([o.matrix_world @ v.co for v in m.vertices])
    ev.to_mesh_clear()
    return co


# Blender's frame: z up, the figure facing -y.
S = world_verts(skin)
head_region = S[:, 2] > CUT + 0.04
H = S[head_region]
nose_b = H[np.argmin(H[:, 1])]
band = np.abs(S[:, 2] - nose_b[2]) < 0.006
width_b = np.ptp(S[band & head_region, 0])
crown_b = S[:, 2].max()
print(f'BODY head: nose at z {nose_b[2]:.3f} y {nose_b[1]:.3f}, width at the nose {width_b:.3f}, skin crown {crown_b:.3f}')
eyes_obj = next((o for o in meshes if o.data.name.startswith('high-poly') or o.name.endswith('high-poly')), None)
if eyes_obj is not None:
    E = world_verts(eyes_obj)
    # (The front of each eye, not its centre: the head's eye landmarks are points on its surface.)
    eye_b = [E[E[:, 0] > 0][np.argmin(E[E[:, 0] > 0][:, 1])], E[E[:, 0] < 0][np.argmin(E[E[:, 0] < 0][:, 1])]]
    iod_b = float(np.linalg.norm(eye_b[0] - eye_b[1]))
    print(f'BODY eyes {iod_b:.4f} apart (centres), at z {np.mean([e[2] for e in eye_b]):.3f}')
else:
    iod_b = None
# The neck: its centre and half-width where the collar is, for trimming what the new head brings below its chin.
ring = S[np.abs(S[:, 2] - (CUT + 0.01)) < 0.012]
neck_c = np.array([np.median(ring[:, 0]), np.median(ring[:, 1])])
neck_r = float(np.percentile(np.hypot(ring[:, 0] - neck_c[0], ring[:, 1] - neck_c[1]), 90))
print(f'BODY neck at the collar: centre {neck_c.round(3)}, radius {neck_r:.3f}')

# A copy of the whole skin, weights and all, for the new head to take its weights from before the cut.
if FROM_BLEND:
    src = bpy.data.objects['weights_source']
else:
    src = skin.copy()
    src.data = skin.data.copy()
    bpy.context.collection.objects.link(src)
    src.name = 'weights_source'

if FROM_BLEND:
    # The head as it was left in the file: its object's move, turn and scale laid into its vertices.
    head = bpy.data.objects[HEAD_NAME]
    mw = head.matrix_world.copy()
    for v in head.data.vertices:
        v.co = mw @ v.co
    head.matrix_world.identity()
    head.data.update()
    G = np.array([v.co for v in head.data.vertices])
    print(f'HEAD from {FROM_BLEND}: as placed by hand, crown {G[:, 2].max():.3f}, lowest {G[:, 2].min():.3f}')
head_objs = [] if FROM_BLEND else load(head_file)
if not FROM_BLEND:
    head = None
if not FROM_BLEND:
  head = next(o for o in head_objs if o.type == 'MESH')
  bpy.context.view_layer.objects.active = head
if not FROM_BLEND:
  for o in bpy.context.selected_objects:
      o.select_set(False)
  head.select_set(True)
  bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
  bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
  G = np.array([v.co for v in head.data.vertices])
  if LANDMARKS and iod_b:
      blender = lambda p: np.array([p[0], -p[2], p[1]])  # glTF (y up) to Blender (z up), as the importer turns it
      nose_h = blender(LANDMARKS['nose'])
      el, er = blender(LANDMARKS['eye_l']), blender(LANDMARKS['eye_r'])
      iod_h = float(np.linalg.norm(el - er))
      k = iod_b / iod_h
      # Turned to sit as the body's head does: the frame of (the eye line, the line from between the eyes to the nose)
      # on the head carried onto the same frame on the body. The head was made as the portrait held it, turned and
      # tilted a little (Mack's, 2026-10-14: looking down and to one side on the body until this).
      def frame(a, b, nose):
          x = a - b
          x /= np.linalg.norm(x)
          n = nose - (a + b) / 2
          y = n - x * (n @ x)
          y /= np.linalg.norm(y)
          return np.stack([x, y, np.cross(x, y)], 1)
      # Only the eye line is trusted: it sets the turn and the roll. The tilt from the eyes-to-nose line overshot
      # (on Mack's head it pitched him 20 degrees to the ground: the landmarks are a few millimetres apart), so the
      # head keeps the portrait's own tilt, the shortest turn taking its eye line onto the body's.
      def arc(u, v):
          u, v = u / np.linalg.norm(u), v / np.linalg.norm(v)
          c, w = float(u @ v), np.cross(u, v)
          if np.linalg.norm(w) < 1e-9:
              return np.eye(3)
          W = np.array([[0, -w[2], w[1]], [w[2], 0, -w[0]], [-w[1], w[0], 0]])
          return np.eye(3) + W + W @ W / (1 + c)
      R = arc(el - er, eye_b[0] - eye_b[1]) if opt.get('turn', 'eyes') == 'eyes' else frame(eye_b[0], eye_b[1], nose_b) @ frame(el, er, nose_h).T
      ang = np.degrees(np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1)))
      # `--pitch-up <degrees>`: the head tipped back by that much about the side-to-side axis through the nose, for a
      # portrait that looked a little down (the eyes-to-nose line is too short to measure it by: see above).
      up = math.radians(float(opt.get('pitch-up', 0)))
      Rx = np.array([[1, 0, 0], [0, math.cos(-up), -math.sin(-up)], [0, math.sin(-up), math.cos(-up)]])
      G = (G - nose_h) @ (Rx @ R).T + nose_h
      print(f"HEAD (landmarks): nose at z {nose_h[2]:.3f}, eyes {iod_h:.4f} apart: scale {k:.4f}; turned {ang:.1f} degrees to the body's face")
  else:
      # Its face: the front-most point in its upper two thirds (the neck's ragged edge is lower down).
      upper = G[:, 2] > G[:, 2].min() + 0.3 * np.ptp(G[:, 2])
      nose_h = G[upper][np.argmin(G[upper][:, 1])]
      band_h = np.abs(G[:, 2] - nose_h[2]) < 0.006 * np.ptp(G[:, 2])
      width_h = np.ptp(G[band_h, 0])
      k = width_b / width_h
      print(f'HEAD: nose at z {nose_h[2]:.3f}, width at the nose {width_h:.3f}, {np.ptp(G[:, 2]):.3f} tall: scale {k:.4f}')
  newG = (G - nose_h) * k + nose_b
  for v, p in zip(head.data.vertices, newG):
      v.co = Vector(p)
  head.data.update()
  print(f'HEAD placed: crown {newG[:, 2].max():.3f} (the body\'s skin crown {crown_b:.3f}, its hair {max(world_verts(o)[:, 2].max() for o in meshes if "haircut" in o.name):.3f}), '
        f'chin-to-crown {newG[:, 2].max() - nose_b[2]:.3f} above the nose, lowest {newG[:, 2].min():.3f}')
  if 'save-blend' in opt:
      # Stop here for a hand fit: the head uncut and unweighted at the automatic placement, one object to move.
      head.name = HEAD_NAME
      head.data.name = HEAD_NAME
      src.hide_set(True)
      src.hide_render = True
      for o in bpy.context.selected_objects:
          o.select_set(False)
      head.select_set(True)
      bpy.context.view_layer.objects.active = head
      dst = os.path.abspath(opt['save-blend'])
      bpy.ops.wm.save_as_mainfile(filepath=dst)
      print('saved for a hand fit:', dst, '(move, turn and scale the object "HEAD (move me)", save, then run with --from-blend)')
      sys.exit(0)

# The new head below the collar's cut, less the overlap, goes.
bm = bmesh.new()
bm.from_mesh(head.data)
chin_z = nose_b[2] - 0.075
def outside_neck(v):
    return v.co.z < chin_z and math.hypot(v.co.x - neck_c[0], v.co.y - neck_c[1]) > neck_r * 1.12
gone = [f for f in bm.faces if max((v.co.z for v in f.verts)) < CUT - OVERLAP or all(outside_neck(v) for v in f.verts)]
bmesh.ops.delete(bm, geom=gone, context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(head.data)
bm.free()
print(f'HEAD below {CUT - OVERLAP:.3f} cut away: {len(head.data.polygons)} faces left')

# The body's skin above the cut goes, and the parts of its head the new one replaces.
bm = bmesh.new()
bm.from_mesh(skin.data)
mw = skin.matrix_world
bm.verts.ensure_lookup_table()
# Above the cut, and anything the head bone carries whatever its height: the old chin and jaw hang below the collar's
# line, and left in they show through the new face as a pale band (found on Mack's first fit, 2026-10-14).
deform = bm.verts.layers.deform.active
head_index = skin.vertex_groups['head'].index if 'head' in skin.vertex_groups else None
def head_weight(v):
    return v[deform].get(head_index, 0.0) if (deform is not None and head_index is not None) else 0.0
HEAD_W = float(opt.get('head-weight', 0.4))
gone = [f for f in bm.faces if min(((mw @ v.co).z for v in f.verts)) > CUT or sum(head_weight(v) for v in f.verts) / len(f.verts) > HEAD_W]
print(f'BODY skin faces taken off: {len(gone)} (above {CUT:.3f}, or carried by the head bone more than {HEAD_W})')
bmesh.ops.delete(bm, geom=gone, context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(skin.data)
bm.free()
kinds = {'glasses': lambda o: 'glasses' in o.name.lower() or 'sagerfrog' in o.name.lower(),
         'haircut': lambda o: 'haircut' in o.name.lower() or 'haircut' in o.data.name.lower(),
         'eyes': lambda o: o.data.name.startswith('high-poly') or o.name.startswith('high-poly'),
         'brows': lambda o: 'eyebrow' in o.name.lower(),
         'lashes': lambda o: 'eyelash' in o.name.lower()}
# The eyes are kept, shrunk to points inside the head: the game's faceless patch (src/poc3d/models/faceShadow.ts) finds
# the face by them (the eye mesh's box) and would leave the new face bare without (Mack's, 2026-10-14). The new head's
# material is named as a skin (`<name>.body`) so the same patch shades it.
KEEP_EYES = 'eyes' in DROP and opt.get('faceless', '0') == '1'  # (off since the faceless rule was retired, 2026-10-14)
for o in list(meshes):
    if KEEP_EYES and kinds['eyes'](o):
        me = o.data
        co = np.array([v.co for v in me.vertices])
        for side in (co[:, 0] > 0, co[:, 0] <= 0):
            if side.any():
                c = co[side].mean(0)
                co[side] = c + (co[side] - c) * 0.02
        for v, p in zip(me.vertices, co):
            v.co = Vector(p)
        me.update()
        print('eyes kept, shrunk to points:', o.name)
        continue
    if any(kinds[d](o) for d in DROP if d in kinds):
        print('dropped', o.name)
        bpy.data.objects.remove(o, do_unlink=True)

# `--tris N`: the head reduced to about N triangles (the cast's budget is 30,000 a figure: Mack's body without its head
# is about 16,000), keeping its UVs; and `--tex N`: its pictures no larger than N on a side (the budget's 1024, the
# skin's 2048: `--tex 2048 --normal-tex 1024`).
if 'tris' in opt and len(head.data.polygons) > int(opt['tris']):
    before = len(head.data.polygons)
    # Welded first: a glTF import splits the mesh along every UV seam, and the reducer then shrinks each piece on its
    # own and opens cracks between them (Mack's generated head, 2026-10-14: 1,372 pieces and 12,906 open edges at
    # 11,000 triangles; the user: "cut up really bad ... holes all over it"). The UVs are per corner, so they survive
    # the weld. Better still: have project_picture.py make the head at its final count (--tris), and leave this off.
    bm = bmesh.new()
    bm.from_mesh(head.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bm.to_mesh(head.data)
    bm.free()
    dec = head.modifiers.new('reduce', 'DECIMATE')
    dec.ratio = int(opt['tris']) / sum(len(p.vertices) - 2 for p in head.data.polygons)
    bpy.context.view_layer.objects.active = head
    bpy.ops.object.modifier_apply(modifier=dec.name)
    print(f'HEAD reduced: {before} faces to {sum(len(p.vertices) - 2 for p in head.data.polygons)} triangles')
for slot in head.material_slots:
    for node in (slot.material.node_tree.nodes if slot.material and slot.material.node_tree else []):
        if node.type == 'TEX_IMAGE' and node.image:
            is_normal = 'normal' in (node.image.name + node.label + node.name).lower() or node.image.colorspace_settings.name == 'Non-Color'
            cap = int(opt.get('normal-tex' if is_normal else 'tex', 0) or 0)
            if cap and max(node.image.size) > cap:
                w, h = node.image.size
                node.image.scale(int(w * cap / max(w, h)), int(h * cap / max(w, h)))
                print(f'HEAD picture {node.image.name}: {w}x{h} to {tuple(node.image.size)}')

# Weights: every vertex group of the body's skin, carried to the new head from the uncut copy.
for g in src.vertex_groups:
    if g.name not in head.vertex_groups:
        head.vertex_groups.new(name=g.name)
bpy.context.view_layer.objects.active = head
dt = head.modifiers.new('weights', 'DATA_TRANSFER')
dt.object = src
dt.use_vert_data = True
dt.data_types_verts = {'VGROUP_WEIGHTS'}
dt.vert_mapping = 'POLYINTERP_NEAREST'
dt.layers_vgroup_select_src = 'ALL'
dt.layers_vgroup_select_dst = 'NAME'
bpy.ops.object.modifier_apply(modifier=dt.name)
# At most four weights a vertex, normalised (what the game's loader expects).
bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
bpy.data.objects.remove(src, do_unlink=True)
head.parent = arm
head.matrix_parent_inverse = arm.matrix_world.inverted()
mod = head.modifiers.new('armature', 'ARMATURE')
mod.object = arm
head.name = 'head_generated'
if opt.get('faceless', '0') == '1':
    for slot in head.material_slots:
        if slot.material:
            slot.material.name = 'head_generated.body'
heavy = {g.name: 0 for g in head.vertex_groups}
for v in head.data.vertices:
    if v.groups:
        best = max(v.groups, key=lambda e: e.weight)
        heavy[head.vertex_groups[best.group].name] += 1
print('HEAD weights, vertices by their main bone:', {k: n for k, n in sorted(heavy.items(), key=lambda kv: -kv[1]) if n})

for o in bpy.context.selected_objects:
    o.select_set(False)
bpy.ops.export_scene.gltf(filepath=out_file, export_format='GLB', export_yup=True, export_skins=True, export_animations=False,
                          export_apply=False, export_image_format='AUTO')
print('wrote', out_file)
