"""
A mob figure from a model made to be looked at: the city's passers-by (src/poc3d/real/people.ts) are dark,
faceless and drawn by the hundred, so a model is worked backwards into one of them: the face's features taken off,
the skin its clothes hide removed, everything joined into one mesh, the arms brought down to hang, the triangles
cut to a few thousand, and its weights carried onto the mob's own fourteen bones (two a vertex). What's kept is
the shape: proportions, hair, the outline of the clothes.

  "<blender.exe>" -b --python scripts/blender/mob_from_model.py -- <in.vrm|.glb|.fbx> <out.json>
      [--name id] [--body woman|man|child|elder] [--tris 3200] [--hair 0.4] [--height 1.68] [--preview <absolute .png>]

Models it knows the skeleton of: VRoid Studio's VRM (J_Bip_* bones, a T-pose, the body whole under its clothes,
the face's features as materials of their own), this project's own cast (assets/characters/*.glb: MakeHuman on the
Unreal mannequin's bones, an A-pose, a mesh per asset, hair on cards cut out by their texture) and Microsoft
Rocketbox's FBX (3ds Max Biped bones, an A-pose, one mesh). Another rig needs its bones' names in RIGS.

--tris is the whole figure's budget, --hair the share of it the hair may have where the hair is its own mesh (hair
is strands: it needs more than its size), --height the figure's height to the top of its head in metres.

The output is a JSON template (src/poc3d/real/mobModels.ts reads it): positions (the mob's frame: x across, y up,
z forward, feet at y 0), normals, two bones and a weight per vertex, a shade per vertex (skin tagged +100, hair and
trousers darker), triangles, the fourteen joints, and the arms' angle from the body.
"""
import bpy, bmesh, sys, os, json, math, shutil, tempfile
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
opt = {'name': os.path.splitext(os.path.basename(out))[0], 'body': 'woman', 'tris': '3200', 'hair': '0.4', 'height': '1.68', 'preview': ''}
for i, a in enumerate(argv):
    if a.startswith('--') and a[2:] in opt:
        opt[a[2:]] = argv[i + 1]
TRIS, HAIR_SHARE, HEIGHT = int(opt['tris']), float(opt['hair']), float(opt['height'])

# The mob's bones (real/mobRig.ts).
PELVIS, SPINE, HEAD, THIGH_L, SHIN_L, THIGH_R, SHIN_R, ARM_L, FORE_L, ARM_R, FORE_R, ROOT, FOOT_L, FOOT_R = range(14)
# How far from straight down the arms hang (rad).
ARM_OUT = 0.2
# Shades (real/mobShape.ts): skin tagged +100.
SKIN, TOP, BOTTOM, SHOE, HAIR, WHITE = 101.0, 1.0, 0.78, 0.5, 0.5, 3.6

bpy.ops.wm.read_factory_settings(use_empty=True)
if src.lower().endswith('.fbx'):
    bpy.ops.import_scene.fbx(filepath=src)
else:
    glb = os.path.join(tempfile.gettempdir(), 'mob_from_model.glb')
    shutil.copyfile(src, glb)
    bpy.ops.import_scene.gltf(filepath=glb)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
meshes = [o for o in bpy.data.objects if o.type == 'MESH' and any(m.type == 'ARMATURE' for m in o.modifiers)]

