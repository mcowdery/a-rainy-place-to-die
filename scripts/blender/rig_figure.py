"""A generated figure (one skin, no skeleton: a statue) given the cast's skeleton, so it can be posed and play the
animation library's clips like one of the cast (models/characters.ts, characterAnims.ts).

  "<blender.exe>" -b --python scripts/blender/rig_figure.py -- <figure.glb> <joints.json> <out.glb>
        [--body <body.glb>] [--height 1.58] [--template assets/characters/julie.glb] [--voxel 0.012] [--hands own] [--proxy <a whole figure's .glb>]

`figure.glb` is the mesh as the generator made it (y up, facing +z, standing in an A-pose), or that with a head set on
it (stitch_head.py); `joints.json` is where its joints lie in the picture it was made from
(scripts/props/figure_landmarks.py, run on the body job's cutout.png). `--body` is the full-length mesh the joints
were found on, when the figure has since had a head set on it and so may fill another box (stitching keeps the
body's own coordinates). The skeleton is the template's (one of the cast: the `game_engine` rig, 53 bones with
Unreal mannequin names), each joint moved to where this figure's is: across and up from the picture, in depth to the
middle of the mesh there. The limbs' joints are the picture's own; the trunk's, neck's and head's are the template's,
carried over by height between the hips, the shoulders and the top of the head. The hands are the template's own,
put on in place of the figure's (a generated hand is a swollen mitten), with their fingers' bones and weights;
`--hands own` keeps the figure's, which then turn at the wrist as one piece.

The weights: Blender's own (bone heat) on a watertight stand-in remeshed from the figure, then carried onto the
figure by nearest surface. Heat fails on a generated mesh as it comes (several shells, laid over one another); on
the stand-in it doesn't. Out comes a .glb as the cast's are: +y up, metres, facing +z, feet at y 0, the skin with up
to four weights a vertex.
"""
import json
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index('--') + 1 :]
figure_file, joints_file, out = args[:3]
opt = {args[i][2:]: args[i + 1] for i in range(3, len(args) - 1, 2)}
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HEIGHT = float(opt.get('height', 1.58))
TEMPLATE = opt.get('template', os.path.join(ROOT, 'assets', 'characters', 'julie.glb'))
VOXEL = float(opt.get('voxel', 0.012))
HANDS = opt.get('hands', 'template') != 'own'

bpy.ops.wm.read_factory_settings(use_empty=True)


def only(ob):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def load(path, apart=None):
    """A .glb's meshes joined into one object with nothing left to apply, its armature if it has one, and a copy
    of the one mesh whose name ends with `apart` (the template's skin, for its hands)."""
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.import_scene.gltf(filepath=path)
    new = list(bpy.context.selected_objects)
    meshes = [o for o in new if o.type == 'MESH']
    kept = None
    if apart:
        only(next(o for o in meshes if o.name.endswith(apart)))
        bpy.ops.object.duplicate()
        kept = bpy.context.view_layer.objects.active
        for m in [m for m in kept.modifiers if m.type == 'ARMATURE']:
            kept.modifiers.remove(m)
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    rig = next((o for o in new if o.type == 'ARMATURE'), None)
    other = [o.name for o in new if o.type not in ('MESH', 'ARMATURE')]
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
        for m in [m for m in o.modifiers if m.type == 'ARMATURE']:
            o.modifiers.remove(m)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if rig is not None:
        only(rig)
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    for name in other:
        bpy.data.objects.remove(bpy.data.objects[name])
    return ob, rig, kept


def points(ob):
    co = np.empty(len(ob.data.vertices) * 3, np.float32)
    ob.data.vertices.foreach_get('co', co)
    return co.reshape(-1, 3).astype(np.float64)


