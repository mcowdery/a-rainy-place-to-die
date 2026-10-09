"""The shoulders, neck, arms and hands of a rigged reference model in refs/models/, as numbers to set ours against:
where its joints are (as shares of its height), how long each part is, how its arm is held at rest, how thick neck,
arm and wrist are, how many points go round the arm along its length, and which bones the skin goes with from the
chest out along the arm (the hand-over at the shoulder, and the twist bones).

    "<blender.exe>" -b --python scripts/refs/measure_upper.py -- <name>

Reference models are looked at and measured, never used in the game (refs/README.md)."""
import bpy, os, re, sys
from collections import defaultdict
from mathutils import Vector

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'refs', 'models')
name = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, name, 'model.glb'))
arm = max((o for o in bpy.context.scene.objects if o.type == 'ARMATURE'), key=lambda o: len(o.data.bones))
bones = arm.data.bones


def bone(pattern):
    hits = [b for b in bones if re.search(pattern, b.name, re.I) and not re.search('end|adjust', b.name, re.I)]
    return hits[0] if hits else None


# (As the file poses her, not at the skeleton's rest: a model brought through other programs can have its skin and
# its skeleton's rest at different scales and places, which only the pose puts right. So everything is measured on
# the posed skin against the posed bones, along the bones: lengths, thickness, the skin's bones hold in any pose.)
bpy.context.scene.frame_set(bpy.context.scene.frame_start)
dg = bpy.context.evaluated_depsgraph_get()


def head_of(b):
    return arm.matrix_world @ arm.pose.bones[b.name].head


J = {k: bone(p) for k, p in {
    'pelvis': r'Bip001-Pelvis', 'spine': r'Bip001-Spine_', 'spine1': r'Bip001-Spine1', 'spine2': r'Bip001-Spine2', 'neck': r'Bip001-Neck', 'head': r'Bip001-Head',
    'clavicle': r'Bip001-L-Clavicle', 'upperarm': r'Bip001-L-UpperArm', 'forearm': r'Bip001-L-Forearm', 'hand': r'Bip001-L-Hand',
    'thumb0': r'Bip001-L-Finger0_', 'thumb1': r'Bip001-L-Finger01', 'thumb2': r'Bip001-L-Finger02', 'index0': r'Bip001-L-Finger1_', 'index1': r'Bip001-L-Finger11', 'index2': r'Bip001-L-Finger12',
    'middle0': r'Bip001-L-Finger2_', 'middle1': r'Bip001-L-Finger21', 'middle2': r'Bip001-L-Finger22', 'little0': r'Bip001-L-Finger4_',
    'thigh': r'Bip001-L-Thigh', 'foot': r'Bip001-L-Foot', 'uptwist': r'Bone-L-UpperArm-Twist_', 'uptwist1': r'Bone-L-UpperArm-Twist1', 'foretwist': r'Bone-L-ForeArm-Twist_', 'foretwist1': r'Bone-L-ForeArm-Twist1',
}.items()}
P = {k: head_of(b) for k, b in J.items() if b}
# The skin: the skinned meshes on this skeleton, in the world.
verts = []  # (position, {bone name: weight})
for o in bpy.context.scene.objects:
    if o.type != 'MESH' or not any(m.type == 'ARMATURE' and m.object == arm for m in o.modifiers):
        continue
    mat = ', '.join(s.material.name for s in o.material_slots if s.material)
    if re.search('hair|face|eye|brow|mask', mat, re.I):
        continue
    names = [g.name for g in o.vertex_groups]
    eo = o.evaluated_get(dg)
    posed = eo.to_mesh()
    for v, q in zip(o.data.vertices, posed.vertices):
        verts.append((eo.matrix_world @ q.co, {names[g.group]: g.weight for g in v.groups if g.weight > 0.01}))
    eo.to_mesh_clear()
up = 2 if max(abs(P['head'].z - P['pelvis'].z), 0) > abs(P['head'].y - P['pelvis'].y) else 1
floor = min(p[up] for p, _ in verts)
top = max(p[up] for p, _ in verts)
H = top - floor
print(f'== {name}: {len(bones)} bones, {len(verts)} skin points; up is {"xyz"[up]}; height (skin) {H:.3f} units')
print('joints, height above the floor as a share of her height, and distance out from the middle:')
side = 0
for k in ['head', 'neck', 'spine2', 'spine1', 'spine', 'pelvis', 'clavicle', 'upperarm', 'forearm', 'hand', 'thigh', 'foot']:
    if k in P:
        print(f'   {k:9} up {(P[k][up] - floor) / H:.3f}   out {abs(P[k][side] - P["pelvis"][side]) / H:.3f}')