# The joints the mob poses by, as each rig names them (%s: L or R).
RIGS = {
    'vroid': dict(pelvis='J_Bip_C_Hips', spine='J_Bip_C_Spine', neck='J_Bip_C_Neck', thigh='J_Bip_%s_UpperLeg', shin='J_Bip_%s_LowerLeg', foot='J_Bip_%s_Foot', arm='J_Bip_%s_UpperArm', fore='J_Bip_%s_LowerArm', hand='J_Bip_%s_Hand'),
    'cast': dict(pelvis='pelvis', spine='spine_01', neck='neck_01', thigh='thigh_%s', shin='calf_%s', foot='foot_%s', arm='upperarm_%s', fore='lowerarm_%s', hand='hand_%s', sides=('l', 'r')),
    'biped': dict(pelvis='Bip01 Pelvis', spine='Bip01 Spine', neck='Bip01 Neck', thigh='Bip01 %s Thigh', shin='Bip01 %s Calf', foot='Bip01 %s Foot', arm='Bip01 %s UpperArm', fore='Bip01 %s Forearm', hand='Bip01 %s Hand'),
}
RIG = next((r for r in RIGS.values() if r['pelvis'] in arm.data.bones), None)
if RIG is None:
    raise SystemExit('unknown skeleton: ' + ', '.join(b.name for b in list(arm.data.bones)[:12]))
SIDES = RIG.get('sides', ('L', 'R'))
VROID = RIG is RIGS['vroid']
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o not in meshes:
        bpy.data.objects.remove(o)