# 1. The figure, to its height in metres, its feet on the ground, its middle over the origin. (Blender's frame: x
# across, the picture's right and the figure's own left at +x; z up; the figure faces -y.)
figure, _, _ = load(figure_file)
figure.name = 'figure'
P = points(figure)
if 'body' in opt:
    body, _, _ = load(opt['body'])
    Q = points(body)
    bpy.data.objects.remove(body)
else:
    Q = P
lo, hi = Q.min(axis=0), Q.max(axis=0)
k = HEIGHT / (hi[2] - lo[2])
origin = np.array([(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, lo[2]])
figure.data.vertices.foreach_set('co', ((P - origin) * k).astype(np.float32).ravel())
figure.data.update()
P = points(figure)
print(f'FIGURE {len(figure.data.polygons)} faces, {HEIGHT:.2f} m tall, {P[:, 0].max() - P[:, 0].min():.2f} across, {P[:, 1].max() - P[:, 1].min():.2f} deep')

depsgraph = bpy.context.evaluated_depsgraph_get()
tree = BVHTree.FromObject(figure, depsgraph)


def depth(x, z, spread=0.012):
    """The middle of the mesh from front to back at a point seen from the front (a little round it too: a joint
    found in a picture can lie a hair off a thin limb)."""
    mids = []
    for dx, dz in ((0, 0), (spread, 0), (-spread, 0), (0, spread), (0, -spread)):
        front = tree.ray_cast(Vector((x + dx, -5, z + dz)), Vector((0, 1, 0)))[0]
        back = tree.ray_cast(Vector((x + dx, 5, z + dz)), Vector((0, -1, 0)))[0]
        if front is not None and back is not None:
            mids.append((front.y + back.y) / 2)
            if (dx, dz) == (0, 0):
                return mids[0]
    return float(np.median(mids)) if mids else 0.0


with open(joints_file, encoding='utf8') as f:
    seen = json.load(f)['joints']


def at(name, z=None):
    j = seen[name]
    x = (lo[0] + j['u'] * (hi[0] - lo[0]) - origin[0]) * k
    z = (hi[2] - j['v'] * (hi[2] - lo[2]) - origin[2]) * k if z is None else z
    return Vector((x, depth(x, z), z))


# 2. The template's skeleton, and where its joints are.
template, rig, skin = load(TEMPLATE, '.body' if HANDS else None)
only(rig)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
T = {b.name: (rig.matrix_world @ b.head_local).copy() for b in rig.data.bones}
t_top = points(template)[:, 2].max()
bpy.data.objects.remove(template)
if T['upperarm_l'].x < T['upperarm_r'].x:
    raise SystemExit("The template's left isn't at +x: not the cast's frame.")

# 3. This figure's joints. The limbs' from the picture.
N = {}
for side, word in (('l', 'left'), ('r', 'right')):
    N[f'upperarm_{side}'] = at(f'{word}_shoulder')
    N[f'lowerarm_{side}'] = at(f'{word}_elbow')
    N[f'hand_{side}'] = at(f'{word}_wrist')
    # (A hand that hangs against the thigh has the thigh's depth, not the arm's: the wrist stays within 2 cm of the elbow's depth, the arm hanging straight down.)
    N[f'hand_{side}'].y = min(max(N[f'hand_{side}'].y, N[f'lowerarm_{side}'].y - 0.02), N[f'lowerarm_{side}'].y + 0.02)
    N[f'thigh_{side}'] = at(f'{word}_hip')
    N[f'calf_{side}'] = at(f'{word}_knee')
    N[f'foot_{side}'] = at(f'{word}_ankle')
hip_z = (N['thigh_l'].z + N['thigh_r'].z) / 2
sh_z = (N['upperarm_l'].z + N['upperarm_r'].z) / 2
t_hip_z = (T['thigh_l'].z + T['thigh_r'].z) / 2
t_sh_z = (T['upperarm_l'].z + T['upperarm_r'].z) / 2
wide = (N['upperarm_l'].x - N['upperarm_r'].x) / (T['upperarm_l'].x - T['upperarm_r'].x)
hips_x = (N['thigh_l'].x + N['thigh_r'].x) / 2
sh_x = (N['upperarm_l'].x + N['upperarm_r'].x) / 2
ears = (at('left_ear') + at('right_ear')) / 2


def up(z):
    """A height on the template to the same place on this figure: between the ground, the hips, the shoulders and
    the top of the head."""
    return float(np.interp(z, [0, t_hip_z, t_sh_z, t_top], [0, hip_z, sh_z, HEIGHT]))


def middle(z):
    """The body's middle line across, at a height: the hips', the shoulders', the head's."""
    return float(np.interp(z, [hip_z, sh_z, ears.z], [hips_x, sh_x, ears.x]))


for name in ('pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head'):
    z = up(T[name].z)
    x = middle(z)
    N[name] = Vector((x, depth(x, z), z))
for side in 'lr':
    z = up(T[f'clavicle_{side}'].z)
    x = middle(z) + T[f'clavicle_{side}'].x * wide
    N[f'clavicle_{side}'] = Vector((x, depth(middle(z), z), z))
    # The foot: its ball and its tip where the shoe's front is, on the ground.
    ankle = N[f'foot_{side}']
    near = P[(P[:, 2] < 0.07) & (np.abs(P[:, 0] - ankle.x) < 0.08)]
    toe_y = float(np.percentile(near[:, 1], 1)) if len(near) else ankle.y - 0.18
    toe_x = at(f"{'left' if side == 'l' else 'right'}_foot_index").x
    N[f'ball_{side}'] = Vector((ankle.x + 0.7 * (toe_x - ankle.x), ankle.y + 0.68 * (toe_y - ankle.y), 0.02))
    N[f'toe_{side}'] = Vector((toe_x, toe_y, 0.02))
    # The hand's knuckles (the picture's first and little fingers'), at the wrist's depth.
    word = 'left' if side == 'l' else 'right'
    knuckle = (at(f'{word}_index') + at(f'{word}_pinky')) / 2
    N[f'knuckle_{side}'] = Vector((knuckle.x, N[f'hand_{side}'].y, knuckle.z))
N['top'] = Vector((N['head'].x, N['head'].y, HEIGHT))
T['top'] = Vector((T['head'].x, T['head'].y, t_top))
for side in 'lr':
    T[f'knuckle_{side}'] = T[f'middle_01_{side}']
    T[f'toe_{side}'] = (rig.matrix_world @ rig.data.bones[f'ball_{side}'].tail_local).copy()

AIM = {'pelvis': 'spine_01', 'spine_01': 'spine_02', 'spine_02': 'spine_03', 'spine_03': 'neck_01', 'neck_01': 'head', 'head': 'top'}
for side in 'lr':
    AIM.update({f'clavicle_{side}': f'upperarm_{side}', f'upperarm_{side}': f'lowerarm_{side}', f'lowerarm_{side}': f'hand_{side}', f'hand_{side}': f'knuckle_{side}', f'thigh_{side}': f'calf_{side}', f'calf_{side}': f'foot_{side}', f'foot_{side}': f'ball_{side}', f'ball_{side}': f'toe_{side}'})


def carry(name):
    """What takes a template bone to this figure's: its joint to its joint, turned and sized so the next joint
    along lands on the next."""
    a, b = T[AIM[name]] - T[name], N[AIM[name]] - N[name]
    turn = a.rotation_difference(b).to_matrix().to_4x4()
    # (A hand is as big as the body is tall: the picture's knuckles say which way it points, and no more.)
    size = HEIGHT / t_top if name.startswith('hand_') else b.length / a.length
    return Matrix.Translation(N[name]) @ turn @ Matrix.Scale(size, 4) @ Matrix.Translation(-T[name])


only(rig)
bpy.ops.object.mode_set(mode='EDIT')
moves = {name: carry(name) for name in AIM}
for bone in rig.data.edit_bones:
    bone.use_connect = False
for bone in rig.data.edit_bones:
    owner = bone
    while owner is not None and owner.name not in moves:
        owner = owner.parent  # (a finger goes with its hand)
    if owner is not None:
        bone.transform(moves[owner.name])
bpy.ops.object.mode_set(mode='OBJECT')
for bone in rig.data.bones:
    # A generated hand is a mitten: it turns at the wrist as one piece.
    if bone.name == 'Root' or bone.name.split('_')[0] in ('thumb', 'index', 'middle', 'ring', 'pinky'):
        bone.use_deform = False
rig.name = 'figure_rig'
leg = (N['thigh_l'] - N['calf_l']).length + (N['calf_l'] - N['foot_l']).length
arm = (N['upperarm_l'] - N['lowerarm_l']).length + (N['lowerarm_l'] - N['hand_l']).length
t_leg = (T['thigh_l'] - T['calf_l']).length + (T['calf_l'] - T['foot_l']).length
t_arm = (T['upperarm_l'] - T['lowerarm_l']).length + (T['lowerarm_l'] - T['hand_l']).length
print(f'SKELETON hips at {hip_z:.2f} m (the template\'s {t_hip_z:.2f}), shoulders {sh_z:.2f} ({t_sh_z:.2f}), {N["upperarm_l"].x - N["upperarm_r"].x:.2f} across ({T["upperarm_l"].x - T["upperarm_r"].x:.2f}); leg {leg:.2f} ({t_leg:.2f}), arm {arm:.2f} ({t_arm:.2f})')
for name in ('upperarm_l', 'lowerarm_l', 'hand_l', 'thigh_l', 'calf_l', 'foot_l', 'ball_l', 'head'):
    print(f'  {name}: {tuple(round(v, 3) for v in N[name])}')

# 4. The weights: on a watertight stand-in, then carried over.
if 'proxy' in opt:
    # A figure put together from pieces (a head set on a body) is open along its joins, which a voxel remesh can't
    # make a solid of; the weights are then taken from a whole figure that sits where it does (the body with its own
    # head), put through the same scale and place, and carried over by nearest surface all the same.
    proxy, _, _ = load(opt['proxy'])
    Pp = points(proxy)
    proxy.data.vertices.foreach_set('co', ((Pp - origin) * k).astype(np.float32).ravel())
    proxy.data.update()
else:
    only(figure)
    bpy.ops.object.duplicate()
    proxy = bpy.context.view_layer.objects.active
source = proxy
source.name = 'stand_in_source'
# (Bone heat either solves a stand-in or gives it nothing at all, and which depends on the voxel size in no way that
# can be told beforehand: the same figure failed at 12 mm and took at 12.5. So a few sizes are tried in turn.)
for size in (VOXEL, VOXEL * 1.04, VOXEL * 0.92, VOXEL * 1.17, VOXEL * 1.33, VOXEL * 0.8):
    only(source)
    bpy.ops.object.duplicate()
    proxy = bpy.context.view_layer.objects.active
    proxy.name = 'stand_in'
    remesh = proxy.modifiers.new('remesh', 'REMESH')
    remesh.mode = 'VOXEL'
    remesh.voxel_size = size
    bpy.ops.object.modifier_apply(modifier='remesh')
    bpy.ops.object.select_all(action='DESELECT')
    proxy.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    weighted = sum(1 for v in proxy.data.vertices if any(g.weight > 0 for g in v.groups))
    print(f'WEIGHTS stand-in at {size * 1000:.1f} mm: {len(proxy.data.vertices)} points, {weighted} with weights')
    if weighted >= 0.9 * len(proxy.data.vertices):
        break
    bpy.data.objects.remove(proxy)
else:
    raise SystemExit('Bone heat failed on the stand-in at every size tried: try another --voxel.')
bpy.data.objects.remove(source)

only(figure)
carry_over = figure.modifiers.new('weights', 'DATA_TRANSFER')
carry_over.object = proxy
carry_over.use_vert_data = True
carry_over.data_types_verts = {'VGROUP_WEIGHTS'}
carry_over.vert_mapping = 'POLYINTERP_NEAREST'
carry_over.layers_vgroup_select_src = 'ALL'
carry_over.layers_vgroup_select_dst = 'NAME'
bpy.ops.object.datalayout_transfer(modifier='weights')
bpy.ops.object.modifier_apply(modifier='weights')
bpy.data.objects.remove(proxy)

# A generated figure's legs are one skin wherever they touch (its shoes, its thighs), so heat runs from each leg's
# bones into the other leg and a shoe is pulled out between the two feet at every step. Below the crotch each side
# is given to its own leg: what a point has of the other leg's bones goes to the same bones on its own side.
legs = ('thigh', 'calf', 'foot', 'ball')
group = {name: figure.vertex_groups[name] for side in 'lr' for name in (f'{b}_{side}' for b in legs) if name in figure.vertex_groups}
of = {g.index: name for name, g in group.items()}
heights = [0.02, (N['foot_l'].z + N['foot_r'].z) / 2, (N['calf_l'].z + N['calf_r'].z) / 2, hip_z]
between = [(N[f'{b}_l'].x + N[f'{b}_r'].x) / 2 for b in ('ball', 'foot', 'calf', 'thigh')]
crotch = hip_z - 0.045 * HEIGHT
moved = 0
for v in figure.data.vertices:
    # (All of it from 3 cm under the crotch down, none of it from 3 cm over.)
    share = min(1.0, max(0.0, (crotch + 0.03 - v.co.z) / 0.06))
    if share == 0:
        continue
    share = share * share * (3 - 2 * share)
    own = 'l' if v.co.x > float(np.interp(v.co.z, heights, between)) else 'r'
    for g in list(v.groups):
        name = of.get(g.group)
        if name is None or name[-1] == own or g.weight == 0:
            continue
        mine = name[:-1] + own
        if mine in group:
            group[mine].add([v.index], g.weight * share, 'ADD')
        group[name].add([v.index], g.weight * (1 - share), 'REPLACE')
        moved += 1
# And the faces that still join the two legs there (a web drawn out between the feet at every step) are taken out:
# what's left is a slit up the inside of each shoe or thigh, where the generator made no surface because the two
# were touching.
across = []
for face in figure.data.polygons:
    xs = [figure.data.vertices[i].co for i in face.vertices]
    if max(p.z for p in xs) < crotch - 0.03 and len({p.x > float(np.interp(p.z, heights, between)) for p in xs}) == 2:
        across.append(face.index)
bm = bmesh.new()
bm.from_mesh(figure.data)
bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.faces[i] for i in across], context='FACES')
bm.to_mesh(figure.data)
bm.free()
print(f'  legs: {moved} weights moved to their own side below {crotch:.2f} m; {len(across)} faces that joined the two legs there taken out')
bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)