L = lambda a, b: (P[a] - P[b]).length / H
print(f'lengths as shares of her height: clavicle {L("clavicle", "upperarm"):.3f}, upper arm {L("upperarm", "forearm"):.3f}, forearm {L("forearm", "hand"):.3f}, '
      f'hand to middle knuckle {L("hand", "middle0"):.3f}, middle finger {L("middle0", "middle1") + L("middle1", "middle2"):.3f}+tip, neck {L("neck", "head"):.3f}, shoulders across {2 * abs(P["upperarm"][side] - P["pelvis"][side]) / H:.3f}')
d = (P['forearm'] - P['upperarm']).normalized()
down = Vector((0, 0, 0))
down[up] = -1
print(f'the arm at rest: {__import__("math").degrees(d.angle(down)):.0f} degrees out from hanging straight down')
# Along the arm from the shoulder's joint: points round it, its thickness, and which bones its skin goes with.
ARM = (P['hand'] - P['upperarm']).length
groups = {'chest (spine)': r'Spine', 'clavicle': r'Clavicle', 'upper arm': r'L-UpperArm_', 'upper arm twist': r'L-UpperArm-Twist', 'forearm': r'L-Forearm_', 'forearm twist': r'L-ForeArm-Twist', 'elbow helpers': r'l_elbow', 'hand': r'L-Hand', 'other': r'.'}
print('along the arm from the shoulder joint (share of shoulder-to-wrist), on her left: points near the line of the arm, how thick the arm is (share of height), and the bones its skin goes with most:')
for i in range(-2, 22):
    a, b = i * 0.05, (i + 1) * 0.05
    slab = []
    for p, w in verts:
        r = p - P['upperarm']
        t = r.dot(d if r.dot(d) < (P['forearm'] - P['upperarm']).length else d) / ARM
        off = (r - d * r.dot(d)).length
        # (Only what is the arm's own or the shoulder's: not the ribs it hangs beside.)
        mine = sum(x for bn, x in w.items() if re.search(r'-L-|_l_|Clavicle', bn))
        if a <= t < b and off < 0.06 * H and mine > 0.3:
            slab.append((off, w))
    if not slab:
        continue
    sums = defaultdict(float)
    for _, w in slab:
        total = sum(w.values()) or 1
        for bn, x in w.items():
            sums[re.sub(r'_\d+$', '', bn).replace('Bip001-', '').replace('Bone-', '')] += x / total
    share = ', '.join(f'{g} {v / len(slab):.2f}' for g, v in sorted(sums.items(), key=lambda q: -q[1])[:4] if v / len(slab) >= 0.04)
    offs = sorted(o for o, _ in slab)
    print(f'   {a:+.2f}..{b:+.2f}: {len(slab):4} points, thick {2 * offs[int(len(offs) * 0.9)] / H:.3f}   {share}')
# The hand: each finger's bones' lengths, and how many points go round a finger.
print('the hand (shares of her height): ' + ', '.join(f'{k} {L(k + "0", k + "1"):.3f}+{L(k + "1", k + "2"):.3f}' for k in ['thumb', 'index', 'middle']) + f'; knuckles across (index to little) {L("index0", "little0"):.3f}')
for k in ['index1', 'middle1']:
    b = J[k]
    ring = [p for p, w in verts if w.get(b.name, 0) > 0.5]
    print(f'   points mostly on {k}: {len(ring)}')
# Level slices of the neck and shoulders.
print('level slices (share of height up): width and depth of the skin there, as shares of height:')
for f in [0.90, 0.88, 0.86, 0.85, 0.84, 0.83, 0.82, 0.81, 0.80, 0.78, 0.76, 0.74, 0.72, 0.70]:
    pts = [p for p, _ in verts if abs((p[up] - floor) / H - f) < 0.006]
    if not pts:
        continue
    other = 3 - up - side
    near = [p for p in pts if abs(p[side] - P['pelvis'][side]) < 0.16 * H]
    w = (max(p[side] for p in near) - min(p[side] for p in near)) / H
    dp = (max(p[other] for p in near) - min(p[other] for p in near)) / H
    print(f'   {f:.2f}: wide {w:.3f}, deep {dp:.3f} ({len(near)} points within reach of the body)')
# The body's own outline without the arms (the skin that goes mostly with the spine, collar bones, neck and head): its
# half width and depth by height, for the slope of the shoulders and the neck's thickness.
print('the body without its arms, by height (share of height): half width, depth')
for i in range(92, 69, -1):
    f = i / 100
    pts = [p for p, w in verts if abs((p[up] - floor) / H - f) < 0.005 and sum(x for bn, x in w.items() if re.search(r'Spine|Clavicle|Neck|Head', bn)) > 0.5]
    if len(pts) < 4:
        continue
    other = 3 - up - side
    mid = P['pelvis'][side]
    print(f'   {f:.2f}: half width {max(abs(p[side] - mid) for p in pts) / H:.3f}, depth {(max(p[other] for p in pts) - min(p[other] for p in pts)) / H:.3f}')