def activate(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def kind_of(name):
    """What a material is: hair, skin, a garment (and which), or something to take off the face."""
    n = name.upper()
    # (Rocketbox's 'opacity': wisps of hair and lashes on cards, nothing without their texture.)
    if any(k in n for k in ('EYEIRIS', 'EYEHIGHLIGHT', 'FACEBROW', 'FACEEYELINE', 'FACEEYELASH', 'FACEMOUTH', 'EYEEXTRA', 'OPACITY')):
        return 'drop'
    if any(k in n for k in ('EYEBROW', 'EYELASH', 'HIGH-POLY', 'LOW-POLY', 'EYEWHITE', 'TEETH', 'TONGUE')):
        return 'drop'
    if any(k in n for k in ('HAIR', 'SHORT0', 'LONG0', 'BOB', 'PONYTAIL', 'BRAID', 'AFRO', 'BANGS')):
        return 'hair'
    if any(k in n for k in ('APRON', 'HEADBAND')):
        return 'white'
    if 'SHOE' in n:
        return 'shoe'
    if 'BOTTOM' in n:
        return 'bottom'
    if 'STOCKING' in n:
        return 'bottom'
    if any(k in n for k in ('SKIN', 'FACE', '.BODY')) or n.endswith('_HEAD') or n in ('HUMAN', 'BODY'):
        return 'skin'
    return 'top'


def alpha_of(mat):
    """The material's base colour texture's alpha as an array (None if it has none)."""
    if not mat or not mat.node_tree:
        return None
    for n in mat.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image and n.image.channels == 4 and n.image.size[0] > 0:
            w, h = n.image.size
            px = np.empty(w * h * 4, dtype=np.float32)
            n.image.pixels.foreach_get(px)
            return px.reshape(h, w, 4)[:, :, 3]
    return None


# ---- Take off what a faceless, dark figure doesn't show: the face's features, and whatever is transparent (the skin
# under the clothes is painted out in its texture; garments are cut out of theirs) ----
for o in meshes:
    me = o.data
    if me.shape_keys:
        o.shape_key_clear()
    uv = me.uv_layers.active
    kinds = [kind_of(m.name) if m else 'top' for m in me.materials]
    # (VRoid's hair is solid strands; elsewhere hair is cards cut out by their texture.)
    alphas = [None if k == 'hair' and VROID else alpha_of(m) for k, m in zip(kinds, me.materials)]
    drop = []
    for p in me.polygons:
        k = kinds[p.material_index]
        if k == 'drop':
            drop.append(p.index)
            continue
        a = alphas[p.material_index]
        if a is None or uv is None:
            continue
        # Transparent at its middle and at every corner: nothing of it shows.
        uvs = [uv.data[li].uv for li in p.loop_indices]
        pts = uvs + [sum(uvs, Vector((0, 0))) / len(uvs)]
        h, w = a.shape
        if all(a[int(min(0.999, max(0, q.y % 1.0)) * h), int(min(0.999, max(0, q.x % 1.0)) * w)] < 0.08 for q in pts):
            drop.append(p.index)
    # Skin a garment covers: a ray out from the face's middle and from each corner meets cloth within a few
    # centimetres (VRoid leaves the body whole under its clothes).
    cloth = [p for p in me.polygons if kinds[p.material_index] in ('top', 'bottom', 'shoe') and p.index not in set(drop)]
    if cloth and any(k == 'skin' for k in kinds):
        verts = [v.co.copy() for v in me.vertices]
        tree = BVHTree.FromPolygons(verts, [tuple(p.vertices) for p in cloth])
        covered = 0
        for p in me.polygons:
            if kinds[p.material_index] != 'skin':
                continue
            n = p.normal
            pts = [p.center] + [verts[i] for i in p.vertices]
            if all(tree.ray_cast(q + n * 0.0008, n, 0.05)[0] is not None for q in pts):
                drop.append(p.index)
                covered += 1
        print('   covered skin', covered)
    # The kinds as vertex groups, so they come through the joining and the cutting down.
    groups = {k: o.vertex_groups.new(name='mobkind_' + k) for k in ('hair', 'skin', 'bottom', 'shoe', 'white')}
    for p in me.polygons:
        k = kinds[p.material_index]
        if k in groups:
            groups[k].add(list(p.vertices), 1.0, 'REPLACE')
    if drop:
        activate(o)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_mode(type='FACE')
        bpy.ops.mesh.select_all(action='DESELECT')
        bpy.ops.object.mode_set(mode='OBJECT')
        for i in drop:
            me.polygons[i].select = True
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.delete(type='FACE')
        bpy.ops.object.mode_set(mode='OBJECT')
    print('MESH', o.name, sorted(set(kinds)), 'dropped', len(drop), 'faces; left', len(me.polygons))

# ---- The arms down from the T-pose, to hang a little out from the body ----
bones = arm.pose.bones
M = arm.matrix_world.copy()
Minv = M.inverted()
for side in SIDES:
    up, hand = bones[RIG['arm'] % side], bones[RIG['hand'] % side]
    shoulder, wrist = M @ up.head, M @ hand.head
    d = (wrist - shoulder).normalized()
    sx = 1.0 if d.x > 0 else -1.0
    want = Vector((sx * math.sin(ARM_OUT), 0, -math.cos(ARM_OUT)))
    q = d.rotation_difference(want)
    up.matrix = Minv @ Matrix.Translation(shoulder) @ q.to_matrix().to_4x4() @ Matrix.Translation(-shoulder) @ M @ up.matrix
    bpy.context.view_layer.update()
    # The legs straight down under the hips too (an A-pose stands with its feet apart; the mob's legs swing fore and aft).
    thigh, foot = bones[RIG['thigh'] % side], bones[RIG['foot'] % side]
    hip, ankle = M @ thigh.head, M @ foot.head
    d = (ankle - hip).normalized()
    want = Vector((0, d.y, d.z)).normalized()
    q = d.rotation_difference(want)
    thigh.matrix = Minv @ Matrix.Translation(hip) @ q.to_matrix().to_4x4() @ Matrix.Translation(-hip) @ M @ thigh.matrix
    bpy.context.view_layer.update()
for o in meshes:
    activate(o)
    for m in [m for m in o.modifiers if m.type == 'ARMATURE']:
        bpy.ops.object.modifier_apply(modifier=m.name)

# The joints, as posed (armature space is the world: the import leaves it at the origin).
head = {b.name: (arm.matrix_world @ b.head).copy() for b in bones}


def role(name):
    """What part of the body a bone is, by its name (None: ask its parent)."""
    u = name.upper()
    if 'UPPERLEG' in u or 'THIGH' in u:
        return 'thigh'
    if 'LOWERLEG' in u or 'CALF' in u:
        return 'shin'
    if 'FOOT' in u or 'TOE' in u:
        return 'foot'
    if 'UPPERARM' in u:
        return 'arm'
    if any(k in u for k in ('LOWERARM', 'FOREARM', 'HAND', 'FINGER', 'THUMB', 'INDEX', 'MIDDLE', 'LITTLE', '_RING')):
        return 'fore'
    if 'NECK' in u or 'HEAD' in u:
        return 'head'
    if 'HIPS' in u or 'PELVIS' in u:
        return 'pelvis'
    if any(k in u for k in ('SPINE', 'CHEST', 'SHOULDER', 'CLAVICLE')):
        return 'spine'
    return None


def mob_bone(b):
    """The mob bone a model bone's weight goes to: its own part's, else its nearest named ancestor's."""
    while b is not None:
        r = role(b.name)
        if r is not None:
            left = head[b.name].x < 0
            return {'thigh': THIGH_L if left else THIGH_R, 'shin': SHIN_L if left else SHIN_R, 'foot': FOOT_L if left else FOOT_R, 'arm': ARM_L if left else ARM_R,
                    'fore': FORE_L if left else FORE_R, 'head': HEAD, 'pelvis': PELVIS, 'spine': SPINE}[r]
        b = b.parent
    return PELVIS


to_mob = {b.name: mob_bone(b) for b in bones}


def blank_face(o):
    """
    A face with nothing to show through it: the mob is see-through, and every layer of a face draws its outline
    (the eyeballs behind the lids, the mouth's inside behind the lips). What's hidden from in front is cut out, the
    openings that leaves (the eyes, the lips) are sealed, and the face is smoothed blank: the brow, the nose and
    the chin stay as shapes, the lids and lips go.
    """
    me = o.data
    names = [g.name for g in o.vertex_groups]
    mw = o.matrix_world
    headw = np.zeros(len(me.vertices))
    for v in me.vertices:
        tot = hw = 0.0
        for g in v.groups:
            n = names[g.group]
            if n in to_mob:
                tot += g.weight
                if to_mob[n] == HEAD:
                    hw += g.weight
        headw[v.index] = hw / tot if tot > 0 else 0
    co = np.array([mw @ v.co for v in me.vertices])
    of_head = headw > 0.6
    if of_head.sum() < 50:
        return
    neck_z = head[RIG['neck']].z
    top_z = co[of_head][:, 2].max()
    skull = of_head & (co[:, 2] > neck_z + 0.35 * (top_z - neck_z))
    cy = float(np.median(co[skull][:, 1]))
    half = float(np.abs(co[skull][:, 0]).max())
    # The face: the front of the head between the chin and the brow, inside the ears.
    region = of_head & (co[:, 1] < cy - 0.1 * half) & (np.abs(co[:, 0]) < 0.72 * half) & (co[:, 2] > neck_z + 0.18 * (top_z - neck_z)) & (co[:, 2] < neck_z + 0.82 * (top_z - neck_z))
    if region.sum() < 30:
        return
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    # (As a set of the vertices themselves: their indices go stale as faces are cut.)
    R = {v for v in bm.verts if region[v.index]}
    fwd = mw.to_3x3().inverted() @ Vector((0, -1, 0))
    fwd.normalize()
    cut = 0
    for _ in range(2):
        bm.faces.ensure_lookup_table()
        tree = BVHTree.FromBMesh(bm)
        # Hidden from in front: something of the head stands before it.
        hidden = [f for f in bm.faces if all(v in R for v in f.verts) and tree.ray_cast(f.calc_center_median() + fwd * 0.0008, fwd, 0.25)[0] is not None]
        cut += len(hidden)
        bmesh.ops.delete(bm, geom=hidden, context='FACES')
        R = {v for v in R if v.is_valid}
        edges = [e for e in bm.edges if len(e.link_faces) == 1 and all(v in R for v in e.verts)]
        filled = bmesh.ops.holes_fill(bm, edges=edges, sides=0)['faces']
        bmesh.ops.triangulate(bm, faces=filled)
        bm.normal_update()
    # Smoothed blank, but for its rim (so it joins the rest of the head as it was).
    inner = [v for v in R if v.is_valid and all(e.other_vert(v) in R for e in v.link_edges)]
    for _ in range(60):
        bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(me)
    bm.free()
    me.update()
    print('   face blanked:', cut, 'hidden faces cut,', len(inner), 'vertices smoothed')


for o in meshes:
    if len(o.data.polygons) and any(kind_of(m.name) == 'skin' for m in o.data.materials if m):
        blank_face(o)

# ---- The weights onto the mob's bones (as groups, so the cutting down blends them), then cut down: the hair on
# its own budget, then all one mesh ----
for o in meshes:
    me = o.data
    names = [g.name for g in o.vertex_groups]
    sums = np.zeros((len(me.vertices), 14))
    for v in me.vertices:
        for g in v.groups:
            n = names[g.group]
            if n in to_mob:
                sums[v.index, to_mob[n]] += g.weight
    for g in [g for g in o.vertex_groups if not g.name.startswith('mobkind_')]:
        o.vertex_groups.remove(g)
    for b in range(14):
        idx = np.nonzero(sums[:, b] > 1e-4)[0]
        if len(idx) == 0:
            continue
        g = o.vertex_groups.new(name='mb_%d' % b)
        for i in idx:
            g.add([int(i)], float(sums[i, b]), 'REPLACE')


def tris_of(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def cut(o, target):
    n = tris_of(o)
    if n <= target:
        return
    activate(o)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0002)
    bpy.ops.object.mode_set(mode='OBJECT')
    m = o.modifiers.new('cut', 'DECIMATE')
    m.ratio = target / max(1, tris_of(o))
    m.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=m.name)