# The hands. A generator's are swollen mittens (a hand is a few pixels of the picture it works from), so the
# figure's own are cut off at the wrist and the template's put there: a modelled hand with its fingers' bones and
# weights, turned and sized as the hand's bone was, a little of its wrist up inside the cuff, its skin brought to
# the colour of the figure's face.
if HANDS:
    def paint(ob):
        """Each face's colour, from the texture of the material it has."""
        mesh = ob.data
        uv = np.empty(len(mesh.loops) * 2, np.float32)
        mesh.uv_layers.active.data.foreach_get('uv', uv)
        mid = uv.reshape(-1, 3, 2).mean(axis=1)
        which = np.empty(len(mesh.polygons), np.int32)
        mesh.polygons.foreach_get('material_index', which)
        colour = np.zeros((len(mesh.polygons), 3), np.float32)
        for index, material in enumerate(mesh.materials):
            node = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED').inputs['Base Color'].links[0].from_node
            while node.type != 'TEX_IMAGE':
                node = next(i.links[0].from_node for i in node.inputs if i.links)
            w, h = node.image.size
            px = np.array(node.image.pixels[:], np.float32).reshape(h, w, 4)[:, :, :3]
            mine = which == index
            colour[mine] = px[np.clip((mid[mine, 1] % 1 * h).astype(int), 0, h - 1), np.clip((mid[mine, 0] % 1 * w).astype(int), 0, w - 1)]
        return colour, node.image

    def corners(ob):
        loops = np.empty(len(ob.data.loops), np.int32)
        ob.data.loops.foreach_get('vertex_index', loops)
        assert len(loops) == 3 * len(ob.data.polygons)
        return loops.reshape(-1, 3)

    def drop(ob, faces):
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.faces[i] for i in faces], context='FACES')
        bm.to_mesh(ob.data)
        bm.free()

    # The figure's face: what looks forward just above the head's joint, and isn't hair.
    F, tris = points(figure), corners(figure)
    colours, _ = paint(figure)
    mids = F[tris].mean(axis=1)
    edge = np.cross(F[tris][:, 1] - F[tris][:, 0], F[tris][:, 2] - F[tris][:, 0])
    forward = edge[:, 1] / np.maximum(np.linalg.norm(edge, axis=1), 1e-12) < -0.6
    face = forward & (np.abs(mids[:, 0] - N['head'].x) < 0.045) & (mids[:, 2] > N['head'].z) & (mids[:, 2] < N['head'].z + 0.07) & (colours.max(axis=1) > 0.45)
    tone = np.median(colours[face], axis=0) if face.sum() > 20 else None

    # The figure's own hands, off: the arm's skin (told by its weights: a hand hangs beside the thigh, which is
    # as near) cut through at the wrist, square to the forearm, and what lies past it taken away.
    arm = {side: {figure.vertex_groups[n].index for n in (f'hand_{side}', f'lowerarm_{side}') if n in figure.vertex_groups} for side in 'lr'}
    armed = {side: np.array([sum(g.weight for g in v.groups if g.group in arm[side]) > 0.5 for v in figure.data.vertices]) for side in 'lr'}
    before = len(figure.data.polygons)
    bm = bmesh.new()
    bm.from_mesh(figure.data)
    # (Both arms' points are picked out before either is cut: a cut renumbers them.)
    # A hand that hung against the thigh is one skin with it (the palm IS the thigh's surface there), so cutting by
    # weights alone takes a bite out of the thigh. What lies within the thigh's own radius of its axis stays, as the
    # thigh; only what stands out of it (the fingers, the thumb, the back of the hand) goes.
    P_all = points(figure)
    thigh_r = {}
    for side in 'lr':
        a_, b_ = np.array(N[f'thigh_{side}']), np.array(N[f'calf_{side}'])
        axis_ = (b_ - a_) / np.linalg.norm(b_ - a_)
        rel_ = P_all - a_
        t_ = rel_ @ axis_
        rad_ = np.linalg.norm(rel_ - np.outer(t_, axis_), axis=1)
        wz = N[f'hand_{side}'].z
        band = (P_all[:, 2] < wz - 0.14) & (P_all[:, 2] > wz - 0.30) & ~armed['l'] & ~armed['r'] & (rad_ < 0.2) & ((P_all[:, 0] > 0) == (side == 'l'))
        thigh_r[side] = (float(np.percentile(rad_[band], 90)) if band.sum() > 50 else 0.0, a_, axis_)
        print(f'  thigh {side}: radius {thigh_r[side][0] * 100:.1f} cm from {int(band.sum())} points')

    def stands_out(side, co):
        r_, a_, axis_ = thigh_r[side]
        rel_ = np.array(co) - a_
        return np.linalg.norm(rel_ - (rel_ @ axis_) * axis_) > r_ * 1.25

    picked = {side: {v for v in bm.verts if armed[side][v.index] and (v.co - N[f'hand_{side}']).length < 0.24 and (v.co.z > N[f'hand_{side}'].z - 0.01 or stands_out(side, v.co))} for side in 'lr'}
    # The template's wrist is slimmer than a generated forearm (on a bare arm the step shows), so the last 9 cm of the
    # arm is drawn in to the template's wrist radius (a little over it) before it's cut: no ledge where the hand comes out.
    size_hand = HEIGHT / t_top
    Sk = points(skin)
    for side in 'lr':
        w0 = np.array(T[f'hand_{side}'])
        a0 = w0 - np.array(T[f'lowerarm_{side}'])
        a0 /= np.linalg.norm(a0)
        rel = Sk - w0
        d0 = rel @ a0
        rad0 = np.linalg.norm(rel - np.outer(d0, a0), axis=1)
        near0 = (d0 > -0.02) & (d0 < 0.0) & (rad0 < 0.06)
        if near0.sum() < 5:
            continue
        r_stub = float(np.median(rad0[near0])) * size_hand * 1.03
        wrist = np.array(N[f'hand_{side}'])
        along = np.array((N[f'hand_{side}'] - N[f'lowerarm_{side}']).normalized())
        vs = list(picked[side])
        co = np.array([tuple(v.co) for v in vs])
        d = (co - wrist) @ along
        radial = co - wrist - np.outer(d, along)
        r = np.linalg.norm(radial, axis=1)
        ring = (np.abs(d) < 0.015) & (r < 0.08)
        if ring.sum() < 5:
            continue
        r_cut = float(np.median(r[ring]))
        if r_stub >= r_cut:
            continue
        t = np.clip((d + 0.09) / 0.09, 0, 1)
        t = t * t * (3 - 2 * t)
        factor = np.where((d < 0.02) & (r < 0.06), 1 + t * (r_stub / r_cut - 1), 1.0)
        new = wrist + np.outer(d, along) + radial * factor[:, None]
        for v, p in zip(vs, new):
            v.co = Vector(p)
        print(f'  wrist {side}: forearm drawn in from {r_cut * 100:.1f} to {r_stub * 100:.1f} cm radius over its last 9 cm')
    for side in 'lr':
        wrist = N[f'hand_{side}']
        along = (wrist - N[f'lowerarm_{side}']).normalized()
        mine = picked[side]
        geom = list(mine) + [e for e in bm.edges if e.verts[0] in mine and e.verts[1] in mine] + [f for f in bm.faces if all(v in mine for v in f.verts)]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=wrist, plane_no=along, clear_outer=True)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(figure.data)
    bm.free()
    gone = np.array([before - len(figure.data.polygons)])

    # The template's, on: each from 2 cm above its wrist, carried as its hand's bone was.
    bpy.ops.object.select_all(action='DESELECT')
    only(skin)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.quads_convert_to_tris()
    bpy.ops.object.mode_set(mode='OBJECT')
    S, tris = points(skin), corners(skin)
    keep = np.zeros(len(tris), bool)
    for side in 'lr':
        wrist = np.array(T[f'hand_{side}'])
        along = wrist - np.array(T[f'lowerarm_{side}'])
        along /= np.linalg.norm(along)
        mine = ((S - wrist) @ along > -0.02) & (np.linalg.norm(S - wrist, axis=1) < 0.26)
        keep |= mine[tris].all(axis=1)
        move = np.array(moves[f'hand_{side}'])
        S[mine] = S[mine] @ move[:3, :3].T + move[:3, 3]
    skin.data.vertices.foreach_set('co', S.astype(np.float32).ravel())
    skin.data.update()
    drop(skin, np.where(~keep)[0])
    # Their paint: the part of the template's skin texture the hands use, cut out, tinted, and no bigger than it need be.
    uv = np.empty(len(skin.data.loops) * 2, np.float32)
    skin.data.uv_layers.active.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    colours, image = paint(skin)
    w, h = image.size
    u0, v0 = np.floor(uv.min(axis=0) * [w, h]).astype(int) - 2
    u1, v1 = np.ceil(uv.max(axis=0) * [w, h]).astype(int) + 2
    u0, v0, u1, v1 = max(u0, 0), max(v0, 0), min(u1, w), min(v1, h)
    patch = np.array(image.pixels[:], np.float32).reshape(h, w, 4)[v0:v1, u0:u1].copy()
    if tone is not None:
        patch[:, :, :3] = np.clip(patch[:, :, :3] * np.clip(tone / np.maximum(np.median(colours, axis=0), 1e-3), 0.5, 1.7), 0, 1)
    patch[:, :, 3] = 1
    # (The two hands lie far apart in the template's texture: most of what is cut out is the space between them.)
    patch = np.ascontiguousarray(patch[:: max(1, -(-max(patch.shape[:2]) // 640)), :: max(1, -(-max(patch.shape[:2]) // 640))])
    painted = bpy.data.images.new('hands', patch.shape[1], patch.shape[0], alpha=False)
    painted.pixels.foreach_set(patch.ravel())
    painted.pack()
    skin.data.uv_layers.active.data.foreach_set('uv', ((uv * [w, h] - [u0, v0]) / [u1 - u0, v1 - v0]).astype(np.float32).ravel())
    material = skin.data.materials[0].copy()
    material.name = 'hands'
    next(n for n in material.node_tree.nodes if n.type == 'TEX_IMAGE' and n.image == image).image = painted
    skin.data.materials.clear()
    skin.data.materials.append(material)
    skin.name = 'hands'
    for bone in rig.data.bones:
        if bone.name != 'Root':
            bone.use_deform = True
    print(f"  hands: the figure's own cut off ({int(gone.sum())} faces), the template's put on ({len(skin.data.polygons)} faces, a {patch.shape[1]}x{patch.shape[0]} texture, {HEIGHT / t_top:.2f} of their size), tinted {'to the face' if tone is not None else 'not at all: no face found'}")
    bpy.ops.object.select_all(action='DESELECT')
    skin.select_set(True)
    figure.select_set(True)
    bpy.context.view_layer.objects.active = figure
    bpy.ops.object.join()

skin = figure.modifiers.new('skin', 'ARMATURE')
skin.object = rig
figure.parent = rig
# A point the stand-in gave nothing (it lay too far from the stand-in's skin: a loose lock of hair, a fingertip) would
# stay where it was while the figure walked away: it takes the weights of the nearest point that has some.
def weighted(v):
    return any(g.weight > 0 for g in v.groups)


have = [v for v in figure.data.vertices if weighted(v)]
lost = [v for v in figure.data.vertices if not weighted(v)]
if lost and have:
    from mathutils import kdtree as _kd

    near = _kd.KDTree(len(have))
    for i, v in enumerate(have):
        near.insert(v.co, i)
    near.balance()
    for v in lost:
        donor = have[near.find(v.co)[1]]
        for g in donor.groups:
            if g.weight > 0:
                figure.vertex_groups[g.group].add([v.index], g.weight, 'REPLACE')
    print(f'  {len(lost)} points with no weight took those of their nearest neighbour')
bare = sum(1 for v in figure.data.vertices if not weighted(v))
print(f'  the figure: {len(figure.data.vertices)} points, {bare} with no weight')

# 5. Out, as the cast's are.
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
figure.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=os.path.abspath(out), export_format='GLB', use_selection=True, export_yup=True, export_apply=False, export_skins=True, export_animations=False, export_materials='EXPORT', export_image_format='AUTO')
print('WROTE', out)
