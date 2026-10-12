"""Poses a Quaternius animal (CC0: Animal Pack Vol.2's cat and dog, as .glb) at rest, by forward kinematics, and renders each pose from the side.

  blender -b -P scripts/animals/pose.py -- <cat|dog> <in.glb> <out dir> [export <out.glb>]

A pose is a table of angles (degrees, about the world's Y axis, added to a bone's rest direction: negative lifts the
bone's far end, towards +Z), bone by bone from the pelvis out; each bone's head follows from its parent's, and the
whole body is then lowered to stand on the ground. `export` also writes the .glb with the poses added as one-frame
an action (Sit) beside the pack's Idle and Walking.
"""
import sys, math, bpy
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
KIND, SRC, OUT = args[0], args[1], args[2]
EXPORT = args[args.index("export") + 1] if "export" in args else None

# Bone names in both models (the same rig): the spine from the pelvis, the neck and head, the tail, the front legs, the back legs.
PELVIS, CHEST, NECK, HEAD = "Bone", "Bone.001", "Bone.002", "Bone.003"
TAIL = ["Bone.004", "Bone.005", "Bone.006", "Bone.007"]
FRONT = [["Bone.014", "Bone.015", "Bone.016"], ["Bone.017", "Bone.018", "Bone.019"]]
BACK = [["Bone.008", "Bone.009", "Bone.010"], ["Bone.011", "Bone.012", "Bone.013"]]

POSES = {
    "cat": {
        "Sit": {PELVIS: -55, CHEST: -45, NECK: -30, HEAD: 2,
                **{b: a for leg in BACK for b, a in zip(leg, (-72, 28, 0))},
                **{b: 0 for leg in FRONT for b in leg},
                "Bone.004": -75, "Bone.005": -30, "Bone.006": -10, "Bone.007": 0},
    },
    "dog": {
        "Sit": {PELVIS: -55, CHEST: -45, NECK: -30, HEAD: 2,
                **{b: a for leg in BACK for b, a in zip(leg, (-72, 28, 0))},
                **{b: 0 for leg in FRONT for b in leg},
                "Bone.004": -75, "Bone.005": -30, "Bone.006": -10, "Bone.007": 0},
    },
}[KIND]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
for o in list(bpy.data.objects):
    if o.type == "MESH" and not o.data.materials:
        bpy.data.objects.remove(o)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
bones = arm.data.bones
# (The pack's own clips are kept, but not playing: a playing clip would overwrite the pose.)
for a in bpy.data.actions:
    a.use_fake_user = True
if arm.animation_data:
    arm.animation_data.action = None
    for t in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(t)


def ry(deg):
    return Matrix.Rotation(math.radians(deg), 3, "Y")


def solve(deltas):
    """Every bone's pose matrix for these deltas: its rest orientation turned by its delta, its head carried by its parent's."""
    new = {}
    for b in bones:  # (bones come parents first)
        d = deltas.get(b.name, 0.0)
        rest3 = b.matrix_local.to_3x3()
        if b.parent is None:
            head = b.head_local.copy()
        else:
            p = b.parent
            head = new[p.name].translation + ry(deltas.get(p.name, 0.0)) @ (b.head_local - p.head_local)
        m = (ry(d) @ rest3).to_4x4()
        m.translation = head
        new[b.name] = m
    return new


FOOT = 0.04


def apply_pose(deltas, ground_back=True):
    """Sets every pose bone from the deltas, the front paws on the ground, and (ground_back) the hind thigh turned until the hind feet are too."""
    deltas = dict(deltas)
    best = None
    for t in range(-130, 0, 2) if ground_back else [deltas[BACK[0][0]]]:
        for leg in BACK:
            deltas[leg[0]] = t
        new = solve(deltas)
        front = min(new[leg[2]].translation.z for leg in FRONT)
        hind = min(new[leg[2]].translation.z for leg in BACK) - front
        err = abs(hind)
        if best is None or err < best[0]:
            best = (err, t)
    for leg in BACK:
        deltas[leg[0]] = best[1]
    new = solve(deltas)
    lift = FOOT - min(new[leg[2]].translation.z for leg in FRONT)
    for m in new.values():
        m.translation.z += lift
    print("thigh", best)
    for b in bones:
        pb = arm.pose.bones[b.name]
        pb.rotation_mode = "QUATERNION"
        if b.parent is None:
            base = b.matrix_local
        else:
            base = new[b.parent.name] @ b.parent.matrix_local.inverted() @ b.matrix_local
        pb.matrix_basis = base.inverted() @ new[b.name]
    bpy.context.view_layer.update()


def rest_pose():
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()


def render(name):
    scn = bpy.context.scene
    scn.render.engine = "BLENDER_WORKBENCH"
    scn.render.resolution_x, scn.render.resolution_y = 600, 450
    scn.display.shading.light = "STUDIO"
    scn.display.shading.color_type = "SINGLE"
    scn.display.shading.single_color = (0.75, 0.7, 0.62)
    scn.world = bpy.data.worlds.new("w")
    scn.world.color = (0.16, 0.17, 0.2)
    if "cam" not in bpy.data.objects:
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        scn.collection.objects.link(cam)
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = 9.5
        cam.location = (0.5, -30, 2.2)
        cam.rotation_euler = (math.radians(90), 0, 0)
        scn.camera = cam
    scn.render.filepath = f"{OUT}/{KIND}-{name}.png"
    bpy.ops.render.render(write_still=True)


import os
os.makedirs(OUT, exist_ok=True)
rest_pose()
render("rest")
actions = {}
for name, deltas in POSES.items():
    apply_pose(deltas, ground_back=(name == 'Sit'))
    render(name)
    if EXPORT:
        act = bpy.data.actions.new(name)
        arm.animation_data.action = act
        for pb in arm.pose.bones:
            pb.keyframe_insert("location", frame=1)
            pb.keyframe_insert("rotation_quaternion", frame=1)
            pb.keyframe_insert("scale", frame=1)
        act.use_fake_user = True
        actions[name] = act
        arm.animation_data.action = None
if EXPORT:
    rest_pose()
    for a in bpy.data.actions:
        short = a.name.split("|")[-1]
        a.name = {"Walking": "Walk"}.get(short, short)
    bpy.ops.export_scene.gltf(filepath=EXPORT, export_format="GLB", export_animations=True, export_skins=True, export_animation_mode="ACTIONS")
    print("exported", EXPORT, [a.name for a in bpy.data.actions])