hair = [o for o in meshes if all(kind_of(m.name) == 'hair' for m in o.data.materials if m)]
rest = [o for o in meshes if o not in hair]
total = {'hair': sum(tris_of(o) for o in hair), 'rest': sum(tris_of(o) for o in rest)}
for o in hair:
    cut(o, TRIS * HAIR_SHARE * tris_of(o) / max(1, total['hair']))
for o in rest:
    cut(o, TRIS * (1 - HAIR_SHARE if hair else 1) * tris_of(o) / max(1, total['rest']))
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
activate(ob)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.quads_convert_to_tris()
bpy.ops.object.mode_set(mode='OBJECT')
me = ob.data
print('CUT', total, '->', tris_of(ob), 'triangles,', len(me.vertices), 'vertices')

# ---- Out, in the mob's frame: Blender's x across, z up, the model facing -y; scaled to the height asked ----
names = [g.name for g in ob.vertex_groups]
mw = ob.matrix_world
co = np.array([mw @ v.co for v in me.vertices])
no = np.array([(mw.to_3x3() @ v.normal).normalized() for v in me.vertices])
kind = np.zeros((len(me.vertices), 5))
bw = np.zeros((len(me.vertices), 14))
KINDS = ['hair', 'skin', 'bottom', 'shoe', 'white']
for v in me.vertices:
    for g in v.groups:
        n = names[g.group]
        if n.startswith('mb_'):
            bw[v.index, int(n[3:])] = g.weight
        elif n.startswith('mobkind_'):
            kind[v.index, KINDS.index(n[8:])] = g.weight
