"""Mixamo FBX clips -> one JSON of the motion, for scripts/anims/mixamo.mjs (which writes the library's glb).

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --python scripts/anims/mixamo_export.py -- <folder of .fbx> <out.json>

Each file is one clip (its skeleton is Mixamo's `mixamorig:` rig, which the animations come on whatever the character).
For the bones the library uses (the cast's names, as in scripts/anims/cmu.mjs) it writes:
  rest   where each bone's head is at rest (the T-pose), metres, in a frame turned to face +z with +y up (the cast's);
  turns  per frame, each bone's turn in that frame's axes from its rest orientation (so rest is the identity, as in the
         library's other clips: models/characterAnims.ts fits it to a character from there);
  hips   per frame, where the pelvis is.
The frame is found from the skeleton itself (left leg to right leg), so it doesn't depend on how Blender oriented the
import. The fingers are carried too (all fifteen a hand).
"""
import json
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

# The cast's bone, the Mixamo bone it takes (as scripts/anims/cmu.mjs's table, with Mixamo's three spine bones).
BONES = {
    'pelvis': 'Hips', 'spine_01': 'Spine', 'spine_02': 'Spine1', 'spine_03': 'Spine2', 'neck_01': 'Neck', 'head': 'Head',
}
for side, s in (('l', 'Left'), ('r', 'Right')):
    BONES.update({
        f'clavicle_{side}': f'{s}Shoulder', f'upperarm_{side}': f'{s}Arm', f'lowerarm_{side}': f'{s}ForeArm',
        f'hand_{side}': f'{s}Hand', f'thigh_{side}': f'{s}UpLeg', f'calf_{side}': f'{s}Leg', f'foot_{side}': f'{s}Foot',
        f'ball_{side}': f'{s}ToeBase',
    })
    # The fingers: the cast's thumb_01_l.. index_01_l.. are Mixamo's LeftHandThumb1.. (the fourth joint is the tip).
    for finger, m in (('thumb', 'Thumb'), ('index', 'Index'), ('middle', 'Middle'), ('ring', 'Ring'), ('pinky', 'Pinky')):
        for k in (1, 2, 3):
            BONES[f'{finger}_0{k}_{side}'] = f'{s}Hand{m}{k}'

args = sys.argv[sys.argv.index('--') + 1:]
folder, out = args[:2]
files = sorted(n for n in os.listdir(folder) if n.lower().endswith('.fbx'))
if len(args) > 3:  # a slice: <offset> <count>, to do a big folder in batches
    files = files[int(args[2]):int(args[2]) + int(args[3])]
clips = {}
for name in files:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        bpy.ops.import_scene.fbx(filepath=os.path.join(folder, name))
    except Exception as err:
        print('SKIP (import failed: %s):' % err, name)
        continue
    arms = [o for o in bpy.data.objects if o.type == 'ARMATURE']
    if not arms or not arms[0].animation_data or not arms[0].animation_data.action:
        print('SKIP (no armature or action):', name)
        continue
    arm = arms[0]
    action = arm.animation_data.action
    world = arm.matrix_world
    bones = arm.data.bones
    pose = arm.pose.bones
    missing = [b for b in BONES.values() if 'mixamorig:' + b not in bones]
    if missing:
        print('SKIP (bones missing %s):' % missing[:3], name)
        continue

    def rest_pos(b):
        return world @ bones['mixamorig:' + b].head_local

    # The frame: x from the right leg to the left (the character's left is +x facing +z), y up, z = x cross y.
    side = rest_pos('LeftUpLeg') - rest_pos('RightUpLeg')
    side.z = 0
    side.normalize()
    up = Vector((0, 0, 1))
    fwd = side.cross(up)
    frame = Matrix((side, up, fwd))  # rows: the new x, y, z in the import's axes (right-handed: x cross y = z)
    if frame.determinant() < 0:
        raise SystemExit('frame is not right-handed: ' + name)
    qf = frame.to_quaternion()

    def to_frame_pos(v):
        return frame @ v

    def to_frame_rot(m3):
        q = m3.normalized().to_quaternion()
        return qf @ q @ qf.inverted()

    rest = {c: list(to_frame_pos(rest_pos(b))) for c, b in BONES.items()}
    rest_rot = {c: to_frame_rot((world @ bones['mixamorig:' + b].matrix_local).to_3x3()) for c, b in BONES.items()}
    start, end = int(action.frame_range[0]), int(action.frame_range[1])
    scene = bpy.context.scene
    turns = {c: [] for c in BONES}
    hips = []
    for f in range(start, end + 1):
        scene.frame_set(f)
        for c, b in BONES.items():
            pb = pose['mixamorig:' + b]
            q = to_frame_rot((world @ pb.matrix).to_3x3()) @ rest_rot[c].inverted()
            turns[c].append([q.x, q.y, q.z, q.w])
        hips.append(list(to_frame_pos(world @ pose['mixamorig:Hips'].head)))
    clips[name[:-4]] = {'fps': scene.render.fps, 'rest': rest, 'turns': turns, 'hips': hips, 'action': action.name}
    print('OK %-40s %3d frames at %d fps, hips %.2f m' % (name, end - start + 1, scene.render.fps, rest['pelvis'][1]))

with open(out, 'w') as fh:
    json.dump(clips, fh, separators=(',', ':'))
print('wrote', out, len(clips), 'clips')