# The skull's top: the highest skin (the hair stands above it).
skin = kind[:, 1] > 0.5
top = float(co[skin][:, 2].max()) if skin.any() else float(co[:, 2].max())
s = HEIGHT / top
frame = lambda p: [round(float(p[0]) * s, 4), round(float(p[2]) * s, 4), round(float(-p[1]) * s, 4)]
pivots = [[0, 0, 0] for _ in range(14)]
for b, n in ((PELVIS, RIG['pelvis']), (SPINE, RIG['spine']), (HEAD, RIG['neck'])):
    pivots[b] = frame(head[n])
for part, lb, rb in (('thigh', THIGH_L, THIGH_R), ('shin', SHIN_L, SHIN_R), ('foot', FOOT_L, FOOT_R), ('arm', ARM_L, ARM_R), ('fore', FORE_L, FORE_R)):
    for side in SIDES:
        h = head[RIG[part] % side]
        pivots[lb if h.x < 0 else rb] = frame(h)
hip_y = pivots[THIGH_L][1]
neck_y = pivots[HEAD][1]

b0 = np.zeros(len(me.vertices), dtype=int)
b1 = np.zeros(len(me.vertices), dtype=int)
w = np.ones(len(me.vertices))
shade = np.zeros(len(me.vertices))
for i in range(len(me.vertices)):
    order = np.argsort(-bw[i])
    a, b = int(order[0]), int(order[1])
    wa, wb = bw[i, a], bw[i, b]
    if wa <= 1e-6:
        a, b, wa, wb = PELVIS, PELVIS, 1.0, 0.0
    if wb <= 1e-6:
        b, wb = a, 0.0
    x, y, z = co[i, 0] * s, co[i, 2] * s, -co[i, 1] * s
    k = kind[i]
    is_hair = k[0] > 0.5
    if is_hair and y < neck_y + 0.02:
        # Hair below the neck lies on the shoulders and back: it goes with the body, not the turning head.
        t = min(1.0, (neck_y + 0.02 - y) / 0.1)
        a, b, wa, wb = HEAD, SPINE, 1 - t, t
    elif a == PELVIS and wa / (wa + wb) > 0.75 and y < hip_y - 0.02 and not k[1] > 0.5:
        # A skirt or a coat below the hips: each side follows its thigh, more of it lower down (as real/people.ts drapes).
        t = min(1.0, (hip_y - y) / 0.3)
        a, b, wa, wb = (THIGH_L if x < 0 else THIGH_R), PELVIS, 0.25 + 0.65 * t, 0.75 - 0.65 * t
    b0[i], b1[i], w[i] = a, b, wa / (wa + wb)
    shade[i] = HAIR if is_hair else SKIN if k[1] > 0.5 else SHOE if k[3] > 0.5 else BOTTOM if k[2] > 0.5 else WHITE if k[4] > 0.5 else TOP

pos = [c for p in co for c in frame(p)]
nor = [round(float(c), 3) for n in no for c in (n[0], n[2], -n[1])]
idx = [int(v) for p in me.polygons for v in p.vertices]
# (Blender's faces wind the same way round in the mob's frame: x, z-up, -y is a rotation, not a mirror.)
doc = {
    'name': opt['name'], 'body': opt['body'], 'source': os.path.basename(src), 'height': HEIGHT, 'triangles': len(idx) // 3,
    'armOut': ARM_OUT, 'pivot': pivots, 'pos': pos, 'nor': nor,
    'b0': [int(v) for v in b0], 'b1': [int(v) for v in b1], 'w': [round(float(v), 3) for v in w], 'shade': [float(v) for v in shade], 'idx': idx,
}
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
with open(out, 'w') as f:
    json.dump(doc, f, separators=(',', ':'))
print('WROTE', out, doc['triangles'], 'triangles', len(me.vertices), 'vertices', 'scale', round(s, 3), 'hip', hip_y, 'neck', neck_y, 'size', os.path.getsize(out) // 1024, 'KB')

# ---- A look at it (front and side), for judging the cut ----
if opt['preview']:
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'SINGLE'
    scene.display.shading.single_color = (0.55, 0.56, 0.6)
    scene.display.shading.show_cavity = True
    scene.render.resolution_x, scene.render.resolution_y = 700, 1000
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = top * 1.12
    for tag, loc, rot in (('front', (0, -6, top / 2), (math.pi / 2, 0, 0)), ('side', (-6, 0, top / 2), (math.pi / 2, 0, -math.pi / 2)), ('back', (0, 6, top / 2), (math.pi / 2, 0, math.pi)), ('q', (-4.2, -4.2, top / 2), (math.pi / 2, 0, -math.pi / 4))):
        cam.location, cam.rotation_euler = loc, rot
        scene.render.filepath = opt['preview'].replace('.png', '_%s.png' % tag)
        bpy.ops.render.render(write_still=True)
